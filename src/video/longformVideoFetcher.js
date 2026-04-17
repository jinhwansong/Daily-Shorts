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
  });
  let videos = response.data.videos;

  if (!videos || !videos.length) {
    response = await axios.get(PEXELS_API, {
      headers,
      params: { ...baseParams, size: 'medium' },
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
  const dlResponse = await axios.get(videoFile.link, { responseType: 'stream' });
  dlResponse.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  return videoPath;
}

/**
 * 롱폼용 Pexels landscape 클립 N개를 순차 다운로드.
 * 장르별 videoQueries에서 순서대로(셔플 없이) 다양한 쿼리 사용.
 * @param {string} outputDir
 * @param {string} genreKey
 * @param {number} count — 필요한 클립 수
 * @returns {string[]} 다운로드된 mp4 경로 배열
 */
async function fetchLandscapeClips(outputDir, genreKey, count = 8) {
  const genre = getGenre(genreKey);
  const queries = [...genre.videoQueries];

  // 쿼리를 셔플해서 다양한 조합 사용
  for (let i = queries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queries[i], queries[j]] = [queries[j], queries[i]];
  }

  const paths = [];
  for (let i = 0; i < count; i++) {
    const query = queries[i % queries.length];
    const filename = `bg_landscape_${i}.mp4`;
    try {
      const p = await fetchOneLandscapeClip(query, outputDir, filename);
      paths.push(p);
      console.log(`  [Pexels] 클립 ${i + 1}/${count}: "${query}"`);
    } catch (err) {
      console.warn(`  [Pexels] 클립 ${i + 1}/${count} 실패 (${query}): ${err.message}`);
      // 실패 시 이미 받은 클립 재사용
      if (paths.length > 0) paths.push(paths[paths.length - 1]);
    }
  }

  if (!paths.length) throw new Error('롱폼용 Pexels 클립을 하나도 받지 못했습니다.');
  return paths;
}

module.exports = { fetchLandscapeClips };
