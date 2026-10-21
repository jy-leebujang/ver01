// Created: 2026-10-18 19:26
// 서비스 규칙 테스트: 점수 재계산, 잘못된 요청 거절, 닉네임 길이. DB 없이 가짜 저장소로 돌린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createService, scoreAnswers, validateNickname, ValidationError } from './service.js';
import { maxScore } from '../public/js/scoring.js';
import { QUESTIONS, GAME_QUESTIONS, answer, right, wrong, perfect, zero } from './fixtures.js';

function fakeRepo() {
  const saved = [];
  return {
    saved,
    listQuestions: () => QUESTIONS,
    saveRecord: (r) => {
      saved.push(r);
      return { rank: saved.length };
    },
    topRecords: () => [],
  };
}

const score = (answers) => scoreAnswers(answers, QUESTIONS);

/** 앞 문제들은 틀리고 idx번째만 주어진 조건으로 맞힌 답안의 총점 */
function onlyOneRight(idx, elapsedMs, hintUsed = false) {
  const answers = zero();
  answers[idx] = right(GAME_QUESTIONS[idx], elapsedMs, hintUsed);
  return score(answers).totalScore;
}

test('전부 1초 안에 맞히면 만점(441점), 카테고리별 점수는 연속 보너스를 포함한다', () => {
  const r = score(perfect());
  assert.equal(r.totalScore, maxScore());
  assert.equal(r.totalScore, 441);
  assert.deepEqual(r.categoryScores, { history: 86, science: 105, geography: 125, general: 125 });
});

test('전부 틀리면 0점', () => {
  assert.equal(score(zero()).totalScore, 0);
});

test('빨리 맞힐수록 점수가 높다: 3초 15 · 5초 12 · 8초 10 · 10초 8', () => {
  assert.equal(onlyOneRight(0, 0), 15);
  assert.equal(onlyOneRight(0, 3000), 15);
  assert.equal(onlyOneRight(0, 3001), 12);
  assert.equal(onlyOneRight(0, 5000), 12);
  assert.equal(onlyOneRight(0, 5001), 10);
  assert.equal(onlyOneRight(0, 8000), 10);
  assert.equal(onlyOneRight(0, 8001), 8);
  assert.equal(onlyOneRight(0, 10000), 8);
});

test('힌트를 쓰면 그 문제 시간 점수의 30%를 깎는다 (소수점 버림)', () => {
  assert.equal(onlyOneRight(0, 1000, true), 10); // 15 -> 10
  assert.equal(onlyOneRight(0, 4000, true), 8); // 12 -> 8
  assert.equal(onlyOneRight(0, 6000, true), 7); // 10 -> 7
  assert.equal(onlyOneRight(0, 9000, true), 5); // 8 -> 5
});

test('힌트를 쓰고 틀리면 그냥 0점', () => {
  const answers = zero();
  answers[0] = { ...wrong(GAME_QUESTIONS[0]), hintUsed: true };
  assert.equal(score(answers).totalScore, 0);
});

test('시간 초과(choiceIndex null)는 0점이고 연속 정답이 끊긴다', () => {
  const answers = zero();
  answers[0] = right(GAME_QUESTIONS[0]); // 15
  answers[1] = answer(GAME_QUESTIONS[1], null, 10000); // 시간 초과
  answers[2] = right(GAME_QUESTIONS[2]); // 연속 1부터 다시: 15
  assert.equal(score(answers).totalScore, 30);
});

test('연속 정답 보너스: 2연속 +2, 5연속 +5, 10연속 +10 (그 문제부터 계속)', () => {
  const run = (n) => {
    const answers = zero();
    for (let i = 0; i < n; i++) answers[i] = right(GAME_QUESTIONS[i]);
    return score(answers).totalScore;
  };
  assert.equal(run(1), 15);
  assert.equal(run(2), 15 + 17);
  assert.equal(run(4), 15 + 17 * 3);
  assert.equal(run(5), 15 + 17 * 3 + 20);
  assert.equal(run(9), 15 + 17 * 3 + 20 * 5);
  assert.equal(run(10), 15 + 17 * 3 + 20 * 5 + 25);
});

test('오답이 끼면 연속이 끊긴다: 맞-틀-맞-맞 = 15 + 0 + 15 + 17', () => {
  const answers = zero();
  answers[0] = right(GAME_QUESTIONS[0]);
  answers[2] = right(GAME_QUESTIONS[2]);
  answers[3] = right(GAME_QUESTIONS[3]);
  assert.equal(score(answers).totalScore, 47);
});

test('힌트를 써도 연속 보너스는 줄지 않고, 연속도 이어진다', () => {
  const answers = zero();
  answers[0] = right(GAME_QUESTIONS[0], 1000, true); // 10
  answers[1] = right(GAME_QUESTIONS[1], 1000, true); // 10 + 보너스 2
  assert.equal(score(answers).totalScore, 22);
});

test('클라이언트가 보낸 점수는 무시한다', () => {
  const repo = fakeRepo();
  const out = createService(repo).submitRecord({ nickname: '철수', answers: zero(), totalScore: 441, categoryScores: { history: 100 } });
  assert.equal(out.totalScore, 0);
  assert.equal(repo.saved[0].totalScore, 0);
});

test('달성 시각은 서버 시계로 정한다', () => {
  const repo = fakeRepo();
  const service = createService(repo, { now: () => new Date('2026-01-02T03:04:05.000Z') });
  const out = service.submitRecord({ nickname: '철수', answers: perfect(), playedAt: '1999-01-01T00:00:00.000Z' });
  assert.equal(out.playedAt, '2026-01-02T03:04:05.000Z');
});

test('저장되는 답안에는 경과 시간과 힌트 사용 여부가 들어간다', () => {
  const repo = fakeRepo();
  createService(repo).submitRecord({ nickname: '철수', answers: perfect() });
  assert.deepEqual(repo.saved[0].answers[0], { questionId: GAME_QUESTIONS[0].id, choiceIndex: GAME_QUESTIONS[0].answerIndex, elapsedMs: 1000, hintUsed: false });
});

test('닉네임은 앞뒤 공백을 제거하고 2~10자만 허용', () => {
  assert.equal(validateNickname('  철수  '), '철수');
  assert.equal(validateNickname('가'.repeat(10)), '가'.repeat(10));
  assert.throws(() => validateNickname('가'), ValidationError);
  assert.throws(() => validateNickname('   a   '), ValidationError);
  assert.throws(() => validateNickname('가'.repeat(11)), ValidationError);
  assert.throws(() => validateNickname(''), ValidationError);
  assert.throws(() => validateNickname(undefined), ValidationError);
  assert.throws(() => validateNickname(1234), ValidationError);
  assert.throws(() => validateNickname('가\n나'), ValidationError);
});

test('이모지도 한 글자로 센다', () => {
  assert.equal(validateNickname('😀😀'), '😀😀');
  assert.throws(() => validateNickname('😀'), ValidationError);
});

test('잘못된 answers는 거절', () => {
  const bad = (answers) => assert.throws(() => score(answers), ValidationError);
  bad(undefined);
  bad('abc');
  bad(perfect().slice(1)); // 19개
  bad([...perfect(), right(QUESTIONS[0])]); // 21개
  bad(QUESTIONS.map((q) => right(q))); // 예전 방식의 40개

  const dup = perfect();
  dup[1] = { ...dup[0] }; // id 중복
  bad(dup);

  const unknown = perfect();
  unknown[0] = { ...unknown[0], questionId: 'zzz' };
  bad(unknown);

  // 카테고리 순서가 고정과 다르면 거절 (첫 문제와 마지막 문제를 맞바꿈)
  const swapped = perfect();
  [swapped[0], swapped[19]] = [swapped[19], swapped[0]];
  bad(swapped);

  // 한 카테고리에서 5개보다 많이 뽑은 경우 (history 6개 + science 4개)
  const uneven = perfect();
  const sixthHistory = QUESTIONS.filter((q) => q.category === 'history')[5];
  uneven[5] = right(sixthHistory);
  bad(uneven);

  for (const choiceIndex of [4, -1, 1.5, '1', undefined]) {
    const a = perfect();
    a[0] = { ...a[0], choiceIndex };
    bad(a);
  }
  for (const elapsedMs of [-1, 10001, 1.5, '1000', undefined, null, NaN]) {
    const a = perfect();
    a[0] = { ...a[0], elapsedMs };
    bad(a);
  }
  for (const hintUsed of ['yes', 1, undefined, null]) {
    const a = perfect();
    a[0] = { ...a[0], hintUsed };
    bad(a);
  }

  const notObject = perfect();
  notObject[0] = null;
  bad(notObject);
});

test('잘못된 본문은 거절하고 저장하지 않는다', () => {
  const repo = fakeRepo();
  const service = createService(repo);
  for (const body of [null, undefined, 'x', [], {}, { nickname: '철수' }, { answers: perfect() }]) {
    assert.throws(() => service.submitRecord(body), ValidationError);
  }
  assert.equal(repo.saved.length, 0);
});
