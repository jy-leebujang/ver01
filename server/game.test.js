// Created: 2026-10-21 23:18
// 화면 쪽 게임 로직(public/js/game.js, scoring.js) 테스트. 특히 클라이언트가 계산한 점수와 서버 재계산 점수가 같은지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../public/js/game.js';
import { timePoints, comboBonus, maxScore, scoreAnswer } from '../public/js/scoring.js';
import { scoreAnswers } from './service.js';
import { QUESTIONS } from './fixtures.js';

/** 시드가 같으면 같은 수열을 내는 간단한 난수 */
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** 게임을 끝까지 진행한다. plan(item, i)가 { pos, ms, hint } 또는 { timeout: true }를 돌려준다. */
function play(game, plan) {
  let i = 0;
  while (!G.isFinished(game)) {
    const item = G.currentItem(game);
    const step = plan(item, i++);
    if (step.hint) G.useHint(game);
    if (step.timeout) G.timeoutCurrent(game);
    else G.answerCurrent(game, step.pos, step.ms);
    G.advance(game);
  }
  return game;
}
const correctPos = (item) => item.order.indexOf(item.question.answerIndex);

test('scoring: 시간 구간, 연속 보너스, 만점', () => {
  assert.deepEqual([0, 3000, 3001, 5000, 5001, 8000, 8001, 10000, 10001].map(timePoints), [15, 15, 12, 12, 10, 10, 8, 8, 0]);
  assert.deepEqual([1, 2, 4, 5, 9, 10, 20].map(comboBonus), [0, 2, 2, 5, 5, 10, 10]);
  assert.equal(maxScore(), 441);
  assert.deepEqual(scoreAnswer({ correct: false, elapsedMs: 0, hintUsed: false }, 7), { points: 0, base: 0, bonus: 0, hintPenalty: 0, streak: 0 });
});

test('한 판은 카테고리 순서대로 카테고리당 5문제, 문제은행에서 무작위로 뽑는다', () => {
  const game = G.createGame('철수', QUESTIONS, seeded(1));
  assert.equal(game.items.length, 20);
  assert.deepEqual(
    game.items.map((it) => it.question.category),
    G.CATEGORY_ORDER.flatMap((c) => Array(5).fill(c)),
  );
  assert.equal(new Set(game.items.map((it) => it.question.id)).size, 20);

  const other = G.createGame('철수', QUESTIONS, seeded(2));
  assert.notDeepEqual(
    game.items.map((it) => it.question.id),
    other.items.map((it) => it.question.id),
  );
});

test('전부 빨리 맞히면 만점이고, 서버가 같은 점수로 재계산한다', () => {
  const game = play(G.createGame('철수', QUESTIONS, seeded(3)), (item) => ({ pos: correctPos(item), ms: 500 }));
  assert.equal(game.score, maxScore());
  assert.equal(game.maxStreak, 20);
  const record = G.buildRecord(game);
  const server = scoreAnswers(record.answers, QUESTIONS);
  assert.equal(server.totalScore, game.score);
  assert.deepEqual(server.categoryScores, game.categoryScores);
});

test('정답·오답·시간 초과·힌트가 섞여도 화면 점수와 서버 점수가 같다', () => {
  for (const seed of [11, 12, 13, 14, 15]) {
    const rng = seeded(seed);
    const game = play(G.createGame('철수', QUESTIONS, seeded(seed + 100)), (item) => {
      const roll = rng();
      if (roll < 0.15) return { timeout: true };
      const hint = rng() < 0.3;
      const ms = Math.floor(rng() * 10001);
      const pos = roll < 0.7 ? correctPos(item) : (correctPos(item) + 1) % 4;
      return { pos, ms, hint };
    });
    const record = G.buildRecord(game);
    const server = scoreAnswers(record.answers, QUESTIONS);
    assert.equal(server.totalScore, game.score, `seed ${seed}`);
    assert.deepEqual(server.categoryScores, game.categoryScores, `seed ${seed}`);
  }
});

test('시간 초과는 답안에 null로 기록되고 연속이 끊긴다', () => {
  const game = G.createGame('철수', QUESTIONS, seeded(4));
  G.answerCurrent(game, correctPos(G.currentItem(game)), 100);
  G.advance(game);
  const result = G.timeoutCurrent(game);
  assert.equal(result.timedOut, true);
  assert.equal(result.correct, false);
  assert.equal(result.points, 0);
  assert.equal(game.streak, 0);
  assert.equal(game.maxStreak, 1);
  assert.deepEqual(game.answers[1], { questionId: G.currentItem(game).question.id, choiceIndex: null, elapsedMs: 10000, hintUsed: false });
  assert.equal(G.timeoutCurrent(game), null); // 이미 확정된 문제
  assert.equal(G.answerCurrent(game, 0, 100), null); // 시간 초과 뒤에는 못 고른다
});

test('힌트: 해설 앞부분만 보여주고, 감점은 문제당 한 번뿐이며, 답한 뒤에는 못 쓴다', () => {
  const game = G.createGame('철수', QUESTIONS, seeded(5));
  const item = G.currentItem(game);
  const hint = G.useHint(game);
  assert.ok(hint.endsWith('…'));
  assert.ok(item.question.explanation.startsWith(hint.slice(0, -1)));
  assert.ok(hint.length - 1 < item.question.explanation.length);
  assert.equal(G.useHint(game), hint); // 다시 눌러도 같은 문구, 감점은 그대로 한 번
  const r = G.answerCurrent(game, correctPos(item), 1000);
  assert.equal(r.base, 10); // 15점의 70%
  assert.equal(r.hintPenalty, 5);
  assert.equal(r.hintUsed, true);
  assert.equal(G.useHint(game), null); // 답한 뒤
});

test('진행 상태를 저장했다 되살려도 점수·연속 정답이 같다', () => {
  const game = G.createGame('철수', QUESTIONS, seeded(6));
  for (let i = 0; i < 8; i++) {
    const item = G.currentItem(game);
    if (i === 3) G.timeoutCurrent(game);
    else {
      if (i === 5) G.useHint(game);
      G.answerCurrent(game, correctPos(item), 1500 + i * 400);
    }
    G.advance(game);
  }
  const restored = G.restoreGame(JSON.parse(JSON.stringify(G.serializeGame(game))), QUESTIONS);
  assert.equal(restored.score, game.score);
  assert.equal(restored.streak, game.streak);
  assert.equal(restored.maxStreak, game.maxStreak);
  assert.deepEqual(restored.categoryScores, game.categoryScores);
  assert.deepEqual(restored.answers, game.answers);
  assert.equal(restored.index, 8);
});

test('예전 규칙(40문제)으로 저장된 진행 상태나 깨진 상태는 버린다', () => {
  const old = {
    nickname: '철수',
    index: 3,
    items: QUESTIONS.map((q, i) => ({ id: q.id, order: [0, 1, 2, 3], picked: i < 3 ? 0 : null })),
  };
  assert.equal(G.restoreGame(old, QUESTIONS), null);

  const game = G.createGame('철수', QUESTIONS, seeded(7));
  G.answerCurrent(game, 0, 100);
  G.advance(game);
  const saved = JSON.parse(JSON.stringify(G.serializeGame(game)));
  assert.ok(G.restoreGame(saved, QUESTIONS));
  assert.equal(G.restoreGame({ ...saved, items: saved.items.map((it, i) => (i === 0 ? { ...it, elapsedMs: 99999 } : it)) }, QUESTIONS), null);
  assert.equal(G.restoreGame({ ...saved, items: saved.items.map((it, i) => (i === 0 ? { ...it, hintUsed: undefined } : it)) }, QUESTIONS), null);
});
