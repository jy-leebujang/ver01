// Created: 2026-10-18 14:24
// 문제 데이터 검증: node scripts/validate-questions.js
import { QUESTIONS } from '../public/js/questions.js';
import { QUESTIONS_PER_CATEGORY } from '../public/js/scoring.js';

const CATEGORIES = ['history', 'science', 'geography', 'general'];
// 한 판에 카테고리당 이만큼 뽑으므로, 문제은행은 카테고리마다 최소 이 수 이상이어야 한다. 더 많아도 된다.
const MIN_PER_CATEGORY = QUESTIONS_PER_CATEGORY;
const MAX_EXPLANATION = 40;

const errors = [];
const fail = (msg) => errors.push(msg);

const ids = new Set();
const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
const answerCounts = [0, 0, 0, 0];

for (const q of QUESTIONS) {
  const where = `[${q.id}]`;
  if (ids.has(q.id)) fail(`${where} id 중복`);
  ids.add(q.id);

  if (!CATEGORIES.includes(q.category)) fail(`${where} 알 수 없는 category: ${q.category}`);
  else counts[q.category]++;

  if (!q.text || !q.text.trim()) fail(`${where} text 비어 있음`);

  if (!Array.isArray(q.choices) || q.choices.length !== 4) {
    fail(`${where} 보기는 4개여야 함`);
  } else {
    if (new Set(q.choices).size !== 4) fail(`${where} 보기에 중복이 있음`);
    if (q.choices.some((c) => typeof c !== 'string' || !c.trim())) fail(`${where} 빈 보기가 있음`);
  }

  if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) {
    fail(`${where} answerIndex 범위 오류: ${q.answerIndex}`);
  } else {
    answerCounts[q.answerIndex]++;
  }

  if (typeof q.source !== 'string' || !q.source.trim()) fail(`${where} source(출처) 없음`);

  const len = [...(q.explanation ?? '')].length;
  if (len === 0) fail(`${where} 해설 없음`);
  else if (len > MAX_EXPLANATION) fail(`${where} 해설이 ${len}자 (최대 ${MAX_EXPLANATION}자)`);
}

for (const c of CATEGORIES) {
  if (counts[c] < MIN_PER_CATEGORY) fail(`${c} 카테고리는 최소 ${MIN_PER_CATEGORY}개여야 하는데 ${counts[c]}개`);
}

console.log('카테고리별 문제 수:', counts);
console.log('정답 위치 분포(0~3번):', answerCounts);

if (errors.length) {
  console.error(`\n검증 실패 (${errors.length}건)`);
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log('\n검증 통과');
