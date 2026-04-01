/**
 * YouTube OAuth2 Refresh Token 발급 스크립트
 *
 * 사용법:
 *   node scripts/getRefreshToken.js --channel=mystery
 *   node scripts/getRefreshToken.js --channel=psychology
 *
 * 각 채널마다 한 번씩 실행 → 나온 refresh_token을 .env에 저장
 *   YOUTUBE_REFRESH_TOKEN_MYSTERY=...
 *   YOUTUBE_REFRESH_TOKEN_PSYCHOLOGY=...
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google } = require('googleapis');
const readline = require('readline');

const args = process.argv.slice(2);
const channelArg = (args.find((a) => a.startsWith('--channel=')) || '').replace('--channel=', '');
const VALID_CHANNELS = ['mystery', 'psychology'];

if (!channelArg || !VALID_CHANNELS.includes(channelArg)) {
  console.error(`사용법: node scripts/getRefreshToken.js --channel=<mystery|psychology>`);
  process.exit(1);
}

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ .env에 YOUTUBE_CLIENT_ID 와 YOUTUBE_CLIENT_SECRET 을 먼저 입력하세요.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/youtube.upload'],
  prompt: 'consent',
});

console.log(`\n==============================`);
console.log(`채널: ${channelArg.toUpperCase()}`);
console.log(`이 채널에 사용할 구글 계정으로 로그인하세요.`);
console.log(`==============================\n`);
console.log(authUrl);
console.log('\n==============================\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('브라우저에서 동의 후 표시된 code를 여기에 붙여넣으세요:\n> ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());

    if (!tokens.refresh_token) {
      console.error('\n❌ refresh_token이 발급되지 않았습니다.');
      console.error('   Google Cloud Console에서 기존 OAuth 동의를 취소 후 다시 시도하세요.');
      process.exit(1);
    }

    const envKey = `YOUTUBE_REFRESH_TOKEN_${channelArg.toUpperCase()}`;
    console.log(`\n✅ [${channelArg}] 발급 완료!\n`);
    console.log('.env에 아래 값을 추가하세요:');
    console.log('──────────────────────────────────────────');
    console.log(`${envKey}=${tokens.refresh_token}`);
    console.log('──────────────────────────────────────────\n');
  } catch (err) {
    console.error('\n❌ 토큰 발급 실패:', err.message);
    process.exit(1);
  }
});
