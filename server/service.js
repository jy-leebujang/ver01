// Created: 2026-10-18 19:20
// 규칙: 입력 검사와 점수 재계산. 클라이언트가 보낸 점수는 받지 않고 answers로 직접 채점한다.
// answers의 choiceIndex는 questions의 원본 choices 순서 기준(화면에 섞여 보인 순서가 아님). 시간 초과면 null.
// answers는 푼 순서대로 온다(연속 정답 보너스가 순서에 따라 달라지므로). 점수 규칙은 화면과 같은 scoring.js를 쓴다.
// 경과 시간(elapsedMs)과 힌트 사용(hintUsed)은 브라우저가 알려 주는 값이라 서버가 사실인지 확인할 수는 없고, 범위만 검사한다.
import {
  CATEGORY_ORDER,
  QUESTIONS_PER_CATEGORY,
  QUESTIONS_PER_GAME,
  QUESTION_TIME_MS,
  scoreAnswer,
} from '../public/js/scoring.js';

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 10;
export const RANKING_SIZE = 10;

export class ValidationError extends Error {}

/** 닉네임: 앞뒤 공백 제거 후 2~10자(유니코드 글자 수). 반환: 정리된 닉네임 */
export function validateNickname(raw) {
  if (typeof raw !== 'string') throw new ValidationError('닉네임이 필요합니다.');
  const value = raw.trim();
  const length = [...value].length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
    throw new ValidationError(`닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자여야 합니다.`);
  }
  // 제어 문자(줄바꿈 등)는 거절한다.
  if (/[\p{Cc}\p{Cf}]/u.test(value)) throw new ValidationError('닉네임에 쓸 수 없는 문자가 있습니다.');
  return value;
}

/**
 * answers 검사와 채점. questions는 DB의 문제은행 배열(정답 포함).
 * 한 판은 카테고리 순서대로 카테고리당 5문제씩 총 20개여야 한다.
 * 반환: { totalScore, categoryScores }
 */
export function scoreAnswers(answers, questions) {
  if (!Array.isArray(answers) || answers.length !== QUESTIONS_PER_GAME) {
    throw new ValidationError(`answers는 ${QUESTIONS_PER_GAME}개여야 합니다.`);
  }
  const byId = new Map(questions.map((q) => [q.id, q]));
  const seen = new Set();
  const categoryScores = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]));
  let totalScore = 0;
  let streak = 0;

  answers.forEach((a, i) => {
    if (!a || typeof a !== 'object') throw new ValidationError('answers 항목 형식이 잘못되었습니다.');
    const question = byId.get(a.questionId);
    if (!question) throw new ValidationError(`알 수 없는 문제 id: ${String(a.questionId)}`);
    if (seen.has(a.questionId)) throw new ValidationError(`중복된 문제 id: ${a.questionId}`);
    seen.add(a.questionId);

    const expected = CATEGORY_ORDER[Math.floor(i / QUESTIONS_PER_CATEGORY)];
    if (question.category !== expected) {
      throw new ValidationError(`${i + 1}번째 문제는 ${expected} 카테고리여야 합니다: ${a.questionId}`);
    }
    const timedOut = a.choiceIndex === null;
    if (!timedOut && (!Number.isInteger(a.choiceIndex) || a.choiceIndex < 0 || a.choiceIndex > 3)) {
      throw new ValidationError(`선택 번호는 0~3 또는 null(시간 초과)이어야 합니다: ${a.questionId}`);
    }
    if (!Number.isInteger(a.elapsedMs) || a.elapsedMs < 0 || a.elapsedMs > QUESTION_TIME_MS) {
      throw new ValidationError(`elapsedMs는 0~${QUESTION_TIME_MS} 사이 정수여야 합니다: ${a.questionId}`);
    }
    if (typeof a.hintUsed !== 'boolean') {
      throw new ValidationError(`hintUsed는 true/false여야 합니다: ${a.questionId}`);
    }

    const scored = scoreAnswer(
      { correct: !timedOut && a.choiceIndex === question.answerIndex, elapsedMs: a.elapsedMs, hintUsed: a.hintUsed },
      streak,
    );
    streak = scored.streak;
    totalScore += scored.points;
    categoryScores[question.category] += scored.points;
  });
  return { totalScore, categoryScores };
}

export function createService(repo, { now = () => new Date() } = {}) {
  return {
    getQuestions: () => repo.listQuestions(),

    /** body: { nickname, answers }. 반환: { nickname, totalScore, categoryScores, rank, playedAt } */
    submitRecord(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ValidationError('요청 본문이 잘못되었습니다.');
      }
      const nickname = validateNickname(body.nickname);
      const { totalScore, categoryScores } = scoreAnswers(body.answers, repo.listQuestions());
      // 달성 시각은 서버 시계로 정한다. 클라이언트 값은 받지 않는다.
      const playedAt = now().toISOString();
      const answers = body.answers.map((a) => ({
        questionId: a.questionId,
        choiceIndex: a.choiceIndex,
        elapsedMs: a.elapsedMs,
        hintUsed: a.hintUsed,
      }));
      const { rank } = repo.saveRecord({ nickname, totalScore, categoryScores, answers, playedAt });
      return { nickname, totalScore, categoryScores, rank, playedAt };
    },

    getRanking: () => repo.topRecords(RANKING_SIZE),
  };
}
