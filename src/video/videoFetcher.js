const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getGenre, DEFAULT_GENRE } = require('../genres');

const PEXELS_API = 'https://api.pexels.com/videos/search';

/** Pexels video_file 항목 중 MP4 우선, 해상도·HD 가중으로 최선 선택 */
function pickBestVideoFile(video) {
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
    if (h >= w && h >= 1920) s += 400_000;
    if (w >= 1080 && h >= 1920) s += 300_000;
    return s;
  };

  return pool.reduce((best, f) => (score(f) > score(best) ? f : best));
}

async function fetchBackgroundVideo(outputDir, genreKey = DEFAULT_GENRE, queryOverride = null) {
  const genre = getGenre(genreKey);
  const queries = genre.videoQueries;
  const trimmedOverride = queryOverride && String(queryOverride).trim();
  const searchQuery = trimmedOverride || queries[Math.floor(Math.random() * queries.length)];

  const headers = { Authorization: process.env.PEXELS_API_KEY };
  const baseParams = {
    query: searchQuery,
    per_page: 15,
    orientation: 'portrait',
  };

  let response = await axios.get(PEXELS_API, {
    headers,
    params: { ...baseParams, size: 'large' },
  });

  let videos = response.data.videos;
  if (!videos || videos.length === 0) {
    response = await axios.get(PEXELS_API, {
      headers,
      params: { ...baseParams, size: 'medium' },
    });
    videos = response.data.videos;
  }

  if (!videos || videos.length === 0) {
    throw new Error(`No videos found for query: ${searchQuery}`);
  }

  const pickIdx = Math.floor(Math.random() * Math.min(videos.length, 8));
  const video = videos[pickIdx];
  const videoFile = pickBestVideoFile(video);
  if (!videoFile) {
    throw new Error(`No downloadable video file for query: ${searchQuery}`);
  }

  const videoPath = path.join(outputDir, 'background.mp4');
  const writer = fs.createWriteStream(videoPath);
  const dlResponse = await axios.get(videoFile.link, { responseType: 'stream' });
  dlResponse.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  return videoPath;
}

function pickTwoDistinctIndices(n) {
  if (n <= 1) return [0, 0];
  let a = Math.floor(Math.random() * n);
  let b = Math.floor(Math.random() * n);
  let guard = 0;
  while (b === a && guard < 20) {
    b = Math.floor(Math.random() * n);
    guard += 1;
  }
  return [a, b];
}

/** 같은 검색으로 서로 다른 클립 2개 — 전·후반 컷용 */
async function fetchTwoBackgroundVideos(outputDir, genreKey = DEFAULT_GENRE, queryOverride = null) {
  const genre = getGenre(genreKey);
  const queries = genre.videoQueries;
  const trimmedOverride = queryOverride && String(queryOverride).trim();
  const searchQuery = trimmedOverride || queries[Math.floor(Math.random() * queries.length)];

  const headers = { Authorization: process.env.PEXELS_API_KEY };
  const baseParams = {
    query: searchQuery,
    per_page: 15,
    orientation: 'portrait',
  };

  let response = await axios.get(PEXELS_API, {
    headers,
    params: { ...baseParams, size: 'large' },
  });

  let videos = response.data.videos;
  if (!videos || videos.length === 0) {
    response = await axios.get(PEXELS_API, {
      headers,
      params: { ...baseParams, size: 'medium' },
    });
    videos = response.data.videos;
  }

  if (!videos || videos.length === 0) {
    throw new Error(`No videos found for query: ${searchQuery}`);
  }

  const poolN = Math.min(videos.length, 8);
  const [i0, i1] = pickTwoDistinctIndices(poolN);
  const paths = [];

  for (let k = 0; k < 2; k++) {
    const idx = k === 0 ? i0 : i1;
    const video = videos[idx];
    const videoFile = pickBestVideoFile(video);
    if (!videoFile) {
      throw new Error(`No downloadable video file for query: ${searchQuery}`);
    }
    const name = k === 0 ? 'background_a.mp4' : 'background_b.mp4';
    const videoPath = path.join(outputDir, name);
    const writer = fs.createWriteStream(videoPath);
    const dlResponse = await axios.get(videoFile.link, { responseType: 'stream' });
    dlResponse.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    paths.push(videoPath);
  }

  return paths;
}

module.exports = { fetchBackgroundVideo, fetchTwoBackgroundVideos };
