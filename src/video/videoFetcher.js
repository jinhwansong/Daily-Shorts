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

/**
 * 0..poolN-1에서 needN개 인덱스. needN>poolN이면 중복
 */
function pickManyIndices(poolN, needN) {
  if (poolN <= 0) return Array.from({ length: needN }, () => 0);
  if (needN <= 0) return [];
  const n = Math.min(needN, 8);
  if (n <= poolN) {
    const arr = Array.from({ length: poolN }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, n);
  }
  const base = pickManyIndices(poolN, poolN);
  const out = [...base];
  while (out.length < n) {
    out.push(Math.floor(Math.random() * poolN));
  }
  return out;
}

async function pexelsSearchForGenre(genre, queryOverride) {
  const queries = genre.videoQueries;
  const trimmedOverride = queryOverride && String(queryOverride).trim();
  const searchQuery = trimmedOverride || queries[Math.floor(Math.random() * queries.length)];

  const headers = { Authorization: process.env.PEXELS_API_KEY };
  const baseParams = {
    query: searchQuery,
    per_page: 20,
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
  return { videos, searchQuery };
}

/**
 * 같은 검색으로 서로 다른 Pexels 세로 클립 N개(기본 4) — 길이에 맞게 짧은 구간씩 이어 붙음
 * @param {number} n 2~8
 * @returns {string[]} background_0.mp4 …
 */
async function fetchNBackgroundVideos(
  outputDir,
  genreKey = DEFAULT_GENRE,
  queryOverride = null,
  n = 4
) {
  const need = Math.max(2, Math.min(8, Math.floor(n) || 4));
  const genre = getGenre(genreKey);
  const { videos, searchQuery } = await pexelsSearchForGenre(genre, queryOverride);

  const poolN = Math.min(videos.length, 20);
  const indices = pickManyIndices(poolN, need);
  const paths = [];

  for (let k = 0; k < need; k++) {
    const video = videos[indices[k]];
    const videoFile = pickBestVideoFile(video);
    if (!videoFile) {
      throw new Error(`No downloadable video file for query: ${searchQuery}`);
    }
    const name = `background_${k}.mp4`;
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

/** @deprecated 쓰는 곳은 fetchNBackgroundVideos(..., 2) */
async function fetchTwoBackgroundVideos(outputDir, genreKey = DEFAULT_GENRE, queryOverride = null) {
  return fetchNBackgroundVideos(outputDir, genreKey, queryOverride, 2);
}

module.exports = { fetchBackgroundVideo, fetchTwoBackgroundVideos, fetchNBackgroundVideos };
