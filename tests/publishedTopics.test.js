const { test } = require('node:test');
const assert = require('node:assert');

const {
  isSupabaseDedupConfigured,
  hasRecentPublishedDuplicate,
  insertPublishedTopicRow,
  extractHookFirstLine,
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
  assert.strictEqual(captured[0][0].hook_first_line, null);
  assert.strictEqual(captured[0][0].thumbnail_line, null);
});

test('insertPublishedTopicRow sends hook_first_line and thumbnail_line', async () => {
  const captured = [];
  const client = makeInsertFake(captured);
  await insertPublishedTopicRow(client, {
    genreKey: 'mystery',
    topicKey: 'x',
    videoId: 'v',
    rawTopic: 'topic',
    hookFirstLine: 'First line of narration.',
    thumbnailLine: 'Thumb text',
  });
  assert.strictEqual(captured[0][0].hook_first_line, 'First line of narration.');
  assert.strictEqual(captured[0][0].thumbnail_line, 'Thumb text');
});

test('extractHookFirstLine: first non-empty line', () => {
  assert.strictEqual(extractHookFirstLine('  \nHello world.\nNext'), 'Hello world.');
});

test('extractHookFirstLine: skips [SECTION] headers', () => {
  assert.strictEqual(
    extractHookFirstLine('[COLD_OPEN]\n\nThe night was cold.'),
    'The night was cold.'
  );
});
