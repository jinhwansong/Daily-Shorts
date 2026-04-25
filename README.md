# YouTube Shorts 자동화 파이프라인

> 스크립트 작성부터 YouTube 업로드까지 — 사람 손 없이 스케줄대로 Shorts가 올라갑니다.

Claude API로 주제·스크립트를 생성하고, OpenAI TTS + FFmpeg으로 영상을 합성해 YouTube Shorts에 자동 업로드하는 **풀 자동화 파이프라인**입니다.  
**`prompts/` 폴더의 txt 파일 하나만 바꾸면 어떤 장르로도 전환 가능합니다.**

---

## 핵심 특징

- **완전 무인 운영** — GitHub Actions cron으로 스케줄 실행. PC/서버 상시 가동 불필요
- **단일 채널** — 미스터리(Noctivault) 전용; GitHub Actions cron으로 자동 업로드
- **중복 방지** — 이미 사용된 주제를 장르별로 추적해 Claude에게 컨텍스트로 전달
- **썸네일 자동 생성** — Hook 문장 + 장르별 색상 테마로 canvas PNG 생성 → YouTube에 자동 설정
- **저비용** — 월 $4~5 (Claude Haiku + OpenAI TTS/Whisper), 나머지 전부 무료
- **확장성** — 프롬프트 파일 하나 + `genres.js` 항목 추가만으로 새 장르/채널 추가

---

## 기술 스택

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![Claude](https://img.shields.io/badge/Claude_Haiku-D97757?style=flat-square&logo=anthropic&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI_TTS%2FWhisper-412991?style=flat-square&logo=openai&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=flat-square&logo=ffmpeg&logoColor=white)
![YouTube](https://img.shields.io/badge/YouTube_API-FF0000?style=flat-square&logo=youtube&logoColor=white)
![Pexels](https://img.shields.io/badge/Pexels_API-05A081?style=flat-square&logo=pexels&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white)

---

## 워크플로

| 채널 | 스케줄 | 워크플로 |
|------|--------|----------|
| 🔪 Mystery (Noctivault) | GitHub Actions cron (여러 시각) | `pipeline-mystery.yml` |

---

## 파이프라인 흐름

```
주제 자동 생성 (Claude)  ←  장르별 instruction + 중복 방지
       ↓
스크립트 생성 (Claude)   ←  prompts/<genre>.txt
       ↓
TTS 음성 변환 (OpenAI TTS) + 배경 영상 다운로드 (Pexels)  ← 병렬
       ↓
자막 생성 (OpenAI Whisper → SRT → ASS)
       ↓
영상 합성 (FFmpeg 1080×1920) + 썸네일 생성 (canvas)        ← 병렬
       ↓
YouTube 업로드 + 썸네일 설정
       ↓
GitHub Actions cron으로 매일 반복
```

---

## 파일 구조

```
shorts-automation/
├── .github/workflows/
│   └── pipeline-mystery.yml       ← cron: 미스터리
├── prompts/
│   └── mystery.txt
├── src/
│   ├── index.js                   ← 파이프라인 진입점 + CLI
│   ├── genres.js                  ← 장르별 설정 중앙 관리
│   ├── script/
│   │   ├── topicGenerator.js      ← 주제 N개 생성 + 중복 방지
│   │   └── scriptGenerator.js     ← 스크립트 + 제목/태그 생성
│   ├── audio/
│   │   └── ttsGenerator.js        ← OpenAI TTS (onyx, 0.92x)
│   ├── video/
│   │   ├── videoFetcher.js        ← Pexels 배경 영상 (장르별 쿼리)
│   │   ├── subtitleGenerator.js   ← Whisper SRT + ASS 변환
│   │   ├── videoComposer.js       ← FFmpeg 최종 합성
│   │   └── thumbnailGenerator.js  ← 장르별 색상 테마 썸네일
│   └── upload/
│       └── youtubeUploader.js     ← YouTube API 업로드 + 썸네일 설정
├── output/                        ← 생성 결과 임시 저장 (gitignore)
├── .env.example
└── package.json
```

---

## 새 장르 추가하는 법

1. `prompts/<newgenre>.txt` 작성
2. `src/genres.js`에 항목 추가

```js
'new-genre': {
  label: 'New Genre Label',
  promptFile: path.join(__dirname, '../prompts/new-genre.txt'),
  topicInstruction: `Generate exactly {count} topics about ...`,
  videoQueries: ['relevant', 'pexels', 'keywords'],
  thumbnailColor: '#0a0a0a',
  thumbnailAccent: '#e74c3c',
},
```

3. `.github/workflows/pipeline-new-genre.yml` 복사 후 cron + genre 수정

---

## 세팅 방법

### 1. 환경변수 준비

`.env.example`을 복사해 `.env`로 만들고 값을 채웁니다.

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
PEXELS_API_KEY=...
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REFRESH_TOKEN_MYSTERY=...
```

> **YouTube OAuth 발급 순서**  
> 1. [Google Cloud Console](https://console.cloud.google.com) → 프로젝트 생성  
> 2. YouTube Data API v3 사용 설정  
> 3. OAuth 2.0 클라이언트: **`getRefreshToken`에는 리디렉션이 필요**함. 콘솔에서 **「데스크톱 앱」** 클라이언트엔 **승인된 리디렉션 URI** 칸이 **안 보이는 경우**가 있음(정상) → 이 경우 **같은 프로젝트**에서 유형 **「웹 애플리케이션」** 클라이언트를 하나 더 만들고, 그쪽 **승인된 리디렉션 URI**에 `http://127.0.0.1:8765/` 를 넣는다(끝 `/` 포함)  
> 4. `.env`의 `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`은 **위 3에서 리디렉션을 넣은 그 클라이언트(보통 웹 앱)**의 ID/Secret로 맞춘다  
> 5. `node scripts/getRefreshToken.js --channel=mystery` → 터미널 URL로 로그인 → `YOUTUBE_REFRESH_TOKEN_MYSTERY` 를 `.env`에 저장. 동의 화면이 *테스트*이면 [OAuth 동의 화면](https://console.cloud.google.com/apis/credentials/consent) → **테스트 사용자**에 본인 Gmail  
>    
> **Shorts 팩트 보조 (무료):** 토픽에 맞는 **영문 위키** API로 본문 일부를 가져와 스크립트에 붙임 (`SHORTS_WIKI_CONTEXT=1` 기본, 끄려면 `0`). API 키 없음, `User-Agent` 권장(`.env`의 `WIKIPEDIA_USER_AGENT`).  
> **하이쿠 사실 불릿 1회(기본 켬):** 위키(또는 토픽만)에서 **불릿**만 먼저 뽑고, 본문 스크립트는 **위키+불릿에 없는 구체(연도·“첫 OOO”·시신·재판 횟수)** 를 쓰지 못하도록 프롬프트로 묶음. 하이쿠 호출 **+1** (`SHORTS_FACTS_STEP=0` 이 꺼짐)

### 2. 로컬 실행

```bash
# FFmpeg 설치 필요 → https://ffmpeg.org
npm install

# 비용 없음 — API·업로드 없이 FFmpeg·썸네일만 검증 (.env 불필요)
npm run dry-run

# 실제 파이프라인 (Claude·OpenAI 등 과금)
npm run mystery        # 미스터리(Noctivault) 배치 (기본 5편, package.json에서 조정)
```

### 3. GitHub Actions 자동 스케줄

1. 레포를 GitHub에 push
2. **Settings → Secrets and variables → Actions → Repository secrets** 에 위 키 6개 등록
3. 이후 매일 지정 시간에 자동 실행

> 수동 실행: Actions 탭 → 워크플로 선택 → **Run workflow**

---

## 비용 (월 기준)

| 항목 | 비용 |
|------|------|
| Claude Haiku API | ~$1 |
| OpenAI TTS + Whisper | ~$3 |
| Pexels / FFmpeg / GitHub Actions / canvas | 무료 |
| **합계** | **$4~5** |

---

## 수익화 로드맵

| 시기 | 목표 | 예상 월수익 |
|------|------|------------|
| 0~2개월 | 파이프라인 안정화 + 영상 60개 | $0 |
| 3~4개월 | 알고리즘 탐색, 장르 A/B 테스트 | $0~50 |
| 5~6개월 | YPP 달성 (구독자 500 + 조회수 1,000만) | $50~200 |
| 7~12개월 | 안정 궤도 | $200~800 |
| 1년+ | 채널 확장 | $500~2,000+ |

> 영어권(미국 메인) 타겟. 광고 수익 + 추후 어필리에이트 추가 예정.

---

## 저작권 안전 체크리스트

아래 항목들은 파이프라인 구조상 **자동으로 충족**됩니다. 매 영상 업로드 직전 `src/utils/copyrightGuard.js`가 자동으로 검증하고 차단합니다.

| 항목 | 상태 | 자동화 방식 |
|------|------|------------|
| 영상 소스 | ✅ 자동 | Pexels API는 CC0만 반환 |
| 음성 | ✅ 자동 | OpenAI TTS API — 상업 이용 허가 |
| 스크립트 | ✅ 자동 | Claude API로만 생성 |
| 자막 | ✅ 자동 | Whisper 로컬 처리 |
| 음악 | ✅ 자동 | 파이프라인에 음악 스텝 없음 |
| 썸네일 | ✅ 자동 | canvas 자체 생성 (외부 이미지 없음) |

업로드 전 검증 결과는 `output/<job>/copyright_audit.json`에 자동 저장됩니다.

```json
{
  "timestamp": "2026-04-01T13:00:00.000Z",
  "passed": true,
  "checks": [
    { "label": "Pexels CC0 배경 영상", "passed": true },
    { "label": "OpenAI TTS 음성 (상업 이용 허가)", "passed": true },
    { "label": "음악 미삽입", "passed": true },
    { "label": "AI 생성 스크립트", "passed": true },
    { "label": "canvas 자체 생성 썸네일 (외부 이미지 없음)", "passed": true }
  ],
  "errors": []
}
```

> 하나라도 실패하면 업로드가 자동 차단됩니다.
