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

function searchQueryFromTopic(topic) {
  const t = String(topic || '')
    .replace(/[—–-].*$/s, ' ')
    .replace(/^[^(]+\(([^)]+)\).*/, '$1')
    .trim();
  if (t.length < 4) return String(topic).slice(0, 120);
  return t.slice(0, 180);
}

function isDisambiguation(title) {
  const s = String(title).toLowerCase();
  return s.includes('disambiguation') || s.includes('(disambig');
}

/**
 * @returns {Promise<{ title: string, url: string, text: string } | null>}
 */
async function fetchWikipediaContext(topic) {
  if (!isEnabled()) return null;

  const q = searchQueryFromTopic(topic);
  if (!q) return null;

  let titles = [];
  try {
    const os = await api.get('https://en.wikipedia.org/w/api.php', {
      params: {
        action: 'opensearch',
        search: q,
        limit: 5,
        namespace: 0,
        format: 'json',
      },
    });
    const data = os.data;
    if (Array.isArray(data) && data[1] && data[1].length) {
      titles = data[1].filter((t) => t && !isDisambiguation(t));
    }
  } catch (e) {
    return null;
  }

  if (!titles.length) {
    try {
      const os2 = await api.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'opensearch',
          search: String(topic).slice(0, 100),
          limit: 3,
          namespace: 0,
          format: 'json',
        },
      });
      const d2 = os2.data;
      if (Array.isArray(d2) && d2[1] && d2[1].length) {
        titles = d2[1].filter((t) => t && !isDisambiguation(t));
      }
    } catch (_) {
      /* ignore */
    }
  }

  for (const title of titles) {
    const text = await fetchPlainExtract(title);
    if (text && text.length > 80) {
      const slug = title.replace(/ /g, '_');
      return {
        title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}`,
        text: text.slice(0, MAX_EXTRACT_CHARS).trim(),
      };
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
