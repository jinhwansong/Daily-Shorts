const { test } = require('node:test');
const assert = require('node:assert');
const { isTitleBlocked, pickWikiArticleTopics } = require('../src/script/wikipediaTopicSeeds');

test('isTitleBlocked: exact normalized match', () => {
  assert.strictEqual(isTitleBlocked('Glenn Miller', ['Glenn Miller']), true);
});

test('isTitleBlocked: substring overlap with used LLM topic', () => {
  assert.strictEqual(
    isTitleBlocked(
      'Death of Elisa Lam',
      ['The 2013 death of Elisa Lam at the Cecil Hotel remains unexplained.']
    ),
    true
  );
});

test('isTitleBlocked: unrelated title passes', () => {
  assert.strictEqual(isTitleBlocked('Dyatlov Pass incident', ['Glenn Miller']), false);
});

test('pickWikiArticleTopics: skips blocked and dedupes', async () => {
  const orig = global.fetch;
  let call = 0;
  global.fetch = undefined;

  const axios = require('axios');
  const origGet = axios.get;
  axios.get = async () => {
    call += 1;
    return {
      data: {
        query: {
          categorymembers: [
            { title: 'Glenn Miller' },
            { title: 'Dyatlov Pass incident' },
            { title: 'Foo (disambiguation)' },
          ],
        },
      },
    };
  };

  try {
    const topics = await pickWikiArticleTopics(1, ['Glenn Miller']);
    assert.strictEqual(topics.length, 1);
    assert.strictEqual(topics[0], 'Dyatlov Pass incident');
    assert.ok(call >= 1);
  } finally {
    axios.get = origGet;
    global.fetch = orig;
  }
});
