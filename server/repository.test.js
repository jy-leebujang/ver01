// Created: 2026-10-18 19:26
// 저장소 테스트: 순위 정렬과 동점 처리, 시드. 메모리 DB를 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from './repository.js';
import { createService } from './service.js';
import { seedIfEmpty } from './seed.js';
import { QUESTIONS, perfect as perfectAnswers, zero as zeroAnswers } from './fixtures.js';

const rec = (nickname, totalScore, playedAt) => ({
  nickname,
  totalScore,
  categoryScores: { history: 0, science: 0, geography: 0, general: 0 },
  answers: [],
  playedAt,
});

test('시드: 비어 있으면 40문제를 채우고, 다시 호출하면 건드리지 않는다', async () => {
  const repo = createRepository(':memory:');
  assert.equal(await seedIfEmpty(repo), 40);
  assert.equal(await seedIfEmpty(repo), 0);
  const list = repo.listQuestions();
  assert.equal(list.length, 40);
  assert.deepEqual(list.map((q) => q.id), QUESTIONS.map((q) => q.id)); // 카테고리 순서 유지
  assert.deepEqual(list[0].choices, QUESTIONS[0].choices);
  assert.equal(list[0].answerIndex, QUESTIONS[0].answerIndex);
  repo.close();
});

test('순위: 총점 내림차순, 동점이면 먼저 달성한 기록이 위', () => {
  const repo = createRepository(':memory:');
  repo.saveRecord(rec('늦은동점', 100, '2026-01-02T00:00:00.000Z'));
  repo.saveRecord(rec('낮은점수', 50, '2026-01-01T00:00:00.000Z'));
  repo.saveRecord(rec('이른동점', 100, '2026-01-01T00:00:00.000Z'));
  repo.saveRecord(rec('최고점', 300, '2026-01-03T00:00:00.000Z'));
  assert.deepEqual(repo.topRecords(10).map((r) => r.nickname), ['최고점', '이른동점', '늦은동점', '낮은점수']);
  repo.close();
});

test('순위: 점수와 시각이 모두 같으면 먼저 저장된 기록이 위', () => {
  const repo = createRepository(':memory:');
  const t = '2026-01-01T00:00:00.000Z';
  const a = repo.saveRecord(rec('먼저', 100, t));
  const b = repo.saveRecord(rec('나중', 100, t));
  assert.equal(a.rank, 1);
  assert.equal(b.rank, 2);
  assert.deepEqual(repo.topRecords(10).map((r) => r.nickname), ['먼저', '나중']);
  repo.close();
});

test('저장 직후 반환되는 순위가 순위표 위치와 일치하고, 10위 밖도 센다', () => {
  const repo = createRepository(':memory:');
  for (let i = 0; i < 12; i++) repo.saveRecord(rec(`상위${i}`, 400 - i * 10, `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`));
  const { rank } = repo.saveRecord(rec('꼴찌', 10, '2026-02-01T00:00:00.000Z'));
  assert.equal(rank, 13);
  const { rank: mid } = repo.saveRecord(rec('중간', 295, '2026-02-02T00:00:00.000Z'));
  assert.equal(mid, 12); // 295점보다 높은 400~300점 11개 뒤
  repo.close();
});

test('순위표는 상위 10개만 돌려준다', () => {
  const repo = createRepository(':memory:');
  for (let i = 0; i < 15; i++) repo.saveRecord(rec(`p${i}`, i * 10, '2026-01-01T00:00:00.000Z'));
  const top = repo.topRecords(10);
  assert.equal(top.length, 10);
  assert.equal(top[0].totalScore, 140);
  assert.equal(top[9].totalScore, 50);
  repo.close();
});

test('서비스+저장소: 두 번 제출하면 순위와 순위표가 일관된다', async () => {
  const repo = createRepository(':memory:');
  await seedIfEmpty(repo);
  let tick = 0;
  const service = createService(repo, { now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)) });
  const perfect = perfectAnswers();
  const zero = zeroAnswers();
  const a = service.submitRecord({ nickname: '만점', answers: perfect });
  const b = service.submitRecord({ nickname: '빵점', answers: zero });
  const c = service.submitRecord({ nickname: '또만점', answers: perfect });
  assert.deepEqual([a.rank, b.rank, c.rank], [1, 2, 2]);
  assert.deepEqual(service.getRanking().map((r) => r.nickname), ['만점', '또만점', '빵점']);
  repo.close();
});
