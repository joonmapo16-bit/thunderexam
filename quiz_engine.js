// quiz_engine.js — Question sampling and session building
'use strict';

const QuizEngine = (function () {
  const MARKERS = ['①', '②', '③', '④'];

  let stmtMap    = {};   // statement_id  → statement object
  let qBank      = [];   // all questions
  let notesByTopicKey = {}; // topic_path[0] → notes[]

  // ── Init ──────────────────────────────────────────────────────────────────

  function init(statements, questions, notes) {
    stmtMap = Object.create(null);
    statements.forEach(s => { stmtMap[s.statement_id] = s; });

    qBank = questions.filter(q => q.correct_marker != null);

    notesByTopicKey = Object.create(null);
    notes.forEach(n => {
      const key = (n.topic_path && n.topic_path[0]) || '기타';
      if (!notesByTopicKey[key]) notesByTopicKey[key] = [];
      notesByTopicKey[key].push(n);
    });
  }

  // ── Filters ───────────────────────────────────────────────────────────────

  // Returns ['전체', '3과목1편 · 직무윤리', ...]
  function getTopics() {
    const seen = new Set();
    qBank.forEach(q => {
      if (q.topic_path && q.topic_path[0]) seen.add(q.topic_path[0]);
    });
    return ['전체', ...Array.from(seen)];
  }

  // Returns subtopics for the given topic (or all if '전체')
  function getSubtopics(topic) {
    const pool = (topic === '전체')
      ? qBank
      : qBank.filter(q => q.topic_path && q.topic_path[0] === topic);
    const seen = new Set();
    pool.forEach(q => { if (q.topic_path && q.topic_path[1]) seen.add(q.topic_path[1]); });
    return ['전체', ...Array.from(seen).sort()];
  }

  // ── Weighting ─────────────────────────────────────────────────────────────

  // Max frequency of any statement linked to this question
  function questionMaxFreq(q) {
    const ids = Object.values(q.options).map(o => o.statement_id).filter(Boolean);
    if (ids.length === 0) return 1;
    return Math.max(...ids.map(id => (stmtMap[id] ? stmtMap[id].frequency : 1)));
  }

  // Base weight from statement frequency; alpha=0 → uniform, alpha=1 → freq-proportional
  function questionFreqWeight(q, alpha) {
    if (alpha === 0) return 1;
    return Math.pow(questionMaxFreq(q), alpha);
  }

  // ── Weighted random sample without replacement ─────────────────────────────

  function weightedSample(pool, count, alpha, answeredMap) {
    // Build weight vector — boost unseen and previously-wrong questions
    const items = pool.map(q => {
      let w = questionFreqWeight(q, alpha);
      const rec = answeredMap[q.question_id];
      if (!rec) {
        w *= 1.5;              // never seen — boost
      } else if (!rec.correct) {
        w *= 2.0;              // previously answered incorrectly — extra boost
      }
      return { q, w };
    });

    const result = [];
    const used   = new Set();
    const cap    = Math.min(count, items.length);

    for (let i = 0; i < cap; i++) {
      const avail = items.filter(x => !used.has(x.q.question_id));
      if (avail.length === 0) break;

      let total = avail.reduce((s, x) => s + x.w, 0);
      let r     = Math.random() * total;
      let pick  = avail[avail.length - 1]; // fallback

      for (const item of avail) {
        r -= item.w;
        if (r <= 0) { pick = item; break; }
      }

      result.push(pick.q);
      used.add(pick.q.question_id);
    }

    return result;
  }

  // ── Option shuffling ──────────────────────────────────────────────────────

  // Returns array of {origKey, displayKey, text, statement_id}
  // origKey = '①'…'④' from the JSON; displayKey = randomly reassigned '①'…'④'
  function shuffleOptions(q) {
    const entries = Object.entries(q.options).map(([k, v]) => ({
      origKey:      k,
      text:         v.text,
      statement_id: v.statement_id || null
    }));

    // Fisher-Yates
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }

    return entries.map((e, i) => ({ ...e, displayKey: MARKERS[i] }));
  }

  // ── Session builder ───────────────────────────────────────────────────────

  // options: { topic, subtopic, count, alpha, wrongOnly, wrongList, answeredMap, highYieldOnly }
  // Returns [{question, shuffledOptions}]
  function buildSession(options) {
    const { topic, subtopic, count, alpha, wrongOnly, wrongList = [], answeredMap = {}, highYieldOnly = false } = options;

    let pool = [...qBank];

    if (wrongOnly) {
      const wSet = new Set(wrongList);
      pool = pool.filter(q => wSet.has(q.question_id));
    } else {
      if (topic && topic !== '전체') {
        pool = pool.filter(q => q.topic_path && q.topic_path[0] === topic);
      }
      if (subtopic && subtopic !== '전체') {
        pool = pool.filter(q => q.topic_path && q.topic_path[1] === subtopic);
      }
    }

    if (highYieldOnly) {
      pool = pool.filter(q => questionMaxFreq(q) >= 3);
    }

    const sampled = weightedSample(pool, count, alpha, answeredMap);

    return sampled.map(q => ({
      question:        q,
      shuffledOptions: shuffleOptions(q)
    }));
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  function getStatement(id) {
    return stmtMap[id] || null;
  }

  // Returns notes[] for the given topic_path[0] key
  function getNotesForTopic(topicKey) {
    return notesByTopicKey[topicKey] || 