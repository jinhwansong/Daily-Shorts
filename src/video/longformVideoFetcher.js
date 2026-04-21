const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getGenre } = require('../genres');

const PEXELS_API = 'https://api.pexels.com/videos/search';

function pickBestLandscapeFile(video) {
  const files = (video.video_files || []).filter((f) => {
    const link = String(f.link || '');
    if (link.includes('.m3u8')) return false;
    const ft = String(f.file_type || '').toLowerCase();
    return !ft || ft.includes('mp4');
  });
  const pool = files.length ? files : video.video_files || [];
  if (!pool.length) return null;

  const score = (f) => {
    const w = f.width || 0;
    const h = f.height || 0;
    let s = w * h;
    const q = String(f.quality || '').toLowerCase();
    if (q === 'uhd' || q === '4k') s += 2_000_000;
    else if (q === 'hd') s += 800_000;
    // landscape 우선: 가로가 더 길 때 가산점
    if (w > h && w >= 1920) s += 500_000;
    return s;
  };

  return pool.reduce((best, f) => (score(f) > score(best) ? f : best));
}

async function fetchOneLandscapeClip(query, outputDir, filename) {
  const headers = { Authorization: process.env.PEXELS_API_KEY };
  const baseParams = { query, per_page: 15, orientation: 'landscape' };

  let response = await axios.get(PEXELS_API, {
    headers,
    params: { ...baseParams, size: 'large' },
    timeout: 15000,
  });
  let videos = response.data.videos;

  if (!videos || !videos.length) {
    response = await axios.get(PEXELS_API, {
      headers,
      params: { ...baseParams, size: 'medium' },
      timeout: 15000,
    });
    videos = response.data.videos;
  }

  if (!videos || !videos.length) {
    throw new Error(`No landscape videos found for query: ${query}`);
  }

  const pickIdx = Math.floor(Math.random() * Math.min(videos.length, 8));
  const video = videos[pickIdx];
  const videoFile = pickBestLandscapeFile(video);
  if (!videoFile) throw new Error(`No downloadable file for query: ${query}`);

  const videoPath = path.join(outputDir, filename);
  const writer = fs.createWriteStream(videoPath);
  const dlResponse = await axios.get(videoFile.link, { responseType: 'stream', timeout: 90000 });

  await new Promise((resolve, reject) => {
    dlResponse.data.on('error', reject);
    writer.on('error', reject);
    writer.on('finish', resolve);
    dlResponse.data.pipe(writer);
  });
  return videoPath;
}

const PARALLEL_CLIPS = 3; // 동시 다운로드 수 (Pexels rate-limit 고려)

/**
 * 롱폼용 Pexels landscape 클립 N개를 병렬(최대 PARALLEL_CLIPS)로 다운로드.
 * @param {string} outputDir
 * @param {string} genreKey
 * @param {number} count — 필요한 클립 수
 * @returns {string[]} 다운로드된 mp4 경로 배열 (index 순 보장)
 */
async function fetchLandscapeClips(outputDir, genreKey, count = 8) {
  const genre = getGenre(genreKey);
  const queries = [...genre.videoQueries];

  for (let i = queries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queries[i], queries[j]] = [queries[j], queries[i]];
  }

  // 인덱스별 결과 슬롯 미리 확보 (병렬 완료 순서가 달라도 순서 유지)
  const results = new Array(count).fill(null);

  const tasks = Array.from({ length: count }, (_, i) => async () => {
    const query = queries[i % queries.length];
    const filename = `bg_landscape_${i}.mp4`;
    try {
      const p = await fetchOneLandscapeClip(query, outputDir, filename);
      console.log(`  [Pexels] 클립 ${i + 1}/${count}: "${query}"`);
      results[i] = p;
    } catch (err) {
      console.warn(`  [Pexels] 클립 ${i + 1}/${count} 실패 (${query}): ${err.message}`);
    }
  });

  // 슬라이딩 윈도우로 병렬 실행
  for (let start = 0; start < tasks.length; start += PARALLEL_CLIPS) {
    await Promise.all(tasks.slice(start, start + PARALLEL_CLIPS).map((t) => t()));
  }

  // 실패 슬롯 채우기 (가장 가까운 성공 클립으로)
  let fallback = null;
  for (let i = 0; i < count; i++) {
    if (results[i]) { fallback = results[i]; }
    else if (fallback) { results[i] = fallback; }
  }
  // 앞쪽 실패분을 뒤에서 채우기
  fallback = null;
  for (let i = count - 1; i >= 0; i--) {
    if (results[i]) { fallback = results[i]; }
    else if (fallback) { results[i] = fallback; }
  }

  const paths = results.filter(Boolean);
  if (!paths.length) throw new Error('롱폼용 Pexels 클립을 하나도 받지 못했습니다.');
  return results.filter(Boolean);
}

/**
 * 이미지 배치 실패 폴백: Pexels 사진 API에서 스틸 이미지 1장 다운로드.
 * @returns {string|null} 저장된 PNG 경로 또는 null
 */
async function fetchPexelsStillForFallback(outputDir, query, idx) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await axios.get('https://api.pexels.com/v1/search', {
      headers: { Authorization: apiKey },
      params: { query, per_page: 10, orientation: 'landscape' },
      timeout: 15000,
    });
    const photos = res.data?.photos;
    if (!photos?.length) return null;
    const pick = photos[Math.floor(Math.random() * Math.min(photos.length, 5))];
    const imgUrl = pick.src.large2x || pick.src.large;
    const imgPath = path.join(outputDir, `fallback_img_${idx}.jpg`);
    const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 20000 });
    fs.writeFileSync(imgPath, Buffer.from(imgRes.data));
    console.log(`  [Fallback] Pexels 스틸 → ${path.basename(imgPath)}`);
    return imgPath;
  } catch (e) {
    console.warn(`  [Fallback] Pexels 스틸 실패: ${e.message}`);
    return null;
  }
}

module.exports = { fetchLandscapeClips, fetchPexelsStillForFallback };
