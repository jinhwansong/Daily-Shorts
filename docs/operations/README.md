# Operations (운영 문서)

미스터리 Shorts 파이프라인을 **사람이** 해석하고 조정할 때 쓰는 메모다. 자동화 동선은 `../` 상위의 레포 루트 `md/automation-vs-manual.md`를 본다.

| 문서 | 용도 |
|------|------|
| [mystery-shorts-strategy.md](./mystery-shorts-strategy.md) | US 시청자·지표 해석·토픽 철학(평균 조회·편차)·레딧과 코드의 관계 |

## 코드와의 경계

- 토픽 **생성 로직**은 `src/script/topicGenerator.js`의 `generateTopics()` → `src/genres.js`의 `topicInstruction`이다.
- 이 폴더의 문서는 **행동 강령·해석**이지, 실행 코드가 아니다.
