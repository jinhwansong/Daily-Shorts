# `400 invalid_request` (로그인/토큰 발급 링크를 열었을 때)

- Google은 예전 “코드만 복붙”(OOB) 흐름을 거절하는 경우가 많다. 이 레포의 `getRefreshToken.js` 는 **루프백** `http://127.0.0.1:8765/` 를 쓴다.  
- **API 및 서비스 → 사용자 인증 정보 → 해당 OAuth 2.0 클라이언트(데스크톱)** → **승인된 리디렉션 URI**에 `http://127.0.0.1:8765/` 를 넣고 저장한다. (`.env`의 `YOUTUBE_CLIENT_ID` / `SECRET`과 **같은** 클라이언트)  
- 동의 화면이 **테스트**이면, OAuth **테스트 사용자**에 로그인할 Gmail을 추가한다(그렇지 않으면 “액세스 차단”/앱이 확인되지 않음 등).  
- 포트를 바꾸면 `YOUTUBE_OAUTH_REDIRECT_PORT`와 Console URI 둘 다 맞출 것.

---

# YouTube 업로드 `invalid_grant` 해결 가이드

파이프라인에서 **영상 합성·저작권 가드까지 성공**한 뒤, 로그에 아래처럼만 실패할 때가 있습니다.

```text
Video 1 failed: invalid_grant
```

이건 FFmpeg나 스크립트 버그가 아니라 **Google OAuth가 리프레시 토큰으로 새 액세스 토큰을 주지 않을 때** 나는 표준 오류입니다. 이 레포는 `YOUTUBE_REFRESH_TOKEN_MYSTERY` 등으로 YouTube Data API에 업로드합니다.

---

## 왜 어제까지 되다가 갑자기 안 될 수 있나

- Google 계정에서 **비밀번호 변경**, 보안 조치, **연결된 앱(타사 앱) 해제**
- OAuth 동의 화면이 **테스트** 상태인데 정책·만료 조건이 맞아 떨어진 경우
- **같은 계정으로 refresh token을 여러 번 발급**해 Google이 예전 토큰을 무효화한 경우
- Cloud Console에서 **OAuth 클라이언트 시크릿을 재발급**해 예전 secret과 짝이 안 맞는 경우
- `.env`(또는 GitHub Actions Secret)에 토큰이 **잘렸거나**, 따옴표·공백이 섞인 경우
- PC **시스템 시간**이 크게 어긋난 경우(드묾)

---

## 해결 절차 (권장)

### 1. 전제 확인

- [Google Cloud Console](https://console.cloud.google.com)에서 **YouTube Data API v3** 사용 설정됨
- **OAuth 2.0 클라이언트 ID**가 있고, 유형은 README와 같이 **데스크톱 앱** 기준으로 맞춰 둠
- 로컬 `.env`에 다음이 **발급 당시와 동일한 클라이언트** 기준으로 들어 있음  
  - `YOUTUBE_CLIENT_ID`  
  - `YOUTUBE_CLIENT_SECRET`  

> refresh token은 **어떤 Client ID/Secret으로 받았는지**에 묶입니다. Secret을 새로 만들었다면 **반드시 새로 refresh token도 발급**해야 합니다.

### 2. Refresh token 다시 발급

프로젝트 루트에서:

```bash
node scripts/getRefreshToken.js --channel=mystery
```

1. 터미널에 출력된 URL을 브라우저에서 엽니다.  
2. 업로드에 쓸 **그 Google 계정**으로 로그인·동의합니다.  
3. 표시된 **authorization code**를 터미널에 붙여넣습니다.  
4. 출력된 한 줄을 `.env`에 반영합니다.

```env
YOUTUBE_REFRESH_TOKEN_MYSTERY=여기에_새_값
```

- 값 앞뒤에 따옴표를 넣지 않아도 됩니다.  
- 한 줄로만 유지합니다(줄바꿈 금지).

### 3. `refresh_token`이 안 나올 때

스크립트가 `refresh_token이 발급되지 않았습니다`라고 하면, Google 계정 설정에서 해당 앱에 대한 **접근 권한을 제거**한 뒤, 위 절차를 **다시** 실행해 보세요. (`prompt: 'consent'`가 이미 스크립트에 있음.)

### 4. GitHub Actions를 쓰는 경우

로컬 `.env`만 고치면 Actions는 그대로입니다. **Repository secrets**에 있는 `YOUTUBE_REFRESH_TOKEN_MYSTERY`(및 필요 시 CLIENT_ID/SECRET)를 **같은 값으로 업데이트**해야 스케줄 실행도 복구됩니다.

### 5. 재실행

```bash
npm run mystery
# 또는
node src/index.js --run-once --genre=mystery
```

---

## 요약

| 증상 | 의미 |
|------|------|
| `invalid_grant` | 현재 저장된 refresh token + client 조합으로 Google이 토큰 갱신 거절 |

**조치:** 같은 `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`으로 `scripts/getRefreshToken.js`를 다시 돌려 `.env`(및 CI Secret)의 refresh token을 교체하면 됩니다.

관련 코드: `src/upload/youtubeUploader.js`, 발급 스크립트: `scripts/getRefreshToken.js`, 환경변수 예시: `.env.example`, 개요: `README.md`의 YouTube OAuth 절차.
