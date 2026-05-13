# YouTube Shorts Open/Close Bookend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미스터리 숏 스크립트에서 도입 HOOK의 구체적 앵커와 마무리 CLIFFHANGER가 명시적으로 연결되도록 프롬프트와 사용자 메시지를 보강한다.

**Architecture:** 시스템 프롬프트(`prompts/mystery.txt`)에 BOOKEND 규칙을 추가하고, `generateScript`의 LLM `user` 문자열에 동일 의도를 한 줄 반복한다. 동작 검증은 문자열 포함 테스트로 최소 보장한다.

**Tech Stack:** Node 18+, `node --test`, 기존 `scriptGenerator.js`·프롬프트 로더.

**Spec:** `docs/superpowers/specs/2026-05-13-youtube-shorts-open-close-bookend-design.md`

---

## File map

| Path | 변경 |
|------|------|
| `prompts/mystery.txt` | STRUCTURE 섹션에 BOOKEND 규칙 추가 |
| `src/script/scriptGenerator.js` | `generateScript`의 `user` 프롬프트에 BOOKEND 보강 줄 추가 |
| `tests/mysteryPromptBookend.test.js` | 프롬프트에 BOOKEND 문단 존재 검증 |
| `package.json` | `npm test` 목록에 새 테스트 파일 추가 |

---

### Task 1: `prompts/mystery.txt`에 BOOKEND 규칙 추가

**Files:**

- Modify: `prompts/mystery.txt`

- [ ] **Step 1: `STRUCTURE` 블록에서 섹션 `4. THE CLIFFHANGER` 직후, `## When Wikipedia` 직전에 아래 블록을 그대로 삽입**

```text

BOOKEND (mandatory — opening and closing must connect):
- Pick ONE concrete anchor from your HOOK (the sound, object, place, transmission, or last-known evidence you opened with).
- The CLIFFHANGER must explicitly call back to that same anchor: reuse its noun, restate the paradox around it, or ask a question that only lands because of the opening beat.
- Do NOT end with a generic closer ("Will we ever know?", "Some secrets stay buried") unless it clearly names or unmistakably refers back to that opening anchor.
- Do NOT introduce a new focal mystery, object, or person in the final sentences that was absent from the HOOK and FACT beats—stay on one spine.
- The viewer should feel the ending was inevitable from how the Short began.
```

- [ ] **Step 2: Commit**

```bash
git add prompts/mystery.txt
git commit -m "feat(prompts): mystery shorts BOOKEND hook-to-closer tie-back"
```

---

### Task 2: `generateScript` 사용자 메시지 보강

**Files:**

- Modify: `src/script/scriptGenerator.js` (`generateScript` 내부 `completeLlm` 호출의 `user` 템플릿 문자열)

- [ ] **Step 1: `BALANCED GROUNDING` 목록에서 `(5) English only...` 줄 바로 뒤에 아래 줄을 추가** (백틱 안 내용만 추가; 기존 번호 유지 후 새 줄이 `(6)`이 되도록)

```text
(6) BOOKEND: The closing question or paradox must explicitly recall one concrete element from your opening sentences—the same evidence, sound, place, object, or last-known detail—not a new topic introduced only at the end.
```

편집 후 해당 구간은 다음과 같은 형태여야 한다(앞뒤는 파일 원문 유지):

```javascript
    user: `Topic: ${topic}${wikiBlock}${factBlock}${noWikiWarning}${scriptUserMessageAddon()}

SOURCE DISCIPLINE — apply before writing a single word:
...

BALANCED GROUNDING (read carefully):
(1) Do **not** invent...
...
(5) English only; respect the word limit for Shorts.
(6) BOOKEND: The closing question or paradox must explicitly recall one concrete element from your opening sentences—the same evidence, sound, place, object, or last-known detail—not a new topic introduced only at the end.`,
```

- [ ] **Step 2: Commit**

```bash
git add src/script/scriptGenerator.js
git commit -m "feat(script): reinforce BOOKEND in generateScript user prompt"
```

---

### Task 3: 프롬프트 회귀 테스트

**Files:**

- Create: `tests/mysteryPromptBookend.test.js`

- [ ] **Step 1: 테스트 파일 작성**

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('mystery.txt includes BOOKEND open/close tie-back section', () => {
  const p = path.join(__dirname, '../prompts/mystery.txt');
  const txt = fs.readFileSync(p, 'utf-8');
  assert.ok(/BOOKEND \(mandatory — opening and closing must connect\)/i.test(txt));
  assert.ok(/explicitly call back/i.test(txt));
});
```

- [ ] **Step 2: 실패 확인** — 파일 생성 전이라면 스킵; 작성 후 실행:

Run:

```bash
npm test -- tests/mysteryPromptBookend.test.js
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/mysteryPromptBookend.test.js
git commit -m "test: assert mystery prompt contains BOOKEND rules"
```

---

### Task 4: `npm test` 스크립트 확장

**Files:**

- Modify: `package.json`

- [ ] **Step 1: `"test"` 배열 문자열에 `tests/mysteryPromptBookend.test.js` 추가**

현재 예시:

```json
"test": "node --test tests/copyrightGuard.test.js tests/topicTier.test.js tests/redditTopicSource.test.js tests/topicKey.test.js tests/publishedTopics.test.js tests/mysteryPromptBookend.test.js"
```

- [ ] **Step 2: 전체 테스트 실행**

Run:

```bash
npm test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: include mystery BOOKEND prompt test in npm test"
```

---

## Spec coverage (self-review)

| 스펙 요구 | 태스크 |
|-----------|--------|
| 북엔드 규칙 (프롬프트) | Task 1 |
| 생성 시 재강조 | Task 2 |
| 사실·길이 유지 (코드 변경 없음 원칙) | Task 2는 문자열만 추가 |
| 검증 | Task 3–4 |

Placeholder 없음.

---

**플랜 저장 위치:** `docs/superpowers/plans/2026-05-13-youtube-shorts-open-close-bookend.md`

플랜 작성 완료. 실행 방식은 다음 중 선택하면 됩니다.

1. **Subagent-driven (권장)** — 태스크마다 새 서브에이전트 + 태스크 간 검토 (`superpowers:subagent-driven-development`).
2. **Inline execution** — 이 세션에서 체크박스 순으로 진행 (`superpowers:executing-plans`).
