// Created: 2026-10-18 19:26
// 서비스 규칙 테스트: 점수 재계산, 잘못된 요청 거절, 닉네임 길이. DB 없이 가짜 저장소로 돌린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createService, scoreAnswers, validateNickname, ValidationError } from './service.js';
import { QUESTIONS } from '../public/js/questions.js';

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

const allCorrect = () => QUESTIONS.map((q) => ({ questionId: q.id, choiceIndex: q.answerIndex }));
const allWrong = () => QUESTIONS.map((q) => ({ questionId: q.id, choiceIndex: (q.answerIndex + 1) % 4 }));

test('전부 맞히면 400점, 카테고리별 100점', () => {
  const r = scoreAnswers(allCorrect(), QUESTIONS);
  assert.equal(r.totalScore, 400);
  assert.deepEqual(r.categoryScores, { history: 100, science: 100, geography: 100, general: 100 });
});

test('전부 틀리면 0점', () => {
  assert.equal(scoreAnswers(allWrong(), QUESTIONS).totalScore, 0);
});

test('일부만 맞히면 맞힌 개수 x 10점, 카테고리별로 나뉜다', () => {
  const answers = allWrong();
  answers[0] = { questionId: QUESTIONS[0].id, choiceIndex: QUESTIONS[0].answerIndex }; // history
  answers[10] = { questionId: QUESTIONS[10].id, choiceIndex: QUESTIONS[10].answerIndex }; // science
  answers[11] = { questionId: QUESTIONS[11].id, choiceIndex: QUESTIONS[11].answerIndex }; // science
  const r = scoreAnswers(answers, QUESTIONS);
  assert.equal(r.totalScore, 30);
  assert.deepEqual(r.categoryScores, { history: 10, science: 20, geography: 0, general: 0 });
});

test('답안 순서는 점수에 영향을 주지 않는다', () => {
  const r = scoreAnswers(allCorrect().reverse(), QUESTIONS);
  assert.equal(r.totalScore, 400);
});

test('클라이언트가 보낸 점수는 무시한다', () => {
  const repo = fakeRepo();
  const out = createService(repo).submitRecord({ nickname: '철수', answers: allWrong(), totalScore: 400, categoryScores: { history: 100 } });
  assert.equal(out.totalScore, 0);
  assert.equal(repo.saved[0].totalScore, 0);
});

test('달성 시각은 서버 시계로 정한다', () => {
  const repo = fakeRepo();
  const service = createService(repo, { now: () => new Date('2026-01-02T03:04:05.000Z') });
  const out = service.submitRecord({ nickname: '철수', answers: allCorrect(), playedAt: '1999-01-01T00:00:00.000Z' });
  assert.equal(out.playedAt, '2026-01-02T03:04:05.000Z');
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
  const bad = (answers) => assert.throws(() => scoreAnswers(answers, QUESTIONS), ValidationError);
  bad(undefined);
  bad('abc');
  bad(allCorrect().slice(1)); // 39개
  bad([...allCorrect(), { questionId: 'h01', choiceIndex: 0 }]); // 41개

  const dup = allCorrect();
  dup[1] = { ...dup[0] }; // id 중복
  bad(dup);

  const unknown = allCorrect();
  unknown[0] = { questionId: 'zzz', choiceIndex: 0 };
  bad(unknown);

  for (const choiceIndex of [4, -1, 1.5, '1', null, undefined]) {
    const a = allCorrect();
    a[0] = { questionId: a[0].questionId, choiceIndex };
    bad(a);
  }

  const notObject = allCorrect();
  notObject[0] = null;
  bad(notObject);
});

test('잘못된 본문은 거절하고 저장하지 않는다', () => {
  const repo = fakeRepo();
  const service = createService(repo);
  for (const body of [null, undefined, 'x', [], {}, { nickname: '철수' }, { answers: allCorrect() }]) {
    assert.throws(() => service.submitRecord(body), ValidationError);
  }
  assert.equal(repo.saved.length, 0);
});
