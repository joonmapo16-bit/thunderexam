// quiz_engine.js — Question sampling and session building
'use strict';

const QuizEngine = (function () {
  const MARKERS = ['①', '②', '③', '④'];

  // EXAM_ALLOC: loaded dynamically from window.THUNDER_EXAM_ALLOC (set by data.js).
  // Falls back to empty object — topics will show bank count instead of alloc count.
  let EXAM_ALLOC = {};

  let stmtMap    = {};   // statement_id  → statement object
  let qBank      = [];   // all questions (correct_marker != null)
  let notesByTopicKey = {}; // topic_path[0] → notes[]

  // ── Init ──────────────────────────────────────────────────────────────────

  function init(statements, questions, notes) {
    // Read exam alloc from data.js global (set before init() is called)
    EXAM_ALLOC = window.THUNDER_EXAM_ALLOC || {};
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

  // ── Topic key formatting ──────────────────────────────────────────────────

  // '3과목1편' → '3과목 1편'
  function formatTopicKey(key) {
    return key.replace(/(\d+과목)(\d+편)/, '$1 $2');
  }

  // Numeric sort order for keys like '1과목1편', '2과목3편', etc.
  function topicKeyOrder(key) {
    const m = key.match(/(\d+)과목(\d+)편/);
    if (!m) return [999, 999];
    return [parseInt(m[1], 10), parseInt(m[2], 10)];
  }

  // ── Topic / Subtopic selectors ────────────────────────────────────────────

  // Returns [{key, label, examAlloc, bankCount}, ...] sorted by 과목 → 편 order.
  // label format: '3과목 1편 - 직무윤리 (5문항)' — 문항수는 44회 실제 출제 배정 수
  function getTopicsWithMeta() {
    const metaMap = {}; // key → {title, bankCount}
    qBank.forEach(q => {
      const k = q.topic_path && q.topic_path[0];
      const t = q.topic_path && q.topic_path[1];
      if (!k) return;
      if (!metaMap[k]) metaMap[k] = { title: '', bankCount: 0 };
      if (t && !metaMap[k].title) metaMap[k].title = t;
      metaMap[k].bankCount++;
    });

    const keys = Object.keys(metaMap).sort((a, b) => {
      const [a1, a2] = topicKeyOrder(a);
      const [b1, b2] = topicKeyOrder(b);
      return a1 !== b1 ? a1 - b1 : a2 - b2;
    });

    const items = keys.map(k => {
      const { title, bankCount } = metaMap[k];
      const formatted  = formatTopicKey(k);
      // Show exam allocation (44회) when available; fall back to bank count
      const examAlloc  = EXAM_ALLOC[k] || null;
      const displayNum = examAlloc !== null ? examAlloc : bankCount;
      const label = title
        ? `${formatted} - ${title} (${displayNum}문항)`
        : `${formatted} (${displayNum}문항)`;
      return { key: k, label, examAlloc, bankCount };
    });

    const totalAlloc = Object.values(EXAM_ALLOC).reduce((s, v) => s + v, 0);
    return [{ key: '전체', label: `전체 (${totalAlloc}문항)`, examAlloc: totalAlloc, bankCount: qBank.length }, ...items];
  }

  // Legacy: plain string list for compatibility (unused internally but kept for safety)
  function getTopics() {
    return getTopicsWithMeta().map(m => m.key);
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

  // ── Pool size & coverage helpers ──────────────────────────────────────────

  // Returns total number of questions matching the given filter (before sampling).
  // Used as the denominator for coverage bars.
  function getPoolSize(topic, subtopic, highYieldOnly) {
    let pool = [...qBank];
    if (topic && topic !== '전체') {
      pool = pool.filter(q => q.topic_path && q.topic_path[0] === topic);
    }
    if (subtopic && subtopic !== '전체') {
      pool = pool.filter(q => q.topic_path && q.topic_path[1] === subtopic);
    }
    if (highYieldOnly) {
      pool = pool.filter(q => questionMaxFreq(q) >= 3);
    }
    return pool.length;
  }

  // Returns {seen, total} for a filter based on the answeredMap (historical coverage).
  // Used for the home-screen "학습 커버리지" bar.
  function getCoverageForFilter(topic, subtopic, answeredMap) {
    let pool = [...qBank];
    if (topic && topic !== '전체') {
      pool = pool.filter(q => q.topic_path && q.topic_path[0] === topic);
    }
    if (subtopic && subtopic !== '전체') {
      pool = pool.filter(q => q.topic_path && q.topic_path[1] === subtopic);
    }
    const seen = pool.filter(q => answeredMap && answeredMap[q.question_id]).length;
    return { seen, total: pool.length };
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

  // ── Proportional sampler (전체 선택 시) ──────────────────────────────────
  //
  // EXAM_ALLOC 비율에 따라 각 과목·편에서 targetCount를 할당하고,
  // 각 버킷에서 weightedSample을 실행한 뒤 셔플해서 합칩니다.
  // → "전체" 세션이 실제 시험 출제 비중을 반영하게 됩니다.
  //
  function proportionalSample(totalCount, alpha, answeredMap, excludeIds, highYieldOnly) {
    const totalAlloc = Object.values(EXAM_ALLOC).reduce((s, v) => s + v, 0); // 100

    // 각 과목·편에 할당할 문항 수 계산 (Largest Remainder Method)
    const buckets = Object.keys(EXAM_ALLOC).map(key => ({
      key,
      raw:       totalCount * EXAM_ALLOC[key] / totalAlloc,
      floor:     0,
      remainder: 0
    }));
    buckets.forEach(b => {
      b.floor     = Math.floor(b.raw);
      b.remainder = b.raw - b.floor;
    });
    let spare = totalCount - buckets.reduce((s, b) => s + b.floor, 0);
    buckets.sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < spare; i++) buckets[i].floor++;

    // 각 버킷에서 샘플링
    const result = [];
    for (const { key, floor: target } of buckets) {
      if (target === 0) continue;
      let pool = qBank.filter(q => q.topic_path && q.topic_path[0] === key);
      if (highYieldOnly) pool = pool.filter(q => questionMaxFreq(q) >= 3);
      if (excludeIds && excludeIds.size > 0) pool = pool.filter(q => !excludeIds.has(q.question_id));
      const sampled = weightedSample(pool, target, alpha, answeredMap);
      result.push(...sampled);
    }

    // 과목 순서 노출 방지를 위해 결과 셔플
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // ── Session builder ───────────────────────────────────────────────────────

  // options: { topic, subtopic, count, alpha, wrongOnly, wrongList, answeredMap,
  //            highYieldOnly, excludeIds }
  // excludeIds: Set<questionId> — questions to exclude (already-seen in this filter series).
  //             Pass null/undefined to disable exclusion.
  // Returns [{question, shuffledOptions}]
  function buildSession(options) {
    const {
      topic, subtopic, count, alpha,
      wrongOnly, wrongList = [], answeredMap = {},
      highYieldOnly = false,
      excludeIds = null
    } = options;

    let sampled;

    if (wrongOnly) {
      // 오답 드릴: 오답 목록에서만 샘플링
      const wSet = new Set(wrongList);
      let pool = qBank.filter(q => wSet.has(q.question_id));
      if (excludeIds && excludeIds.size > 0) pool = pool.filter(q => !excludeIds.has(q.question_id));
      sampled = weightedSample(pool, count, alpha, answeredMap);

    } else if (topic === '전체' && (!subtopic || subtopic === '전체')) {
      // 전체 선택: EXAM_ALLOC 비율에 따른 비중 샘플링
      sampled = proportionalSample(count, alpha, answeredMap, excludeIds, highYieldOnly);

    } else {
      // 특정 과목·편 또는 주제 선택: 기존 방식
      let pool = [...qBank];
      if (topic && topic !== '전체') {
        pool = pool.filter(q => q.topic_path && q.topic_path[0] === topic);
      }
      if (subtopic && subtopic !== '전체') {
        pool = pool.filter(q => q.topic_path && q.topic_path[1] === subtopic);
      }
      if (highYieldOnly) pool = pool.filter(q => questionMaxFreq(q) >= 3);
      if (excludeIds && excludeIds.size > 0) pool = pool.filter(q => !excludeIds.has(q.question_id));
      sampled = weightedSample(pool, count, alpha, answeredMap);
    }

    return sampled.map(q => ({
      question:        q,
      shuffledOptions: shuffleOptions(q)
    }));
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  function getStatement(id) {
    return stmtMap[id] || null;
  }

  function getNotesForTopic(topicKey) {
    return notesByTopicKey[topicKey] || [];
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    init,
    getTopics,
    getTopicsWithMeta,
    getSubtopics,
    getPoolSize,
    getCoverageForFilter,
    buildSession,
    getStatement,
    getNotesForTopic
  };
})();
