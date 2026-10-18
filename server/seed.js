// Created: 2026-10-18 19:20
// questions 표가 비어 있으면 public/js/questions.js 내용으로 채운다. 이미 있으면 건드리지 않는다.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const QUESTIONS_FILE = path.resolve(here, '../public/js/questions.js');

export async function loadSeedQuestions() {
  const mod = await import(pathToFileURL(QUESTIONS_FILE).href);
  return mod.QUESTIONS;
}

/** 반환: 새로 넣은 문제 수 (이미 채워져 있으면 0) */
export async function seedIfEmpty(repo, questions) {
  if (repo.countQuestions() > 0) return 0;
  const list = questions ?? (await loadSeedQuestions());
  repo.insertQuestions(list);
  return list.length;
}
