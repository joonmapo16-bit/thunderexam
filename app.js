// app.js — Main application controller
'use strict';

const App = (function () {

  // ── State ─────────────────────────────────────────────────────────────────
  let appState   = null;   // Progress state object
  let session    = [];     // [{question, shuffledOptions}, ...]
  let cursor     = 0;      // current question index within session
  let sessionLog = [];     // per-question result: {questionId, correct}

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

  // Insert newlines before 가./나./다./라. list items so they display on separate lines.
  // Only fires when the pattern actually appears; safe to call on any stem.
  function formatStem(text) {
    if (!text) return '';
    // Match: one or more spaces + single jamo label (가나다라) + period + space
    // Replaces with: newline + label + period + space
    // e.g. "...않는다. 나. 투자권유..." → "...않는다.\n나. 투자권유..."
    return text
      .replace(/\s+([가나다라])\.\s+/g, (_, label) => '\n' + label + '. ')
      .trimStart();
  }

  function show(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function $(id) { return document.getElementById(id); }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    // Data loaded by data.js as window globals
    QuizEngine.init(
      window.THUNDER_STATEMENTS,
      window.THUNDER_QUESTIONS,
      window.THUNDER_NOTES
    );
    appState = Progress.load();

    buildTopicSelector();
    bindEvents();
    renderHome();
    show('screen-home');
  }

  // ── Topic / Subtopic selectors ────────────────────────────────────────────

  function buildTopicSelector() {
    const sel = $('sel-topic');
    sel.innerHTML = '';
    QuizEngine.getTopics().forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      sel.appendChild(o);
    });
    buildSubtopicSelector(sel.value);
  }

  function buildSubtopicSelector(topic) {
    const sel = $('sel-subtopic');
    sel.innerHTML = '';
    QuizEngine.getSubtopics(topic).forEach(s => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      sel.appendChild(o);
    });
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  function bindEvents() {
    $('sel-topic').addEventListener('change', e => buildSubtopicSelector(e.target.value));

    $('rng-alpha').addEventListener('input', e => {
      $('lbl-alpha').textContent = parseFloat(e.target.value).toFixed(1);
    });

    $('btn-start').addEventListener('click', startSession);
    $('btn-wrong-drill').addEventListener('click', startWrongDrill);
    $('btn-mock-exam').addEventListener('click', startMockExam);
    $('btn-reset').addEventListener('click', resetProgress);

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
      renderHome(); show('screen-home');
    });
    $('btn-end-wrong').addEventListener('click', startWrongDrill);
  }

  // ── Home screen ───────────────────────────────────────────────────────────

  function renderHome() {
    $('stat-answered').textContent = appState.totalAnswered;
    $('stat-accuracy').textContent = Progress.getAccuracy(appState) + '%';
    $('stat-wrong').textContent    = appState.wrongList.length;

    const nQ = window.THUNDER_QUESTIONS ? window.THUNDER_QUESTIONS.length : 0;
    $('stat-bank').textContent = nQ + '문항';

    $('btn-wrong-drill').disabled = appState.wrongList.length === 0;
  }

  // ── Session start ─────────────────────────────────────────────────────────

  function getSettings() {
    return {
      topic:        $('sel-topic').value,
      subtopic:     $('sel-subtopic').value,
      count:        Math.min(96, Math.max(1, parseInt($('inp-count').value) || 10)),
      alpha:        parseFloat($('rng-alpha').value),
      highYieldOnly: document.getElementById('chk-high-yield').checked
    };
  }

  function startSession() {
    const { topic, subtopic, count, alpha, highYieldOnly } = getSettings();
    session = QuizEngine.buildSession({
      topic, subtopic, count, alpha,
      wrongOnly:   false,
      wrongList:   appState.wrongList,
      answeredMap: appState.answered,
      highYieldOnly
    });

    if (session.length === 0) {
      alert('해당 조건에 맞는 문제가 없습니다. 필터를 변경해 주세요.');
      return;
    }

    cursor     = 0;
    sessionLog = [];
    show('screen-quiz');
    renderQuestion();
  }

  // ── Mock exam ─────────────────────────────────────────────────────────────

  function startMockExam() {
    stopTimer();
    isMockExam = true;
    session = QuizEngine.buildSession({
      topic: '전체', subtopic: '전체', count: 70, alpha: 0.7,
      wrongOnly: false, wrongList: appState.wrongList, answeredMap: appState.answered,
      highYieldOnly: false
    });
    if (session.length === 0) { alert('문제 데이터를 로드할 수 없습니다.'); return; }
    cursor = 0; sessionLog = [];
    mockTimeLeft = 1800;
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
      renderEnd(true);   // timeExpired=true
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
    stopTimer(); isMockExam = false;
    $('mock-timer-bar').classList.add('hidden');
    if (appState.wrongList.length === 0) return;
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
    show('screen-quiz');
    renderQuestion();
  }

  // ── Quiz screen ───────────────────────────────────────────────────────────

  function renderQuestion() {
    const { question: q, shuffledOptions: opts } = session[cursor];

    // Progress indicator
    $('quiz-progress').textContent = (cursor + 1) + ' / ' + session.length;
    $('quiz-bar').style.width = (cursor / session.length * 100) + '%';

    // Topic + subtopic badges
    const topicLabel = (q.topic_path && q.topic_path[1]) || (q.topic_path && q.topic_path[0]) || '';
    $('quiz-topic').textContent = topicLabel;

    if (q.subtopic) {
      $('quiz-subtopic').textContent = q.subtopic;
      $('quiz-subtopic').classList.remove('hidden');
    } else {
      $('quiz-subtopic').classList.add('hidden');
    }

    // Polarity badge
    const polMap = {
      positive:    '긍정형',
      negative:    '부정형',
      count:       '개수형',
      all:         '전부형',
      pair:        '짝짓기',
      count_blank: '개수(빈칸)'
    };
    $('quiz-polarity').textContent = polMap[q.stem_polarity] || q.stem_polarity || '';

    // Year tags on stem
    const yearStr = (q.year_tags && q.year_tags.length) ? ' [' + q.year_tags.join(', ') + ']' : '';
    $('quiz-stem').textContent = formatStem(q.stem + yearStr);

    // Render option buttons
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
      textSpan.textContent = opt.text;   // verbatim, no escaping needed in textContent

      btn.appendChild(markerSpan);
      btn.appendChild(textSpan);
      btn.addEventListener('click', () => handleAnswer(opt.origKey));
      container.appendChild(btn);
    });

    // Reset reveal area
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

    // Disable all buttons immediately
    document.querySelectorAll('.opt-btn').forEach(b => { b.disabled = true; });

    const correct = (chosenOrigKey === q.correct_marker);

    // Colour the buttons
    document.querySelectorAll('.opt-btn').forEach(b => {
      if (b.dataset.origKey === q.correct_marker) {
        b.classList.add('opt-correct');
      } else if (b.dataset.origKey === chosenOrigKey) {
        b.classList.add('opt-wrong');
      }
    });

    // Record in progress + session log
    appState = Progress.recordAnswer(appState, q.question_id, correct);
    sessionLog.push({ questionId: q.question_id, correct });

    // Auto-add to wrong list on error (user can un-toggle later)
    if (!correct && !Progress.isWrong(appState, q.question_id)) {
      appState = Progress.toggleWrong(appState, q.question_id);
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

    // Verdict banner
    const banner = $('reveal-verdict');
    if (correct) {
      banner.textContent = '✓ 정답';
      banner.className   = 'reveal-verdict verdict-correct';
    } else {
      banner.textContent = '✗ 오답  —  정답: ' + q.correct_marker;
      banner.className   = 'reveal-verdict verdict-wrong';
    }

    // Per-option breakdown
    const detailEl = $('reveal-options');
    detailEl.innerHTML = '';

    shuffledOptions.forEach(opt => {
      const stmt       = opt.statement_id ? QuizEngine.getStatement(opt.statement_id) : null;
      const isAnswer   = (opt.origKey === q.correct_marker);
      const isChosen   = (opt.origKey === chosenOrigKey);

      const row = document.createElement('div');
      row.className = 'reveal-row' + (isAnswer ? ' reveal-row-answer' : '');

      // O/X badge
      let tvHtml = '';
      if (stmt) {
        if      (stmt.truth_value === 'O') tvHtml = '<span class="badge-o">O</span>';
        else if (stmt.truth_value === 'X') tvHtml = '<span class="badge-x">X</span>';
        else                               tvHtml = '<span class="badge-q">?</span>';
      }

      // Flags
      const chosenFlag = isChosen  ? '<span class="flag-chosen">◀ 선택</span>' : '';
      const answerFlag = isAnswer  ? '<span class="flag-answer">★ 정답</span>' : '';

      // Option text (verbatim — use textContent trick via DOM)
      const textNode = document.createTextNode(opt.text);
      const textTemp = document.createElement('span');
      textTemp.className = 'reveal-opt-text';
      textTemp.appendChild(textNode);

      row.innerHTML =
        '<span class="opt-marker">' + esc(opt.displayKey) + '</span>' +
        tvHtml +
        '<span class="reveal-opt-text">' + esc(opt.text) + '</span>' +
        chosenFlag + answerFlag;

      detailEl.appendChild(row);
    });

    // Full explanation (verbatim) — shown once for the whole question
    const explEl = $('reveal-explanation');
    explEl.textContent = (q.explanation && q.explanation.trim()) ? q.explanation : '해설 없음';

    // Source citation
    const yearStr = (q.year_tags && q.year_tags.length) ? q.year_tags.join(', ') : '';
    const pdfShort = (q.source_pdf || '')
      .replace(/^\[.*?\]\s*/, '')   // strip [44회 기출풀복원특강] prefix
      .replace(/\.pdf$/i, '');
    const parts = [
      '출처: ' + pdfShort,
      yearStr   ? '기출: ' + yearStr : null,
      q.source_q_no != null ? '문번: ' + q.source_q_no : null
    ].filter(Boolean);
    $('reveal-source').textContent = parts.join('  │  ');

    // Notes — find titled notes in the same topic
    const topicKey = (q.topic_path && q.topic_path[0]) || '';
    const notes    = QuizEngine.getNotesForTopic(topicKey).filter(n => n.title && n.title.trim());

    const notesBtn     = $('btn-show-notes');
    const notesContent = $('reveal-notes-content');

    if (notes.length === 0) {
      notesBtn.classList.add('hidden');
    } else {
      notesBtn.classList.remove('hidden');
      notesContent.innerHTML = '';

      // Prefer a note whose title mentions the current subtopic; otherwise show first
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
      bodyEl.textContent = targetNote.body;  // verbatim

      notesContent.appendChild(titleEl);
      notesContent.appendChild(bodyEl);
    }
  }

  // ── Wrong-answer toggle button ─────────────────────────────────────────────

  function updateWrongBtn() {
    if (!session