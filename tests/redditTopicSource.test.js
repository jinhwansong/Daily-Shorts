const { test } = require('node:test');
const assert = require('node:assert');
const { titlesFromHotJson } = require('../src/script/redditTopicSource');

test('titlesFromHotJson: 표준 Reddit hot.json 형태', () => {
  const data = {
    data: {
      children: [
        { data: { title: '  Case Name — what happened? ' } },
        { data: { title: '[Megathread] Weekly' } },
        { data: { title: 'Another mystery' } },
      ],
    },
  };
  const titles = titlesFromHotJson(data);
  assert.deepStrictEqual(titles, ['Case Name — what happened?', 'Another mystery']);
});

test('titlesFromHotJson: 비어있으면 빈 배열', () => {
  assert.deepStrictEqual(titlesFromHotJson(null), []);
  assert.deepStrictEqual(titlesFromHotJson({}), []);
});
