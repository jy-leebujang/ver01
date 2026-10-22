// Created: 2026-10-18 19:28
// HTTP API 테스트: 실제로 서버를 임의 포트에 띄워 요청한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './index.js';
import { createRepository } from './repository.js';
import { createService } from './service.js';
import { seedIfEmpty } from './seed.js';
import { perfect, QUESTIONS } from './fixtures.js';

async function withServer(fn, options) {
  const repo = createRepository(':memory:');
  await seedIfEmpty(repo);
  const server = createApp(createService(repo), options).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
}

const post = (base, body, raw = false) =>
  fetch(`${base}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ? body : JSON.stringify(body) });

test('GET /api/questions: 문제은행 40문제, 카테고리 순서', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/questions`);
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.equal(list.length, QUESTIONS.length); // 문제은행 전체
    assert.deepEqual([...new Set(list.map((q) => q.category))], ['history', 'science', 'geography', 'general']);
  });
});

test('POST /api/records: 점수·카테고리별 점수·순위를 돌려준다', async () => {
  await withServer(async (base) => {
    const res = await post(base, { nickname: '철수', answers: perfect() });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.totalScore, 441); // 만점: 시간 점수 15 x 20 + 연속 정답 보너스 141
    assert.equal(body.rank, 1);
    assert.deepEqual(body.categoryScores, { history: 86, science: 105, geography: 125, general: 125 });
    const ranking = await (await fetch(`${base}/api/ranking`)).json();
    assert.equal(ranking[0].nickname, '철수');
    assert.equal(ranking[0].playedAt, body.playedAt);
  });
});

test('잘못된 요청은 400', async () => {
  await withServer(async (base) => {
    assert.equal((await post(base, { nickname: '가', answers: perfect() })).status, 400);
    assert.equal((await post(base, { nickname: '철수', answers: perfect().slice(1) })).status, 400);
    assert.equal((await post(base, { nickname: '철수' })).status, 400);
    assert.equal((await post(base, '{깨진 json', true)).status, 400);
    assert.deepEqual(await (await fetch(`${base}/api/ranking`)).json(), []);
  });
});

test('없는 API는 404 JSON', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/nope`);
    assert.equal(res.status, 404);
    assert.ok((await res.json()).error);
  });
});

test('public/ 정적 파일을 함께 제공한다', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<html/i);
  });
});

test('같은 IP가 기록을 너무 자주 보내면 429', async () => {
  await withServer(
    async (base) => {
      assert.equal((await post(base, { nickname: '철수', answers: perfect() })).status, 201);
      assert.equal((await post(base, { nickname: '철수', answers: perfect() })).status, 201);
      assert.equal((await post(base, { nickname: '철수', answers: perfect() })).status, 429);
    },
    { recordsPerMinute: 2 },
  );
});
