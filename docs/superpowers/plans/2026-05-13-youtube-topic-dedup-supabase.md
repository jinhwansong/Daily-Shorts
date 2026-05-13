# YouTube Topic Dedup (Supabase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions·로컬 공통으로 `genre_key` + 정규화 `topic_key` 기준 최근 6개월 이내 업로드 이력이 있으면 주제를 재추첨하고, 업로드 성공 시 Supabase `published_topics`에 행을 남긴다.

**Architecture:** `@supabase/supabase-js` + `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`가 있을 때만 활성화한다. 중복 조회 실패 시 **경고 후 진행(fail-open)**. 재추첨 상한 초과 시 해당 슬롯은 **`skipped: true`** 로 마감한다. 숏(`runPipeline`)·인덱스 롱폼(`runLongformPipeline`)·분리 롱폼 Phase 1/2 모두 업로드 경로에 맞춰 `resolve` 또는 `record`를 연결한다.

**Tech Stack:** Node 18+, `@supabase/supabase-js`, 기존 `node --test`, Supabase Postgres.

---

## File map (생성·수정)

| Path | 책임 |
|------|------|
| `supabase/migrations/001_published_topics.sql` | `published_topics` 테이블·인덱스 DDL |
| `src/utils/topicKey.js` | `normalizeTopicKey(topic)` |
| `src/utils/publishedTopics.js` | 활성 여부, 중복 조회, 삽입, `resolveTopicForUpload`, `recordPublishedTopic` |
| `src/index.js` | 입구·스크립트 재시도에 `resolveTopicForUpload`; 업로드 성공 후 `recordPublishedTopic`; 배치 결과 처리 |
| `src/longformPhase1.js` | `resolveTopicForUpload` |
| `src/longformPhase2.js` | 업로드 성공 후 `recordPublishedTopic` |
| `tests/topicKey.test.js` | 정규화 테스트 |
| `tests/publishedTopics.test.js` | 페이크 Supabase 클라이언트 테스트 |
| `.github/workflows/pipeline-mystery.yml` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `.github/workflows/longform-phase1.yml`, `longform-phase2.yml` | 동일 |

**오픈 결정 (플랜에서 확정):** 조회·삽입 오류 → fail-open. 재시도 초과 → 슬롯만 스킵(`reason: 'topic_supabase_dedup_exhausted'`). 롱폼 Phase 1·2 포함 적용.

---

### Task 1: Supabase DDL

**Files:**

- Create: `supabase/migrations/001_published_topics.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- published_topics: 업로드 성공 이력 (append-only)
create table if not exists public.published_topics (
  id bigint generated always as identity primary key,
  genre_key text not null,
  topic_key text not null,
  uploaded_at timestamptz not null default now(),
  video_id text,
  raw_topic text
);

create index if not exists published_topics_genre_topic_uploaded_idx
  on public.published_topics (genre_key, topic_key, uploaded_at desc);

comment on table public.published_topics is 'YouTube 업로드 성공 시 기록; 6개월 중복 방지 조회용';
```

- [ ] **Step 2: Supabase SQL Editor에서 실행 후 테이블 확인**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/001_published_topics.sql
git commit -m "chore(db): Supabase published_topics 테이블 DDL"
```

---

### Task 2: 의존성

**Files:**

- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: 설치**

Run:

```bash
npm install @supabase/supabase-js@^2
```

Expected: lockfile 갱신.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @supabase/supabase-js for topic dedup ledger"
```

---

### Task 3: `normalizeTopicKey`

**Files:**

- Create: `src/utils/topicKey.js`
- Create: `tests/topicKey.test.js`

- [ ] **Step 1: 실패할 테스트 작성** (`tests/topicKey.test.js`)

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeTopicKey } = require('../src/utils/topicKey');

test('normalizeTopicKey: trim, NFC, lower, collapse spaces', () => {
  assert.strictEqual(normalizeTopicKey('  The  Dyatlov Pass  '), 'the dyatlov pass');
});

test('normalizeTopicKey: null/empty → empty string', () => {
  assert.strictEqual(normalizeTopicKey(null), '');
  assert.strictEqual(normalizeTopicKey('   '), '');
});

test('normalizeTopicKey: composed vs decomposed unicode same', () => {
  const composed = '\u00e9';
  const decomposed = 'e\u0301';
  assert.strictEqual(normalizeTopicKey(composed), normalizeTopicKey(decomposed));
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- tests/topicKey.test.js` → FAIL 예상.

- [ ] **Step 3: 구현** (`src/utils/topicKey.js`)

```javascript
function normalizeTopicKey(topic) {
  if (topic == null) return '';
  let s = String(topic).normalize('NFC').trim().toLowerCase();
  s = s.replace(/\s+/g, ' ');
  return s;
}

module.exports = { normalizeTopicKey };
```

- [ ] **Step 4: 통과 확인** — Run: `npm test -- tests/topicKey.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/topicKey.js tests/topicKey.test.js
git commit -m "feat: normalizeTopicKey for Supabase dedup"
```

---

### Task 4: `publishedTopics.js` + 페이크 테스트

**Files:**

- Create: `src/utils/publishedTopics.js`
- Create: `tests/publishedTopics.test.js`

- [ ] **Step 1: 테스트 작성** (`tests/publishedTopics.test.js`)

```javascript
const { test } = require('node:test');
const assert = require('node:assert');

const {
  isSupabaseDedupConfigured,
  hasRecentPublishedDuplicate,
  insertPublishedTopicRow,
} = require('../src/utils/publishedTopics');

function makeSelectFake(rows, capture) {
  const builder = {
    select() {
      return builder;
    },
    eq(col, val) {
      if (capture) capture.push(['eq', col, val]);
      return builder;
    },
    gte(col, val) {
      if (capture) capture.push(['gte', col, val]);
      return builder;
    },
    limit(n) {
      if (capture) capture.push(['limit', n]);
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return { from: () => builder };
}

function makeInsertFake(capture) {
  return {
    from() {
      return {
        insert(rows) {
          capture.push(rows);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

test('isSupabaseDedupConfigured false when env missing', () => {
  assert.strictEqual(isSupabaseDedupConfigured(), false);
});

test('hasRecentPublishedDuplicate true when row returned', async () => {
  const calls = [];
  const client = makeSelectFake([{ id: 1 }], calls);
  const dup = await hasRecentPublishedDuplicate(client, 'mystery', 'dyatlov', {
    cooldownMonths: 6,
  });
  assert.strictEqual(dup, true);
  assert.strictEqual(calls.some((c) => c[0] === 'limit'), true);
});

test('insertPublishedTopicRow sends genre_key and topic_key', async () => {
  const captured = [];
  const client = makeInsertFake(captured);
  await insertPublishedTopicRow(client, {
    genreKey: 'mystery',
    topicKey: 'dyatlov pass',
    videoId: 'vid123',
    rawTopic: 'The Dyatlov Pass',
  });
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0][0].genre_key, 'mystery');
  assert.strictEqual(captured[0][0].topic_key, 'dyatlov pass');
  assert.strictEqual(captured[0][0].video_id, 'vid123');
});
```

- [ ] **Step 2: FAIL 확인** — `npm test -- tests/publishedTopics.test.js`

- [ ] **Step 3: 구현** (`src/utils/publishedTopics.js`)

```javascript
const { createClient } = require('@supabase/supabase-js');
const { normalizeTopicKey } = require('./topicKey');
const { generateTopics } = require('../script/topicGenerator');

function getCooldownMonths() {
  const n = parseInt(process.env.TOPIC_PUBLISHED_COOLDOWN_MONTHS || '6', 10);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

function getMaxDedupRetries() {
  const n = parseInt(process.env.TOPIC_DEDUP_MAX_RETRIES || '8', 10);
  return Number.isFinite(n) && n > 0 ? n : 8;
}

function cooldownCutoffIso(months) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}

function isSupabaseDedupConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabaseClient() {
  if (!isSupabaseDedupConfigured()) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function hasRecentPublishedDuplicate(client, genreKey, topicKey, options = {}) {
  const months = options.cooldownMonths ?? getCooldownMonths();
  const cutoff = cooldownCutoffIso(months);
  const { data, error } = await client
    .from('published_topics')
    .select('id')
    .eq('genre_key', genreKey)
    .eq('topic_key', topicKey)
    .gte('uploaded_at', cutoff)
    .limit(1);

  if (error) {
    console.warn(`[Supabase dedup] duplicate check failed: ${error.message}`);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function insertPublishedTopicRow(client, row) {
  const payload = {
    genre_key: row.genreKey,
    topic_key: row.topicKey,
    video_id: row.videoId ?? null,
    raw_topic: row.rawTopic ?? null,
  };
  const { error } = await client.from('published_topics').insert([payload]);
  if (error) {
    console.error(`[Supabase dedup] insert failed after upload: ${error.message}`);
  }
}

function getDedupClient() {
  return getSupabaseClient();
}

async function resolveTopicForUpload(genreKey, candidateTopic) {
  const client = getDedupClient();
  if (!client) return candidateTopic || null;

  let topic = candidateTopic;
  const max = getMaxDedupRetries();

  for (let attempt = 0; attempt <= max; attempt++) {
    const key = normalizeTopicKey(topic);
    if (!key) {
      const one = await generateTopics(1, genreKey);
      topic = one[0];
      continue;
    }

    let duplicate;
    try {
      duplicate = await hasRecentPublishedDuplicate(client, genreKey, key, {
        cooldownMonths: getCooldownMonths(),
      });
    } catch (e) {
      console.warn(`[Supabase dedup] duplicate check threw: ${e.message}`);
      duplicate = false;
    }

    if (!duplicate) return topic;

    if (attempt === max) {
      console.warn(`[Supabase dedup] exhausted ${max} re-picks for genre=${genreKey}`);
      return null;
    }

    const one = await generateTopics(1, genreKey);
    topic = one[0];
  }

  return null;
}

async function recordPublishedTopic({ genreKey, topic, videoId }) {
  const client = getDedupClient();
  if (!client) return;

  const topicKey = normalizeTopicKey(topic);
  if (!topicKey) return;

  try {
    await insertPublishedTopicRow(client, {
      genreKey,
      topicKey,
      videoId: videoId ?? null,
      rawTopic: topic,
    });
  } catch (e) {
    console.error(`[Supabase dedup] recordPublishedTopic: ${e.message}`);
  }
}

module.exports = {
  isSupabaseDedupConfigured,
  getDedupClient,
  getCooldownMonths,
  getMaxDedupRetries,
  cooldownCutoffIso,
  hasRecentPublishedDuplicate,
  insertPublishedTopicRow,
  resolveTopicForUpload,
  recordPublishedTopic,
};
```

- [ ] **Step 4: 전체 테스트** — Run: `npm test` → topicKey + publishedTopics 포함 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/publishedTopics.js tests/publishedTopics.test.js
git commit -m "feat: Supabase published_topics 조회·기록·resolveTopicForUpload"
```

---

### Task 5: `src/index.js` 연동

**Files:**

- Modify: `src/index.js`

- [ ] **Step 1: 상단에 require 추가**

```javascript
const { resolveTopicForUpload, recordPublishedTopic } = require('./utils/publishedTopics');
```

- [ ] **Step 2: `runPipeline` — `fs.mkdirSync` 직후, `for (let attempt = 1; ...)` 들어가기 전에 초기 topic 해석**

`runPipeline` 시작부에서 첫 줄을 다음 패턴으로 바꿉니다.

```javascript
async function runPipeline(topic, genreKey) {
  const genre = getGenre(genreKey);
  const jobId = Date.now();
  const outputDir = path.join(__dirname, `../output/${genreKey}_${jobId}`);
  fs.mkdirSync(outputDir, { recursive: true });

  let currentTopic = await resolveTopicForUpload(genreKey, topic);
  if (!currentTopic) {
    console.error('  [Supabase dedup] 재추첨 상한 초과 — 이번 실행 건너뜀');
    return {
      skipped: true,
      reason: 'topic_supabase_dedup_exhausted',
      genreKey,
      topic,
    };
  }

  let script = null;
```

- [ ] **Step 3: `runPipeline` 스크립트 재시도 루프** — `attempt > 1` 분기에서 `generateTopics` 다음에 다시 resolve:

```javascript
    if (attempt > 1) {
      console.warn(`  [Topic] 재시도 ${attempt - 1}/3`);
      const one = await generateTopics(1, genreKey);
      currentTopic = await resolveTopicForUpload(genreKey, one[0]);
      if (!currentTopic) {
        console.error('  [Supabase dedup] 재추첨 상한 초과 (스크립트 재시도 중)');
        break;
      }
    }
```

(`attempt === 1`일 때는 이미 상단에서 resolve된 `currentTopic` 유지.)

- [ ] **Step 4: 업로드 성공 직후 `recordPublishedTopic` 호출**

`uploadVideo` / `setThumbnail` 성공 후, `result.json` 작성 전에 추가:

```javascript
  await recordPublishedTopic({
    genreKey,
    topic: currentTopic,
    videoId,
  });
```

- [ ] **Step 5: `runLongformPipeline`** — `console.log` 주제 출력 직후:

```javascript
  let resolvedTopic = await resolveTopicForUpload(genreKey, topic);
  if (!resolvedTopic) {
    console.error('  [Supabase dedup] 재추첨 상한 초과 — 롱폼 건너뜀');
    return {
      skipped: true,
      reason: 'topic_supabase_dedup_exhausted',
      genreKey,
      topic,
    };
  }
  topic = resolvedTopic;

  console.log(`\n[${genre.label}] Topic: ${topic}`);
```

아래쪽에서 스크립트·메타 생성 시 같은 `topic` 변수 사용 유지.

업로드 성공 후(`result` 만들기 전):

```javascript
  await recordPublishedTopic({ genreKey, topic, videoId });
```

- [ ] **Step 6: `runBatch` 결과 처리** — `pipelineFn`이 `skipped: true`이면 기존처럼 results에 넣되 `reason === 'topic_supabase_dedup_exhausted'` 도 허용됨을 확인.

- [ ] **Step 7: 테스트** — Run: `npm test` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/index.js
git commit -m "feat: integrate Supabase topic dedup into shorts/longform pipelines"
```

---

### Task 6: 롱폼 Phase 1·2

**Files:**

- Modify: `src/longformPhase1.js`
- Modify: `src/longformPhase2.js`

- [ ] **Step 1: Phase 1** — `generateTopics` 다음 줄을 다음으로 교체:

```javascript
const { resolveTopicForUpload } = require('./utils/publishedTopics');
// ...
const [generated] = await generateTopics(1, genreKey);
const topic = await resolveTopicForUpload(genreKey, generated);
if (!topic) {
  console.error('[Supabase dedup] 재추첨 상한 초과 — Phase 1 중단');
  process.exit(1);
}
console.log(`  Topic: ${topic}`);
```

(실제 파일에서 변수 이름이 `[topic]` 구조분해라면 그에 맞춰 통합.)

- [ ] **Step 2: Phase 2** — `uploadVideo` 성공 후 `recordPublishedTopic`:

```javascript
const { recordPublishedTopic } = require('./utils/publishedTopics');
// ...
const { videoId, videoUrl } = await uploadVideo(finalPath, metadata, genreKey);
await recordPublishedTopic({ genreKey, topic, videoId });
```

`topic`은 state에서 온 문자열 그대로 사용.

- [ ] **Step 3: Commit**

```bash
git add src/longformPhase1.js src/longformPhase2.js
git commit -m "feat: Supabase dedup on longform phase1/phase2"
```

---

### Task 7: GitHub Actions 시크릿

**Files:**

- Modify: `.github/workflows/pipeline-mystery.yml`
- Modify: `.github/workflows/longform-phase1.yml`
- Modify: `.github/workflows/longform-phase2.yml`

- [ ] **Step 1: 각 워크플로 `env:` 블록에 추가**

```yaml
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 2: 저장소 Settings → Secrets에 동일 이름으로 값 설정**

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/
git commit -m "ci: pass Supabase secrets for topic dedup"
```

---

### Task 8: `package.json` test 스크립트 갱신

**Files:**

- Modify: `package.json` → `"test"` 줄에 새 테스트 파일 포함 확인:

```json
"test": "node --test tests/copyrightGuard.test.js tests/topicTier.test.js tests/redditTopicSource.test.js tests/topicKey.test.js tests/publishedTopics.test.js"
```

- [ ] **Step 1: 수정 후 `npm test` 전체 PASS**

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: extend npm test with topic dedup unit tests"
```

---

## Spec coverage (self-review)

| 스펙 요구 | 태스크 |
|-----------|--------|
| 6개월 윈도우 | `TOPIC_PUBLISHED_COOLDOWN_MONTHS`, `cooldownCutoffIso` |
| 재추첨 | `resolveTopicForUpload` + `TOPIC_DEDUP_MAX_RETRIES` |
| 업로드 후 insert | `recordPublishedTopic` |
| Secrets / Actions | Task 7 |
| 비활성 시 noop | `isSupabaseDedupConfigured` 가드 |
| fail-open 조회 오류 | `hasRecentPublishedDuplicate` 내 error 분기 |

Placeholder 스캔: 없음.

---

**플랜 저장 위치:** `docs/superpowers/plans/2026-05-13-youtube-topic-dedup-supabase.md`

**실행 방식 선택:**

1. **Subagent-driven (권장)** — 태스크마다 새 서브에이전트, 태스크 사이 검토 (`superpowers:subagent-driven-development`).
2. **Inline execution** — 이 세션에서 체크박스 순으로 진행 (`superpowers:executing-plans`).

원하시는 쪽을 알려주시면 됩니다.
