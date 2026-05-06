# Superpowers 플러그인 — 스킬 목록 및 사용 방법

Cursor에 설치된 **Superpowers** 플러그인은 개발·디버깅·계획·리뷰를 위한 **프로세스 스킬** 모음입니다. 아래 설명은 플러그인에 포함된 각 `SKILL.md`의 **frontmatter `description`** 과 개요를 바탕으로 정리했습니다.

---

## 1. 스킬을 어떻게 “쓰는가”

- **에이전트가 자동 적용:** 대화나 작업 내용이 어떤 스킬의 설명과 맞으면, 에이전트는 해당 스킬을 읽고 그 절차를 따르도록 설계되어 있습니다.
- **직접 지정:** 채팅에서 `@` 멘션이나 규칙·스킬 경로로 특정 스킬을 열어 두면, 그 문서가 컨텍스트에 들어갑니다. 플러그인이 `/` 명령으로 스킬 이름을 노출한다면 그 경로로도 호출할 수 있습니다.
- **다른 제품과의 차이:** 공식 `using-superpowers` 스킬 원문에는 Claude Code의 `Skill` 도구, Copilot CLI의 `skill` 도구 등 **플랫폼별 도구 이름**이 나옵니다. Cursor에서는 “관련 스킬 파일을 로드한 뒤 그대로 따름”으로 이해하면 됩니다.

### 지침 우선순위 (`using-superpowers`)

1. **사용자의 명시적 지시** (예: `AGENTS.md`, 직접 요청) — 최우선  
2. **Superpowers 스킬** — 기본 시스템 동작과 충돌 시 스킬 우선  
3. **기본 시스템 프롬프트** — 최하위  

사용자가 “TDD 쓰지 마”라고 하면, 스킬이 TDD를 권하더라도 **사용자 지시가 이깁니다**.

### 여러 스킬이 겹칠 때 (`using-superpowers`)

- **프로세스 스킬 먼저** (예: brainstorming, systematic-debugging) — 접근 방법을 정함  
- **구현·도메인 스킬 다음** — 실행 단계에서 적용  

예: “기능을 만들자” → 먼저 brainstorming 계열, 이후 구현 스킬.

### 스킬 종류

- **Rigid(엄격):** TDD, 디버깅 등 — 외곡하지 말고 절차대로  
- **Flexible(유연):** 패턴 위주 — 원칙을 맥락에 맞게 적용  

---

## 2. 스킬 목록

| 스킬 이름 | 용도 (요약) |
|-----------|----------------|
| `using-superpowers` | 대화·작업 시작 시 스킬 탐지·로드 방식과 우선순위 확립. “1%라도 해당될 수 있으면 스킬을 연다”는 규칙이 핵심 |
| `brainstorming` | **창의적 작업 전** — 기능·컴포넌트·동작 변경 전 아이디어를 설계·스펙으로 다듬음. 사용자가 설계를 승인하기 전에는 구현 금지 |
| `writing-plans` | **멀티스텝 스펙이 있을 때, 코드 전** — 구현 계획서 작성. 기본 저장 위치: `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` |
| `executing-plans` | **이미 작성된 계획을 “별도 세션”에서 실행**할 때. 체크포인트·검증 위주. 서브에이전트가 있다면 `subagent-driven-development` 권장 |
| `subagent-driven-development` | **같은 세션에서** 계획 실행. **작업마다 새 서브에이전트** + 스펙 검토 후 품질 검토 등 2단계 리뷰 |
| `test-driven-development` | **기능·버그 수정 구현 전** — 실패하는 테스트부터. 예외는 파트너와 합의(프로토타입, 생성 코드, 설정 파일 등) |
| `systematic-debugging` | **버그·테스트 실패·이상 동작** — 추측으로 고치지 말고, 원인 조사 후 수정 |
| `verification-before-completion` | **완료·통과·수리됐다고 말하기 전** — 해당 주장을 뒷받침하는 명령을 **이번에** 실행하고 출력으로 증명 |
| `using-git-worktrees` | **기능 브랜치 격리** — worktree 생성·디렉터리 선택·`.gitignore` 안전 확인 |
| `finishing-a-development-branch` | **구현 완료·테스트 통과 후** — 머지 / PR / 보관 / 폐기 등 선택지를 제시하고 처리 |
| `receiving-code-review` | **리뷰 피드백 수신 시** — 맹목적 동의 금지, 코드베이스 기준으로 검증 후 반영 |
| `requesting-code-review` | **작업 단위·주요 기능 완료·머지 전** — `code-reviewer` 서브에이전트 등으로 리뷰 요청 |
| `dispatching-parallel-agents` | **서로 독립인 문제가 2개 이상** — 도메인별로 에이전트를 나눠 병렬 처리 |
| `writing-skills` | **새 스킬 작성·편집·배포 전 검증** — 스킬을 “문서화된 TDD”로 다룸. 선행으로 `test-driven-development` 이해 권장 |

---

## 3. 권장 워크플로 (한 줄 요약)

1. **새 기능·동작 변경:** `brainstorming` → 설계 문서(기본 `docs/superpowers/specs/…`) → `writing-plans`  
2. **계획 실행:**  
   - 같은 세션 + 독립 작업 많음 → `subagent-driven-development`  
   - 별도 세션에서 진행 → `executing-plans`  
3. **구현 세부:** `test-driven-development`  
4. **문제 발생:** `systematic-debugging`  
5. **끝맺음:** `verification-before-completion` → `finishing-a-development-branch`  
6. **리뷰:** `requesting-code-review` / `receiving-code-review`  

`executing-plans`는 완료 후 **`finishing-a-development-branch`**를 쓰라고 명시합니다. 계획 실행 전·격리 작업에 **`using-git-worktrees`**를 연계하는 것이 권장됩니다.

---

## 4. 컴파운드 엔지니어링 (Compound Engineering)

**컴파운드 엔지니어링**은 “기능을 하나 추가할수록 코드베이스가 더 꼬이는” 대신, **풀어낸 문제·학습·결정을 자산으로 남겨 다음 작업이 더 쉬워지게 만드는** AI 보조 개발 방식을 가리키는 말로 쓰입니다. (대표적으로 [Every](https://every.to/p/compound-engineering) 쪽에서 정리·확산된 개념이며, 별도 [Compound Engineering 플러그인](https://github.com/EveryInc/compound-engineering-plugin)으로 워크플로를 도구화한 사례가 있습니다.)

### 4.1 루프

여러 자료에서 공통으로 나오는 순환은 다음과 비슷합니다.

| 단계 | 하는 일 |
|------|---------|
| **Plan** | 맥락 조사, 설계, 구현 로드맵·작업 분해 |
| **Work** | 계획대로 구현·검증 (반복 가능한 패턴 유지) |
| **Review** | 보안·성능·구조 등 다각도 점검, 이슈를 일찍 잡기 |
| **Compound** | 해결 과정·결정·실수 방지 규칙을 **문서·스킬·레포 규칙**으로 남김 → 다음 Plan이 같은 함정을 덜 밟음 |

“실행(Work)만 빠르게”가 아니라 **Plan·Review·Compound에 시간을 쓰는 쪽이** 장기 속도에 유리하다는 주장이 붙는 경우가 많습니다.

### 4.2 Superpowers 스킬과의 대응

컴파운드 엔지니어링은 별도 제품군이고 Superpowers는 다른 플러그인이지만, **같은 철학을 Superpowers로 구현**하려면 아래처럼 맞춰 볼 수 있습니다.

| 컴파운드 단계 | Superpowers에서 |
|---------------|-------------------|
| Plan | `brainstorming` → 설계 스펙 → `writing-plans` |
| Work | `executing-plans` / `subagent-driven-development` + `test-driven-development`, 필요 시 `using-git-worktrees` |
| Review | `requesting-code-review`·`code-reviewer`, 피드백 수신 시 `receiving-code-review` |
| Compound | 스펙·계획·결정을 `docs/superpowers/` 등에 유지, 반복되는 규칙은 `writing-skills`로 스킬화하거나 `AGENTS.md` / 프로젝트 규칙에 흡수 |

**Compound**에 가장 가까운 단독 스킬은 **`writing-skills`**(재사용 가능한 “How”를 문서로 굳힘)이고, 한 번의 기능 사이클 전체를 “다음에 복리로 남기려면” **`brainstorming`이 요구하는 설계 문서화**와 **`verification-before-completion`으로 검증을 남기는 습관**이 같이 가야 합니다.

---

## 5. 서브에이전트: `code-reviewer`

`requesting-code-review` 스킬에 따르면, **구현 요약·요구사항/계획·베이스/헤드 SHA** 등을 넣어 `code-reviewer` 서브에이전트를 호출합니다. 세션 전체 히스토리 대신 **변경과 요구사항만** 넘겨 집중 리뷰를 하도록 하는 것이 목적입니다. 템플릿은 플러그인의 `code-reviewer.md` 등을 참고하면 됩니다.

---

## 6. 폐기된 명령 (Commands)

구 Superpowers 슬래시 명령은 아래처럼 **스킬 이름으로 대체**하는 것이 권장됩니다.

| 예전 | 대체 |
|------|------|
| `brainstorm` | `brainstorming` 스킬 |
| `write-plan` | `writing-plans` 스킬 |
| `execute-plan` | `executing-plans` 스킬 |

---

## 7. 플러그인 파일 위치 (참고)

설치 환경에 따라 캐시 경로가 다를 수 있습니다. 이 문서를 생성할 때 사용한 예시 경로는 다음과 같습니다.

`…/cursor-public/superpowers/<버전 해시>/skills/<스킬명>/SKILL.md`

원문 업데이트는 **항상 해당 `SKILL.md`** 를 기준으로 하면 됩니다.

---

## 8. 한 페이지 치트시트

| 상황 | 열 스킬 |
|------|---------|
| 무엇을 만들지부터 정해야 함 | `brainstorming` |
| 어떻게 나눠 구현할지 문서가 필요 | `writing-plans` |
| 계획대로 직접/서브에이전트로 실행 | `subagent-driven-development` 또는 `executing-plans` |
| 코드부터 쓰기 전 | `test-driven-development` |
| 깨짐·버그 | `systematic-debugging` |
| “다 됐다”고 하기 전 | `verification-before-completion` |
| 브랜치 정리·머지·PR | `finishing-a-development-branch` |
| 독립 이슈 여러 개 | `dispatching-parallel-agents` |
| 리뷰 받기/처리하기 | `requesting-code-review` / `receiving-code-review` |
| 스킬 문서를 새로 쓸 때 | `writing-skills` |
| 컴파운드(지식·규칙 누적) | 설계·계획·검증을 repo에 남기고, 반복 규칙은 `writing-skills` 또는 팀 규칙 파일로 |
