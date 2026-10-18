// Created: 2026-10-18 17:42
// 게임 로직 (화면과 무관한 순수 함수). 점수 계산은 모두 여기서만 한다.
// 답안은 "원본 보기 순서(questions.js의 choices) 기준 번호"로 기록한다. 서버가 같은 기준으로 채점하기 위해서다.

export const CATEGORY_ORDER = ['history', 'science', 'geography', 'general'];
export const CATEGORY_LABELS = {
  history: '한국사',
  science: '과학',
  geography: '지리',
  general: '일반상식',
};
export const POINTS_PER_CORRECT = 10;
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 10;

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

/**
 * 새 게임 상태를 만든다.
 * 카테고리 순서는 고정, 카테고리 안의 문제 순서와 보기 순서는 매 판 랜덤.
 * item.order[화면 위치] = 원본 보기 번호
 */
export function createGame(nickname, questions, rng = Math.random) {
  const items = CATEGORY_ORDER.flatMap((category) =>
    shuffle(questions.filter((q) => q.category === category), rng).map((question) => ({
      question,
      order: shuffle([0, 1, 2, 3], rng),
      picked: null, // 고른 보기의 원본 번호
    })),
  );
  return {
    nickname,
    items,
    index: 0,
    score: 0,
    categoryScores: Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])),
    answers: [], // { questionId, choiceIndex } — 원본 보기 번호 기준
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

/**
 * 현재 문제에 답한다. displayPos는 화면에 보이는 위치(0~3).
 * 이미 답한 문제거나 범위를 벗어나면 null.
 */
export function answerCurrent(game, displayPos) {
  const item = currentItem(game);
  if (!item || item.picked !== null) return null;
  if (!Number.isInteger(displayPos) || displayPos < 0 || displayPos > 3) return null;

  const picked = item.order[displayPos];
  const correct = picked === item.question.answerIndex;
  item.picked = picked;
  game.answers.push({ questionId: item.question.id, choiceIndex: picked });
  if (correct) {
    game.score += POINTS_PER_CORRECT;
    game.categoryScores[item.question.category] += POINTS_PER_CORRECT;
  }
  return {
    correct,
    pickedPos: displayPos,
    correctPos: item.order.indexOf(item.question.answerIndex),
    explanation: item.question.explanation,
  };
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
    items: game.items.map((it) => ({ id: it.question.id, order: it.order, picked: it.picked })),
  };
}

/**
 * 저장된 상태에서 게임을 되살린다. 점수와 답안은 저장값을 믿지 않고 다시 계산한다.
 * 형식이 맞지 않으면 null.
 */
export function restoreGame(data, questions) {
  try {
    if (!data || typeof data.nickname !== 'string' || !validateNickname(data.nickname).ok) return null;
    if (!Array.isArray(data.items) || data.items.length !== questions.length) return null;
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
      const picked = saved.picked;
      if (answered ? !Number.isInteger(picked) || picked < 0 || picked > 3 : picked !== null) return null;
      items.push({ question, order: [...saved.order], picked });
    }
    // 카테고리가 고정 순서대로 10개씩 이어지는지 확인
    const perCategory = questions.length / CATEGORY_ORDER.length;
    const inOrder = CATEGORY_ORDER.every((c, ci) => items.slice(ci * perCategory, (ci + 1) * perCategory).every((it) => it.question.category === c));
    if (!inOrder) return null;

    const game = {
      nickname: data.nickname,
      items,
      index: data.index,
      score: 0,
      categoryScores: Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])),
      answers: [],
    };
    for (const it of items.slice(0, data.index)) {
      game.answers.push({ questionId: it.question.id, choiceIndex: it.picked });
      if (it.picked === it.question.answerIndex) {
        game.score += POINTS_PER_CORRECT;
        game.categoryScores[it.question.category] += POINTS_PER_CORRECT;
      }
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
