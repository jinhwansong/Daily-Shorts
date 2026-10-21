import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { StoreService } from "./store.service";
import { AiService } from "./ai.service";
import { KlingService } from "./kling.service";
import { MediaService } from "./media.service";
import { PublishingService } from "./publishing.service";
import type {
  CaseRecord,
  Claim,
  ContentRecord,
  EvidenceSource,
} from "./models";
import {
  canonicalKey,
  claimKey,
  documentHash,
  evidenceFailures,
  isDuplicate,
  normalizeKey,
  selectedClaims,
} from "./policy";
import { httpsUrl, object, strings, text } from "./input";

@Injectable()
export class OperationsService {
  private readonly active = new Map<string, Promise<unknown>>();
  constructor(
    private readonly store: StoreService,
    private readonly ai: AiService,
    private readonly kling: KlingService,
    private readonly media: MediaService,
    private readonly publishing: PublishingService,
  ) {}

  async createCase(input: unknown) {
    const body = object(input),
      name = text(body.name, "사건명", 200),
      date = text(body.date, "사건 시기", 80),
      location = text(body.location, "장소", 200);
    const aliases = strings(body.aliases || [], "별칭"),
      externalIds = strings(body.externalIds || [], "외부 ID");
    const cases = await this.store.cases();
    const key = canonicalKey(name, date, location);
    const existing = cases.find(
      (item) =>
        item.canonicalKey === key ||
        externalIds.some((value) => item.externalIds.includes(value)) ||
        (normalizeKey(item.date) === normalizeKey(date) &&
          normalizeKey(item.location) === normalizeKey(location) &&
          [item.name, ...item.aliases].some((value) =>
            [name, ...aliases].some(
              (next) => normalizeKey(value) === normalizeKey(next),
            ),
          )),
    );
    if (existing)
      return this.store.saveCase(
        {
          ...existing,
          aliases: [
            ...new Set([
              ...existing.aliases,
              ...aliases,
              ...(normalizeKey(name) !== normalizeKey(existing.name)
                ? [name]
                : []),
            ]),
          ],
          externalIds: [...new Set([...existing.externalIds, ...externalIds])],
        },
        existing,
      );
    const record: CaseRecord = {
      id: randomUUID(),
      canonicalKey: key,
      name,
      date,
      location,
      aliases,
      externalIds,
      sources: [],
      claims: [],
      status: text(body.status || "미해결", "현재 상태", 200),
      createdAt: new Date().toISOString(),
    };
    return this.store.saveCase(record);
  }

  async addSource(caseId: string, input: unknown) {
    const body = object(input),
      record = await this.store.case(caseId);
    const kind = text(body.kind, "출처 유형", 20) as EvidenceSource["kind"];
    if (!["official", "primary", "report", "reference"].includes(kind))
      throw new BadRequestException("출처 유형이 올바르지 않습니다.");
    const source: EvidenceSource = {
      id: randomUUID(),
      url: httpsUrl(body.url, "출처 URL"),
      title: text(body.title, "자료명", 300),
      text: text(body.text, "원문 발췌", 60000),
      verifiedAt: new Date().toISOString(),
      kind,
    };
    if (
      record.sources.some(
        (item) => item.url === source.url && item.text === source.text,
      )
    )
      return record;
    return this.store.saveCase(
      { ...record, sources: [...record.sources, source] },
      record,
    );
  }

  async addClaim(caseId: string, input: unknown) {
    const body = object(input),
      record = await this.store.case(caseId);
    const claimText = text(body.text, "주장", 2000),
      sourceId = text(body.sourceId, "근거 자료", 36);
    const classification = text(
      body.classification,
      "주장 구분",
      20,
    ) as Claim["classification"];
    if (
      !["Fact", "Reported", "Hypothesis", "Unverified"].includes(classification)
    )
      throw new BadRequestException("주장 구분이 올바르지 않습니다.");
    const claim: Claim = {
      id: claimKey(claimText),
      text: claimText,
      sourceId,
      classification,
      quote: text(body.quote, "원문 근거 문장", 12000),
    };
    const failures = evidenceFailures([claim], record.sources);
    if (failures.length) throw new BadRequestException(failures);
    if (record.claims.some((item) => item.id === claim.id)) return record;
    return this.store.saveCase(
      { ...record, claims: [...record.claims, claim] },
      record,
    );
  }

  async reserve(input: unknown) {
    if (!(await this.store.historyReady()))
      throw new ConflictException(
        "운영 시작 전 기존 DB와 YouTube 이력을 먼저 가져오세요.",
      );
    const history = await this.store.history();
    if (history.some((item) => !item.mappedContent && !item.ignoredReason))
      throw new ConflictException(
        "가져온 과거 발행 이력을 먼저 사건·주장에 연결하세요. 중복 여부가 불명확하면 제작을 중단합니다.",
      );
    const body = object(input),
      record = await this.store.case(text(body.caseId, "사건 ID", 36));
    if (record.legacyReviewRequired)
      throw new ConflictException(
        "과거 발행 이력을 검토해야 하는 사건입니다. 이력 검토 후 진행하세요.",
      );
    const format = text(body.format, "형식", 20);
    if (!["shorts", "longform"].includes(format))
      throw new BadRequestException(
        "형식은 shorts 또는 longform이어야 합니다.",
      );
    const coreClaimIds = strings(body.coreClaimIds, "핵심 주장");
    const editionId = text(body.editionId || "original", "판본", 120);
    const previous = (await this.store.previousContents()).filter(
      (item) => item.caseId === record.id,
    );
    if (
      format === "longform" &&
      editionId === "original" &&
      previous.some(
        (item) => item.format === "longform" && item.editionId === "original",
      )
    )
      throw new ConflictException(
        "이 사건의 기본 롱폼이 이미 있습니다. 새 공식 정보는 승인된 업데이트 판본으로 다루세요.",
      );
    if (
      editionId !== "original" &&
      (!text(body.updateReason, "새 공식 정보와 업데이트 이유", 2000) ||
        coreClaimIds.every((key) =>
          previous.some((item) => item.coreClaimIds.includes(key)),
        ))
    )
      throw new ConflictException(
        "업데이트에는 새로운 검증 주장과 이유가 필요합니다.",
      );
    const now = new Date().toISOString();
    const content: ContentRecord = {
      id: randomUUID(),
      caseId: record.id,
      format: format as ContentRecord["format"],
      angleId: normalizeKey(text(body.angleId, "핵심 관점", 160)),
      editionId,
      coreClaimIds,
      ...(body.derivedFromId
        ? { derivedFromId: text(body.derivedFromId, "상위 영상 ID", 36) }
        : {}),
      ...(editionId !== "original"
        ? { updateReason: body.updateReason as string }
        : {}),
      script: "",
      title: record.name,
      description: "",
      thumbnailText: "",
      assets: [],
      assetIds: [],
      status: "reserved",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const failures = evidenceFailures(
      selectedClaims(content, record),
      record.sources,
    );
    if (failures.length) throw new BadRequestException(failures);
    if (editionId !== "original") {
      if (body.updateApproved !== true)
        throw new BadRequestException(
          "업데이트의 새 정보와 제작 필요성을 직접 확인하세요.",
        );
      const fresh = selectedClaims(content, record).filter(
        (claim) =>
          !previous.some((item) => item.coreClaimIds.includes(claim.id)),
      );
      if (
        !fresh.some((claim) =>
          ["official", "primary"].includes(
            record.sources.find((source) => source.id === claim.sourceId)
              ?.kind || "",
          ),
        )
      )
        throw new ConflictException(
          "새 공식 기록 또는 1차 자료에 근거한 추가 주장이 필요합니다.",
        );
    }
    if (previous.some((item) => isDuplicate(item, content)))
      throw new ConflictException(
        "같은 핵심 정보를 다룬 콘텐츠가 이미 있습니다.",
      );
    return this.store.reserve(content);
  }

  async saveDraft(contentId: string, input: unknown) {
    await this.store.assertIdle(contentId);
    const body = object(input),
      content = await this.store.content(contentId);
    if (
      !["reserved", "draft", "verified", "rendered", "failed"].includes(
        content.status,
      ) ||
      content.youtubeId
    )
      throw new ConflictException(
        "업로드 이후에는 이 원고를 변경할 수 없습니다. 업데이트 판본으로 제작하세요.",
      );
    if (body.revision !== content.revision)
      throw new ConflictException(
        "다른 작업에서 변경됐습니다. 새로고침하세요.",
      );
    return this.store.saveContent({
      ...content,
      script: text(body.script, "원고", 50000),
      title: text(body.title, "제목", 100),
      description: text(body.description, "설명", 5000),
      thumbnailText: text(body.thumbnailText, "썸네일 문구", 200),
      status: "draft",
      verification: undefined,
      renderHash: undefined,
      renderInputHash: undefined,
    });
  }

  async action(contentId: string, command: string, input: unknown = {}) {
    if (this.active.has(contentId))
      throw new ConflictException("이미 실행 중입니다.");
    const body = object(input),
      content = await this.store.content(contentId);
    const allowed: Record<string, string[]> = {
      generate: ["reserved", "draft"],
      verify: ["draft"],
      render: ["verified"],
      upload: ["rendered"],
      reconcile: ["reconciliation_required"],
      thumbnail: ["uploaded_private"],
      "sync-youtube": [
        "uploaded_private",
        "published",
        "approved",
        "publishing",
        "reconciliation_required",
      ],
      kling: ["draft", "verified"],
      "kling-status": ["draft", "verified"],
    };
    if (!allowed[command]?.includes(content.status))
      throw new ConflictException("현재 상태에서 실행할 수 없는 작업입니다.");
    const run = await this.store.run(contentId, command);
    const promise = this.store
      .withRun(run.id, async () => {
        const latest = await this.store.content(contentId);
        if (!allowed[command]?.includes(latest.status))
          throw new ConflictException("작업 시작 전에 상태가 변경되었습니다.");
        return this.perform(latest, command, body);
      })
      .then(async (result) => {
        await this.store.saveRun({
          ...run,
          status: "completed",
          message:
            result &&
            typeof result === "object" &&
            "status" in result &&
            typeof result.status === "string"
              ? result.status
              : undefined,
          finishedAt: new Date().toISOString(),
        });
        return result;
      })
      .catch(async (error) => {
        const latest = await this.store.content(contentId);
        const unclear = [
          "uploading",
          "publishing",
          "reconciliation_required",
        ].includes(latest.status);
        if (latest.status !== "reconciliation_required")
          await this.store.withRun(run.id, () =>
            this.store.saveContent({
              ...latest,
              status: unclear ? "reconciliation_required" : latest.status,
              error: error instanceof Error ? error.message : "작업 실패",
            }),
          );
        await this.store.saveRun({
          ...run,
          status: unclear ? "unknown" : "failed",
          message: error instanceof Error ? error.message : "작업 실패",
          finishedAt: new Date().toISOString(),
        });
        return error instanceof Error ? error : new Error("작업 실패");
      })
      .catch((error) => {
        console.error(
          `작업 ${run.id} 기록 실패:`,
          error instanceof Error ? error.message : "저장소 오류",
        );
        return error instanceof Error ? error : new Error("저장소 오류");
      })
      .finally(() => {
        this.active.delete(contentId);
      });
    this.active.set(contentId, promise);
    return run;
  }

  private async perform(
    content: ContentRecord,
    command: string,
    body: Record<string, unknown>,
  ) {
    const record = await this.store.case(content.caseId);
    if (command === "generate") {
      const previous = (await this.store.previousContents()).filter(
        (item) => item.id !== content.id && item.caseId === content.caseId,
      );
      await this.ai.compare(content, previous);
      const draft = await this.ai.generate(content, record);
      return this.store.saveContent({
        ...content,
        ...draft,
        status: "draft",
        error: undefined,
        verification: undefined,
      });
    }
    if (command === "verify") {
      await this.ai.compare(
        content,
        (await this.store.previousContents()).filter(
          (item) => item.id !== content.id && item.caseId === content.caseId,
        ),
      );
      const verification = await this.ai.verify(content, record);
      return this.store.saveContent({
        ...content,
        verification,
        status: verification.passed ? "verified" : "draft",
        error: verification.passed
          ? undefined
          : verification.failures.join("\n"),
      });
    }
    if (command === "render") return this.media.render(content, record);
    if (command === "upload") return this.publishing.upload(content, record);
    if (command === "sync-youtube") return this.publishing.syncStatus(content);
    if (command === "thumbnail") return this.publishing.thumbnail(content);
    if (command === "reconcile")
      return this.publishing.reconcile(content, body);
    if (command === "kling") {
      if (body.rightsConfirmed !== true)
        throw new BadRequestException("입력 이미지 사용 권한을 확인하세요.");
      return this.kling.submit(
        content,
        httpsUrl(body.imageUrl, "입력 이미지"),
        text(body.prompt, "장면 설명", 2500),
      );
    }
    if (command === "kling-status") {
      const result = await this.kling.status(content);
      if (
        result.videoUrl &&
        !content.assets.some(
          (asset) => asset.providerTaskId === result.requestId,
        )
      ) {
        const assetId = randomUUID();
        const storageKey = await this.media.captureKling(
          content,
          assetId,
          result.videoUrl,
        );
        const asset = {
          id: assetId,
          providerTaskId: result.requestId,
          storageKey,
          contentId: content.id,
          kind: "video" as const,
          sourceUrl: result.videoUrl,
          license: "fal Kling 3.0 commercial output; operator review required",
          licenseUrl: "https://fal.ai/terms",
          credit: "AI reenactment — Kling VIDEO 3.0",
          aiGenerated: true,
          rightsConfirmed: false,
        };
        await this.store.saveContent({
          ...content,
          assets: [...content.assets, asset],
          assetIds: [...content.assetIds, asset.id],
        });
      }
      return result;
    }
  }

  async waitForContent(contentId: string) {
    const result = await this.active.get(contentId);
    if (result instanceof Error) throw result;
    return this.store.content(contentId);
  }

  async asset(contentId: string, input: unknown) {
    await this.store.assertIdle(contentId);
    const body = object(input),
      content = await this.store.content(contentId);
    if (!["draft", "verified", "rendered"].includes(content.status))
      throw new ConflictException("원고 단계에서 자료를 등록하세요.");
    if (body.revision !== content.revision)
      throw new ConflictException("자료가 변경되었습니다. 새로고침하세요.");
    if (body.removeId) {
      if (!content.assets.some((item) => item.id === body.removeId))
        throw new BadRequestException("삭제할 자료가 없습니다.");
      const assets = content.assets.filter((item) => item.id !== body.removeId);
      return this.store.saveContent({
        ...content,
        assets,
        assetIds: assets.map((item) => item.id),
        status: content.status === "rendered" ? "verified" : content.status,
        renderHash: undefined,
        renderInputHash: undefined,
      });
    }
    const kind = text(body.kind, "자료 유형", 20);
    if (!["image", "video"].includes(kind))
      throw new BadRequestException(
        "사진·지도·문서 이미지는 image, 영상은 video를 선택하세요.",
      );
    if (body.rightsConfirmed !== true || typeof body.aiGenerated !== "boolean")
      throw new BadRequestException("사용 권리와 AI 생성 여부를 확인하세요.");
    const previous = content.assets.find((item) => item.id === body.replaceId);
    const sameFile =
      previous?.sourceUrl === body.sourceUrl && previous?.kind === kind;
    if (sameFile && previous.aiGenerated && body.aiGenerated !== true)
      throw new BadRequestException("AI 재현 자료의 AI 표시를 유지하세요.");
    const asset = {
      ...(sameFile ? previous : {}),
      id: sameFile ? previous!.id : randomUUID(),
      contentId,
      kind: kind as "image" | "video",
      sourceUrl: httpsUrl(body.sourceUrl, "자료 URL"),
      license: text(body.license, "라이선스", 300),
      licenseUrl: httpsUrl(body.licenseUrl, "라이선스 URL"),
      credit: text(body.credit, "크레딧", 500),
      rightsConfirmed: true,
      aiGenerated: body.aiGenerated,
    };
    const assets = body.replaceId
      ? content.assets.map((old) => (old.id === body.replaceId ? asset : old))
      : [...content.assets, asset];
    if (
      body.replaceId &&
      !content.assets.some((old) => old.id === body.replaceId)
    )
      throw new BadRequestException("교체할 자료가 없습니다.");
    return this.store.saveContent({
      ...content,
      assets,
      assetIds: assets.map((item) => item.id),
      status: content.status === "rendered" ? "verified" : content.status,
      renderHash: undefined,
      renderInputHash: undefined,
    });
  }

  async recover(contentId: string, input: unknown) {
    const body = object(input);
    if (this.active.has(contentId) || body.workerStopped !== true)
      throw new ConflictException(
        "해당 작업을 실행하던 모든 워커가 종료되었는지 확인하세요.",
      );
    const content = await this.store.content(contentId),
      runs = (await this.store.runs()).filter(
        (run) => run.contentId === contentId && run.status === "running",
      );
    for (const run of runs)
      await this.store.saveRun({
        ...run,
        status: "unknown",
        message: "운영자가 워커 종료 확인. 비용·YouTube 결과 대조 필요.",
        finishedAt: new Date().toISOString(),
      });
    if (["uploading", "publishing"].includes(content.status))
      return this.store.saveContent({
        ...content,
        status: "reconciliation_required",
        error: "업로드/공개 결과 대조가 필요합니다.",
      });
    return content;
  }

  async settle(input: unknown) {
    const body = object(input),
      key = text(body.operationKey, "비용 작업 키", 240);
    if (body.providerChecked !== true || typeof body.dollars !== "number")
      throw new BadRequestException(
        "공급자 청구 확인과 실제 비용을 입력하세요.",
      );
    const entry = (await this.store.budgets()).find(
      (item) => item.operation_key === key,
    );
    if (!entry) throw new BadRequestException("비용 예약을 찾을 수 없습니다.");
    await this.store.assertIdle(entry.content_id);
    await this.store.settleCost(key, body.dollars, body.dollars === 0);
    return { saved: true };
  }
}
