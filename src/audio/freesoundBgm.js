const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getGenre, DEFAULT_GENRE } = require('../genres');

const API = 'https://freesound.org/apiv2';

/** NC(비상업)는 기본 제외. 호출마다 새 Set (모듈 Set 오염 방지) */
function getAllowedLicenses() {
  const s = new Set(['Creative Commons 0']);
  if (process.env.FREESOUND_ALLOW_ATTRIBUTION === '1') s.add('Attribution');
  return s;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 검색 응답이 틀릴 수 있으므로, 다운로드 직전에 sound 단건 API로 라이선스 재확인
 */
async function verifySoundInstance(soundId, token) {
  const params = new URLSearchParams({
    fields: 'id,name,username,license,url,previews',
    token: token.trim(),
  });
  const res = await axios.get(`${API}/sounds/${soundId}/?${params.toString()}`, {
    timeout: 45000,
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    return { ok: false, error: res.data?.detail || `HTTP ${res.status}` };
  }
  const s = res.data;
  if (!s || !s.license) return { ok: false, error: '라이선스 없음' };
  return { ok: true, sound: s };
}

function buildFreesoundAttributionLine(meta) {
  const url = meta.url || `https://freesound.org/s/${meta.soundId}/`;
  const name = meta.name || 'Sound';
  const user = meta.username || 'unknown';

  if (meta.license === 'Creative Commons 0') {
    return `BGM: "${name}" — Freesound / ${user} (CC0). ${url}`;
  }
  if (meta.license === 'Attribution') {
    return (
      `Background music: "${name}" by ${user} — ${url} ` +
      `(Freesound · CC BY 4.0 / Attribution — license terms: https://creativecommons.org/licenses/by/4.0/)`
    );
  }
  return `BGM: "${name}" — Freesound / ${user}. ${url} (License: ${meta.license})`;
}

function mustAppendFreesoundCredit(meta) {
  if (!meta || !meta.license) return false;
  if (meta.license === 'Attribution') return true;
  return process.env.FREESOUND_APPEND_CREDIT !== '0';
}

/**
 * search/text(구) → 404면 공식 /search/ 로 재시도
 */
async function freesoundSearch(params) {
  const qs = params.toString();
  const paths = [`${API}/search/text/?${qs}`, `${API}/search/?${qs}`];
  let lastRes;
  for (const fullUrl of paths) {
    const res = await axios.get(fullUrl, { timeout: 45000, validateStatus: () => true });
    lastRes = res;
    if (res.status === 404) continue;
    return res;
  }
  return lastRes;
}

/**
 * Freesound에서 CC0만 검색 → 서버 재검증 후 프리뷰 MP3 저장
 */
async function fetchFreesoundBgm(outputDir, genreKey = DEFAULT_GENRE) {
  const token = process.env.FREESOUND_API_KEY;
  if (!token || !token.trim()) return null;

  const allowAttribution = process.env.FREESOUND_ALLOW_ATTRIBUTION === '1';
  const allowedLicenses = getAllowedLicenses();

  const genre = getGenre(genreKey);
  const primaryQuery = genre.freesoundBgmQuery || 'ambient atmospheric loop';

  console.log(`  Freesound BGM 검색 [장르: ${genreKey}] 기본어: "${primaryQuery}"`);

  const filterLicense = allowAttribution
    ? '(license:"Creative Commons 0" OR license:Attribution)'
    : 'license:"Creative Commons 0"';

  /** duration·쿼리를 단계적으로 완화 (엄격 → 넓음 → CC0만) */
  const searchPlans = [];

  const sharedFallbacks = ['ambient loop', 'ambient', 'soundscape', 'music', 'loop'];
  const moodFallbacks =
    genreKey === 'psychology'
      ? ['calm', 'soft', 'meditation', 'subtle', 'minimal']
      : ['dark ambient', 'drone', 'dark', 'tension'];
  const baseQueries = [primaryQuery, ...sharedFallbacks, ...moodFallbacks];

  const durationTiers = [
    'duration:[12 TO 240]',
    'duration:[5 TO 600]',
    null,
  ];

  for (const q of [...new Set(baseQueries)]) {
    for (const dur of durationTiers) {
      const filterBody = dur ? `${filterLicense} ${dur}` : filterLicense;
      searchPlans.push({ query: q, filterBody, label: `${q || '(빈쿼리)'} + ${dur || 'CC0만'}` });
    }
  }

  searchPlans.push({
    query: '',
    filterBody: filterLicense,
    label: '빈 쿼리 + CC0만 (다운로드 많은 순)',
  });

  let lastErr;

  for (const plan of searchPlans) {
    try {
      const params = new URLSearchParams({
        query: plan.query,
        filter: plan.filterBody,
        sort: 'downloads_desc',
        page_size: '50',
        fields: 'id,name,username,license,previews,duration,url',
        token: token.trim(),
      });

      const res = await freesoundSearch(params);
      if (!res || res.status !== 200) {
        lastErr = new Error(res?.data?.detail || `Freesound search HTTP ${res?.status || '?'}`);
        continue;
      }
      const data = res.data;
      if (data.detail) {
        lastErr = new Error(String(data.detail));
        continue;
      }

      const results = data.results || [];
      const candidates = shuffle(
        results.filter((s) => {
          if (!s || !allowedLicenses.has(s.license)) return false;
          return true;
        })
      );

      if (candidates.length === 0) {
        if (results.length > 0) {
          const sample = results[0];
          lastErr = new Error(
            `후보 ${results.length}개인데 라이선스 필터에서 제외됨 (예: ${sample.license || '?'})`
          );
        } else {
          lastErr = new Error(`CC0 결과 없음 (${plan.label})`);
        }
        continue;
      }

      for (const pick of candidates) {
        const verified = await verifySoundInstance(pick.id, token);
        if (!verified.ok) {
          lastErr = new Error(verified.error);
          continue;
        }
        const s = verified.sound;
        if (!allowedLicenses.has(s.license)) {
          console.warn(
            `  ⚠ Freesound id ${pick.id}: 재검증 라이선스 "${s.license}" — 허용 목록에 없어 건너뜀`
          );
          lastErr = new Error(`검증 실패: ${s.license}`);
          continue;
        }

        const previewUrl =
          s.previews?.['preview-hq-mp3'] ||
          s.previews?.['preview-lq-mp3'] ||
          pick.previews?.['preview-hq-mp3'] ||
          pick.previews?.['preview-lq-mp3'];
        if (!previewUrl) {
          lastErr = new Error('프리뷰 URL 없음');
          continue;
        }

        const mp3Path = path.join(outputDir, 'freesound_bgm.mp3');
        const metaPath = path.join(outputDir, 'freesound_bgm.json');

        const audioRes = await axios.get(previewUrl, {
          responseType: 'arraybuffer',
          timeout: 120000,
          validateStatus: () => true,
        });
        if (audioRes.status !== 200) {
          lastErr = new Error(`프리뷰 다운로드 HTTP ${audioRes.status}`);
          continue;
        }
        fs.writeFileSync(mp3Path, Buffer.from(audioRes.data));

        const meta = {
          source: 'freesound',
          soundId: s.id,
          name: s.name,
          username: s.username,
          license: s.license,
          url: s.url || `https://freesound.org/s/${s.id}/`,
          queryUsed: plan.label,
          verifiedAt: new Date().toISOString(),
        };
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

        const attributionLine = buildFreesoundAttributionLine(meta);

        console.log(`  🎵 Freesound BGM: ${s.name} (id ${s.id}, ${s.license})`);
        return { path: mp3Path, attributionLine, meta };
      }
    } catch (e) {
      lastErr = e;
    }
  }

  console.warn(
    `  ⚠ Freesound: ${lastErr?.message || lastErr} → 이 영상에는 Freesound 음원을 쓰지 않습니다 (0곡).`
  );
  return null;
}

module.exports = {
  fetchFreesoundBgm,
  buildFreesoundAttributionLine,
  mustAppendFreesoundCredit,
  getAllowedLicenses,
};
