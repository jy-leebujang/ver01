// Created: 2026-10-18 19:20
// SQLite 읽기/쓰기. SQL은 이 파일에만 둔다.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/** dbPath: 파일 경로 또는 ':memory:' */
export function createRepository(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id           TEXT PRIMARY KEY,
      position     INTEGER NOT NULL,
      category     TEXT NOT NULL,
      text         TEXT NOT NULL,
      choices      TEXT NOT NULL,
      answer_index INTEGER NOT NULL,
      explanation  TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS records (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname        TEXT NOT NULL,
      total_score     INTEGER NOT NULL,
      category_scores TEXT NOT NULL,
      answers         TEXT NOT NULL,
      played_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_records_rank ON records (total_score DESC, played_at, id);
  `);

  const countQuestions = db.prepare('SELECT COUNT(*) AS n FROM questions');
  const insertQuestion = db.prepare(`
    INSERT INTO questions (id, position, category, text, choices, answer_index, explanation, source)
    VALUES (@id, @position, @category, @text, @choices, @answerIndex, @explanation, @source)
  `);
  const selectQuestions = db.prepare('SELECT * FROM questions ORDER BY position');
  const insertRecord = db.prepare(`
    INSERT INTO records (nickname, total_score, category_scores, answers, played_at)
    VALUES (@nickname, @totalScore, @categoryScores, @answers, @playedAt)
  `);
  const selectTop = db.prepare(`
    SELECT nickname, total_score, category_scores, played_at
    FROM records
    ORDER BY total_score DESC, played_at ASC, id ASC
    LIMIT ?
  `);
  // 나보다 위에 있는 기록 수 + 1. 정렬 기준(점수 내림차순, 먼저 달성한 순, 입력 순)과 같아야 한다.
  const selectRank = db.prepare(`
    SELECT COUNT(*) + 1 AS rank FROM records
    WHERE total_score > @totalScore
       OR (total_score = @totalScore AND (played_at < @playedAt OR (played_at = @playedAt AND id < @id)))
  `);

  const toQuestion = (row) => ({
    id: row.id,
    category: row.category,
    text: row.text,
    choices: JSON.parse(row.choices),
    answerIndex: row.answer_index,
    explanation: row.explanation,
    source: row.source,
  });

  return {
    countQuestions: () => countQuestions.get().n,

    /** questions: questions.js 형식 배열. 한 번에 넣고, 배열 순서를 position으로 기억한다. */
    insertQuestions: db.transaction((questions) => {
      questions.forEach((q, i) => {
        insertQuestion.run({
          id: q.id,
          position: i,
          category: q.category,
          text: q.text,
          choices: JSON.stringify(q.choices),
          answerIndex: q.answerIndex,
          explanation: q.explanation,
          source: q.source ?? '',
        });
      });
    }),

    listQuestions: () => selectQuestions.all().map(toQuestion),

    /** 기록 저장. 반환: { rank } (모든 기록 중 순위, 1부터) */
    saveRecord: db.transaction((record) => {
      const { lastInsertRowid } = insertRecord.run({
        nickname: record.nickname,
        totalScore: record.totalScore,
        categoryScores: JSON.stringify(record.categoryScores),
        answers: JSON.stringify(record.answers),
        playedAt: record.playedAt,
      });
      const { rank } = selectRank.get({
        totalScore: record.totalScore,
        playedAt: record.playedAt,
        id: Number(lastInsertRowid),
      });
      return { rank };
    }),

    topRecords: (limit) =>
      selectTop.all(limit).map((row) => ({
        nickname: row.nickname,
        totalScore: row.total_score,
        categoryScores: JSON.parse(row.category_scores),
        playedAt: row.played_at,
      })),

    close: () => db.close(),
  };
}
