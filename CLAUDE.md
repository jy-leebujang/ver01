<!-- Created: 2026-10-18 14:06 -->
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Only planning files exist so far: `prompts.md` (4-stage build prompts) and `architecture.html` (physical/logical design). No source code, build tooling, or tests yet, so there are no build, lint, or test commands to document. Update this file once code is added.

## Running

Stages 1-4 are written, but stage 4 (`server/`, Dockerfile, compose) has never been run: Node.js and Docker are not installed on this machine, so `npm test` and the Docker build are unverified. With Node 20+: `npm install && npm test && npm start` (http://localhost:3000). NAS deployment steps are in `README.md`. Without a server, `python -m http.server -d public` still works (http://localhost:8000; `storage.js` falls back to localStorage). `npm run validate` checks the question data, including the required `source` field.

`public/js/game.js` holds all scoring/shuffle logic (pure functions), `app.js` only renders and handles events, and questions, records, ranking, and resume state are only reachable via `storage.js`. `storage.js` calls the server API and falls back to localStorage when it is unreachable; the server owns scores and timestamps, so `saveRecord` overwrites `record.playedAt` with the server's value (app.js uses it to highlight "my record"). `saveRecord` returns `{ rank }` (position among all records, not just the top 10); resume progress stays device-local even after stage 4.

## Planned architecture

See `architecture.html`. Stages 1-3 are a pure HTML/CSS/JS client under `public/` with localStorage; stage 4 adds a Node/Express + SQLite server in `server/`, deployed by Docker on a Synology NAS. UI and game logic must read/write data only through `public/js/storage.js`, so stage 4 only swaps that file's internals. The server recomputes scores from submitted answers (answers use original `choices` order, not the shuffled display order).

## Project

A single-player trivia ("상식 퀴즈") web game. The product spec is the PRD doc "상식 퀴즈 게임 PRD" (https://claude.ai/code/artifact/ab8db41e-ee13-48f2-9344-f1fb4f3745db); it is not stored in the repo, so read it there before implementing. Key constraints from it:

- 4-choice multiple choice; categories 한국사, 과학, 지리, 일반상식, 10 questions each (40 total).
- Instant correct/incorrect feedback with a one-sentence explanation, auto-advancing after 1.5s.
- One full game must finish in 3-4 minutes (~5s per question).
- Scoring: 10 points per correct answer (max 400); the leaderboard keeps the top 10 by score, ties broken by earlier date.
- Questions are static data; only play records are persisted (browser localStorage by default; server-shared ranking is an open issue in the PRD).


## 문제에 대한 검증 가이드 라인
모든 문제에 대한 검증을 할것.
 - 정보의 출처가 명확한지 확인 할것.
 - 의심스러운 내용은 배제 할것.