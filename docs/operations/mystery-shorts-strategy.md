# 미스터리 Shorts — US 시청자·지표·토픽 (운영 메모)

## 1. 파이프라인에서 토픽이 나오는 방식 (사실)

- 실행 경로: `src/script/topicGenerator.js` → LLM → `src/genres.js`의 `mystery.topicInstruction`.
- **레딧 시드:** `src/script/redditTopicSource.js`가 (선택) 서브레딧 **핫** 글 제목을 가져와 프롬프트에 **REDDIT DISCUSSION SEEDS** 블록으로 넣는다. **가정·사실은 LLM이 위키/뉴스 기준으로 검증**해야 하며, 제목만 믿고 허구를 쓰면 안 된다.
- 시드를 끄려면 환경변수 **`REDDIT_SEEDS=0`** (또는 `false`).

## 2. 목표 말하기: 평균 조회수 vs 그만두기

- **평균(또는 중앙값) 조회수**를 올리려면 “한두 개 대박”보다 **바닥을 올리는 토픽 믹스**가 수학적으로 유리한 경우가 많다.
- **구독자**는 Shorts만으로 천천히 오르는 편이 흔하다. 구독을 목표와 평균 조회를 **같은 기준**에 묶으면 판단이 흔들린다.
- **접기/유지**는 레포가 결정하지 않는다. 필요하면 “3개월마다 중앙값 조회 또는 월 총 시청 시간” 같은 **사전 기준**만 쓴다.

## 3. 지표: 조회수 높은데 시청유지(%)는 낮은 경우

- Shorts는 **넓은 추천**에 노출될수록 **무작위 시청자**가 섞여 **평균 % 시청**이 떨어질 수 있다. 이것만으로 “콘텐츠가 더 나쁘다”고 단정하지 않는다.
- **총 시청 시간**, **노출 대비 클릭**, **평균 시청 초**를 같은 기간·비슷한 길이 영상끼리 비교한다.

## 4. Studio의 ‘검색어’

- 제목·설명에 없는 단어가 검색어 보고에 뜰 수 있다. **최적화 타깃 키워드**로 잡기보다 **참고**로 본다.
- 미국 시청자용 메타 규칙은 이미 `src/script/scriptGenerator.js`의 메타데이터 프롬프트에 반영되어 있다.

## 5. 토픽 A/B 티어 (구현됨)

- **`src/script/topicTier.js`**: 배치마다 줄 단위로 **TIER A**(인지도·검색 친화) vs **TIER B**(딥컷, 여전히 출처 규율)를 **가중 랜덤** 할당한다.
- **`TOPIC_TIER_A_WEIGHT`**: 0~1, 기본 **0.65** (A 65%, B 35% 기대값).
- `genres.js`의 `mystery` 지시문 + 티어 블록이 같이 들어간다.

## 6. 레딧·티어 환경변수 요약

| 변수 | 의미 |
|------|------|
| `REDDIT_SEEDS` | `0` / `false` 이면 레딧 호출 안 함 |
| `REDDIT_SUBREDDITS` | 콤마 구분 서브 목록 (기본: UnresolvedMysteries, TrueCrime, ColdCase) |
| `REDDIT_SEED_LIMIT` | 시드 제목 최대 개수 (기본 15) |
| `REDDIT_USER_AGENT` | Reddit API 권장 — 식별 가능한 UA 문자열 |
| `TOPIC_TIER_A_WEIGHT` | A 티어 비중 (기본 0.65) |

---

## 관련 파일

- 자동화 개요: [md/automation-vs-manual.md](../../md/automation-vs-manual.md)
- 스크립트·메타 생성: `src/script/scriptGenerator.js`
- 토픽 LLM: `src/script/topicGenerator.js`, `src/genres.js`
- 레딧 시드: `src/script/redditTopicSource.js`
- A/B 티어: `src/script/topicTier.js`
