// Created: 2026-10-21 23:18
// 테스트용 데이터: 한 판(카테고리 순서대로 카테고리당 5문제)과 답안 만들기.
import { QUESTIONS } from '../public/js/questions.js';
import { CATEGORY_ORDER, QUESTIONS_PER_CATEGORY } from '../public/js/scoring.js';

export { QUESTIONS };

/** 한 판에 나오는 문제 20개. 카테고리 순서 고정, 각 카테고리의 앞 5개. */
export const GAME_QUESTIONS = CATEGORY_ORDER.flatMap((c) => QUESTIONS.filter((q) => q.category === c).slice(0, QUESTIONS_PER_CATEGORY));

export const answer = (q, choiceIndex, elapsedMs = 1000, hintUsed = false) => ({ questionId: q.id, choiceIndex, elapsedMs, hintUsed });
export const right = (q, elapsedMs, hintUsed) => answer(q, q.answerIndex, elapsedMs, hintUsed);
export const wrong = (q) => answer(q, (q.answerIndex + 1) % 4);

/** 전부 1초 만에 힌트 없이 맞힌 답안 (만점) */
export const perfect = () => GAME_QUESTIONS.map((q) => right(q));
/** 전부 틀린 답안 (0점) */
export const zero = () => GAME_QUESTIONS.map((q) => wrong(q));
