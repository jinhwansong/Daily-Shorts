# Mystery Shorts 운영·전략 문서화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub 저장소에 **운영자(본인)가 다시 읽었을 때 맥락이 살아 있는** 미스터리 Shorts 전략·토픽·지표 해석 문서를 추가하고, 기존 `md/automation-vs-manual.md`와 상호 링크한다.

**Architecture:** `docs/operations/` 하위에 인덱스(`README.md`)와 본문(`mystery-shorts-strategy.md`) 두 파일만 둔다. 코드·파이프라인 변경은 범위 밖이다. 레딧은 **현재 레포 코드에 직접 연동되어 있지 않으므로** “외부에서 영감을 얻는 경우”를 부록으로만 적는다.

**Tech Stack:** Markdown, UTF-8.

---

### Task 1: `docs/operations/` 인덱스 생성

**Files:**
- Create: `docs/operations/README.md`

- [ ] **Step 1: Create `docs/operations/README.md`**

아래 내용 전체를 그대로 저장한다.

```markdown
# Operations (운영 문서)

미스터리 Shorts 파이프라인을 **사람이** 해석하고 조정할 때 쓰는 메모다. 자동화 동선은 `../` 상위의 레포 루트 `md/automation-vs-manual.md`를 본다.

| 문서 | 용도 |
|------|------|
| [mystery-shorts-strategy.md](./mystery-shorts-strategy.md) | US 시청자·지표 해석·토픽 철학(평균 조회·편차)·레딻과 코드의 관계 |

## 코드와의 경계

- 토픽 **생성 로직**은 `src/script/topicGenerator.js`의 `generateTopics()` → `src/genres.js`의 `topicInstruction`이다.
- 이 폴더의 문서는 **행동 강령·해석**이지, 실행 코드가 아니다.
```

- [ ] **Step 2: Commit**

```bash
git add docs/operations/README.md
git commit -m "docs(ops): add operations index for mystery Shorts"
```

---

### Task 2: 전략 본문 `mystery-shorts-strategy.md` 작성 및 링크 연결

**Files:**
- Create: `docs/operations/mystery-shorts-strategy.md`
- Modify: `md/automation-vs-manual.md` (문서 끝에 "운영 전략" 링크 한 블록 추가)

- [ ] **Step 1: Create `docs/operations/mystery-shorts-strategy.md`**

아래 내용 전체를 그대로 저장한다.

```markdown
# 미스터리 Shorts — US 시청자·지표·토픽 (운영 메모)

## 1. 파이프라인에서 토픽이 나오는 방식 (사실)

- 실행 경로: `src/script/topicGenerator.js` → LLM → `src/genres.js`의 `mystery.topicInstruction`.
- “레딧 미스터리에서 본 사건”을 **직접 크롤링**하는 코드는 이 레포에 없다. 레딧에서 아이디어를 얻었다면, 그건 **운영자의 외부 입력**이며, LLM 토픽 문구와 **불일치할 수 있다**는 전제를 둔다.

## 2. 목표 말하기: 평균 조회수 vs 그만두기

- **평균(또는 중앙값) 조회수**를 올리려면 “한두 개 대박”보다 **바닥을 올리는 토픽 믹스**가 수학적으로 유리한 경우가 많다.
- **구독자**는 Shorts만으로 천천히 오르는 편이 흔하다. 구독을 목표와 평균 조회를 **같은 기준**에 묶으면 판단이 흔들린다.
- **접기/유지**는 레포가 결정하지 않는다. 필요하면 “3개월마다 중앙값 조회 또는 월 총 시청 시간” 같은 **사전 기준**만 쓴다.

## 3. 지표: 조회수 높은데 시청유지(%)는 낮은 경우

- Shorts는 **넓은 추천**에 노출될수록 **무작위 시청자**가 섞여 **평균 % 시청**이 떨어질 수 있다. 이것만으로 “콘텐츠가 더 나쁘다”고 단정하지 않는다.
- **총 시청 시간**, **노출 대비 클릭**, **평균 시청 초**를 같은 기간·비슷한 길이 영상끼리 비교한다.

## 4. Studio의 ‘검색어’

- 제목·설명에 없는 단어가 검색어 보고에 뜰 수 있다. **최적화 타깃 키워드**로 잡기보다 **참고**로 본다.
- 미국 시청자용 메타 규칙은 이미 `src/script/scriptGenerator.js`의 메타데이터 프롬프트에 반영되어 있다.

## 5. 토픽 철학: “완전 랜덤”의 함정

- LLM에 “다양하게” 뽑게 하면 **분산이 커지기 쉽다**. US 본토 시청자에게 **이름 인지도**가 낮은 사건은 **조회 바닥**이 낮아지기 쉽다.
- `genres.js`의 `mystery` 지시문에는 이미 *recognizable*, *widely covered* 쪽 우선을 쓴다. 그래도 편차가 크면 **추가 구조(티어·비율)** 는 **코드 변경**으로 다루고, 이 문서는 그 **의도**만 남긴다.

## 6. 다음 단계 (코드 밖)

- 토픽을 **A/B 티어 가중치**로 나누는 것은 **별도 구현 계획**의 대상이다.
- 본 문서는 **문서화 1단계**에서 멈춘다.

---

## 관련 파일

- 자동화 개요: [md/automation-vs-manual.md](../../md/automation-vs-manual.md)
- 스크립트·메타 생성: `src/script/scriptGenerator.js`
- 토픽 LLM: `src/script/topicGenerator.js`, `src/genres.js`
```

- [ ] **Step 2: Patch `md/automation-vs-manual.md`**

파일 **맨 아래**에 다음 블록을 추가한다(기존 마지막 줄 다음에 빈 줄 하나 두고 붙인다).

```markdown

---

## 운영·전략 (사람이 읽는 메모)

- [docs/operations/mystery-shorts-strategy.md](../docs/operations/mystery-shorts-strategy.md) — US 시청자, 지표 해석, 토픽 철학, 레딧 vs 코드 경계
```

- [ ] **Step 3: Commit**

```bash
git add docs/operations/mystery-shorts-strategy.md md/automation-vs-manual.md
git commit -m "docs(ops): add mystery Shorts strategy memo and link from automation guide"
```

---

### Task 3: 스스로 검수 (자동 테스트 없음)

**Files:**
- (read-only) 위에서 만든 마크다운

- [ ] **Step 1: 링크 점검**

로컬에서 다음을 확인한다.

- `docs/operations/README.md` → `mystery-shorts-strategy.md` 상대 링크가 깨지지 않는지
- `md/automation-vs-manual.md` → `../docs/operations/mystery-shorts-strategy.md` 가 레포 루트 기준으로 올바른지  
  (`md/` 에서 `docs/` 로 가려면 `../docs/operations/...` 가 맞다)

- [ ] **Step 2: 빈 커밋 없음 확인**

`git status` 가 깨끗한지 확인한다.

---

## Self-review (작성자용)

- **Spec coverage:** 사용자 요청(문서화 우선, US, 평균 조회·편차·레딧·지표 이야기)은 본문 섹션 1~6으로 반영. 코드 변경은 의도적으로 제외.
- **Placeholder scan:** 없음.
- **경로:** Windows·Git 경로 모두 `/` 사용으로 통일.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-06-mystery-operations-docs.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration  

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints  

Which approach?
