/**
 * 위키 시드 제목 필터 단위 테스트
 */
const { test } = require('node:test');
const assert = require('node:assert');
const {
  titlesFromCategoryMembersQuery,
  parseSeedCategories,
} = require('../src/script/wikipediaTopicSeeds');

test('titlesFromCategoryMembersQuery filters list/disambig/category', () => {
  const q = {
    categorymembers: [
      { title: 'Jane Doe murder' },
      { title: 'Foo (disambiguation)' },
      { title: 'List of unsolved murders' },
      { title: 'Category:Deaths' },
    ],
  };
  const out = titlesFromCategoryMembersQuery(q);
  assert.deepStrictEqual(out, ['Jane Doe murder']);
});

test('parseSeedCategories adds Category prefix when missing', () => {
  const prev = process.env.WIKIPEDIA_SEED_CATEGORIES;
  try {
    process.env.WIKIPEDIA_SEED_CATEGORIES = 'Unsolved_deaths';
    const cats = parseSeedCategories();
    assert.ok(cats.includes('Category:Unsolved_deaths'));
  } finally {
    if (prev === undefined) delete process.env.WIKIPEDIA_SEED_CATEGORIES;
    else process.env.WIKIPEDIA_SEED_CATEGORIES = prev;
  }
});
