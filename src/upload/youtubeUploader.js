const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

function getYouTubeClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
  return google.youtube({ version: 'v3', auth: oauth2Client });
}

async function uploadVideo(videoPath, { title, description, tags }) {
  const youtube = getYouTubeClient();
  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description: `${description}\n\n#Shorts #Mystery #TrueStory #Horror #DarkFacts`,
        tags: [...tags, 'shorts', 'mystery', 'horror', 'scary'],
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

module.exports = { uploadVideo };
