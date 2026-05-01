// progress.js — LocalStorage persistence layer
// Key: thunderexam_v1
'use strict';

const Progress = (function () {
  const STORAGE_KEY = 'thunderexam_v1';

  function defaultState() {
    return {
      answered:      {},   // questionId → {correct:bool, count:int, lastSeen:timestamp}
      wrongList:     [],   // [questionId, ...]  — manual wrong-answer log
      totalAnswered: 0,
      totalCorrect:  0
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const s = JSON.parse(raw);
      // migrate missing keys for older saves
      s.answered     = s.answered     || {};
      s.wrongList    = s.wrongList    || [];
      s.totalAnswered = s.totalAnswered || 0;
      s.totalCorrect  = s.totalCorrect  || 0;
      return s;
    } catch (_) {
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) { /* storage full — silently ignore */ }
  }

  // Call after user picks an answer in quiz
  function recordAnswer(state, questionId, correct) {
    if (!state.answered[questionId]) {
      state.answered[questionId] = { correct: false, count: 0, lastSeen: 0 };
    }
    const rec = state.answered[questionId];
    rec.count++;
    rec.correct  = correct;
    rec.lastSeen = Date.now();

    state.totalAnswered++;
    if (correct) state.totalCorrect++;

    save(state);
    return state;
  }

  // Toggle a question in the wrong-answer list
  function toggleWrong(state, questionId) {
    const idx = state.wrongList.indexOf(questionId);
    if (idx >= 0) {
      state.wrongList.splice(idx, 1);
    } else {
      state.wrongList.push(questionId);
    }
    save(state);
    return state;
  }

  function isWrong(state, questionId) {
    return state.wrongList.includes(questionId);
  }

  // 0–100 integer
  function getAccuracy(state) {
    if (state.totalAnswered === 0) return 0;
    return Math.round((state.totalCorrect / state.totalAnswered) * 100);
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    return defaultState();
  }

  return { load, save, defaultState, recordAnswer, toggleWrong, isWrong, getAccuracy, reset };
})();
