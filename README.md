# Noctivault 제작 워커

영어 미스터리 다큐멘터리를 제작하는 NestJS TypeScript 워커입니다.

**GitHub Actions에서 제작 → YouTube 비공개 업로드 → YouTube Studio에서 검수·공개·성과 확인**으로 운영합니다. React 보드, PWA, HTTP 서버와 자동 공개 기능은 제거했습니다. PC를 계속 켜 두거나 별도 웹 서버를 배포할 필요가 없습니다.

사건·근거·중복·예산·작업 이력은 Supabase, 음성·자막·영상은 GCS에 보관합니다. Actions의 파일시스템·캐시는 영구 이력으로 사용하지 않습니다.

## 준비

1. Supabase SQL Editor에서 아래 SQL을 순서대로 검토·적용합니다. 이미 적용한 것은 반복할 필요가 없습니다.
   - `supabase/migrations/202610190001_noctivault.sql`: 사건·콘텐츠·중복·예산·실행 잠금.
   - `supabase/migrations/202610210001_studio_publication.sql`: Studio 공개 상태 동기화. 기존 자료를 삭제하지 않고 상태 전이 함수를 교체합니다. 기존 `approved`·`publishing` 기록도 조회·대조할 수 있습니다.
2. GitHub 저장소의 **Settings → Secrets and variables → Actions → Secrets**에 아래 값을 등록합니다. 실제 `.env`나 서비스 계정 파일을 커밋하지 않습니다.
3. GCS 버킷은 비공개로 유지하고 서비스 계정에 버킷 객체 읽기·쓰기 권한을 줍니다. YouTube Data API v3를 활성화합니다.

| Secret                                                                        | 용도                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                                   | 영구 제작 상태·이력·예산. `anon` 키 사용 불가         |
| `ANTHROPIC_API_KEY`                                                           | Haiku 4.5 원고·최종 사실 검증·정보 중복 검증          |
| `OPENAI_API_KEY`                                                              | TTS-1 / onyx / 0.92 음성과 Whisper 자막               |
| `FAL_KEY`                                                                     | Kling VIDEO 3.0 Standard. Kling 장면 요청 시 필요     |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN_MYSTERY` | 비공개 업로드·과거 이력·현재 공개 상태 조회           |
| `GCS_BUCKET`                                                                  | 버킷 이름 (`gs://` 제외)                              |
| `GCP_SA_KEY`                                                                  | GCS 서비스 계정 JSON 전체. Actions 인증 단계에서 사용 |

전체 항목과 기본값은 [.env.example](.env.example)에 있습니다. 자막 스타일 같은 선택 설정은 **Actions → Variables**에 같은 이름으로 등록합니다. Actions는 PC의 `.env`를 읽지 않습니다. 반대로 로컬 `.env`에 GitHub Secrets가 자동 반영되지도 않습니다.

OAuth 토큰을 새로 발급하려면 로컬에서 `.env`에 클라이언트 ID·Secret을 준비하고 아래 도구를 실행합니다. 토큰은 터미널에 출력하며 파일에 자동 기록하지 않습니다.

```sh
npm ci
node scripts/getRefreshToken.js --channel=mystery
```

발급 시 Noctivault 채널 계정과 권한을 확인하고 토큰을 `YOUTUBE_REFRESH_TOKEN_MYSTERY` Secret으로 등록합니다. 성과는 Studio에서 확인하므로 Analytics API와 그 전용 권한은 사용하지 않습니다.

## GitHub Actions에서 실행

**Actions → Noctivault Worker → Run workflow**에서 `operation`을 선택합니다. 현재는 수동 실행만 구성되어 있으며, 저장소에 코드를 올리는 것만으로 유료 제작이 시작되지는 않습니다.

| operation      | 동작                                                               |
| -------------- | ------------------------------------------------------------------ |
| `request`      | `request_json`에 입력한 JSON 관리 명령 1개 실행                    |
| `produce`      | Studio 상태를 대조한 뒤 준비된 콘텐츠 1편을 제작하고 비공개 업로드 |
| `sync-youtube` | 이미 업로드한 영상의 공개 상태를 읽어 DB 이력에 반영               |

`genre`는 `produce`에서 `mystery`(Shorts) 또는 `mystery-long`(롱폼)을 선택합니다. 요청 JSON은 셸 코드로 실행하지 않고 파일로 전달해 파싱합니다. 작업이 실패하면 원인과 실행 기록을 확인한 뒤 재개합니다. 공개 전환 명령은 제공하지 않습니다.

### 첫 제작 준비

`operation=request`를 선택하고 `request_json`에 아래 형태를 입력합니다. 전체 명령과 입력 예시는 [워커 요청 안내](docs/worker-requests.md)에 있습니다.

```json
{ "command": "history-import" }
```

기존 `published_topics`와 YouTube 업로드 전체를 먼저 가져옵니다. 비어 있는 채널도 이 단계를 완료해야 합니다. 이어 `status`로 ID와 이력을 확인하고, 과거 영상을 실제 사건·핵심 주장에 연결합니다. 복원할 수 없는 이력은 검토 필요 상태로 남아 신규 예약을 차단합니다. 무관한 영상만 사유를 남겨 제외합니다.

```json
{ "command": "status" }
```

제작 순서는 **사건 → 직접 확인한 원문 → 주장 → 콘텐츠 예약 → 원고 → 화면 자료 권리 확인 → 최종 검증 → 렌더 → 비공개 업로드**입니다. 보드를 대신해 `case`, `source`, `claim`, `reserve`, `draft`, `asset` 등의 JSON 요청을 사용합니다. 운영자가 원문과 자료를 준비해야 하며, 대기열이 비었을 때 LLM이 사건·출처를 임의로 만들어 채우지 않습니다.

`generate`는 원고를 생성하고, `verify`는 원고·제목·썸네일·설명란을 함께 검증합니다. `asset`으로 권리를 확인한 자료를 등록하고 `produce`로 이어서 진행할 수 있습니다. 권리가 불명확하거나 자료가 없으면 렌더 전에 중단합니다. 내용 수정 시 검증·렌더를 다시 수행해야 하며 업로드된 콘텐츠는 수정하지 않고 업데이트 판본으로 다룹니다.

## YouTube Studio에서 검수·공개

1. Actions가 비공개로 업로드한 영상을 YouTube Studio에서 엽니다.
2. 영상·음성·자막·출처·라이선스·AI 재현 표시와 YouTube 제한 안내를 실제 재생본으로 확인합니다. 롱폼 썸네일과 Shorts 표지도 확인합니다.
3. 문제가 없을 때 **Studio에서 직접 공개하거나 예약 게시**합니다. 워커는 `videos.update`로 공개하지 않습니다.
4. 이후 `operation=sync-youtube`를 실행합니다. `produce` 시작 전에도 같은 조회를 수행합니다.

동기화는 실제 공개 상태를 읽어 기록하는 작업이며, 사람의 검수나 사실 보증을 대신하지 않습니다. 공개를 관찰하면 `published`로 기록하고, 이후 비공개·일부 공개로 바꿔도 과거 제작 이력을 지우지 않습니다. 예약 게시 영상은 실제 공개되기 전까지 공개 완료로 기록하지 않습니다. `publishedAt`은 최초 공개를 관찰한 시각이며 정확한 공개 시각 분석용 필드는 아닙니다.

설명란의 `[Noctivault:콘텐츠ID]` 식별자는 제거하지 마세요. 식별자가 없거나 영상이 삭제·차단되어 조회되지 않으면 동기화가 실패하며 재업로드하지 않습니다. Studio에서 원고·제목·설명을 수정한 내용은 원래 검증 원고에 자동 반영되지 않으므로 변경된 주장과 근거는 직접 관리해야 합니다.

## 중단·과금 복구

- 같은 콘텐츠의 동시 작업은 Supabase 실행 잠금으로 막습니다. 다른 실행 경로도 같은 DB를 사용해야 합니다.
- Actions가 종료됐는데 실행 중 기록이 남으면 모든 워커가 종료된 것을 확인한 뒤 `recover`를 요청합니다. 업로드 결과가 불명확하면 `reconciliation_required`가 되어 재업로드를 차단합니다.
- `reconcile`은 콘텐츠 식별자로 채널 목록을 대조합니다. Studio에서 이미 공개한 영상도 기존 영상 ID와 공개 상태를 복원합니다. 일치가 0건 또는 여러 건이면 자동 재업로드하지 않습니다.
- 업로드 요청 후 1시간 이상 지났고 실제 업로드가 없다는 운영자 확인과 원격 재조회가 일치할 때만 `confirmedNoUpload: true`로 렌더 완료 상태로 복구할 수 있습니다.
- `settle`은 공급자의 청구·작업 종료를 확인한 뒤 실제 비용을 입력하는 명령입니다. 미과금이 확인된 경우에만 0으로 해제합니다. 결과가 불명확한 호출은 예약을 유지하며 무작정 다시 요청하지 않습니다.
- 성공 응답·음성 청크·자막·렌더·Kling 결과는 GCS에 보존해 재사용합니다. 보관 파일이나 영구 이력을 임의로 지우지 않습니다.

## AI·예산·자산

- `prompts/mystery.txt`, `mystery-long.txt`: Shorts 85~120단어, 근거가 충분할 때 롱폼 최대 약 3,600단어. 분량을 채우기 위해 반복하지 않습니다.
- `prompts/factcheck.txt`, `dedup.txt`: 최종 문구 사실 검증과 영구 정보 중복 검사. 프롬프트 내용이 바뀌면 별도 응답·비용 키를 사용하며, 이미 만든 원고는 자동 재생성하지 않습니다. Actions는 선택한 Git ref의 파일을 사용하므로 변경 내용을 커밋·푸시해야 다음 실행에 반영됩니다.
- Kling은 `fal-ai/kling-video/v3/standard/image-to-video`, 무음 5초를 사용합니다. 2026-10-19 확인 기준 요청 전 $0.42 예약, 콘텐츠당 유료 성공 장면 1개가 기본입니다. `kling` 요청 후 `kling-status`로 조회하고, 보존한 결과의 사용 권리를 `asset` 명령으로 확인한 뒤 사용합니다. [공급사 가격](https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video)은 실행 전 재확인하세요.
- 월 API 예산 $20: 영상 $7, 조사·원고·검증 $5, 음성·자막 $2, 이미지 $2, 기타 $4. 미완료 예약을 합산해 초과를 차단합니다. 공급사 실제 청구·세금·Actions·저장소 비용은 별도 대조해야 합니다.
- `assets/fonts/`와 `fonts.json`은 영상 자막용입니다. FFmpeg가 이 폴더를 읽습니다. 보드용 Pretendard 파일은 보드와 함께 제거했습니다.
- `assets/bgm/` 원본은 보존했지만 현재 BGM을 자동 혼합하지 않습니다. 사용하려면 곡별 권리·원저작자·크레딧 기록과 믹싱·렌더 해시 반영을 함께 구현해야 합니다.
- Qwen3-TTS는 설치·연결하지 않았습니다. 현재 OpenAI 음성 프로필은 Shorts·롱폼 공통입니다. 미사용 Gemini·Pexels·Freesound·임의 모델 변경 환경변수는 `.env.example`에서 제거했습니다.

## 로컬 CLI와 검증

Node.js 22.12 이상을 사용합니다. 제작·로컬 진단에는 FFmpeg·ffprobe와 `libass`, `drawtext`, H.264, MP3, AAC 지원이 필요합니다. GCS·음성 요청 전에 실행 환경을 확인합니다.

```sh
npm ci
npm run build
node dist/main.js --help
node dist/main.js --request=request.json
npm run mystery
npm run mystery-long
npm run longform-phase1
npm run longform-phase2
npm run sync:youtube
npm run dry-run
npm test
```

`npm start`는 사용법만 출력합니다. HTTP 서버를 실행하지 않습니다. `--dry-run`은 검은 배경·자막·무음의 5초 로컬 합성이며 외부 API를 호출하지 않습니다. 로컬의 관리·제작 명령은 실제 `.env` 설정으로 동작하므로 테스트 명령과 구분하세요.

테스트는 로컬 PGlite SQL·중복·예산·잠금·상태 전이, 요청 파싱, 원고·자막·미디어·Kling·업로드 복구·Studio 상태 조회를 검증합니다. 운영 DB·유료 API·실제 YouTube 발행을 호출하지 않습니다. 실제 FFmpeg 회귀 테스트 도구는 아래처럼 준비할 수 있으며 없으면 해당 테스트만 명시적으로 건너뜁니다.

```sh
npm install --prefix output/media-test-tools --no-save ffmpeg-ffprobe-static
npm run test:media
npm audit --omit=dev
```

## 폴더

```text
src/                       NestJS application context 기반 TypeScript 워커
  main.ts, app.module.ts   실행·의존성 구성
  cli.service.ts          제작·동기화·JSON 파일 명령
  request.service.ts      허용된 관리 요청 실행
  production.service.ts   대기열 제작·YouTube 상태 동기화
  vault/                  근거·중복·예산·AI·미디어·업로드·이력
prompts/                   현재 서비스가 읽는 원고·검증 지침
assets/                    영상용 폰트·음악 원본
scripts/                   OAuth 발급·과거 리뷰 표 보정
supabase/migrations/       영구 데이터·권한·상태 전이 SQL
tests/                     현재 워커 검증
docs/                      기획·요청 명세·과거 기록
output/                    로컬 결과·테스트 도구 (Git 제외)
```

`scripts/fillReviewTopics.js`는 과거 `published_topics`와 리뷰 문서 표를 맞추는 별도 도구입니다. 실행 결과 `dist/`는 직접 수정하지 않습니다. React/Vite/PWA 의존성과 보드 전용 파일은 사용하지 않습니다.
