// Created: 2026-10-18 17:42
// 화면 전환과 이벤트 처리. 점수·채점은 game.js, 저장·조회는 storage.js만 통해서 한다.
import { loadQuestions, saveRecord, loadRanking, saveProgress, loadProgress, clearProgress } from './storage.js';
import * as G from './game.js';

const FEEDBACK_MS = 1500; // 피드백을 보여준 뒤 자동으로 다음 문제로 넘어가는 시간
const TRANSITION_MS = 1500; // 카테고리 전환 화면 표시 시간
const TICK_MS = 100; // 남은 시간 표시를 갱신하는 간격
const root = document.getElementById('app');

let game = null;
let autoTimer = null;
let tickTimer = null; // 문제 제한 시간을 세는 타이머
let ui = null; // 현재 문제 화면의 요소 모음
let skip = null; // 카테고리 전환 화면에서 바로 넘기는 함수

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function stopTimer() {
  clearInterval(tickTimer);
  tickTimer = null;
}

function show(...nodes) {
  clearTimeout(autoTimer);
  autoTimer = null;
  stopTimer();
  ui = null;
  skip = null;
  root.replaceChildren(...nodes);
}

function button(text, className, onClick) {
  const b = el('button', { class: className, type: 'button', text });
  b.addEventListener('click', onClick);
  return b;
}

/* ---------- 시작 화면 ---------- */

function renderStart(message = '') {
  game = null;
  const input = el('input', {
    id: 'nickname',
    type: 'text',
    maxlength: String(G.NICKNAME_MAX * 2),
    autocomplete: 'off',
    placeholder: '2~10자',
  });
  const hint = el('p', { class: 'hint', 'aria-live': 'polite', text: message });
  const start = el('button', { class: 'primary', type: 'submit', text: '게임 시작' });
  start.disabled = true;

  input.addEventListener('input', () => {
    const result = G.validateNickname(input.value);
    start.disabled = !result.ok;
    hint.textContent = input.value && !result.ok ? result.message : '';
  });

  const form = el('form', { class: 'card' }, el('label', { for: 'nickname', text: '닉네임' }), input, hint, start);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = G.validateNickname(input.value);
    if (result.ok) startGame(result.value);
  });

  show(
    el('h1', { text: '상식 퀴즈' }),
    el('p', { class: 'sub', text: `한국사 · 과학 · 지리 · 일반상식, 총 ${G.QUESTIONS_PER_GAME}문제` }),
    el('p', { class: 'rules', text: `문제당 ${G.QUESTION_TIME_MS / 1000}초 · 빨리 맞힐수록 높은 점수 · 연속 정답 보너스 · 힌트를 쓰면 감점` }),
    form,
    button('순위표 보기', 'secondary', renderRankingScreen),
  );
  input.focus();
}

async function startGame(nickname) {
  try {
    const questions = await loadQuestions();
    game = G.createGame(nickname, questions);
    renderQuestion();
  } catch {
    renderStart('문제를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

/* ---------- 이어하기 ---------- */

function renderResume(saved) {
  const p = G.progress(saved);
  show(
    el('h1', { text: '이어서 할까요?' }),
    el(
      'div',
      { class: 'card' },
      el('p', { class: 'resume-info', text: `${saved.nickname}님의 게임이 진행 중이에요.` }),
      el('p', { class: 'sub', text: `${G.CATEGORY_LABELS[p.category]} · 전체 ${p.overall}/${p.total} · ${saved.score}점` }),
      button('이어서 하기', 'primary', () => {
        game = saved;
        renderQuestion();
      }),
      button('새로 시작', 'secondary', async () => {
        await clearProgress().catch(() => {});
        renderStart();
      }),
    ),
  );
}

/* ---------- 문제 화면 ---------- */

function renderQuestion() {
  const item = G.currentItem(game);
  const p = G.progress(game);

  // 새로고침해도 이어할 수 있게, 문제가 새로 보일 때마다 진행 상태를 저장한다.
  saveProgress(G.serializeGame(game)).catch(() => {});

  const scoreEl = el('span', { class: 'score', text: `${game.score}점` });
  const bar = el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(p.total), 'aria-valuenow': String(p.overall - 1) });
  bar.append(el('div', { class: 'bar-fill' }));
  bar.firstChild.style.width = `${((p.overall - 1) / p.total) * 100}%`;

  const comboEl = el('span', { class: 'combo' });
  setCombo(comboEl);

  const header = el(
    'header',
    { class: 'status' },
    el('span', { class: 'cat', text: G.CATEGORY_LABELS[p.category] }),
    el('span', { text: `${p.inCategory}/${p.categoryTotal}` }),
    el('span', { text: `전체 ${p.overall}/${p.total}` }),
    comboEl,
    scoreEl,
  );

  // 남은 시간 막대. 마지막 5초는 숫자 카운트다운도 보여준다.
  const timerFill = el('div', { class: 'timer-fill' });
  const countEl = el('span', { class: 'countdown', 'aria-hidden': 'true', hidden: '' });
  const timerEl = el('div', { class: 'timer' }, el('div', { class: 'timer-bar' }, timerFill), countEl);

  const buttons = G.displayChoices(item).map((text, pos) => {
    const mark = el('span', { class: 'mark', 'aria-hidden': 'true' });
    const btn = el(
      'button',
      { class: 'choice', type: 'button' },
      el('span', { class: 'num', 'aria-hidden': 'true', text: String(pos + 1) }),
      el('span', { class: 'label', text }),
      mark,
    );
    btn.addEventListener('click', () => choose(pos));
    return { btn, mark };
  });

  const hintBtn = el('button', {
    class: 'secondary hint-btn',
    type: 'button',
    text: `힌트 보기 (이 문제 점수 ${100 - G.HINT_KEEP_PERCENT}% 감점) [H]`,
  });
  hintBtn.addEventListener('click', useHint);
  const hintBox = el('p', { class: 'hint-box', hidden: '' });

  const feedback = el('button', { class: 'feedback', type: 'button', hidden: '' });
  feedback.addEventListener('click', goNext);
  const live = el('div', { 'aria-live': 'polite' }, hintBox, feedback);

  show(
    header,
    bar,
    timerEl,
    el('h2', { class: 'question', text: item.question.text }),
    el('div', { class: 'choices' }, ...buttons.map((b) => b.btn)),
    hintBtn,
    live,
  );
  ui = { buttons, feedback, scoreEl, comboEl, timerEl, timerFill, countEl, hintBtn, hintBox, startedAt: performance.now() };
  startTimer();
}

/** 연속 정답이 2 이상일 때만 표시한다 */
function setCombo(comboEl) {
  comboEl.textContent = game.streak >= 2 ? `${game.streak}연속` : '';
}

/* ---------- 문제 제한 시간 ---------- */

function elapsedMs() {
  return Math.min(G.QUESTION_TIME_MS, Math.max(0, Math.round(performance.now() - ui.startedAt)));
}

function startTimer() {
  const tick = () => {
    if (!ui) return;
    const left = Math.max(0, G.QUESTION_TIME_MS - (performance.now() - ui.startedAt));
    const urgent = left <= G.COUNTDOWN_MS;
    ui.timerFill.style.width = `${(left / G.QUESTION_TIME_MS) * 100}%`;
    ui.timerEl.classList.toggle('urgent', urgent);
    ui.countEl.hidden = !urgent;
    if (urgent) ui.countEl.textContent = String(Math.ceil(left / 1000));
    if (left <= 0) timeUp();
  };
  tickTimer = setInterval(tick, TICK_MS);
  tick();
}

function timeUp() {
  if (!game || !ui) return;
  stopTimer();
  const result = G.timeoutCurrent(game);
  if (result) showResult(result);
}

function useHint() {
  if (!game || !ui) return;
  const text = G.useHint(game);
  if (!text) return;
  ui.hintBox.textContent = `힌트: ${text}`;
  ui.hintBox.hidden = false;
  ui.hintBtn.disabled = true;
}

function choose(pos) {
  if (!game || !ui) return;
  stopTimer();
  const result = G.answerCurrent(game, pos, elapsedMs());
  if (result) showResult(result);
}

/** 이번 문제 결과 화면: 정답/오답 표시, 얻은 점수, 해설 */
function showResult(result) {
  ui.buttons.forEach(({ btn }) => {
    btn.disabled = true;
  });
  ui.hintBtn.disabled = true;
  const correct = ui.buttons[result.correctPos];
  correct.btn.classList.add('correct');
  correct.mark.textContent = '✓';
  if (!result.correct && !result.timedOut) {
    const picked = ui.buttons[result.pickedPos];
    picked.btn.classList.add('wrong');
    picked.mark.textContent = '✗';
  }
  ui.scoreEl.textContent = `${game.score}점`;
  setCombo(ui.comboEl);
  ui.timerEl.classList.remove('urgent');

  const headText = result.correct ? '✓ 정답!' : result.timedOut ? '⏱ 시간 초과' : '✗ 오답';
  const head = el('strong', { text: headText });
  head.className = result.correct ? 'ok' : 'no';
  ui.feedback.replaceChildren(
    head,
    el('span', { class: 'points', text: pointsText(result) }),
    el('span', { class: 'explain', text: result.explanation }),
    el('span', { class: 'skip', text: '탭하거나 Space를 누르면 바로 넘어가요' }),
  );
  ui.feedback.hidden = false;
  autoTimer = setTimeout(goNext, FEEDBACK_MS);
}

/** 예: "+14점 (속도 12, 3연속 +2)", "+10점 (속도 15, 힌트 -5)", 오답은 "0점" */
function pointsText(result) {
  if (!result.correct) return '0점';
  const parts = [`속도 ${result.base + result.hintPenalty}`];
  if (result.hintPenalty > 0) parts.push(`힌트 -${result.hintPenalty}`);
  if (result.bonus > 0) parts.push(`${result.streak}연속 +${result.bonus}`);
  return `+${result.points}점 (${parts.join(', ')})`;
}

function goNext() {
  if (!game || !ui) return;
  clearTimeout(autoTimer);
  autoTimer = null;
  if (!G.advance(game)) return;
  if (G.isFinished(game)) finishGame();
  else if (G.categoryChanged(game)) renderTransition();
  else renderQuestion();
}

/* ---------- 카테고리 전환 화면 (마지막 카테고리 뒤에는 없음) ---------- */

function renderTransition() {
  const prev = game.items[game.index - 1].question.category;
  const next = G.currentItem(game).question.category;
  const proceed = () => renderQuestion();

  const panel = el(
    'button',
    { class: 'transition', type: 'button' },
    el('strong', { class: 'done', text: `${G.CATEGORY_LABELS[prev]} 끝!` }),
    el('span', { class: 'cat-score', text: `${game.categoryScores[prev]}점` }),
    el('span', { class: 'next', text: `다음은 ${G.CATEGORY_LABELS[next]}` }),
  );
  panel.addEventListener('click', proceed);
  show(panel);
  skip = proceed;
  autoTimer = setTimeout(proceed, TRANSITION_MS);
}

/* ---------- 결과 화면 ---------- */

async function finishGame() {
  const finished = game;
  ui = null;
  clearTimeout(autoTimer);
  const record = G.buildRecord(finished);

  let rank = null;
  let saved = true;
  try {
    ({ rank } = await saveRecord(record));
  } catch {
    saved = false;
  }
  await clearProgress().catch(() => {});
  let ranking = [];
  try {
    ranking = await loadRanking();
  } catch {
    saved = false;
  }
  renderResult(finished, record, rank, ranking, saved);
}

function renderResult(finished, record, rank, ranking, saved) {
  const correct = G.correctCount(finished);
  const rows = G.CATEGORY_ORDER.map((c) =>
    el('li', {}, el('span', { text: G.CATEGORY_LABELS[c] }), el('span', { text: `${finished.categoryScores[c]}점` })),
  );
  const rankText = rank ? (rank <= 10 ? `내 순위 ${rank}위` : `내 순위 ${rank}위 (상위 10위 밖)`) : '';
  const nodes = [
    el('h1', { text: '게임 끝!' }),
    el(
      'div',
      { class: 'card' },
      el('p', { class: 'total', text: `${finished.score}점` }),
      el('p', { class: 'sub center', text: `만점 ${G.maxScore()}점 · 정답률 ${G.accuracy(finished)}% (${correct}/${finished.items.length})` }),
      el('p', { class: 'sub center', text: `최대 연속 정답 ${finished.maxStreak}` }),
      rankText ? el('p', { class: 'my-rank', text: rankText }) : '',
      el('ul', { class: 'cats' }, ...rows),
    ),
  ];
  if (!saved) nodes.push(el('p', { class: 'hint', text: '기록을 저장하지 못했어요.' }));
  nodes.push(el('h2', { class: 'section', text: '순위표' }), rankingTable(ranking, record.playedAt));
  nodes.push(button('다시 하기', 'primary', () => startGame(finished.nickname)));
  show(...nodes);
}

/* ---------- 순위표 ---------- */

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function rankingTable(ranking, highlightPlayedAt = null) {
  if (!ranking.length) return el('p', { class: 'sub', text: '아직 기록이 없어요.' });
  const body = ranking.map((r, i) => {
    const mine = highlightPlayedAt !== null && r.playedAt === highlightPlayedAt;
    const tr = el(
      'tr',
      mine ? { class: 'me', 'aria-current': 'true' } : {},
      el('td', { text: String(i + 1) }),
      el('td', { text: mine ? `${r.nickname} (내 기록)` : r.nickname }),
      el('td', { class: 'num-col', text: `${r.totalScore}점` }),
      el('td', { class: 'date', text: formatDate(r.playedAt) }),
    );
    return tr;
  });
  return el(
    'table',
    { class: 'rank' },
    el('thead', {}, el('tr', {}, el('th', { text: '순위' }), el('th', { text: '닉네임' }), el('th', { class: 'num-col', text: '점수' }), el('th', { text: '날짜' }))),
    el('tbody', {}, ...body),
  );
}

async function renderRankingScreen() {
  let ranking = [];
  try {
    ranking = await loadRanking();
  } catch {
    // 빈 순위표로 보여준다.
  }
  show(el('h1', { text: '순위표' }), rankingTable(ranking), button('돌아가기', 'secondary', () => renderStart()));
}

/* ---------- 키보드: 1~4 보기 선택, Space/Enter 다음 ---------- */

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (skip) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      skip();
    }
    return;
  }
  if (!game || !ui) return;
  const item = G.currentItem(game);
  if (!item) return;
  if (item.picked === null) {
    if (['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      choose(Number(event.key) - 1);
    } else if (event.key === 'h' || event.key === 'H') {
      event.preventDefault();
      useHint();
    }
  } else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    goNext();
  }
});

/* ---------- 시작: 저장된 진행이 있으면 이어서 할지 묻는다 ---------- */

async function init() {
  try {
    const savedState = await loadProgress();
    if (savedState) {
      const restored = G.restoreGame(savedState, await loadQuestions());
      if (restored && restored.index > 0) {
        renderResume(restored);
        return;
      }
      await clearProgress();
    }
  } catch {
    // 저장된 상태를 못 읽으면 처음부터 시작한다.
  }
  renderStart();
}

init();
