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
