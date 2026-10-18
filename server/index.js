// Created: 2026-10-18 19:24
// 서버 시작과 라우터. public/ 정적 파일과 /api를 함께 제공한다.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepository } from './repository.js';
import { createService, ValidationError } from './service.js';
import { seedIfEmpty } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(here, '../public');

/** 같은 IP가 기록을 연달아 보내는 것을 막는 간단한 제한 (메모리, 1분 창). */
function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 1000) {
      for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    next();
  };
}

export function createApp(service, { recordsPerMinute = 20 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // DSM 리버스 프록시 한 단계 뒤에 있으므로 X-Forwarded-For의 클라이언트 IP를 쓴다.
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '10kb' }));

  const limitRecords = createRateLimiter({ max: recordsPerMinute, windowMs: 60_000 });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/questions', (req, res) => res.json(service.getQuestions()));
  app.get('/api/ranking', (req, res) => res.json(service.getRanking()));
  app.post('/api/records', limitRecords, (req, res) => res.status(201).json(service.submitRecord(req.body)));

  app.use('/api', (req, res) => res.status(404).json({ error: '없는 API입니다.' }));
  app.use(express.static(PUBLIC_DIR));

  // 잘못된 요청은 400, 그 밖은 500
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 형식이 잘못되었습니다.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: '요청이 너무 큽니다.' });
    console.error(err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });
  return app;
}

async function main() {
  const port = Number(process.env.PORT) || 3000;
  const dbPath = process.env.DB_PATH || path.resolve(here, '../data/quiz.db');

  const repo = createRepository(dbPath);
  const seeded = await seedIfEmpty(repo);
  if (seeded) console.log(`문제 ${seeded}개를 DB에 채웠습니다.`);

  const app = createApp(createService(repo));
  const server = app.listen(port, '0.0.0.0', () => console.log(`quiz server: http://0.0.0.0:${port} (DB: ${dbPath})`));

  const shutdown = () => {
    server.close(() => {
      repo.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
