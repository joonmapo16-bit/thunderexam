// app.js — Main application controller
'use strict';

// ── Active exam (persisted in localStorage across page loads) ─────────────
const ACTIVE_EXAM = (function () {
  return localStorage.getItem('thunderexam_active_exam') || 'exam_A';
})();

const App = (function () {

  // ── State ─────────────────────────────────────────────────────────────────
  let appState   = null;
  let session    = [];
  let cursor     = 0;
  let sessionLog = [];

  let currentFilterKey  = '';
  let currentTopic      = '전체';
  let currentSubtopic   = '전체';
  let currentHighYield  = false;

  let isMockExam        = false;
  let mockTimeLeft      = 0;
  let mockTimerInterval = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatText(text) {
    if (!text) return '';
    return text
      .replace(/\s+([가나다라])\.\s+/g, (_, label) => '\n' + label + '. ')
      .replace(/[ \t]*[•·][ \t]*/g, '\n• ')
      .replace(/\s+([가나다라]):\s+/g, (_, label) => '\n' + label + ': ')
      .trimStart();
  }

  const formatStem = formatText;

  function show(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
    window.scrollTo(0, 0);
    const homeBtn = $('btn-home');
    if (screenId === 'screen-home') {
      homeBtn.classList.add('hidden');
    } else {
      homeBtn.classList.remove('hidden');
    }
  }

  function $(id) { return document.getElementById(id); }

  function makeFilterKey(topic, subtopic) {
    return (topic || '전체') + '||' + (subtopic || '전체');
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    QuizEngine.init(
      window.THUNDER_STATEMENTS,
      window.THUNDER_QUESTIONS,
      window.THUNDER_NOTES
    );
    appState = Progress.load(ACTIVE_EXAM);

    // Show active exam name in subtitle
    const meta = window.THUNDER_EXAM_META || {};
    const subtitle = $('app-subtitle');
    if (subtitle && meta.exam_name) {
      subtitle.textContent = meta.exam_name;
    }

    buildTopicSelector();
    bindEvents();
    renderHome();
    show('screen-home');
  }

  // ── Topic / Subtopic selectors ────────────────────────────────────────────

  function buildTopicSelector() {
    const sel = $('sel-topic');
    sel.innerHTML = '';
    QuizEngine.getTopicsWithMeta().forEach(m => {
      const o = document.createElement('option');
      o.value       = m.key;
      o.textContent = m.label;
      sel.appendChild(o);
    });
    buildSubtopicSelector(sel.value);
    updateHomeCoverage();
  }

  function buildSubtopicSelector(topic) {
    const sel = $('sel-subtopic');
    sel.innerHTML = '';
    QuizEngine.getSubtopics(topic).forEach(s => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      sel.appendChild(o);
    });
    updateHomeCoverage();
  }

  // ── Coverage bars ─────────────────────────────────────────────────────────

  function updateHomeCoverage() {
    const topic    = $('sel-topic').value;
    const subtopic = $('sel-subtopic').value;
    const { seen, total } = QuizEngine.getCoverageForFilter(topic, subtopic, appState.answered);
    const pct = total ? Math.round(seen / total * 100) : 0;
    $('home-coverage-bar').style.width = pct + '%';
    $('home-coverage-detail').textContent = seen + ' / ' + total + ' 문항 (' + pct + '%)';
  }

  function updateQuizCoverageBar() {
    const seenIds  = Progress.getSeenForFilter(appState, currentFilterKey);
    const seenCount = seenIds.size;
    const total    = QuizEngine.getPoolSize(currentTopic, currentSubtopic, currentHighYield);
    const pct      = total ? Math.round(seenCount / total * 100) : 0;
    $('quiz-coverage-bar').style.width = pct + '%';
    $('quiz-coverage-label').textContent = seenCount + '/' + total + ' (' + pct + '%)';
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  function bindEvents() {
    $('sel-topic').addEventListener('change', e => {
      buildSubtopicSelector(e.target.value);
    });
    $('sel-subtopic').addEventListener('change', () => updateHomeCoverage());

    $('rng-alpha').addEventListener('input', e => {
      $('lbl-alpha').textContent = parseFloat(e.target.value).toFixed(1);
    });

    $('btn-start').addEventListener('click', startSession);
    $('btn-wrong-drill').addEventListener('click', startWrongDrill);
    $('btn-mock-exam').addEventListener('click', startMockExam);

    $('btn-reset-stats').addEventListener('click', resetStats);
    $('btn-reset-coverage').addEventListener('click', resetCoverage);
    $('btn-reset-all').addEventListener('click', resetAll);

    $('btn-home').addEventListener('click', goHome);

    $('btn-next').addEventListener('click', nextQuestion);
    $('btn-toggle-wrong').addEventListener('click', toggleCurrentWrong);
    $('btn-show-notes').addEventListener('click', () => {
      const nc = $('reveal-notes-content');
      const hidden = nc.classList.toggle('hidden');
      $('btn-show-notes').textContent = hidden ? '보충설명 보기 ▼' : '보충설명 접기 ▲';
    });

    $('btn-end-home').addEventListener('click', () => {
      stopTimer();
      $('mock-timer-bar').classList.add('hidden');
      isMockExam = false;
      renderHome();
      show('screen-home');
    });
    $('btn-end-wrong').addEventListener('click', startWrongDrill);

    // Exam selector
    const examSel = $('exam-selector');
    if (examSel) {
      examSel.value = ACTIVE_EXAM;
      examSel.addEventListener('change', e => {
        const chosen = e.target.value;
        if (chosen === ACTIVE_EXAM) return;
        localStorage.setItem('thunderexam_active_exam', chosen);
        location.reload();
      });
    }

    // Reset progress button (per-exam reset)
    const resetBtn = $('btn-reset-progress');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const name = (window.THUNDER_EXAM_META || {}).exam_name || ACTIVE_EXAM;
        if (!confirm('[' + name + '] 의 모든 학습 기록을 초기화합니다. 계속하시겠습니까?')) return;
        appState = Progress.reset(ACTIVE_EXAM);
        renderHome();
      });
    }
  }

  // ── Home / navigation ─────────────────────────────────────────────────────

  function goHome() {
    if (session.length > 0 && cursor < session.length && sessionLog.length > 0) {
      if (!confirm('진행 중인 세션을 종료하고 홈으로 돌아가시겠습니까?')) return;
    }
    stopTimer();
    $('mock-timer-bar').classList.add('hidden');
    isMockExam = false;
    session = [];
    renderHome();
    show('screen-home');
  }

  function renderHome() {
    $('stat-answered').textContent = appState.totalAnswered;
    $('stat-accuracy').textContent = Progress.getAccuracy(appState) + '%';
    $('stat-wrong').textContent    = appState.wrongList.length;

    const nQ = window.THUNDER_QUESTIONS ? window.THUNDER_QUESTIONS.length : 0;
    $('stat-bank').textContent = nQ + '문항';

    $('btn-wrong-drill').disabled = appState.wrongList.length === 0;

    updateHomeCoverage();
  }

  // ── Session start ─────────────────────────────────────────────────────────

  function getSettings() {
    return {
      topic:        $('sel-topic').value,
      subtopic:     $('sel-subtopic').value,
      count:        Math.min(96, Math.max(1, parseInt($('inp-count').value) || 10)),
      alpha:        parseFloat($('rng-alpha').value),
      highYieldOnly: $('chk-high-yield').checked
    };
  }

  function startSession() {
    const { topic, subtopic, count, alpha, highYieldOnly } = getSettings();
    const filterKey = makeFilterKey(topic, subtopic);
    const seenIds = Progress.getSeenForFilter(appState, filterKey);

    let sess = QuizEngine.buildSession({
      topic, subtopic, count, alpha,
      wrongOnly: false,
      wrongList:   appState.wrongList,
      answeredMap: appState.answered,
      highYieldOnly,
      excludeIds: seenIds
    });

    let wasExhausted = false;

    if (sess.length === 0) {
      wasExhausted = true;
      appState = Progress.resetSeenForFilter(appState, filterKey, ACTIVE_EXAM);
      sess = QuizEngine.buildSession({
        topic, subtopic, count, alpha,
        wrongOnly:   false,
        wrongList:   appState.wrongList,
        answeredMap: appState.answered,
        highYieldOnly,
        excludeIds: null
      });
    }

    if (sess.length === 0) {
      alert('해당 조건에 맞는 문제가 없습니다. 필터를 변경해 주세요.');
      return;
    }

    currentFilterKey = filterKey;
    currentTopic     = topic;
    currentSubtopic  = subtopic;
    currentHighYield = highYieldOnly;

    session    = sess;
    cursor     = 0;
    sessionLog = [];

    const toast = $('exhaustion-toast');
    if (wasExhausted) {
      toast.classList.remove('hidden');
    } else {
      toast.classList.add('hidden');
    }

    show('screen-quiz');
    renderQuestion();
  }

  // ── Mock exam ─────────────────────────────────────────────────────────────

  function startMockExam() {
    stopTimer();
    isMockExam = true;

    currentFilterKey = makeFilterKey('전체', '전체');
    currentTopic     = '전체';
    currentSubtopic  = '전체';
    currentHighYield = false;

    session = QuizEngine.buildSession({
      topic: '전체', subtopic: '전체', count: 70, alpha: 0.7,
      wrongOnly: false, wrongList: appState.wrongList, answeredMap: appState.answered,
      highYieldOnly: false
    });

    if (session.length === 0) { alert('문제 데이터를 로드할 수 없습니다.'); return; }

    cursor = 0;
    sessionLog = [];
    mockTimeLeft = 1800;

    $('exhaustion-toast').classList.add('hidden');
    $('mock-timer-bar').classList.remove('hidden');
    updateTimerDisplay();
    mockTimerInterval = setInterval(tickTimer, 1000);

    show('screen-quiz');
    renderQuestion();
  }

  function stopTimer() {
    if (mockTimerInterval) { clearInterval(mockTimerInterval); mockTimerInterval = null; }
  }

  function tickTimer() {
    mockTimeLeft--;
    updateTimerDisplay();
    if (mockTimeLeft <= 0) {
      stopTimer();
      $('mock-timer-bar').classList.add('hidden');
      renderEnd(true);
      show('screen-end');
    }
  }

  function updateTimerDisplay() {
    const disp = $('mock-timer-display');
    if (!disp) return;
    const m = Math.floor(mockTimeLeft / 60);
    const s = mockTimeLeft % 60;
    disp.textContent = m + ':' + String(s).padStart(2, '0');
    disp.className = 'mock-timer-display';
    if (mockTimeLeft <= 300)      disp.classList.add('timer-danger');
    else if (mockTimeLeft <= 600) disp.classList.add('timer-warn');
    const qc = $('mock-timer-qcount');
    if (qc) qc.textContent = (cursor + 1) + ' / ' + session.length;
  }

  function startWrongDrill() {
    stopTimer();
    isMockExam = false;
    $('mock-timer-bar').classList.add('hidden');
    if (appState.wrongList.length === 0) return;

    currentFilterKey = 'wrongdrill';
    currentTopic     = '전체';
    currentSubtopic  = '전체';
    currentHighYield = false;

    const { alpha } = getSettings();
    session = QuizEngine.buildSession({
      topic: '전체', subtopic: '전체',
      count: appState.wrongList.length,
      alpha,
      wrongOnly:   true,
      wrongList:   appState.wrongList,
      answeredMap: appState.answered
    });

    if (session.length === 0) {
      alert('오답 목록이 비어 있습니다.');
      return;
    }

    cursor     = 0;
    sessionLog = [];
    $('exhaustion-toast').classList.add('hidden');
    show('screen-quiz');
    renderQuestion();
  }

  // ── Quiz screen ───────────────────────────────────────────────────────────

  function renderQuestion() {
    const { question: q, shuffledOptions: opts } = session[cursor];

    $('quiz-bar').style.width = (cursor / session.length * 100) + '%';
    $('quiz-session-label').textContent = (cursor + 1) + ' / ' + session.length;
    $('quiz-progress').textContent      = (cursor + 1) + ' / ' + session.length;

    updateQuizCoverageBar();

    const topicRaw   = (q.topic_path && q.topic_path[0]) || '';
    const subtopicRaw = (q.topic_path && q.topic_path[1]) || '';
    let topicLabel = topicRaw
      ? topicRaw.replace(/(\d+과목)(\d+편)/, '$1 $2')
      : '';
    if (subtopicRaw) topicLabel = topicLabel + ' · ' + subtopicRaw;
    $('quiz-topic').textContent = topicLabel;

    $('quiz-subtopic').classList.add('hidden');

    const polMap = {
      positive:    '긍정형',
      negative:    '부정형',
      count:       '개수형',
      all:         '전부형',
      pair:        '짝짓기',
      count_blank: '개수(빈칸)'
    };
    $('quiz-polarity').textContent = polMap[q.stem_polarity] || q.stem_polarity || '';

    const yearStr = (q.year_tags && q.year_tags.length) ? ' [' + q.year_tags.join(', ') + ']' : '';
    $('quiz-stem').textContent = formatStem(q.stem + yearStr);

    const container = $('quiz-options');
    container.innerHTML = '';
    opts.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'opt-btn';
      btn.dataset.origKey = opt.origKey;

      const markerSpan = document.createElement('span');
      markerSpan.className = 'opt-marker';
      markerSpan.textContent = opt.displayKey;

      const textSpan = document.createElement('span');
      textSpan.className = 'opt-text';
      textSpan.textContent = formatText(opt.text);

      btn.appendChild(markerSpan);
      btn.appendChild(textSpan);
      btn.addEventListener('click', () => handleAnswer(opt.origKey));
      container.appendChild(btn);
    });

    $('quiz-reveal').classList.add('hidden');
    $('btn-next').classList.add('hidden');
    $('btn-toggle-wrong').classList.add('hidden');
    $('reveal-notes-content').classList.add('hidden');
    $('btn-show-notes').textContent = '보충설명 보기 ▼';

    updateWrongBtn();
  }

  // ── Answer handling ───────────────────────────────────────────────────────

  function handleAnswer(chosenOrigKey) {
    const { question: q, shuffledOptions: opts } = session[cursor];

    document.querySelectorAll('.opt-btn').forEach(b => { b.disabled = true; });

    const correct = (chosenOrigKey === q.correct_marker);

    document.querySelectorAll('.opt-btn').forEach(b => {
      if (b.dataset.origKey === q.correct_marker) {
        b.classList.add('opt-correct');
      } else if (b.dataset.origKey === chosenOrigKey) {
        b.classList.add('opt-wrong');
      }
    });

    appState = Progress.recordAnswer(appState, q.question_id, correct, ACTIVE_EXAM);
    sessionLog.push({ questionId: q.question_id, correct });

    if (currentFilterKey && currentFilterKey !== 'wrongdrill') {
      appState = Progress.recordSeenBatch(appState, currentFilterKey, [q.question_id], ACTIVE_EXAM);
      updateQuizCoverageBar();
    }

    if (!correct && !Progress.isWrong(appState, q.question_id)) {
      appState = Progress.toggleWrong(appState, q.question_id, ACTIVE_EXAM);
    }

    renderReveal(q, opts, chosenOrigKey);

    $('quiz-reveal').classList.remove('hidden');
    $('btn-next').classList.remove('hidden');
    $('btn-toggle-wrong').classList.remove('hidden');
    updateWrongBtn();
  }

  // ── Reveal panel ──────────────────────────────────────────────────────────

  function renderReveal(q, shuffledOptions, chosenOrigKey) {
    const correct = (chosenOrigKey === q.correct_marker);

    const banner = $('reveal-verdict');
    if (correct) {
      banner.textContent = '✓ 정답';
      banner.className   = 'reveal-verdict verdict-correct';
    } else {
      banner.textContent = '✗ 오답  —  정답: ' + q.correct_marker;
      banner.className   = 'reveal-verdict verdict-wrong';
    }

    const detailEl = $('reveal-options');
    detailEl.innerHTML = '';

    shuffledOptions.forEach(opt => {
      const stmt     = opt.statement_id ? QuizEngine.getStatement(opt.statement_id) : null;
      const isAnswer = (opt.origKey === q.correct_marker);
      const isChosen = (opt.origKey === chosenOrigKey);

      const row = document.createElement('div');
      row.className = 'reveal-row' + (isAnswer ? ' reveal-row-answer' : '');

      let tvHtml = '';
      if (stmt) {
        if      (stmt.truth_value === 'O') tvHtml = '<span class="badge-o">O</span>';
        else if (stmt.truth_value === 'X') tvHtml = '<span class="badge-x">X</span>';
        else                               tvHtml = '<span class="badge-q">?</span>';
      }

      const chosenFlag = isChosen ? '<span class="flag-chosen">◀ 선택</span>' : '';
      const answerFlag = isAnswer ? '<span class="flag-answer">★ 정답</span>' : '';

      row.innerHTML =
        '<span class="opt-marker">' + esc(opt.displayKey) + '</span>' +
        tvHtml +
        '<span class="reveal-opt-text">' + esc(formatText(opt.text)).replace(/\n/g, '<br>') + '</span>' +
        chosenFlag + answerFlag;

      detailEl.appendChild(row);
    });

    const explEl = $('reveal-explanation');
    explEl.textContent = (q.explanation && q.explanation.trim()) ? formatText(q.explanation) : '해설 없음';

    const yearStr  = (q.year_tags && q.year_tags.length) ? q.year_tags.join(', ') : '';
    const pdfShort = (q.source_pdf || '')
      .replace(/^\[.*?\]\s*/, '')
      .replace(/\.pdf$/i, '');
    const parts = [
      '출처: ' + pdfShort,
      yearStr           ? '기출: ' + yearStr       : null,
      q.source_q_no != null ? '문번: ' + q.source_q_no : null
    ].filter(Boolean);
    $('reveal-source').textContent = parts.join('  │  ');

    const topicKey = (q.topic_path && q.topic_path[0]) || '';
    const notes    = QuizEngine.getNotesForTopic(topicKey).filter(n => n.title && n.title.trim());

    const notesBtn     = $('btn-show-notes');
    const notesContent = $('reveal-notes-content');

    if (notes.length === 0) {
      notesBtn.classList.add('hidden');
    } else {
      notesBtn.classList.remove('hidden');
      notesContent.innerHTML = '';

      let targetNote = notes[0];
      if (q.subtopic) {
        const match = notes.find(n => n.title.includes(q.subtopic));
        if (match) targetNote = match;
      }

      const titleEl = document.createElement('div');
      titleEl.className = 'note-title';
      titleEl.textContent = targetNote.title;

      const bodyEl = document.createElement('pre');
      bodyEl.className = 'note-body';
      bodyEl.textContent = targetNote.body;

      notesContent.appendChild(titleEl);
      notesContent.appendChild(bodyEl);
    }
  }

  // ── Wrong-answer toggle ────────────────────────────────────────────────────

  function updateWrongBtn() {
    if (!session[cursor]) return;
    const qId   = session[cursor].question.question_id;
    const wrong = Progress.isWrong(appState, qId);
    const btn   = $('btn-toggle-wrong');
    btn.textContent = wrong ? '✓ 오답 등록됨' : '+ 오답 등록';
    btn.classList.toggle('wrong-active', wrong);
  }

  function toggleCurrentWrong() {
    if (!session[cursor]) return;
    const qId = session[cursor].question.question_id;
    appState  = Progress.toggleWrong(appState, qId, ACTIVE_EXAM);
    updateWrongBtn();
  }

  // ── Next question / session end ───────────────────────────────────────────

  function nextQuestion() {
    cursor++;
    if (cursor >= session.length) {
      stopTimer();
      $('mock-timer-bar').classList.add('hidden');
      renderEnd(false);
      show('screen-end');
    } else {
      if (isMockExam) updateTimerDisplay();
      renderQuestion();
    }
  }

  function renderEnd(timeExpired = false) {
    const sessionCorrect = sessionLog.filter(r => r.correct).length;
    const sessionTotal   = sessionLog.length;
    const sessionPct     = sessionTotal ? Math.round(sessionCorrect / sessionTotal * 100) : 0;

    $('end-total').textContent             = sessionTotal;
    $('end-correct').textContent           = sessionCorrect;
    $('end-session-accuracy').textContent  = sessionPct + '%';
    $('end-global-accuracy').textContent   = Progress.getAccuracy(appState) + '%';
    $('end-global-answered').textContent   = appState.totalAnswered;
    $('end-wrong-count').textContent       = appState.wrongList.length;

    let msg = '';
    if      (sessionPct >= 90) msg = '완벽합니다! 🎉';
    else if (sessionPct >= 80) msg = '합격권입니다! 계속 유지하세요.';
    else if (sessionPct >= 60) msg = '조금 더 힘내세요. 오답 복습을 추천합니다.';
    else                       msg = '오답 집중 드릴로 복습해 보세요.';
    $('end-message').textContent = msg;

    const mockEl = $('mock-pass-fail');
    if (isMockExam) {
      const passed = sessionPct >= 80;
      const label  = timeExpired ? ' (시간 종료)' : '';
      mockEl.style.color = passed ? 'var(--green)' : 'var(--red)';
      mockEl.textContent = (passed ? '✓ 합격권' : '✗ 불합격권') + label + ' — 합격선 80%';
      mockEl.classList.remove('hidden');
    } else {
      mockEl.classList.add('hidden');
    }

    $('btn-end-wrong').disabled = appState.wrongList.length === 0;
  }

  // ── Reset handlers ────────────────────────────────────────────────────────

  function resetStats() {
    if (!confirm('정답률·오답 목록을 초기화합니다. 커버리지(편별 진도)는 유지됩니다. 계속하시겠습니까?')) return;
    appState = Progress.resetStats(appState, ACTIVE_EXAM);
    renderHome();
  }

  function resetCoverage() {
    if (!confirm('편별 커버리지(진도)를 초기화합니다. 정답률·오답 목록은 유지됩니다. 계속하시겠습니까?')) return;
    appState = Progress.resetCoverage(appState, ACTIVE_EXAM);
    renderHome();
  }

  function resetAll() {
    if (!confirm('모든 학습 기록(정답률, 오답 목록, 커버리지)을 초기화합니다. 계속하시겠습니까?')) return;
    appState = Progress.reset(ACTIVE_EXAM);
    renderHome();
  }

  return { init };
})();

// ── Dynamic data loader ───────────────────────────────────────────────────────
// Injects data/<examId>/data.js as a <script> tag, then boots the app.
(function () {
  const examId = ACTIVE_EXAM;
  const script = document.createElement('script');
  script.src = 'data/' + examId + '/data.js';
  script.onload = function () {
    window.addEventListener('DOMContentLoaded', function () { App.init(); });
    // If DOM is already ready (script injected after DOMContentLoaded fired):
    if (document.readyState !== 'loading') App.init();
  };
  script.onerror = function () {
    document.body.innerHTML =
      '<div style="padding:2rem;font-family:sans-serif;color:#dc2626">' +
      '<h2>데이터 로드 실패</h2>' +
      '<p>data/' + examId + '/data.js 를 찾을 수 없습니다.</p>' +
      '<p>switch_exam.py 를 실행해 데이터를 배포하세요.</p>' +
      '</div>';
  };
  document.head.appendChild(script);
})();
