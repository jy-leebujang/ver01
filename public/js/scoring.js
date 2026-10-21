// Created: 2026-10-21 23:14
// 점수 규칙 (화면과 서버가 함께 쓰는 순수 함수). 클라이언트(game.js)와 서버(service.js)가 같은 규칙으로 채점하도록
// 규칙 숫자는 여기에만 둔다. 서버는 ../public/js/scoring.js 를 그대로 가져다 쓴다.

export const CATEGORY_ORDER = ['history', 'science', 'geography', 'general'];
export const QUESTIONS_PER_CATEGORY = 5; // 문제은행(카테고리당 10개)에서 한 판에 뽑는 수
export const QUESTIONS_PER_GAME = CATEGORY_ORDER.length * QUESTIONS_PER_CATEGORY;

export const QUESTION_TIME_MS = 10000; // 한 문제 제한 시간. 넘기면 오답(0점)
export const COUNTDOWN_MS = 5000; // 남은 시간이 이 값 이하가 되면 숫자 카운트다운을 보여준다

// [경과 시간 상한(ms), 점수]. 위에서부터 처음 맞는 칸의 점수를 받는다. 빨리 맞힐수록 높다.
export const TIME_TIERS = [
  [3000, 15],
  [5000, 12],
  [8000, 10],
  [10000, 8],
];

// 힌트를 쓰면 그 문제의 시간 점수에서 30%를 깎는다(70%만 받는다). 소수점 오차를 피하려고 정수로 계산한다.
export const HINT_KEEP_PERCENT = 70;

// [연속 정답 수 이상, 그 문제에 붙는 보너스]. 위에서부터 처음 맞는 칸을 쓴다. 보너스는 힌트 감점과 무관하다.
export const COMBO_TIERS = [
  [10, 10],
  [5, 5],
  [2, 2],
];

/** 경과 시간(ms)에 따른 점수. 제한 시간을 넘으면 0. */
export function timePoints(elapsedMs) {
  const tier = TIME_TIERS.find(([limit]) => elapsedMs <= limit);
  return tier ? tier[1] : 0;
}

/** 이 문제까지 연속 정답이 streak개일 때의 보너스 */
export function comboBonus(streak) {
  const tier = COMBO_TIERS.find(([min]) => streak >= min);
  return tier ? tier[1] : 0;
}

/**
 * 한 문제 채점.
 * streakBefore: 이 문제 직전까지의 연속 정답 수.
 * 반환: { points, base, bonus, hintPenalty, streak } — points = base + bonus, streak은 이 문제 이후의 연속 정답 수
 */
export function scoreAnswer({ correct, elapsedMs, hintUsed }, streakBefore) {
  if (!correct) return { points: 0, base: 0, bonus: 0, hintPenalty: 0, streak: 0 };
  const full = timePoints(elapsedMs);
  const base = hintUsed ? Math.floor((full * HINT_KEEP_PERCENT) / 100) : full;
  const streak = streakBefore + 1;
  const bonus = comboBonus(streak);
  return { points: base + bonus, base, bonus, hintPenalty: full - base, streak };
}

/** 한 판의 만점: 전부 3초 안에 힌트 없이 연속으로 맞힌 경우 */
export function maxScore(count = QUESTIONS_PER_GAME) {
  let total = 0;
  for (let n = 1; n <= count; n++) total += TIME_TIERS[0][1] + comboBonus(n);
  return total;
}
