// progress.js — LocalStorage persistence layer
// Keys: thunderexam_v1_<examId>  (namespaced per exam)
// Migration: old 'thunderexam_v1' key is auto-migrated to 'thunderexam_v1_exam_A' on first load.
'use strict';

const Progress = (function () {
  const KEY_PREFIX = 'thunderexam_v1';
  const LEGACY_KEY = 'thunderexam_v1';  // old single-exam key

  // Returns the localStorage key for a given exam
  function storageKey(examId) {
    return KEY_PREFIX + '_' + (examId || 'exam_A');
  }

  function defaultState() {
    return {
      answered:      {},   // questionId → {correct:bool, count:int, lastSeen:timestamp}
      wrongList:     [],   // [questionId, ...]
      totalAnswered: 0,
      totalCorrect:  0,
      seenByFilter:  {}    // filterKey → [questionId, ...] — coverage tracking per filter
    };
  }

  // One-time migration: if old key exists, copy to exam_A namespace then delete.
  function _migrateIfNeeded() {
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      const newKey = storageKey('exam_A');
      if (legacy && !localStorage.getItem(newKey)) {
        localStorage.setItem(newKey, legacy);
      }
      if (legacy) {
        localStorage.removeItem(LEGACY_KEY);
      }
    } catch (_) { /* ignore */ }
  }

  function load(examId) {
    _migrateIfNeeded();
    try {
      const raw = localStorage.getItem(storageKey(examId));
      if (!raw) return defaultState();
      const s = JSON.parse(raw);
      s.answered      = s.answered      || {};
      s.wrongList     = s.wrongList     || [];
      s.totalAnswered = s.totalAnswered || 0;
      s.totalCorrect  = s.totalCorrect  || 0;
      s.seenByFilter  = s.seenByFilter  || {};
      return s;
    } catch (_) {
      return defaultState();
    }
  }

  function save(state, examId) {
    try {
      localStorage.setItem(storageKey(examId), JSON.stringify(state));
    } catch (_) { /* storage full — silently ignore */ }
  }

  function recordAnswer(state, questionId, correct, examId) {
    if (!state.answered[questionId]) {
      state.answered[questionId] = { correct: false, count: 0, lastSeen: 0 };
    }
    const rec = state.answered[questionId];
    rec.count++;
    rec.correct  = correct;
    rec.lastSeen = Date.now();

    state.totalAnswered++;
    if (correct) state.totalCorrect++;

    save(state, examId);
    return state;
  }

  function recordSeenBatch(state, filterKey, questionIds, examId) {
    if (!state.seenByFilter) state.seenByFilter = {};
    const existing = new Set(state.seenByFilter[filterKey] || []);
    questionIds.forEach(id => existing.add(id));
    state.seenByFilter[filterKey] = Array.from(existing);
    save(state, examId);
    return state;
  }

  function getSeenForFilter(state, filterKey) {
    if (!state.seenByFilter) return new Set();
    return new Set(state.seenByFilter[filterKey] || []);
  }

  function resetSeenForFilter(state, filterKey, examId) {
    if (!state.seenByFilter) state.seenByFilter = {};
    delete state.seenByFilter[filterKey];
    save(state, examId);
    return state;
  }

  function toggleWrong(state, questionId, examId) {
    const idx = state.wrongList.indexOf(questionId);
    if (idx >= 0) {
      state.wrongList.splice(idx, 1);
    } else {
      state.wrongList.push(questionId);
    }
    save(state, examId);
    return state;
  }

  function isWrong(state, questionId) {
    return state.wrongList.includes(questionId);
  }

  function getAccuracy(state) {
    if (state.totalAnswered === 0) return 0;
    return Math.round((state.totalCorrect / state.totalAnswered) * 100);
  }

  function resetStats(state, examId) {
    state.answered      = {};
    state.wrongList     = [];
    state.totalAnswered = 0;
    state.totalCorrect  = 0;
    save(state, examId);
    return state;
  }

  function resetCoverage(state, examId) {
    state.seenByFilter = {};
    save(state, examId);
    return state;
  }

  // Full reset for a given exam
  function reset(examId) {
    localStorage.removeItem(storageKey(examId));
    return defaultState();
  }

  return {
    storageKey, load, save, defaultState,
    recordAnswer,
    recordSeenBatch, getSeenForFilter, resetSeenForFilter,
    toggleWrong, isWrong,
    getAccuracy,
    resetStats, resetCoverage, reset
  };
})();
