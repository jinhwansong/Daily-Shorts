/**
 * YouTube OAuth2 Refresh Token 발급
 *
 * Google은 "OOB" 복붙(urn:ietf:wg:oauth:2.0:oob) 흐름을 막는 경우가 많아 400 invalid_request 가 난다.
 * 이 스크립트는 루프백(로컬 HTTP)으로 인증 코드를 받는다.
 *
 * ① Cloud Console: API 및 서비스 → 사용자 인증 정보
 * ② (Daily-Shorts) OAuth 2.0 클라이언트: "데스크톱 앱"이면 **리디렉션 URI 칸이 없을 수** 있음 →
 *    같은 프로젝트에 **"웹 애플리케이션"** 클라이언트를 추가하고, 그 ID/Secret을 .env에 쓰면 됨
 * ③ "승인된 리디렉션 URI"에 아래를 **한 줄** 추가하고 저장
 *    http://127.0.0.1:8765/
 *    (끝의 슬래시 포함, 포트/호스트는 아래 YOUTUBE_OAUTH_REDIRECT_PORT 와 맞출 것)
 * ④ 터미널: node scripts/getRefreshToken.js --channel=mystery
 * ⑤ 터미널이 출력한 URL로 브라우저 열기 → 동의 → 자동으로 이 PC로 돌아오면 터미널에 토큰 출력
 *
 * (동의화면 "앱이 확인되지 않음" / 테스트 사용자 — OAuth 동의 화면에서 테스트 사용자에 본인 Gmail 추가)
 *
 *   node scripts/getRefreshToken.js --channel=mystery
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google } = require('googleapis');
const http = require('http');

const args = process.argv.slice(2);
const channelArg = (args.find((a) => a.startsWith('--channel=')) || '').replace('--channel=', '');
const VALID_CHANNELS = ['mystery'];

if (!channelArg || !VALID_CHANNELS.includes(channelArg)) {
  console.error('사용법: node scripts/getRefreshToken.js --channel=mystery');
  process.exit(1);
}

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ .env에 YOUTUBE_CLIENT_ID 와 YOUTUBE_CLIENT_SECRET 을 먼저 입력하세요.');
  process.exit(1);
}

const REDIRECT_PORT = parseInt(process.env.YOUTUBE_OAUTH_REDIRECT_PORT || '8765', 10);
const REDIRECT_PATH = '/';
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

function waitForCallback() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      (async () => {
        if (!req.url) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const url = new URL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`);
        if (url.pathname !== REDIRECT_PATH) {
          res.statusCode = 404;
          res.end();
          return;
        }

        const oErr = url.searchParams.get('error');
        if (oErr) {
          const desc = url.searchParams.get('error_description') || '';
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.writeHead(400);
          res.end(
            `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>${oErr}</p><p>${desc}</p></body></html>`
          );
          server.close(() => reject(new Error(`OAuth: ${oErr} ${desc}`)));
          return;
        }

        const code = url.searchParams.get('code');
        if (!code) {
          res.statusCode = 400;
          res.end();
          return;
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.writeHead(200);
        res.end(
          '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>OK. This window can be closed. Check the terminal.</p></body></html>'
        );

        try {
          const { tokens } = await oauth2Client.getToken(code.trim());
          server.close(() => resolve(tokens));
        } catch (e) {
          server.close(() => reject(e));
        }
      })();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${REDIRECT_PORT} in use. Set YOUTUBE_OAUTH_REDIRECT_PORT in .env and the same URL in Google Cloud (redirect URI).`
          )
        );
      } else {
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, '127.0.0.1');
  });
}

async function run() {
  const tokenPromise = waitForCallback();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    prompt: 'consent',
  });

  console.log(`\n${'='.repeat(55)}`);
  console.log('Channel: ' + channelArg.toUpperCase());
  console.log('\n1) Add this **exact** redirect URI in Google Cloud Console:');
  console.log('   ' + REDIRECT_URI);
  console.log('   (APIs & services → Credentials → your OAuth 2.0 Client ID');
  console.log('    -> Authorized redirect URIs -> Save.)\n');
  console.log('2) Open this URL in your browser and sign in:\n');
  console.log(authUrl);
  console.log(`\n${'='.repeat(55)}\n`);

  try {
    const tokens = await tokenPromise;
    if (!tokens.refresh_token) {
      console.error('\n❌ No refresh_token. Remove app access in Google account security and try again, or add yourself as a test user on the OAuth consent screen.');
      process.exit(1);
    }
    const envKey = `YOUTUBE_REFRESH_TOKEN_${channelArg.toUpperCase()}`;
    console.log(`\nOK [${channelArg}]\n`);
    console.log('Add to .env:');
    console.log('──────────────────────────────────────────');
    console.log(`${envKey}=${tokens.refresh_token}`);
    console.log('──────────────────────────────────────────\n');
  } catch (err) {
    console.error('\n❌ Failed:', err.message || err);
    if (/invalid|redirect|client/i.test(String(err.message || err))) {
      console.error(`\nIf you saw 400 invalid_request in the browser, the redirect URI in Google Cloud\nmust be exactly: ${REDIRECT_URI}`);
    }
    process.exit(1);
  }
}

run();
