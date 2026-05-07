// quiz_engine.js — Question sampling and session building
'use strict';

const QuizEngine = (function () {
  const MARKERS = ['①', '②', '③', '④'];

  let EXAM_ALLOC = {};
  let stmtMap    = {};
  let qBank      = [];
  let notesByTopicKey = {};

  // ── Init ──────────────────────────────────────────────────────────────────

  function init(statements, questions, notes) {
    EXAM_ALLOC = window.THUNDER_EXAM_ALLOC || {};
    stmtMap = Object.create(null);
    // statements may be empty array for exam_C — guard all accesses
    if (Array.isArray(statements)) {
      statements.forEach(s => { if (s && s.statement_id) stmtMap[s.statement_id] = s; });
    }

    qBank = (questions || [])
      .filter(q => q.correct_marker != null)
      .map(normalizeQuestion);

    notesByTopicKey = Object.create(null);
    (notes || []).forEach(n => {
      // exam_A/B: n.topic_path[0];  exam_C: n.topic_path[0] or '기타'
      const key = (n.topic_path && n.topic_path[0]) || '기타';
      if (!notesByTopicKey[key]) notesByTopicKey[key] = [];
      notesByTopicKey[key].push(n);
    });
  }

  // ── Calc-mode detection ───────────────────────────────────────────────────

  function isCalcMode() {
    return qBank.length > 0 && qBank[0].question_format === 'calc';
  }

  // ── Topic key helpers ─────────────────────────────────────────────────────

  function getTopicKey(q) {
    return (q.topic_path && q.topic_path[0]) || q.section || '기타';
  }

  function formatTopicKey(key) {
    // exam_A/B: '3과목1편' → '3과목 1편'
    return key.replace(/(\d+과목)(\d+편)/, '$1 $2');
  }

  function topicKeyOrder(key) {
    // exam_A/B: '1과목1편', '2과목3편'
    const m1 = key.match(/^(\d+)과목(\d+)편/);
    if (m1) return [parseInt(m1[1], 10) * 100, parseInt(m1[2], 10)];
    // exam_C: '1과목', '2과목', '3과목-1', '3과목-2', '신유형'
    const m2 = key.match(/^(\d+)과목(?:-(\d+))?/);
    if (m2) return [parseInt(m2[1], 10) * 100, m2[2] ? parseInt(m2[2], 10) : 0];
    return [9999, 0]; // '신유형', '기타' sort last
  }

  // ── Topic / Subtopic selectors ────────────────────────────────────────────

  function getTopicsWithMeta() {
    const metaMap = {};
    qBank.forEach(q => {
      const k = getTopicKey(q);
      const t = (q.topic_path && q.topic_path[1]) || '';
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
      const formatted = formatTopicKey(k);
      const examAlloc = EXAM_ALLOC[k] || null;
      const displayNum = examAlloc !== null ? examAlloc : bankCount;
      const label = title
        ? `${formatted} - ${title} (${displayNum}문항)`
        : `${formatted} (${displayNum}문항)`;
      return { key: k, label, examAlloc, bankCount };
    });

    const totalAlloc = Object.values(EXAM_ALLOC).reduce((s, v) => s + v, 0);
    const totalBank  = qBank.length;
    return [{ key: '전체', label: `전체 (${totalAlloc || totalBank}문항)`, examAlloc: totalAlloc, bankCount: totalBank }, ...items];
  }

  function getTopics() {
    return getTopicsWithMeta().map(m => m.key);
  }

  function getSubtopics(topic) {
    const pool = (topic === '전체')
      ? qBank
      : qBank.filter(q => getTopicKey(q) === topic);
    const seen = new Set();
    pool.forEach(q => { if (q.topic_path && q.topic_path[1]) seen.add(q.topic_path[1]); });
    return ['전체', ...Array.from(seen).sort()];
  }

  // ── Pool size & coverage ──────────────────────────────────────────────────

  function getPoolSize(topic, subtopic, highYieldOnly) {
    let pool = [...qBank];
    if (topic && topic !== '전체') {
      pool = pool.filter(q => getTopicKey(q) === topic);
    }
    if (subtopic && subtopic !== '전체') {
      pool = pool.filter(q => q.topic_path && q.topic_path[1] === subtopic);
    }
    if (highYieldOnly) {
      pool = pool.filter(q => questionMaxFreq(q) >= 3);
    }
    return pool.length;
  }

  function getCoverageForFilter(topic, subtopic, answeredMap) {
    let pool = [...qBank];
    if (topic && topic !== '전체') {
      pool = pool.filter(q => getTopicKey(q) === topic);
    }
    if (subtopic && subtopic !== '전체') {
      pool = pool.filter(q => q.topic_path && q.topic_path[1] === subtopic);
    }
    const seen = pool.filter(q => answeredMap && answeredMap[q.question_id]).length;
    return { seen, total: pool.length };
  }

  // ── Weighting ─────────────────────────────────────────────────────────────

  function questionMaxFreq(q) {
    // After normalizeQuestion(), q.frequency is always set.
    return q.frequency;
  }

  function questionFreqWeight(q, alpha) {
    if (alpha === 0) return 1;
    return Math.pow(questionMaxFreq(q), alpha);
  }

  // ── Option text cleaner (B1) ──────────────────────────────────────────────
  //
  // Strips trailing noise from option text caused by PDF parser boundary leaks.
  // Patterns (matched left-to-right; truncation at first match past position 20):
  //   "가: / 나: / 다: / 라:" — start of next explanation item bled into option
  //   "즉 / ▶ / ▷ / ※"      — explanation trigger words
  //   "N개 가:"              — count-type answer bleeding into next label
  // Guard: text shorter than 30 chars is returned unchanged (avoids false
  // positives on very short options where the trigger char may be intentional).

  function cleanOption(text) {
    if (!text || text.length < 30) return text;
    const triggers = [
      /\s+(?:가|나|다|라):\s*/,
      /\s+(?:즉|▶|▷|※)\s+/,
      /\s+\d{1,2}개\s+(?:가|나|다|라):/,
    ];
    for (const re of triggers) {
      const m = text.match(re);
      if (m && m.index > 20) return text.slice(0, m.index).trim();
    }
    return text;
  }

  // ── Canonical normalizer ─────────────────────────────────────────────────
  //
  // Called in init() on every question before it enters qBank.
  // Ensures all downstream code sees a single, stable schema:
  //   q.options   → [{origKey, text, statement_id}]  (always array)
  //   q.frequency → number (always set)
  //   q.q_no      → string | null

  function normalizeQuestion(q) {
    // Options: unify object-format (exam_A/B) and array-format (exam_C)
    let opts;
    if (Array.isArray(q.options)) {
      opts = q.options.map(o => ({
        origKey:      o.marker,
        text:         cleanOption(o.text || ''),
        statement_id: null,
      }));
    } else {
      opts = Object.entries(q.options || {}).map(([k, v]) => ({
        origKey:      k,
        text:         cleanOption((v && typeof v === 'object') ? (v.text || '') : String(v || '')),
        statement_id: (v && v.statement_id) || null,
      }));
    }

    // Frequency: use q.frequency if already set, else derive from statements
    let frequency = q.frequency;
    if (frequency == null) {
      const ids = opts.map(o => o.statement_id).filter(Boolean);
      frequency = ids.length > 0
        ? Math.max(...ids.map(id => (stmtMap[id] ? stmtMap[id].frequency : 1)))
        : 1;
    }

    // q_no: coerce to string
    const q_no = q.q_no != null ? String(q.q_no) : null;

    return { ...q, options: opts, frequency, q_no };
  }

  // ── Option ordering ───────────────────────────────────────────────────────
  //
  // 2026-05-02 — Fisher-Yates shuffle disabled.
  // Reason: explanation text and OX badges reference original PDF markers
  // (origKey). Shuffling caused ★정답 visual position, verdict text, and the
  // explanation's "②/③/④" mentions to point at three different visible
  // options. We now always preserve original order so origKey === displayKey
  // and every reference stays internally consistent.

  function orderOptions(q) {
    // q.options is already normalized to [{origKey, text, statement_id}].
    const markerOrder = { '①': 0, '②': 1, '③': 2, '④': 3, '⑤': 4 };
    const entries = [...q.options];
    entries.sort((a, b) => {
      const av = markerOrder[a.origKey];
      const bv = markerOrder[b.origKey];
      return (av == null ? 99 : av) - (bv == null ? 99 : bv);
    });
    return entries.map((e, i) => ({ ...e, displayKey: MARKERS[i] || e.origKey }));
  }

  // ── Calc-drill session builder ────────────────────────────────────────────

  function buildCalcDrillSession(opts) {
    const { topicFilter, wrongOnly = false, wrongList = [] } = opts || {};
    let pool = [...qBank];

    if (wrongOnly) {
      const wSet = new Set(wrongList);
      pool = pool.filter(q => wSet.has(q.question_id));
    } else if (topicFilter && topicFilter !== '전체') {
      pool = pool.filter(q => getTopicKey(q) === topicFilter);
    }

    // Sort by q_no numerically (e.g., '1', '1-1', '2', ...)
    pool.sort((a, b) => {
      const parseQno = q => {
        const lbl = (q.source && q.source.q_no_label) || q.q_no || '0';
        const m = String(lbl).match(/^(\d+)(?:-(\d+))?/);
        return m ? parseInt(m[1], 10) * 1000 + (m[2] ? parseInt(m[2], 10) : 0) : 0;
      };
      return parseQno(a) - parseQno(b);
    });

    return pool.map(q => ({ question: q, shuffledOptions: orderOptions(q) }));
  }

  // ── Weighted random sample ─────────────────────────────────────────────────

  function weightedSample(pool, count, alpha, answeredMap) {
    const items = pool.map(q => {
      let w = questionFreqWeight(q, alpha);
      const rec = answeredMap[q.question_id];
      if (!rec)          w *= 1.5;
      else if (!rec.correct) w *= 2.0;
      return { q, w };
    });

    const result = [], used = new Set();
    const cap = Math.min(count, items.length);
    for (let i = 0; i < cap; i++) {
      const avail = items.filter(x => !used.has(x.q.question_id));
      if (avail.length === 0) break;
      let total = avail.reduce((s, x) => s + x.w, 0);
      let r = Math.random() * total;
      let pick = avail[avail.length - 1];
      for (const item of avail) { r -= item.w; if (r <= 0) { pick = item; break; } }
      result.push(pick.q);
      used.add(pick.q.question_id);
    }
    return result;
  }

  // ── Proportional sampler ───────────────────────────────────────────────────

  function proportionalSample(totalCount, alpha, answeredMap, excludeIds, highYieldOnly) {
    const totalAlloc = Object.values(EXAM_ALLOC).reduce((s, v) => s + v, 0);

    const buckets = Object.keys(EXAM_ALLOC).map(key => ({
      key, raw: totalCount * EXAM_ALLOC[key] / totalAlloc, floor: 0, remainder: 0
    }));
    buckets.forEach(b => { b.floor = Math.floor(b.raw); b.remainder = b.raw - b.floor; });
    let spare = totalCount - buckets.reduce((s, b) => s + b.floor, 0);
    buckets.sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < spare; i++) buckets[i].floor++;

    const result = [];
    for (const { key, floor: target } of buckets) {
      if (target === 0) continue;
      let pool = qBank.filter(q => getTopicKey(q) === key);
      if (highYieldOnly) pool = pool.filter(q => questionMaxFreq(q) >= 3);
      if (excludeIds && excludeIds.size > 0) pool = pool.filter(q => !excludeIds.has(q.question_id));
      result.push(...weightedSample(pool, target, alpha, answeredMap));
    }
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // ── Session builder ───────────────────────────────────────────────────────

  function buildSession(options) {
    const {
      topic, subtopic, count, alpha,
      wrongOnly, wrongList = [], answeredMap = {},
      highYieldOnly = false,
      excludeIds = null
    } = options;

    // calc mode: delegate to sequential drill
    if (isCalcMode()) {
      return buildCalcDrillSession({ topicFilter: topic, wrongOnly, wrongList });
    }

    let sampled;

    if (wrongOnly) {
      const wSet = new Set(wrongList);
      let pool = qBank.filter(q => wSet.has(q.question_id));
      if (excludeIds && excludeIds.size > 0) pool = pool.filter(q => !excludeIds.has(q.question_id));
      sampled = weightedSample(pool, count, alpha, answeredMap);

    } else if (topic === '전체' && (!subtopic || subtopic === '전체')) {
      sampled = proportionalSample(count, alpha, answeredMap, excludeIds, highYieldOnly);

    } else {
      let pool = [...qBank];
      if (topic && topic !== '전체') {
        pool = pool.filter(q => getTopicKey(q) === topic);
      }
      if (subtopic && subtopic !== '전체') {
        pool = pool.filter(q => q.topic_path && q.topic_path[1] === subtopic);
      }
      if (highYieldOnly) pool = pool.filter(q => questionMaxFreq(q) >= 3);
      if (excludeIds && excludeIds.size > 0) pool = pool.filter(q => !excludeIds.has(q.question_id));
      sampled = weightedSample(pool, count, alpha, answeredMap);
    }

    return sampled.map(q => ({ question: q, shuffledOptions: orderOptions(q) }));
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  function getStatement(id) { return stmtMap[id] || null; }

  function getNotesForTopic(topicKey) { return notesByTopicKey[topicKey] || []; }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    init,
    isCalcMode,
    getTopics,
    getTopicsWithMeta,
    getSubtopics,
    getPoolSize,
    getCoverageForFilter,
    buildSession,
    buildCalcDrillSession,
    getStatement,
    getNotesForTopic,
  };
})();
