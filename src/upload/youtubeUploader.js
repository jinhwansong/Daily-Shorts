const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const YOUTUBE_PRIVACY_ALLOWED = new Set(['private', 'unlisted', 'public']);

/** 기본 private — 스튜디오에서 저작권·제한 안내 확인 후 직접 공개할 때 사용 */
function resolvePrivacyStatus() {
  const raw = (process.env.YOUTUBE_PRIVACY_STATUS || 'private').toString().trim().toLowerCase();
  if (YOUTUBE_PRIVACY_ALLOWED.has(raw)) return raw;
  console.warn(`[YouTube] YOUTUBE_PRIVACY_STATUS="${raw}" 는 무시되고 private 로 업로드합니다. (허용: private, unlisted, public)`);
  return 'private';
}

// 장르별로 다른 Refresh Token을 사용해 각각의 채널에 업로드
const REFRESH_TOKEN_MAP = {
  mystery: process.env.YOUTUBE_REFRESH_TOKEN_MYSTERY,
  /** 롱폼은 동일 채널(Noctivault) — 별도 토큰이 없으면 mystery와 공유 */
  'mystery-long':
    process.env.YOUTUBE_REFRESH_TOKEN_MYSTERY_LONG || process.env.YOUTUBE_REFRESH_TOKEN_MYSTERY,
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

/** 설명 하단에 해시태그 줄 추가 (snippet.tags와 별도 — Shorts/검색 노출 보조) */
function buildDescription(description, tags) {
  const unique = [...new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))];
  const tagLine = unique
    .slice(0, 25)
    .map((t) => {
      const w = t.replace(/^#/, '').replace(/\s+/g, '');
      return w ? `#${w}` : '';
    })
    .filter(Boolean)
    .join(' ');
  const body = description.trim();
  if (!tagLine) return `${body}\n\n#Shorts`;
  return `${body}\n\n${tagLine}\n\n#Shorts`;
}

/** YouTube snippet.title max length */
const YOUTUBE_TITLE_MAX = 100;

const OAUTH_RETRY_DOC = 'md/youtube-oauth-invalid-grant.md';

function rethrowIfYouTubeOAuthFailed(err, step) {
  const m = err?.message || String(err);
  if (/invalid_grant/i.test(m)) {
    throw new Error(
      `YouTube OAuth invalid_grant during ${step}: Google rejected the refresh token (expired, revoked, or wrong client). ` +
        `Use the same YOUTUBE_CLIENT_ID/SECRET as when the token was issued and run: node scripts/getRefreshToken.js --channel=mystery. ` +
        `Update YOUTUBE_REFRESH_TOKEN_MYSTERY in .env (and CI secrets if applicable). See ${OAUTH_RETRY_DOC}. Original: ${m}`
    );
  }
  throw err;
}

async function uploadVideo(videoPath, { title, description, tags }, genreKey = 'mystery') {
  const youtube = getYouTubeClient(genreKey);
  const fullDescription = buildDescription(description, tags);
  const privacyStatus = resolvePrivacyStatus();
  const safeTitle = String(title == null ? '' : title)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, YOUTUBE_TITLE_MAX) || 'Video';
  let response;
  try {
    response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: safeTitle,
          description: fullDescription,
          tags: [...new Set([...tags, 'shorts'])],
          categoryId: '22',
          defaultLanguage: 'en',
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      },
      media: { body: fs.createReadStream(videoPath) },
    });
  } catch (err) {
    rethrowIfYouTubeOAuthFailed(err, 'video upload');
  }
  const videoId = response.data.id;
  console.log(
    `[YouTube] 업로드 완료 (${privacyStatus}) — 스튜디오에서 저작권·제한 안내·설명란(스크립트) 확인 후 공개하세요.`
  );
  return { videoId, videoUrl: `https://www.youtube.com/shorts/${videoId}` };
}

/**
 * 업로드 직후에는 영상 처리 중이라 thumbnails.set이 실패하는 경우가 있어 짧은 대기 후 재시도합니다.
 * 커스텀 썸네일은 YouTube 계정에 전화번호 인증이 되어 있어야 API에서 허용됩니다.
 */
async function setThumbnail(videoId, thumbnailPath, genreKey = 'mystery') {
  const absPath = thumbnailPath ? path.resolve(thumbnailPath) : '';
  if (!absPath || !fs.existsSync(absPath)) {
    console.warn(`[YouTube] 썸네일 스킵: 파일 없음 (${absPath || thumbnailPath || '경로 없음'})`);
    return;
  }

  const youtube = getYouTubeClient(genreKey);
  const maxAttempts = 5;

  await sleep(3000);

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await youtube.thumbnails.set({
        videoId,
        media: { mimeType: 'image/png', body: fs.createReadStream(absPath) },
      });
      console.log(`[YouTube] 썸네일 적용 완료 (${videoId})`);
      return;
    } catch (err) {
      lastErr = err;
      const msg = err.message || String(err);
      if (/invalid_grant/i.test(msg)) {
        rethrowIfYouTubeOAuthFailed(err, 'thumbnail upload');
      }
      console.warn(`[YouTube] 썸네일 시도 ${attempt}/${maxAttempts} 실패: ${msg}`);
      if (attempt < maxAttempts) await sleep(5000);
    }
  }

  console.error(
    `[YouTube] 썸네일 적용 실패 — 영상은 올라갔습니다. 스튜디오에서 수동 설정하거나, ` +
      `계정에 전화 인증(커스텀 썸네일 권한)과 OAuth 토큰을 확인하세요. (${lastErr?.message || lastErr})`
  );
  // 업로드는 이미 성공했으므로 throw 하지 않음 (파이프라인이 "업로드 실패"로 오인하지 않도록)
}

module.exports = { uploadVideo, setThumbnail };
