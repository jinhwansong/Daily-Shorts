const { google } = require('googleapis');
const fs = require('fs');

// 장르별로 다른 Refresh Token을 사용해 각각의 채널에 업로드
const REFRESH_TOKEN_MAP = {
  mystery: process.env.YOUTUBE_REFRESH_TOKEN_MYSTERY,
  psychology: process.env.YOUTUBE_REFRESH_TOKEN_PSYCHOLOGY,
};

function getYouTubeClient(genreKey) {
  const refreshToken = REFRESH_TOKEN_MAP[genreKey];
  if (!refreshToken) {
    throw new Error(
      `YOUTUBE_REFRESH_TOKEN_${genreKey.toUpperCase()} 환경변수가 없습니다. .env를 확인하세요.`
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.youtube({ version: 'v3', auth: oauth2Client });
}

async function uploadVideo(videoPath, { title, description, tags }, genreKey = 'mystery') {
  const youtube = getYouTubeClient(genreKey);
  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description: `${description}\n\n#Shorts`,
        tags: [...new Set([...tags, 'shorts'])],
        categoryId: '22',
        defaultLanguage: 'en',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: { body: fs.createReadStream(videoPath) },
  });
  const videoId = response.data.id;
  return { videoId, videoUrl: `https://www.youtube.com/shorts/${videoId}` };
}

async function setThumbnail(videoId, thumbnailPath, genreKey = 'mystery') {
  if (!thumbnailPath || !fs.existsSync(thumbnailPath)) return;
  const youtube = getYouTubeClient(genreKey);
  await youtube.thumbnails.set({
    videoId,
    media: { mimeType: 'image/png', body: fs.createReadStream(thumbnailPath) },
  });
}

module.exports = { uploadVideo, setThumbnail };
