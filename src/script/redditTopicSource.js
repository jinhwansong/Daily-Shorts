/**
 * Reddit 게시글 제목을 "시드"로만 사용 — LLM이 위키/뉴스로 사실 검증.
 * REDDIT_SEEDS=0 이면 비활성. REDDIT_SUBREDDITS 콤마 구분.
 */

const axios = require('axios');

const DEFAULT_SUBS = ['UnresolvedMysteries', 'TrueCrime', 'ColdCase'];

/**
 * JSON 응답에서 제목 추출 (단위 테스트용)
 */
function titlesFromHotJson(data) {
  const children = data?.data?.children || [];
  const out = [];
  for (const c of children) {
    const t = c?.data?.title;
    if (typeof t !== 'string' || !t.trim()) continue;
    if (/^\[Megathread\]/i.test(t)) continue;
    if (/^\[Discussion\]/i.test(t) && t.length < 20) continue;
    out.push(t.trim().slice(0, 280));
  }
  return out;
}

function parseSubredditList() {
  const raw = process.env.REDDIT_SUBREDDITS || DEFAULT_SUBS.join(',');
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^r\//i, ''))
    .filter(Boolean);
}

async function fetchRedditSeeds() {
  const off = process.env.REDDIT_SEEDS === '0' || process.env.REDDIT_SEEDS === 'false';
  if (off) return [];

  const limitTotal = Math.min(
    40,
    Math.max(1, parseInt(process.env.REDDIT_SEED_LIMIT || '15', 10) || 15)
  );
  const subs = parseSubredditList();
  if (subs.length === 0) return [];

  const ua =
    process.env.REDDIT_USER_AGENT ||
    'shorts-automation/1.0 (private topic seeds; contact via repo owner)';
  const titles = [];
  const seen = new Set();

  for (const sub of subs) {
    if (titles.length >= limitTotal) break;
    try {
      const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json`;
      const { data } = await axios.get(url, {
        params: { limit: 20 },
        headers: { 'User-Agent': ua, Accept: 'application/json' },
        timeout: 18000,
        validateStatus: (s) => s === 200,
      });
      for (const t of titlesFromHotJson(data)) {
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        titles.push(t);
        if (titles.length >= limitTotal) break;
      }
    } catch (e) {
      console.warn(`[Reddit] r/${sub}: ${e.message}`);
    }
  }

  return titles.slice(0, limitTotal);
}

module.exports = { fetchRedditSeeds, titlesFromHotJson };
