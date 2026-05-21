---
title: "feat: 미스터리 숏 1주 운영 (2026-05-22 ~ 05-28)"
type: feat
status: completed
date: 2026-05-21
origin: docs/reviews/2026.05.21.md
---

# 미스터리 숏 1주 운영 계획 (2026-05-22 ~ 05-28)

## Summary

5/14~5/21 회고에서 나온 **「편수 줄이기 · 중복 사건 금지 · DB만으로 topic/hook 적재」** 를 다음 주(5/22~5/28)에 실행하는 **운영 계획**이다. 코드 대규모 변경 없이, **수동 `workflow_dispatch` + 일 1편 + Supabase 쿨다운** 으로 **편당 평균 조회**를 이번 주(~195) 대비 개선하는 것이 목표다. `prompts/mystery.txt` 수정은 **보류**한다.

---

## Problem Frame

- 5/14~5/21에 8일간 20편 업로드, 편당 평균 조회 ~195. 같은 사건 재업(Amelia, Mary Celeste 등)으로 조회 분산.
- 파이프라인 **cron 중지** 상태. Supabase `published_topics`는 20편 중 12편만 topic 매칭(과거 백필 안 함 — **액션 B**).
- 조회 KPI 기준으로 **운영 레버**(편수·중복·사건 Tier)를 먼저 조정하고, HOOK 분석은 **DB에 hook_first_line 5편+ 쌓인 뒤** 다음 회고에서 한다.

---

## Requirements

- R1. **5/22~5/28** 업로드 **총 5~7편**, **하루 최대 1편**(실험 핵심).
- R2. **같은 raw topic / topic_key 6개월 쿨다운** 준수(Supabase dedup). **7일 내 동일 사건 재업 금지**(운영 규칙).
- R3. 매 성공 업로드마다 DB에 `video_id`, `raw_topic`, `hook_first_line` 자동 기록(002 마이그레이션 적용 전제).
- R4. **5/28 전후** 스튜디오 지표 + `fillReviewTopics.js`로 `docs/reviews/2026.05.28.md` 작성.
- R5. 성공 판정: 업로드 N편 대비 **편당 평균 조회 > 250** 또는 **상위 3편 평균 > 300**(5/28 스냅샷, 동일 KPI 정의).
- R6. 이번 주 **`prompts/mystery.txt` / BOOKEND 규칙 변경 없음**.

**Origin:** `docs/reviews/2026.05.21.md` §다음 주까지 운영·실험

---

## Scope Boundaries

- **In scope:** 수동 CI 실행, env 확인, 업로드 편수·사건 Tier, 주간 회고 표, Supabase 마이그레이션 1회.
- **Out of scope:** cron 스케줄 복구, 과거 94편 topic/hook 백필, Reddit/위키 시드 실험, 롱폼 파이프라인, 프롬프트 대개편.
- **Deferred to Follow-Up Work:** 5/28 회고 후 hook_first_line 5편+이면 mystery.txt HOOK 한 줄 수정 검토(별도 플랜).

---

## Context & Research

### Relevant Code and Patterns

- CI: `.github/workflows/pipeline-mystery.yml` — **`workflow_dispatch`만**, 이미 `--count=1` (`node src/index.js --run-daily --genre=mystery --count=1`).
- Dedup: `src/utils/publishedTopics.js` — `TOPIC_PUBLISHED_COOLDOWN_MONTHS`(기본 6), `recordPublishedTopic`에 `hook_first_line` 저장(002 적용 후).
- 회고: `docs/weekly-youtube-review-handoff.md`, `scripts/fillReviewTopics.js`.
- 분석 기준선: `docs/reviews/2026.05.21.md` (5/14~5/21, 20편, 평균 ~195).

### Institutional Learnings

- `docs/solutions/` 없음 — 이번 주 기준선은 `2026.05.21.md`만 사용.

---

## Key Technical Decisions

- **수동 실행만:** cron 복구 안 함. 실패 시 Actions 로그만 보고 재시도 — 하루 2편 넘기지 않음.
- **일 1편 고정:** workflow `--count=1` 유지. `DAILY_UPLOAD_COUNT` env는 workflow에 없으면 무관( CLI count가 우선).
- **사건 Tier:** Tier A(US 검색형 실종 1회) + Tier B(디테일 강한 제목) 혼합. **이번 주 blocklist(재업 금지):** Amelia Earhart, Mary Celeste, Uwe Barschel, Natalee Holloway(5/20 업로드 직후), Glenn Miller, Flight 19, Steve Fossett — 최소 **7일**.
- **데이터:** topic은 `fillReviewTopics.js`, hook은 **다음 회고(5/28+)부터** DB 컬럼 사용. 이번 주 표에는 hook 열 **넣지 않음**.
- **KPI:** 조회수 1순위. 노출·CTR은 표에만 기록, 판단은 보조.

---

## Open Questions

### Resolved During Planning

- **자동 스케줄?** → 아니오. 이번 주는 전부 수동.
- **몇 편?** → 5~7편(주 5일 업로드 가정, 주말 휴식 가능).

### Deferred to Implementation

- Supabase 002가 아직 미적용이면 `hook_first_line` insert 실패 가능 → **U1에서 확인**.

---

## High-Level Technical Design

> *운영 흐름만 directional.*

```text
[5/21] Pre-flight: Supabase 002 + blocklist 확인
    ↓
[5/22~5/27] 매 업로드일: GitHub Actions Run workflow (count=1)
    → dedup → topic/script → upload → published_topics row
    ↓
[5/28] Studio export → reviews/2026.05.28.md + fillReviewTopics.js
    → 편당 평균 vs 195, 실험 성공/실패 판정
```

---

## Implementation Units

### U1. Pre-flight (5/21, 재개 전 1회)

**Goal:** DB·CI가 1주 실험을 받칠 준비 상태.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Verify: `supabase/migrations/002_published_topics_hook_columns.sql`
- Verify: `.github/workflows/pipeline-mystery.yml`
- Optional query: Supabase `published_topics`에서 Amelia/Mary Celeste 등 최근 `topic_key` 확인

**Approach:**
1. Supabase SQL Editor에서 **002 마이그레이션 실행** (`hook_first_line`, `thumbnail_line` 컬럼).
2. GitHub Secrets(`SUPABASE_*`, YouTube, API keys) 유효 확인.
3. **Blocklist 메모** 작성(노트 또는 `docs/reviews/2026.05.28.md` 메타에 붙일 준비): Amelia, Mary Celeste, Uwe Barschel, Natalee(5/20), Glenn Miller, Flight 19, Steve Fossett — 7일간 파이프라인 topic 후보에서 제외( dedup 6mo + 운영 7d ).

**Verification:**
- `published_topics` insert 테스트 1행(또는 dry-run 로그)에서 hook 컬럼 오류 없음.
- Actions에서 `workflow_dispatch` Run 가능.

---

### U2. 주간 업로드 리듬 (5/22 ~ 5/27)

**Goal:** 5~7편 업로드, 일 1편, Tier·blocklist 준수.

**Requirements:** R1, R2, R3

**Dependencies:** U1

**Files:**
- Run: `.github/workflows/pipeline-mystery.yml` (manual)
- Monitor: GitHub Actions logs, YouTube Studio

**Approach:**

| 요일 | 액션 |
|------|------|
| **매 업로드일** | GitHub → Actions → Mystery Pipeline → **Run workflow** (1회 = 1편) |
| **Tier A (주 2~3편)** | US 실종·이름 검색형 — **사건당 1편만**. 예: Asha Degree, Brandon Swanson, DB Cooper(미업로드 시), Kyron Horman(재시도 시 제목·각도 변경) |
| **Tier B (주 2~4편)** | 디테일 제목 패턴 — Villisca/Hinterkaifeck/Dorothy Scott 급 **새 각도**. `이름 + 숫자/증거/장소` |
| **피하기** | JonBenét·Magnitsky식(노출↑ 조회↓ 패턴), blocklist 사건, 7일 내 동일 사건 |

**업로드 후 24h:** Studio에서 조회·노출만 훑기(조기 신호). 실패 run은 같은 날 **재실행하지 않음**(중복 업로드 방지).

**Verification:**
- 주간 업로드 **≤7편**, **어느 날도 2편 초과 없음**.
- `published_topics`에 이번 주 `video_id` 행 수 ≈ 성공 업로드 수.

---

### U3. 데이터·회고 준비 (업로드 중 상시)

**Goal:** 5/28 회고를 DB topic 중심으로 빠르게 작성.

**Requirements:** R3, R4

**Dependencies:** U2 (일부 업로드 후부터 가능)

**Files:**
- Modify/create: `docs/reviews/2026.05.28.md` (5/28 작성)
- Run: `scripts/fillReviewTopics.js` (경로를 5/28 파일로 바꾸거나 인자 추가 — **Deferred:** 5/28에 스튜디오 붙여넣은 뒤 실행; 현재 스크립트는 `2026.05.21.md` 고정)

**Approach:**
- 표 열: `video_id | 제목 | topic (raw) | 게시 시간 | 길이 | 조회 | 노출 | CTR` (**hook 열 없음**).
- 스튜디오에서 **5/22~5/28 업로드분만** export → 게시 시간 최신순 정렬.
- `node scripts/fillReviewTopics.js` 실행 전 **reviewPath를 2026.05.28.md로** 맞출 것(5/28 당일 작업 — 스크립트 1줄 수정 또는 env).

**Verification:**
- 5/28 md에 **topic (raw) 매칭률 ≈ 100%**(이번 주 업로드분은 전부 DB 기록 전제).

---

### U4. 주간 마감·판정 (5/28)

**Goal:** 실험 성공/실패 결정 및 다음 주 방향 1줄.

**Requirements:** R4, R5

**Dependencies:** U2, U3

**Files:**
- Create: `docs/reviews/2026.05.28.md` (분석 섹션 포함)

**Approach:**
1. 5/22~5/28 업로드 N편 조회 합계 / N = **편당 평균**.
2. 상위 3편 평균 조회 계산.
3. **성공:** 평균 > 250 **또는** 상위3 > 300 → 다음 주 **일 1편 유지**, Tier A 비중 소폭 ↑.
4. **실패:** → Tier A만(US 검색형), JonBenét/Magnitsky 패턴 2주 금지, **프롬프트는 여전히 보류** unless hook_first_line ≥ 5.
5. AI 요청 템플릿(선택): `@docs/reviews/2026.05.28.md` + 「편당 평균 vs 195, 중복 0건? 5줄」.

**Verification:**
- `2026.05.28.md`에 **숫자 요약 · 상하위 · 성공/실패 판정 · 다음 주 1줄** 존재.

---

## System-Wide Impact

- **YouTube / Studio:** 업로드 빈도 감소 → 채널당 노출 학습에 유리할 수 있음(가설).
- **Supabase:** `published_topics` 행 5~7건 추가, dedup 조회 범위 확대.
- **비용:** 일 1편 × 7일 — LLM/TTS/CI 분당 비용 감소.
- **Unchanged:** mystery-long, cron, mystery.txt, 과거 영상 메타.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 002 미적용 → hook insert 실패 | U1에서 마이그레이션 필수 |
| dedup이 topic 재추첨만 하고 blocklist 사건과 충돌 | Tier 후보를 blocklist 밖으로 수동 좁히기 |
| workflow 실패 후 같은 날 재Run → 중복 | 실패일 업로드 0편으로 기록, 다음 날 1편만 |
| fillReviewTopics가 5/21 파일 고정 | 5/28에 reviewPath 변경(소규모) |

---

## Documentation / Operational Notes

- 기준선 회고: `docs/reviews/2026.05.21.md`
- 템플릿: `docs/weekly-youtube-review-handoff.md`
- CI 중지 확인: `.github/workflows/pipeline-mystery.yml` `on: workflow_dispatch` only

---

## Success Metrics

| 지표 | 기준선 (5/14~21) | 목표 (5/22~28) |
|------|------------------|----------------|
| 편당 평균 조회 | ~195 | **> 250** |
| 상위 3편 평균 | ~530 (722,683,594) | **> 300** |
| 주간 업로드 수 | 20 / 8일 | **5~7 / 7일** |
| 동일 사건 7일 내 재업 | Amelia 등 다수 | **0건** |
| DB topic 매칭(당주) | 12/20 | **≈ N/N** |

---

## Sources & References

- **Origin:** [docs/reviews/2026.05.21.md](../reviews/2026.05.21.md)
- CI: `.github/workflows/pipeline-mystery.yml`
- Dedup: `src/utils/publishedTopics.js`
- 회고 스크립트: `scripts/fillReviewTopics.js`
