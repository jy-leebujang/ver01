# Created: 2026-10-18 19:32
# 1단계: 의존성 설치. better-sqlite3는 alpine(musl)용 미리 빌드된 파일이 없으면 직접 컴파일하므로 빌드 도구를 둔다.
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# 2단계: 실행용 이미지. 빌드 도구 없이 설치된 node_modules만 가져온다.
FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/quiz.db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
