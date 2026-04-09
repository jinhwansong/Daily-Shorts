# 자동화되는 것 vs 수동으로 할 일

이 레포의 **미스터리 Shorts 파이프라인** 기준으로 정리했습니다. (`src/index.js` → 업로드까지)

---

## 자동으로 돌아가는 것

| 단계 | 내용 |
|------|------|
| 주제 | Claude가 장르별 지시(`genres.js`) + 중복 방지(`output/used_topics_*.json`)로 N개 생성 |
| 스크립트 | `prompts/mystery.txt` + 토픽, `CONTENT_HOOK_LEVEL`에 따라 훅 강도 문구 추가 |
| 메타 | 제목, `THUMBNAIL_LINE`, 설명, 태그, Pexels 검색어(배경·썸네일에 연동) |
| 음성 | OpenAI TTS → `audio.mp3` |
| 배경 영상 | Pexels 세로 클립(단일 또는 `VIDEO_DUAL_BACKGROUND` 시 2클립 반씩 이어붙임) |
| 자막 | Whisper SRT → ASS(폰트·스타일은 `.env` / `fonts.json`) |
| 영상 합성 | FFmpeg: 색보정, 선택 켄 번즈, 자막 burn-in, BGM 믹스, 라우드니즈 등 |
| 썸네일 | Canvas PNG(`thumbnail.png`) — 폰트는 `fonts.json` / `THUMBNAIL_*` |
| 검증 | `copyrightGuard` 통과 시에만 업로드 진행 |
| 업로드 | YouTube Data API로 영상 + 썸네일 설정 |
| 스케줄 | GitHub Actions `pipeline-mystery.yml` cron / 수동 실행 |

**비용이 나는 호출:** Anthropic, OpenAI(TTS·Whisper), Pexels(다운로드), Freesound(키 있을 때).

---

## 사람이 해야 하는 것 (또는 정기적으로 손대는 것)

### 1. 최초·유지 세팅

- **API 키·토큰**: `.env`(로컬) / GitHub **Repository secrets**(Actions).  
  - 워크플로 `env:`에 **적어 넣지 않은** 변수는 CI에서 비어 있음 → **코드 기본값**만 적용됨.  
  - 로컬과 Actions를 맞추려면 `VIDEO_*`, `CONTENT_HOOK_LEVEL`, 폰트 관련 등을 **secrets + workflow `env`에 추가**하거나, 저장소 기본만 쓰기로 타협.
- **Google Cloud**: YouTube Data API 사용 설정, OAuth 클라이언트, `getRefreshToken.js`로 refresh token 발급.
- **FFmpeg**: 로컬·Actions 러너에 설치(워크플로는 `apt`로 설치).

### 2. 에셋·품질

- **`assets/fonts/`**: 쓰는 TTF 배치, `fonts.json` / `SUBTITLE_FONT_NAME` / `THUMBNAIL_*`와 **패밀리 이름 일치** 확인.
- **`assets/bgm/`**: Freesound 실패 시 쓸 로컬 BGM 풀(선택).
- **`assets/images/<장르>/`**: Pexels 썸네일 이미지 실패 시 폴백용(선택).

### 3. 콘텐츠·정책 (자동이 아님)

- **사실·민감도**: 자동 생성은 **틀리거나 과장**될 수 있음. 민감 사건·실존 인물은 **직접 검토** 권장.
- **YouTube 정책**: 수익화·연령·그래픽 콘텐츠 규정은 **채널 주인이 판단**해야 함.
- **저작권 가드**는 구조적 안전만 체크; **법적·플랫폼 최종 책임**은 업로더에게 있음.

### 4. 운영·개선

- **Analytics**: 조회·이탈·구독은 YouTube Studio에서 확인; 그에 맞춰 `prompts/mystery.txt`, `genres.js`, `.env` 튜닝은 **수동 결정**.
- **이상 출력**: 한 편이 마음에 안 들면 그 job의 `output/`·메타를 보고 프롬프트·`CONTENT_HOOK_LEVEL`·`VIDEO_*` 조정.
- **키 유출 시**: 키 재발급·`.env`·GitHub secrets 교체.
- **주제 캐시**: `output/used_topics_mystery.json`이 비정상이면 삭제·백업 후 재생성(의도에 따라).

### 5. 아직 파이프라인에 없는 것 (수동 또는 추후 개발)

- 자막 **단어별 색·강조**(Whisper 단어 타임스탬프 등 별도 작업).
- 클립 **크로스페이드**, **엔딩 구독 CTA** 영상 레이어.
- 업로드 전 **사람 최종 승인** 게이트(지금은 가드 통과 시 바로 업로드).

---

## 빠른 체크리스트

- [ ] Secrets / `.env` 필수 키 전부 채움  
- [ ] (선택) CI에서도 쓸 튜닝 env를 workflow에 반영할지 결정  
- [ ] 폰트 파일·이름 일치 확인  
- [ ] 가끔 Studio에서 올라온 영상 1편씩 품질·사실 확인  

이 파일은 `md/mentor.md`의 **레포 맥락**과 같이 두고, 운영 방침 바뀔 때마다 여기만 고쳐도 됩니다.
