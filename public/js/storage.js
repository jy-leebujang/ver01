// Created: 2026-10-18 14:24
// 저장 창구 (서버판). 화면과 게임 로직은 저장·조회를 반드시 이 파일의 함수로만 한다.
// 기본은 NAS 서버 API(/api)를 부르고, 서버가 응답하지 않으면 기기 저장(localStorage)으로 자동 대체한다.
// 함수 이름과 반환 형태는 3단계와 같다. 진행 상태(이어하기)는 이 기기에만 저장하며 서버로 보내지 않는다.
import { QUESTIONS } from './questions.js';

const RECORDS_KEY = 'quiz.records';
const PROGRESS_KEY = 'quiz.progress';
const RANKING_SIZE = 10;
const API_TIMEOUT_MS = 4000;

/* ---------- 서버 호출 ---------- */

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 서버가 요청을 읽고 일부러 거절한 경우(400 잘못된 요청, 413 너무 큼, 429 너무 잦음)만 오류로 올려 보낸다.
// 그 밖에는 서버에 닿지 않았거나(네트워크·시간 초과·5xx), API가 없는 환경(정적 서버의 404)으로 보고 기기 저장으로 대체한다.
const REJECTED = new Set([400, 413, 429]);
function isUnavailable(err) {
  return !(err instanceof ApiError) || !REJECTED.has(err.status);
}

/** 서버 우선, 안 되면 fallback. 대체했는지에 따라 오프라인 안내를 켜고 끈다. */
async function withFallback(online, offline) {
  try {
    const result = await online();
    setOfflineNotice(false);
    return result;
  } catch (err) {
    if (!isUnavailable(err)) throw err;
    setOfflineNotice(true);
    return offline();
  }
}

function setOfflineNotice(on) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('offline-notice');
  if (!on) {
    if (el) el.remove();
    return;
  }
  if (el) return;
  el = document.createElement('div');
  el.id = 'offline-notice';
  el.className = 'offline-notice';
  el.setAttribute('role', 'status');
  el.textContent = '오프라인 모드: 이 기기에만 저장됨';
  document.body.append(el);
}

/* ---------- 기기 저장 (서버가 안 될 때의 대체판) ---------- */

// localStorage를 못 쓰는 환경(시크릿 모드 등)에서는 메모리에만 보관한다.
let memoryRecords = [];
let memoryProgress = null;

function readRecords() {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return memoryRecords;
  }
}

function writeRecords(records) {
  memoryRecords = records;
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // 저장 실패는 무시한다. 메모리 보관분으로 이번 접속 동안은 동작한다.
  }
}

// 총점 내림차순, 동점이면 먼저 달성한(playedAt이 빠른) 기록이 위
function compareRecords(a, b) {
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
  return a.playedAt < b.playedAt ? -1 : a.playedAt > b.playedAt ? 1 : 0;
}

function localQuestions() {
  return QUESTIONS.map((q) => ({ ...q, choices: [...q.choices] }));
}

function localSaveRecord(record) {
  const saved = { ...record };
  const records = readRecords();
  records.push(saved);
  writeRecords(records);
  const rank = [...records].sort(compareRecords).indexOf(saved) + 1;
  return { rank };
}

function localRanking() {
  return [...readRecords()].sort(compareRecords).slice(0, RANKING_SIZE);
}

/* ---------- 공개 함수 ---------- */

/** 문제 배열 반환 */
export async function loadQuestions() {
  return withFallback(() => api('/questions'), localQuestions);
}

/**
 * 기록 저장.
 * record: { nickname, answers, totalScore, categoryScores, playedAt }
 * 반환: { rank } — 저장된 모든 기록 중 이번 기록의 순위(1부터)
 *
 * 서버에는 nickname과 answers만 보낸다. 점수와 달성 시각은 서버가 정하므로,
 * 호출한 쪽이 순위표에서 "내 기록"을 찾을 수 있게 record.playedAt을 서버 값으로 맞춰 준다.
 */
export async function saveRecord(record) {
  return withFallback(
    async () => {
      const res = await api('/records', {
        method: 'POST',
        body: JSON.stringify({ nickname: record.nickname, answers: record.answers }),
      });
      record.playedAt = res.playedAt;
      return { rank: res.rank, totalScore: res.totalScore, categoryScores: res.categoryScores };
    },
    () => localSaveRecord(record),
  );
}

/** 상위 10개 기록 반환 */
export async function loadRanking() {
  return withFallback(() => api('/ranking'), localRanking);
}

/** 진행 중인 게임 상태 저장 (이어하기용, 이 기기에만) */
export async function saveProgress(state) {
  memoryProgress = state;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(state));
  } catch {
    // 메모리 보관분만 남는다.
  }
}

/** 저장된 진행 상태 반환, 없으면 null */
export async function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return memoryProgress;
  }
}

export async function clearProgress() {
  memoryProgress = null;
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {
    // 무시
  }
}
