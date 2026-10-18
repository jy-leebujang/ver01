<!-- Created: 2026-10-18 19:36 -->
# 상식 퀴즈 — 로컬 실행과 Synology NAS 배포

Node.js(Express) 서버 1개가 `public/` 화면과 `/api`를 함께 제공하고, 기록은 SQLite 파일(`quiz.db`) 하나에 저장한다.
서버가 안 켜져 있으면 화면이 자동으로 기기 저장(localStorage)으로 대체되고 "오프라인 모드" 안내가 작게 뜬다.

## 0. PC에서 먼저 실행해 보기

Node.js 20 이상이 필요하다.

```
npm install
npm run validate     # 문제 데이터 검사 (출처 필드 포함)
npm test             # 서버 테스트
npm start            # http://localhost:3000
```

다른 기기(휴대폰 등)로 확인하려면 같은 Wi-Fi에서 `http://PC의IP:3000` 으로 접속한다.
DB는 `data/quiz.db`에 생긴다. 지우면 처음 상태로 돌아간다.

## 1. 용어 한 줄 정리

| 용어 | 뜻 |
|---|---|
| 컨테이너 | 프로그램과 실행 환경을 한 상자에 담아 돌리는 것. 지우면 안의 데이터도 사라진다. |
| 볼륨 | NAS 폴더를 컨테이너 안에 연결한 것. DB를 여기에 둬서 컨테이너를 지워도 남긴다. |
| 리버스 프록시 | 바깥 요청(6001)을 받아 안쪽 서버(8080)로 넘기고 HTTPS도 처리하는 DSM 내장 문지기 |
| DDNS | 집 IP가 바뀌어도 같은 도메인으로 찾아오게 해 주는 서비스 |
| 포트포워딩 | 공유기가 "바깥 6001번 요청은 NAS로 보내라"고 길을 여는 설정 |

## 2. NAS 배포 (집 안 접속까지)

### 2-1. NAS 준비
1. DSM 패키지 센터에서 **Container Manager**를 설치한다. (DSM 7.2 미만이면 이름이 **Docker**다.)
2. **File Station**에서 `docker` 공유 폴더 아래에 `quiz` 폴더를 만들고, 그 안에 `data` 폴더를 만든다.
   - 결과: `/volume2/docker/quiz` 와 `/volume2/docker/quiz/data`
   - 볼륨 번호가 `volume2`이 아니면 `docker-compose.yml`의 `volumes:` 경로를 실제 경로로 고친다.

### 2-2. 프로젝트 파일을 NAS로 복사
`/volume2/docker/quiz` 안에 아래만 올린다. `node_modules`, `data`, `*.db`는 올리지 않는다.

```
Dockerfile
docker-compose.yml
package.json
.dockerignore
server/
public/
```

방법 A. File Station에서 위 파일/폴더를 끌어다 놓는다.
방법 B. PC 터미널에서 (NAS의 SSH를 켠 경우; 제어판 → 터미널 및 SNMP → SSH 활성화)

```
scp -r Dockerfile docker-compose.yml package.json .dockerignore server public 계정@NAS의IP:/volume2/docker/quiz/
```

### 2-3. 빌드와 실행 (Container Manager의 "프로젝트")
1. Container Manager → **프로젝트** → **생성**
2. 프로젝트 이름 `quiz`, 경로 `/volume2/docker/quiz` 선택. 기존 `docker-compose.yml`이 있다고 나오면 그것을 사용한다.
3. 웹 포털 설정은 건너뛴다(리버스 프록시는 뒤에서 따로 한다). **완료**를 누르면 빌드 후 실행된다. 첫 빌드는 몇 분 걸린다.
4. 프로젝트 → `quiz` → 컨테이너 상태가 **실행 중**(정상이면 healthy)인지 본다.

SSH로 직접 실행하려면:

```
cd /volume2/docker/quiz
sudo docker compose up -d --build
sudo docker compose logs -f      # "문제 40개를 DB에 채웠습니다." 가 보이면 정상
```

### 2-4. 집 안 접속 확인
같은 Wi-Fi의 PC·휴대폰 브라우저에서 `http://NAS의IP:8080` 을 연다.
- 한 판을 끝내면 `/volume2/docker/quiz/data/quiz.db` 가 생겨 있어야 한다.
- 다른 기기에서도 같은 순위표가 보여야 한다.
- 프로젝트를 **중지 → 삭제 → 다시 생성**해도 순위가 남아 있어야 한다. (볼륨 확인)
- NAS를 재시작한 뒤 자동으로 다시 켜지는지도 한 번 확인한다. (`restart: unless-stopped`)

## 3. 집 밖에서 접속 (HTTPS + 도메인)

### 3-1. 도메인(DDNS)
DSM 제어판 → **외부 액세스** → **DDNS** → 추가 → 서비스 공급자 `Synology`, 원하는 이름(예: `myquiz.synology.me`).
Synology 계정이 필요하다. 이미 가진 도메인이 있으면 그 도메인으로 해도 된다.

### 3-2. HTTPS 인증서 (Let's Encrypt)
DSM 제어판 → **보안** → **인증서** → 추가 → **새 인증서 추가** → **Let's Encrypt에서 인증서 가져오기**
도메인 이름에 위에서 만든 도메인을 넣는다. 발급 과정에서 80번 포트로 확인 요청이 오므로, 공유기에서 외부 80번을 NAS 80번으로 **발급받는 동안만** 열어 둬야 할 수 있다. 발급 후에는 닫아도 된다(갱신 때 다시 필요할 수 있음).

### 3-3. 리버스 프록시 (6001 → 8080)
DSM 제어판 → **로그인 포털** → **고급** → **리버스 프록시** → 생성

| 항목 | 값 |
|---|---|
| 소스 프로토콜 / 호스트 이름 / 포트 | HTTPS / `jydev.synology.me` / 6001 |
| 대상 프로토콜 / 호스트 이름 / 포트 | HTTP / `localhost` / 8080 |

그다음 **보안 → 인증서 → 설정**에서 이 도메인 항목에 3-2의 인증서를 연결한다.

### 3-4. 공유기 포트포워딩 (6001만)
공유기 관리 화면에서 **외부 6001 → NAS의 내부 IP 6001 (TCP)** 하나만 연다. 리버스 프록시가 6001로 받으므로 내부 포트도 6001이다.
NAS는 공유기에서 **고정 IP(IP 예약)** 로 잡아 둬야 NAS IP가 바뀌어도 규칙이 깨지지 않는다.

### 3-5. 확인
휴대폰 Wi-Fi를 끄고 LTE로 `https://jydev.synology.me:6001` 에 접속해 자물쇠 표시와 게임 동작을 확인한다.

## 4. 보안

- **DSM 관리 포트(5000/5001)는 외부에 열지 않는다.** 공유기에서 열려 있는 포트가 6001 하나뿐인지 확인한다.
- 8080 포트도 외부에 열지 않는다. 바깥에서는 리버스 프록시(6001)로만 들어온다.
- DSM 계정에 **2단계 인증**을 켠다: DSM 우상단 계정 → 개인 설정 → 계정 → 2단계 인증.
- 기본 `admin` 계정은 비활성화하고, 비밀번호는 길고 고유하게 쓴다.
- 서버는 점수를 직접 다시 계산하고 닉네임·답안을 검사하며, 같은 IP가 1분에 20번을 넘게 기록을 보내면 막는다.
  그래도 로그인이 없으므로 누군가 일부러 정답을 알고 만점 기록을 올릴 수는 있다. 친구끼리 쓰는 게임 수준의 보호다.
- **백업:** Hyper Backup(패키지 센터에서 설치)으로 `/volume2/docker/quiz/data` 폴더를 정기 백업한다.
  DB는 WAL 모드라 `quiz.db-wal`, `quiz.db-shm` 파일이 함께 생긴다. 폴더째로 백업해야 한다.
- 컨테이너는 root로 실행된다. NAS 폴더 권한 문제를 피하려는 선택이다.

## 5. 운영

| 하고 싶은 일 | 방법 |
|---|---|
| 코드/문제 변경 반영 | 바뀐 파일을 NAS에 다시 복사 → 프로젝트 → `quiz` → **빌드**(또는 `docker compose up -d --build`) |
| 로그 보기 | 컨테이너 → `quiz` → 로그 / `docker compose logs -f` |
| 순위 초기화 | 프로젝트 중지 → `data/quiz.db*` 삭제 → 시작 |
| **문제를 고친 뒤 반영** | 문제는 DB가 **비어 있을 때만** `questions.js`에서 채워진다. 문제만 바꾸고 기록은 남기려면 DB 파일을 백업한 뒤 `questions` 표를 비워야 하고(SQLite 도구 필요), 간단히는 DB를 지워 순위를 초기화한다. |

## 6. 접속이 안 될 때 (순서대로)

1. **컨테이너가 실행 중인가?** Container Manager에서 상태 확인. 꺼져 있으면 로그를 본다.
   - 빌드 중 `better-sqlite3` 오류 → NAS CPU 구조 문제일 수 있다. 로그 전문을 확인한다.
   - `SQLITE_CANTOPEN` / 권한 오류 → `/volume2/docker/quiz/data` 폴더가 있는지, 경로가 compose와 같은지 확인.
2. **집 안에서 `http://NAS의IP:8080` 이 열리는가?** 안 되면 서버 문제, 되면 3번으로.
   - 포트 8080을 NAS의 다른 프로그램이 쓰고 있으면 compose의 `"8080:3000"` 앞 숫자를 바꾸고, 리버스 프록시 대상 포트도 같이 바꾼다.
3. **DSM 방화벽**(제어판 → 보안 → 방화벽)을 켰다면 8080(집 안)과 6001을 허용했는지 확인.
4. **리버스 프록시** 규칙의 호스트 이름/포트가 맞는지, 인증서가 그 도메인에 연결됐는지 확인.
5. **공유기 포트포워딩** 6001 → NAS 내부 IP 6001. NAS의 내부 IP가 바뀌지 않았는지 확인.
6. **DDNS**가 현재 집 공인 IP를 가리키는지 확인(제어판 → 외부 액세스 → DDNS 상태).
7. **집 밖(LTE)** 에서 접속해 본다. 집 Wi-Fi 안에서 도메인으로 접속하면 공유기가 되돌려 주지 않아(헤어핀 NAT) 안 열리는 경우가 있다.
8. 통신사가 공인 IP를 주지 않는 환경(CGNAT)이면 포트포워딩이 불가능하다. 공유기의 WAN IP와 `내 IP 확인` 사이트의 IP가 같은지 비교해 본다.
9. 접속은 되는데 "오프라인 모드"가 뜨면 화면은 열렸지만 `/api`가 실패하는 것이다. 브라우저 개발자 도구의 네트워크 탭에서 `/api/questions` 응답을 본다.

## 7. 구조

```
public/           화면 (정적 파일)
  js/storage.js   저장 창구. 서버 API 호출, 실패 시 기기 저장으로 대체
server/
  index.js        서버 시작, 라우터 (/api/questions, /api/records, /api/ranking, /api/health)
  service.js      입력 검사, 점수 재계산
  repository.js   SQLite (SQL은 여기에만)
  seed.js         questions 표가 비면 public/js/questions.js로 채움
  *.test.js       테스트 (npm test)
Dockerfile, docker-compose.yml
```

API
- `GET /api/questions`: 문제 40개 (카테고리 순서)
- `POST /api/records`: `{ nickname, answers: [{ questionId, choiceIndex }] }` → `{ nickname, totalScore, categoryScores, rank, playedAt }`. `choiceIndex`는 원본 `choices` 순서 기준(0~3).
- `GET /api/ranking`: 상위 10개
