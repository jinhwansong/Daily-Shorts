import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { StoreService } from "./store.service";
import { PublishingService } from "./publishing.service";
import { object, strings, text } from "./input";
import type { ContentRecord, LegacyRecord } from "./models";
import { evidenceFailures, selectedClaims, normalizeKey } from "./policy";

@Injectable()
export class HistoryService {
  constructor(
    private readonly store: StoreService,
    private readonly publishing: PublishingService,
  ) {}

  private async save(record: LegacyRecord) {
    const { error } = await this.store.db().from("vault_legacy").upsert({
      id: record.id,
      external_key: record.externalKey,
      data: record,
    });
    if (error)
      throw new ServiceUnavailableException("과거 이력을 저장하지 못했습니다.");
    return record;
  }

  async import() {
    const known = new Map(
      (await this.store.history()).map((item) => [item.externalKey, item]),
    );
    const currentVideoIds = new Set(
      (await this.store.contents())
        .map((item) => item.youtubeId)
        .filter(Boolean),
    );
    let imported = 0;
    const add = async (
      externalKey: string,
      title: string,
      hook: string,
      thumbnail: string,
      videoId?: string,
      uploadedAt?: string,
    ) => {
      if (known.has(externalKey) || (videoId && currentVideoIds.has(videoId)))
        return;
      const record: LegacyRecord = {
        id: randomUUID(),
        externalKey,
        title,
        hook,
        thumbnail,
        videoId,
        uploadedAt,
        createdAt: new Date().toISOString(),
      };
      await this.save(record);
      known.set(externalKey, record);
      imported++;
    };
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.store
        .db()
        .from("published_topics")
        .select("*")
        .order("id")
        .range(offset, offset + 999);
      if (error?.code === "42P01" || error?.code === "PGRST205") break;
      if (error)
        throw new ServiceUnavailableException(
          "기존 published_topics 이력을 읽지 못했습니다.",
        );
      for (const row of data || [])
        await add(
          row.video_id
            ? `youtube:${row.video_id}`
            : `published_topics:${row.id}`,
          row.raw_topic || row.topic_key,
          row.hook_first_line || "",
          row.thumbnail_line || "",
          row.video_id,
          row.uploaded_at,
        );
      if (!data || data.length < 1000) break;
    }
    const youtube = this.publishing.client();
    const channel = await youtube.channels.list({
      part: ["contentDetails"],
      mine: true,
    });
    const playlistId =
      channel.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlistId)
      throw new ConflictException("YouTube 채널의 업로드 목록이 없습니다.");
    let pageToken: string | undefined;
    do {
      const page = await youtube.playlistItems.list({
        part: ["snippet", "contentDetails"],
        playlistId,
        maxResults: 50,
        pageToken,
      });
      for (const item of page.data.items || [])
        if (item.contentDetails?.videoId)
          await add(
            `youtube:${item.contentDetails.videoId}`,
            item.snippet?.title || "제목 미확인",
            "",
            "",
            item.contentDetails.videoId,
            item.contentDetails.videoPublishedAt || undefined,
          );
      pageToken = page.data.nextPageToken || undefined;
    } while (pageToken);
    const { error } = await this.store
      .db()
      .from("vault_settings")
      .upsert({
        key: "history-import",
        data: { importedAt: new Date().toISOString(), total: known.size },
      });
    if (error)
      throw new ServiceUnavailableException(
        "이력 대조 완료 상태를 저장하지 못했습니다.",
      );
    return { imported, total: known.size };
  }

  async map(id: string, input: unknown) {
    const body = object(input),
      record = (await this.store.history()).find((item) => item.id === id);
    if (!record) throw new BadRequestException("이력이 없습니다.");
    if (record.mappedContent || record.ignoredReason)
      throw new ConflictException("이미 검토한 이력입니다.");
    if (body.ignoredReason)
      return this.save({
        ...record,
        ignoredReason: text(
          body.ignoredReason,
          "이 채널과 무관한 이력의 제외 사유",
          1000,
        ),
      });
    const caseRecord = await this.store.case(text(body.caseId, "사건 ID", 36));
    const format = text(body.format, "영상 형식", 20);
    if (!["shorts", "longform"].includes(format))
      throw new BadRequestException("영상 형식을 확인하세요.");
    const mappedContent: ContentRecord = {
      id,
      caseId: caseRecord.id,
      format: format as ContentRecord["format"],
      angleId: normalizeKey(text(body.angleId, "과거 영상의 핵심 관점", 160)),
      editionId: "original",
      coreClaimIds: strings(body.coreClaimIds, "과거 영상의 핵심 주장"),
      script: record.hook,
      title: record.title,
      description: "",
      thumbnailText: record.thumbnail,
      status: "published",
      revision: 1,
      assets: [],
      assetIds: [],
      youtubeId: record.videoId,
      publishedAt: record.uploadedAt,
      imported: true,
      createdAt: record.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const failures = evidenceFailures(
      selectedClaims(mappedContent, caseRecord),
      caseRecord.sources,
    );
    if (failures.length) throw new BadRequestException(failures);
    return this.save({ ...record, mappedContent });
  }
}
