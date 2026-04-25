/**
 * en.wikipedia.org — opensearch + extracts (무료, API 키 없음)
 * https://api.wikimedia.org/ 요청 시 User-Agent 필수
 */

const axios = require('axios');

const UA =
  (process.env.WIKIPEDIA_USER_AGENT && String(process.env.WIKIPEDIA_USER_AGENT).trim()) ||
  'ShortsPipeline/1.0 (mystery shorts bot; +https://github.com/)';

const api = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': UA, 'Accept': 'application/json' },
  validateStatus: (s) => s >= 200 && s < 500,
});

const MAX_EXTRACT_CHARS = Math.min(8000, Math.max(1500, parseInt(process.env.WIKI_MAX_CHARS || '5000', 10) || 5000));

function isEnabled() {
  return (process.env.SHORTS_WIKI_CONTEXT || '1').toString().trim() !== '0';
}

function isDisambiguation(title) {
  const s = String(title).toLowerCase();
  return s.includes('disambiguation') || s.includes('(disambig');
}

/**
 * 토픽 문장에서 검색 쿼리 후보들을 우선순위 순서로 반환.
 *
 * 전략:
 *  1) "이름 이름" 같은 2+ 단어 대문자 연속 — 인명·지명·사건명 (가장 정확)
 *  2) dash(—/–/-) 앞까지 잘라낸 단축 문장
 *  3) 원문 전체 앞 100자
 */
function searchQueriesFromTopic(topic) {
  const t = String(topic || '');
  const queries = [];

  // 1) 연속하는 대문자 단어 쌍/트리플 추출 (인명·사건명)
  const capRuns = [];
  const capPattern = /\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{0,}){1,4})\b/g;
  let m;
  while ((m = capPattern.exec(t)) !== null) {
    const phrase = m[1].trim();
    // 문장 맨 앞 단어(The, In, A 등) 단독은 제외
    if (phrase.split(' ').length >= 2 || /^[A-Z]{2,}$/.test(phrase)) {
      if (!queries.includes(phrase)) queries.push(phrase);
    }
  }

  // 2) dash 앞 단축 문장
  const dashClipped = t.replace(/[—–].*$/s, '').replace(/\.$/, '').trim();
  if (dashClipped.length >= 6 && !queries.includes(dashClipped)) {
    queries.push(dashClipped.slice(0, 120));
  }

  // 3) 원문 앞 100자 (최후 fallback)
  const raw100 = t.slice(0, 100).trim();
  if (!queries.includes(raw100)) queries.push(raw100);

  return queries.filter(Boolean);
}

async function opensearch(q, limit = 5) {
  try {
    const res = await api.get('https://en.wikipedia.org/w/api.php', {
      params: { action: 'opensearch', search: q, limit, namespace: 0, format: 'json' },
    });
    const data = res.data;
    if (Array.isArray(data) && data[1]?.length) {
      return data[1].filter((t) => t && !isDisambiguation(t));
    }
  } catch (_) { /* ignore */ }
  return [];
}

/**
 * @returns {Promise<{ title: string, url: string, text: string } | null>}
 */
async function fetchWikipediaContext(topic) {
  if (!isEnabled()) return null;

  const queries = searchQueriesFromTopic(topic);

  for (const q of queries) {
    const titles = await opensearch(q);
    for (const title of titles) {
      const text = await fetchPlainExtract(title);
      if (text && text.length > 80) {
        const slug = title.replace(/ /g, '_');
        console.log(`  [Wiki] 검색어: "${q}" → "${title}"`);
        return {
          title,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}`,
          text: text.slice(0, MAX_EXTRACT_CHARS).trim(),
        };
      }
    }
  }

  return null;
}

async function fetchPlainExtract(title) {
  try {
    const res = await api.get('https://en.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        format: 'json',
        prop: 'extracts',
        explaintext: 1,
        exsectionformat: 'plain',
        exintro: 0,
        exlimit: 1,
        /** 기본이 짧을 수 있어 본문 일부 (문자 수) */
        exchars: Math.min(12000, MAX_EXTRACT_CHARS + 2000),
        redirects: 1,
        titles: title,
      },
    });
    const pages = res.data?.query?.pages;
    if (!pages) return null;
    const id = Object.keys(pages)[0];
    if (!id || id === '-1') return null;
    const ext = pages[id].extract;
    if (!ext || typeof ext !== 'string') return null;
    return ext;
  } catch (e) {
    return null;
  }
}

function isWikiContextEnabled() {
  return isEnabled();
}

module.exports = { fetchWikipediaContext, isWikiContextEnabled, isEnabled };
