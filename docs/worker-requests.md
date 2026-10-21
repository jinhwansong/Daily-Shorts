# Actions/CLI 관리 요청

GitHub Actions의 `operation=request`에서 `request_json`에 JSON 객체 하나를 입력합니다. 로컬에서는 같은 객체를 파일에 저장하고 `node dist/main.js --request=request.json`으로 실행합니다. 아래의 `사건 UUID`, `콘텐츠 UUID`, `근거 ID` 등은 `status`나 이전 요청 결과의 실제 ID로 교체합니다. API 키는 요청 JSON에 넣지 않습니다.

요청은 `{ "command": "명령", "id": "대상 UUID", "data": { ... } }` 형태입니다. `id`는 대상이 있는 명령에만 필요합니다. 콘텐츠 수정의 `revision`은 `status`에서 확인한 최신 숫자여야 하며, 다른 작업이 변경하면 충돌로 중단합니다. 실패 요청을 통째로 자동 재시도하지 않습니다.

## 명령

| command          | id             | data                                                                                                 | 동작                                                                 |
| ---------------- | -------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `status`         | 없음           | 없음                                                                                                 | 사건·콘텐츠·원문·주장 ID, revision, 비용·실행·과거 이력 조회         |
| `history-import` | 없음           | 없음                                                                                                 | 기존 DB·YouTube 업로드 전체 대조. 첫 예약 전 필수                    |
| `history-map`    | 과거 이력 UUID | `caseId`, `format`, `angleId`, `coreClaimIds` 또는 `ignoredReason`                                   | 과거 영상의 정보 범위 연결 / 무관한 이력 제외                        |
| `case`           | 없음           | `name`, `date`, `location`, 선택 `aliases`, `externalIds`, `status`                                  | 사건 등록·기존 사건 병합                                             |
| `source`         | 사건 UUID      | `title`, `url`, `kind`, `text`                                                                       | 직접 확인한 원문 발췌 등록. kind: official/primary/report/reference  |
| `claim`          | 사건 UUID      | `text`, `classification`, `sourceId`, `quote`                                                        | 주장과 실제 원문 문장 연결                                           |
| `reserve`        | 없음           | `caseId`, `format`, `angleId`, `coreClaimIds` 등                                                     | 영구 중복 검사 후 제작 예약                                          |
| `draft`          | 콘텐츠 UUID    | `revision`, `script`, `title`, `description`, `thumbnailText`                                        | 원고 직접 작성·수정 및 검증·렌더 초기화                              |
| `generate`       | 콘텐츠 UUID    | 없음                                                                                                 | 등록한 근거로 AI 원고 생성 (유료)                                    |
| `verify`         | 콘텐츠 UUID    | 없음                                                                                                 | 최종 원고·게시 문구·정보 중복 검증 (유료)                            |
| `asset`          | 콘텐츠 UUID    | `revision`, `kind`, `sourceUrl`, `license`, `licenseUrl`, `credit`, `rightsConfirmed`, `aiGenerated` | 화면 자료 등록. kind: image/video                                    |
| `render`         | 콘텐츠 UUID    | 없음                                                                                                 | 검증본·권리 확인 자료로 음성·자막·영상 제작 (유료)                   |
| `upload`         | 콘텐츠 UUID    | 없음                                                                                                 | 렌더 결과를 YouTube에 비공개 업로드                                  |
| `thumbnail`      | 콘텐츠 UUID    | 없음                                                                                                 | 이미 업로드한 롱폼의 썸네일 업로드 재시도                            |
| `kling`          | 콘텐츠 UUID    | `imageUrl`, `prompt`, `rightsConfirmed: true`                                                        | 권리 확인된 이미지로 Kling 3.0 장면 요청 (유료)                      |
| `kling-status`   | 콘텐츠 UUID    | 없음                                                                                                 | 기존 공급사 작업 조회·완성 결과 GCS 보존                             |
| `sync-youtube`   | 콘텐츠 UUID    | 없음                                                                                                 | 해당 영상의 실제 공개 상태 조회·기록. 공개 전환하지 않음             |
| `recover`        | 콘텐츠 UUID    | `workerStopped: true`                                                                                | 모든 워커 종료를 확인한 뒤 중단 실행 기록 해제                       |
| `reconcile`      | 콘텐츠 UUID    | 선택 `confirmedNoUpload: true`                                                                       | 업로드 응답 유실 후 채널과 대조. 무업로드 복구는 별도 조건 충족 필요 |
| `settle`         | 없음           | `operationKey`, `providerChecked: true`, `dollars`                                                   | 공급사에서 확인한 실제 과금으로 비용 예약 정산                       |

`publish`, `approve`, `reopen`은 지원하지 않습니다. 검수·공개·예약 게시·성과 확인은 YouTube Studio에서 합니다. 전체 업로드 상태 조회는 `operation=sync-youtube` 또는 로컬 `--sync-youtube`로 실행할 수 있습니다.

## 제작 예시

아래 텍스트·URL은 입력 형식 예시입니다. 실제 확인한 자료로 바꿔야 합니다.

### 사건

```json
{
  "command": "case",
  "data": {
    "name": "직접 조사한 사건명",
    "date": "사건 시기",
    "location": "장소",
    "aliases": [],
    "externalIds": []
  }
}
```

### 원문과 주장

```json
{
  "command": "source",
  "id": "사건 UUID",
  "data": {
    "title": "자료 제목",
    "url": "https://example.org/original-record",
    "kind": "primary",
    "text": "직접 확인한 원문 발췌"
  }
}
```

```json
{
  "command": "claim",
  "id": "사건 UUID",
  "data": {
    "text": "근거로 확인한 주장 한 문장",
    "classification": "Reported",
    "sourceId": "근거 ID",
    "quote": "직접 확인한 원문 발췌"
  }
}
```

`quote`는 등록한 원문에 실제로 있어야 합니다. `Fact`, `Reported`, `Hypothesis`, `Unverified`를 구분하며 `Unverified`는 사실 중심 핵심 주장으로 예약할 수 없습니다.

### 예약과 원고 생성

```json
{
  "command": "reserve",
  "data": {
    "caseId": "사건 UUID",
    "format": "shorts",
    "angleId": "마지막 기록에 초점",
    "coreClaimIds": ["주장 ID"]
  }
}
```

`format`은 `shorts` 또는 `longform`입니다. 파생 Shorts는 `derivedFromId`에 상위 롱폼 콘텐츠 UUID와 그보다 좁은 주장 범위를 연결합니다. 업데이트 판본은 `editionId`, `updateReason`, `updateApproved: true`와 새 공식·1차 자료의 주장이 필요합니다. 이름만 바꾼 재제작은 차단합니다.

```json
{ "command": "generate", "id": "콘텐츠 UUID" }
```

생성 후 `status`에서 원고·메타데이터와 최신 revision을 확인합니다. 고칠 때는 `draft`에 전체 문구와 revision을 보냅니다. 한 명령의 실패·진행 상태는 Actions 실행 결과와 DB 실행 기록으로 확인합니다.

### 자료 등록과 제작

```json
{
  "command": "asset",
  "id": "콘텐츠 UUID",
  "data": {
    "revision": 2,
    "kind": "image",
    "sourceUrl": "https://upload.wikimedia.org/실제-이미지-경로.jpg",
    "license": "실제 라이선스",
    "licenseUrl": "https://example.org/실제-권리-확인-페이지",
    "credit": "실제 저자·원본 페이지·라이선스가 요구하는 표시",
    "rightsConfirmed": true,
    "aiGenerated": false
  }
}
```

파일 다운로드는 Wikimedia·Pexels·fal·Google Storage CDN으로 제한합니다. 원본 페이지와 저자 링크 등 필요한 출처를 크레딧에 기록하세요. 서명된 다운로드 URL은 공개 크레딧으로 복사하지 않습니다.

자료를 바꾸려면 같은 data에 `replaceId`, 지우려면 `revision`과 `removeId`를 보냅니다. 자료를 교체하면 관련 렌더를 다시 만들어야 합니다. `kling-status`가 등록한 생성 결과는 아직 권리 미확인 상태이므로 해당 자료 ID를 `replaceId`로 지정해 권리·라이선스·AI 표시를 확정합니다. 같은 AI 파일의 AI 표시를 해제할 수 없습니다.

이후 `operation=produce` 또는 `verify` → `render` → `upload` 요청으로 비공개 업로드까지 진행합니다. 예산·검증·권리·동시 작업 검사에 실패하면 중단합니다. 롱폼 썸네일은 업로드 후 자동 등록하며 실패한 경우 `thumbnail`로 재시도합니다.

## 복구 예시

```json
{ "command": "recover", "id": "콘텐츠 UUID", "data": { "workerStopped": true } }
```

```json
{ "command": "reconcile", "id": "콘텐츠 UUID" }
```

첫 요청 후 최소 1시간이 지났고 모든 워커가 종료되었으며 실제 업로드가 없는 것을 확인했을 때만 `data: { "confirmedNoUpload": true }`를 사용할 수 있습니다. 서버도 목록을 재조회합니다. 이 확인 없이 재업로드하지 않습니다.

```json
{
  "command": "settle",
  "data": {
    "operationKey": "비용 작업 키",
    "providerChecked": true,
    "dollars": 0.42
  }
}
```

0달러 해제는 공급사에서 작업 종료와 미과금을 확인한 경우에만 사용합니다. 유료 요청 결과가 불명확하면 비용 예약을 유지합니다. 같은 요청을 다시 보내는 것으로 복구하지 않습니다.
