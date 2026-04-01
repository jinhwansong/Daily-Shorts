const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PEXELS_API = 'https://api.pexels.com/videos/search';

const DARK_QUERIES = [
  'dark forest night',
  'abandoned building',
  'foggy road',
  'empty hallway',
  'dark tunnel',
  'stormy sky',
  'old mansion',
  'dark water',
  'night city rain',
  'shadow silhouette',
];

async function fetchBackgroundVideo(outputDir, query = null) {
  const searchQuery = query || DARK_QUERIES[Math.floor(Math.random() * DARK_QUERIES.length)];

  const response = await axios.get(PEXELS_API, {
    headers: { Authorization: process.env.PEXELS_API_KEY },
    params: { query: searchQuery, per_page: 10, orientation: 'portrait', size: 'medium' },
  });

  const videos = response.data.videos;
  if (!videos || videos.length === 0) {
    throw new Error(`No videos found for query: ${searchQuery}`);
  }

  const video = videos[Math.floor(Math.random() * Math.min(videos.length, 5))];
  const videoFile =
    video.video_files.find(
      (f) => f.width === 1080 || (f.height > f.width && f.quality === 'hd')
    ) || video.video_files[0];

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

module.exports = { fetchBackgroundVideo, DARK_QUERIES };
