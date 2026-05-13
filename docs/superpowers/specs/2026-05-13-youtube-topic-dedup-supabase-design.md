# Design: YouTube 미스터리 파이프라인 — Supabase 기반 토픽 중복 방지

**Date:** 2026-05-13  
**Status:** Draft for review  
**Context:** 숏/롱폼 자동 업로드가 GitHub Actions에서 돌며, 로컬 `output/` 기반 레저(`topic_history.json`, `used_topics_{genre}.json`)는 런너 간에 유지되지 않는다. 동일·정규화 시 동일한 `topic` 문자열이 반복 추첨되는 문제를 서버 측에서 막는다.

## Goals

1. **장르(`genre_key`) + 정규화 토픽 키(`topic_key`)** 기준으로, **최근 6개월 이내에 업로드에 성공한 조합**이면 해당 후보는 **버리고 주제를 다시 뽑는다**.
2. **6개월이 지난 뒤**에는 동일 `topic_key`로 **재업로드를 허용**한다.
3. **진실 원천**은 Supabase(Postgres). GitHub Actions는 Repository secrets로만 연결한다.
4. 기존 로컬 히스토리는 **로컬 개발·짧은 기간(예: `TOPIC_DEDUP_DAYS`) 보조**로 남길 수 있으나, **CI에서는 Supabase 규칙이 우선**한다.

## Non-goals

- 의미상 중복(다른 문장·같은 사건)까지 임베딩으로 탐지하는 것 — 별도 스펙.
- YouTube API만으로 채널 메타 동기화해 중복 판단하는 것 — 선택적 보조이며 본 설계의 필수 경로 아님.

## Definitions

- **`topic`**: 파이프라인에 들어오는 원문 주제 문자열.
- **`topic_key`**: 비교용 정규화 결과. 예: Unicode NFC, 소문자(ASCII 구간), 앞뒤 공백·연속 공백 제거, 선택적 구두점 제거. 구현 시 단일 함수 `normalizeTopicKey(topic)`로 고정.
- **“업로드 성공”**: YouTube `videos.insert`가 성공하고 유효한 `video_id`를 받은 시점. 비공개 업로드도 성공으로 본다.

## Architecture

| 단계 | 동작 |
|------|------|
| 주제 확정 전 | Supabase에 대해 `(genre_key, topic_key)`에 대해 **`uploaded_at >= now() - interval '6 months'`** 인 행이 있으면 **중복**으로 처리. |
| 중복 시 | **다시 주제 추첨**(배치/단일 진입점 모두 동일 정책). **한 슬롯당 최대 재시도 횟수** 상한(환경변수, 예: `TOPIC_DEDUP_MAX_RETRIES=8`)을 둔다. 상한 초과 시 해당 슬롯은 실패 로그 후 중단 또는 스킵(구현 플랜에서 하나로 고정). |
| 업로드 성공 후 | 같은 런에서 `genre_key`, `topic_key`, `uploaded_at`(서버 시각 기본), `video_id`, 선택적 `job_id`를 **append-only insert**. |

### Data model (Supabase)

- 테이블 예: `published_topics`  
  - `id` (bigserial, PK)  
  - `genre_key` (text, not null)  
  - `topic_key` (text, not null)  
  - `uploaded_at` (timestamptz, not null, default `now()`)  
  - `video_id` (text, nullable)  
  - `raw_topic` (text, nullable) — 디버깅·감사용, PII 없을 것 가정  

- **인덱스**: `(genre_key, topic_key, uploaded_at DESC)` — 중복 조회용.  
- **UNIQUE 제약은 6개월 윈도우와 맞지 않으므로** “6개월에 한 번만” 규칙은 **애플리케이션/쿼리**로만 강제하고, DB는 이력을 쌓는다.

### Client & secrets

- Node 파이프라인에서 `@supabase/supabase-js` 또는 REST + `service_role` 중 프로젝트 관례에 맞는 하나.  
- GitHub Actions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(또는 RLS 없이 쓰기 가능한 서버 전용 키)를 secrets로 설정. 키는 로그에 절대 출력하지 않는다.  
- **로컬**: `.env`에 동일 변수가 있으면 Supabase 경로 활성화; 없으면 기존 파일 기반 dedup만 사용(선택).

### Failure modes

- **조회 실패**(네트워크/Supabase 장애):  
  - **권장(보수)**: 업로드 전 중복 검사가 실패하면 **해당 런에서 업로드를 중단하지 않고**, 경고 로그 + (선택) 메트릭. 대신 **성공 insert도 실패할 수 있음** → 동일 런이 레저에 없을 수 있어 **드물게 중복 허용**될 수 있음을 문서화.  
  - **대안(엄격)**: 검사 실패 시 파이프라인 실패 — CI 안정성과 트레이드오프. 구현 플랜에서 기본값 하나를 택한다.

- **삽입 실패**: 업로드는 이미 되었으므로 로그·재시도(아이템포턴트 `video_id` 기준 upsert는 선택) 검토.

### Integration points (코드베이스)

- `src/script/topicGenerator.js`: 이미 로컬 히스토리/`TOPIC_DEDUP_DAYS` 존재 → Supabase 활성 시 **제외 목록 소스를 Supabase 조회 결과와 병합**하거나, CI에서는 Supabase만 신뢰.  
- `src/index.js` — `runBatch` / `runPipeline`: 확정 `topic` 직전 또는 `generateTopics` 이후에 **중복 검사 루프**; 업로드 성공 직후 **insert**.

## Testing

- Supabase 로컬 또는 스테이징 프로젝트로: (1) 동일 `topic_key` 연속 두 번 — 두 번째는 재추첨 또는 거절 (2) 6개월 이전 타임스탬프 시드 후 동일 키 — 허용.  
- GitHub Actions: secrets 미설정 워크플로는 기존 동작과 동일(또는 명시적 noop)인지 확인.

## Open decisions (implementation plan에서 확정)

1. 중복 검사/삽입 실패 시 **보수 vs 엄격** 기본값.  
2. 재시도 상한 초과 시 **스킵 vs 전체 잡 실패**.  
3. 롱폼(`runLongformPipeline`)에 동일 규칙을 **즉시 적용할지**, 숏만 1차 적용할지.

---

승인되면 `writing-plans` 스킬로 구현 작업을 쪼갠다.
