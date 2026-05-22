/**
 * 미스터리 토픽 시드 — en.wikipedia.org categorymembers (API 키 불필요, User-Agent 필수)
 */

const axios = require('axios');

const UA =
  (process.env.WIKIPEDIA_USER_AGENT && String(process.env.WIKIPEDIA_USER_AGENT).trim()) ||
  'ShortsPipeline/1.0 (mystery shorts bot; +https://github.com/)';

const DEFAULT_SEED_CATEGORIES = [
  'Category:Unsolved_deaths',
  'Category:Missing_person_cases',
  'Category:Unexplained_disappearances',
];

function parseSeedCategories() {
  const raw = process.env.WIKIPEDIA_SEED_CATEGORIES || DEFAULT_SEED_CATEGORIES.join(',');
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith('Category:') ? s : `Category:${s}`));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function filterSeedTitles(titles) {
  return titles.filter(Boolean).filter((t) => {
    const u = String(t);
    if (/disambiguation/i.test(u)) return false;
    if (/^List of /i.test(u)) return false;
    if (u.startsWith('Category:')) return false;
    if (u.startsWith('Template:')) return false;
    return true;
  });
}

/** 단위 테스트용: API 응답 query 부분에서 제목 배열 추출 */
function titlesFromCategoryMembersQuery(query) {
  const members = query?.categorymembers ?? [];
  return filterSeedTitles(members.map((m) => m.title));
}

/**
 * @param {number} limit
 * @returns {Promise<string[]>}
 */
async function fetchWikipediaSeedTitles(limit = 15) {
  const categories = parseSeedCategories();
  if (categories.length === 0) return [];

  const cap = Math.min(40, Math.max(1, limit));
  const cat = categories[Math.floor(Math.random() * categories.length)];

  try {
    const res = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        format: 'json',
        formatversion: 2,
        list: 'categorymembers',
        cmtitle: cat,
        cmtype: 'page',
        cmlimit: Math.min(50, Math.max(cap * 2, 20)),
      },
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
      },
      timeout: 18000,
      validateStatus: (s) => s === 200,
    });

    const members = res.data?.query?.categorymembers ?? [];
    const titles = shuffle(filterSeedTitles(members.map((m) => m.title)));
    return titles.slice(0, cap);
  } catch (e) {
    console.warn(`[Wikipedia seeds] ${e.message}`);
    return [];
  }
}

module.exports = {
  fetchWikipediaSeedTitles,
  parseSeedCategories,
  titlesFromCategoryMembersQuery,
};
