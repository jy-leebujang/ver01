// Created: 2026-10-18 17:42
// 게임 로직 (화면과 무관한 순수 함수). 점수 계산은 모두 여기서만 한다.
// 답안은 "원본 보기 순서(questions.js의 choices) 기준 번호"로 기록한다. 서버가 같은 기준으로 채점하기 위해서다.
// 점수 규칙(시간 점수, 힌트 감점, 연속 정답 보너스)은 scoring.js에 있고 서버와 공유한다.
import {
  CATEGORY_ORDER,
  QUESTIONS_PER_CATEGORY,
  QUESTIONS_PER_GAME,
  QUESTION_TIME_MS,
  scoreAnswer,
} from './scoring.js';

export { CATEGORY_ORDER, QUESTIONS_PER_GAME, QUESTION_TIME_MS, COUNTDOWN_MS, HINT_KEEP_PERCENT, maxScore } from './scoring.js';

export const CATEGORY_LABELS = {
  history: '한국사',
  science: '과학',
  geography: '지리',
  general: '일반상식',
};
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 10;

const TIMED_OUT = -1; // item.picked 값: 시간 안에 답하지 못함 (answers에는 choiceIndex null로 기록)
const HINT_RATIO = 0.5; // 힌트로 보여줄 해설의 앞부분 비율

/** 닉네임 검사. 앞뒤 공백은 제거하고 글자 수(2~10)를 본다. */
export function validateNickname(raw) {
  const value = String(raw ?? '').trim();
  const length = [...value].length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
    return { ok: false, value, message: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.` };
  }
  return { ok: true, value, message: '' };
}

/** Fisher-Yates 셔플 (원본은 바꾸지 않는다) */
export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newItem(question, order) {
  return {
    question,
    order,
    picked: null, // 고른 보기의 원본 번호. 시간 초과면 TIMED_OUT
    elapsedMs: 0,
    hintUsed: false,
  };
}

/**
 * 새 게임 상태를 만든다.
 * 카테고리 순서는 고정, 각 카테고리에서 문제은행 중 5개를 무작위로 뽑고, 문제 순서와 보기 순서도 매 판 랜덤.
 * item.order[화면 위치] = 원본 보기 번호
 */
export function createGame(nickname, questions, rng = Math.random) {
  const items = CATEGORY_ORDER.flatMap((category) =>
    shuffle(
      questions.filter((q) => q.category === category),
      rng,
    )
      .slice(0, QUESTIONS_PER_CATEGORY)
      .map((question) => newItem(question, shuffle([0, 1, 2, 3], rng))),
  );
  return {
    nickname,
    items,
    index: 0,
    score: 0,
    streak: 0, // 현재 연속 정답 수
    maxStreak: 0,
    categoryScores: Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])),
    answers: [], // { questionId, choiceIndex(시간 초과면 null), elapsedMs, hintUsed } — 원본 보기 번호 기준
  };
}

export function isFinished(game) {
  return game.index >= game.items.length;
}

export function currentItem(game) {
  return isFinished(game) ? null : game.items[game.index];
}

/** 화면에 보일 보기 문구 (섞인 순서) */
export function displayChoices(item) {
  return item.order.map((original) => item.question.choices[original]);
}

/** 해설의 앞부분만 보여주는 힌트 문구 */
export function hintText(explanation) {
  const chars = [...String(explanation ?? '')];
  const keep = Math.max(1, Math.ceil(chars.length * HINT_RATIO));
  return `${chars.slice(0, keep).join('')}…`;
}

/**
 * 현재 문제에서 힌트를 쓴다. 아직 답하지 않은 문제에서만 가능하다.
 * 이미 썼으면 같은 문구를 다시 돌려주고(감점은 한 번뿐), 쓸 수 없는 상태면 null.
 */
export function useHint(game) {
  const item = currentItem(game);
  if (!item || item.picked !== null) return null;
  item.hintUsed = true;
  return hintText(item.question.explanation);
}

/** 경과 시간을 0~제한 시간 범위의 정수(ms)로 맞춘다 */
function clampElapsed(ms) {
  const n = Number.isFinite(ms) ? Math.round(ms) : QUESTION_TIME_MS;
  return Math.min(QUESTION_TIME_MS, Math.max(0, n));
}

/** 현재 문제를 확정하고 점수·연속 정답·답안 기록을 갱신한다 */
function settle(game, item, picked, elapsedMs) {
  const ms = clampElapsed(elapsedMs);
  const timedOut = picked === TIMED_OUT;
  const correct = !timedOut && picked === item.question.answerIndex;
  const scored = scoreAnswer({ correct, elapsedMs: ms, hintUsed: item.hintUsed }, game.streak);

  item.picked = picked;
  item.elapsedMs = ms;
  game.streak = scored.streak;
  game.maxStreak = Math.max(game.maxStreak, game.streak);
  game.score += scored.points;
  game.categoryScores[item.question.category] += scored.points;
  game.answers.push({
    questionId: item.question.id,
    choiceIndex: timedOut ? null : picked,
    elapsedMs: ms,
    hintUsed: item.hintUsed,
  });

  return {
    correct,
    timedOut,
    pickedPos: timedOut ? null : item.order.indexOf(picked),
    correctPos: item.order.indexOf(item.question.answerIndex),
    explanation: item.question.explanation,
    hintUsed: item.hintUsed,
    ...scored,
  };
}

/**
 * 현재 문제에 답한다. displayPos는 화면에 보이는 위치(0~3), elapsedMs는 문제를 보여준 뒤 흐른 시간.
 * 이미 답한 문제거나 범위를 벗어나면 null.
 */
export function answerCurrent(game, displayPos, elapsedMs) {
  const item = currentItem(game);
  if (!item || item.picked !== null) return null;
  if (!Number.isInteger(displayPos) || displayPos < 0 || displayPos > 3) return null;
  return settle(game, item, item.order[displayPos], elapsedMs);
}

/** 제한 시간 안에 답하지 못했을 때. 오답(0점)으로 처리하고 연속 정답이 끊긴다. */
export function timeoutCurrent(game) {
  const item = currentItem(game);
  if (!item || item.picked !== null) return null;
  return settle(game, item, TIMED_OUT, QUESTION_TIME_MS);
}

/** 답한 문제에서만 다음으로 넘어간다. 넘어갔으면 true. */
export function advance(game) {
  const item = currentItem(game);
  if (!item || item.picked === null) return false;
  game.index += 1;
  return true;
}

/** 진행 표시용 값 */
export function progress(game) {
  const item = currentItem(game);
  const total = game.items.length;
  if (!item) return { category: null, inCategory: 0, categoryTotal: 0, overall: total, total };
  const category = item.question.category;
  const sameCategory = game.items.filter((it) => it.question.category === category);
  return {
    category,
    inCategory: sameCategory.indexOf(item) + 1,
    categoryTotal: sameCategory.length,
    overall: game.index + 1,
    total,
  };
}

/** 방금 카테고리가 끝나고 다음 카테고리로 넘어왔는가 (마지막 카테고리 뒤에는 false) */
export function categoryChanged(game) {
  const next = currentItem(game);
  if (!next || game.index === 0) return false;
  return game.items[game.index - 1].question.category !== next.question.category;
}

/** 끝난 게임을 저장할 기록으로 만든다 */
export function buildRecord(game, playedAt = new Date().toISOString()) {
  return {
    nickname: game.nickname,
    answers: game.answers.map((a) => ({ ...a })),
    totalScore: game.score,
    categoryScores: { ...game.categoryScores },
    playedAt,
  };
}

/** 정답률(%) */
export function accuracy(game) {
  return Math.round((correctCount(game) / game.items.length) * 100);
}

/** 이어하기용으로 저장할 최소 상태 */
export function serializeGame(game) {
  return {
    nickname: game.nickname,
    index: game.index,
    items: game.items.map((it) => ({
      id: it.question.id,
      order: it.order,
      picked: it.picked,
      elapsedMs: it.elapsedMs,
      hintUsed: it.hintUsed,
    })),
  };
}

/**
 * 저장된 상태에서 게임을 되살린다. 점수와 답안은 저장값을 믿지 않고 다시 계산한다.
 * 형식이 맞지 않으면(예전 규칙으로 저장된 진행 상태 포함) null.
 */
export function restoreGame(data, questions) {
  try {
    if (!data || typeof data.nickname !== 'string' || !validateNickname(data.nickname).ok) return null;
    if (!Array.isArray(data.items) || data.items.length !== QUESTIONS_PER_GAME) return null;
    if (!Number.isInteger(data.index) || data.index < 0 || data.index >= data.items.length) return null;

    const byId = new Map(questions.map((q) => [q.id, q]));
    const seen = new Set();
    const items = [];
    for (let i = 0; i < data.items.length; i++) {
      const saved = data.items[i];
      const question = byId.get(saved.id);
      if (!question || seen.has(saved.id)) return null;
      seen.add(saved.id);
      if (!Array.isArray(saved.order) || saved.order.length !== 4 || [...saved.order].sort().join() !== '0,1,2,3') return null;

      const answered = i < data.index;
      const { picked, elapsedMs } = saved;
      if (answered) {
        if (!Number.isInteger(picked) || picked < TIMED_OUT || picked > 3) return null;
        if (!Number.isInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > QUESTION_TIME_MS) return null;
        if (typeof saved.hintUsed !== 'boolean') return null;
      } else if (picked !== null) {
        return null;
      }
      const item = newItem(question, [...saved.order]);
      if (answered) Object.assign(item, { picked, elapsedMs, hintUsed: saved.hintUsed });
      items.push(item);
    }
    // 카테고리가 고정 순서대로 5개씩 이어지는지 확인
    const inOrder = CATEGORY_ORDER.every((c, ci) =>
      items.slice(ci * QUESTIONS_PER_CATEGORY, (ci + 1) * QUESTIONS_PER_CATEGORY).every((it) => it.question.category === c),
    );
    if (!inOrder) return null;

    const game = {
      nickname: data.nickname,
      items,
      index: data.index,
      score: 0,
      streak: 0,
      maxStreak: 0,
      categoryScores: Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])),
      answers: [],
    };
    for (const it of items.slice(0, data.index)) {
      const timedOut = it.picked === TIMED_OUT;
      const scored = scoreAnswer(
        { correct: it.picked === it.question.answerIndex, elapsedMs: it.elapsedMs, hintUsed: it.hintUsed },
        game.streak,
      );
      game.streak = scored.streak;
      game.maxStreak = Math.max(game.maxStreak, game.streak);
      game.score += scored.points;
      game.categoryScores[it.question.category] += scored.points;
      game.answers.push({
        questionId: it.question.id,
        choiceIndex: timedOut ? null : it.picked,
        elapsedMs: it.elapsedMs,
        hintUsed: it.hintUsed,
      });
    }
    return game;
  } catch {
    return null;
  }
}

export function correctCount(game) {
  return game.answers.filter((a) => {
    const item = game.items.find((it) => it.question.id === a.questionId);
    return item.question.answerIndex === a.choiceIndex;
  }).length;
}
