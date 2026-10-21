import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { google } from "googleapis";
import { createReadStream } from "node:fs";
import { StoreService } from "./store.service";
import { MediaService, fileHash } from "./media.service";
import { documentHash, evidenceFailures, selectedClaims } from "./policy";
import type { CaseRecord, ContentRecord } from "./models";

@Injectable()
export class PublishingService {
  constructor(
    private readonly store: StoreService,
    private readonly media: MediaService,
  ) {}

  auth() {
    if (
      !process.env.YOUTUBE_CLIENT_ID ||
      !process.env.YOUTUBE_CLIENT_SECRET ||
      !process.env.YOUTUBE_REFRESH_TOKEN_MYSTERY
    )
      throw new ServiceUnavailableException("YouTube OAuth 설정이 필요합니다.");
    const auth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
    );
    auth.setCredentials({
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN_MYSTERY,
    });
    return auth;
  }

  client() {
    return google.youtube({ version: "v3", auth: this.auth() });
  }

  async upload(initial: ContentRecord, record: CaseRecord) {
    if (initial.youtubeId)
      throw new ConflictException("이미 업로드된 영상입니다.");
    const failures = evidenceFailures(
      selectedClaims(initial, record),
      record.sources,
    );
    if (
      !initial.verification?.passed ||
      initial.verification.hash !== documentHash(initial) ||
      initial.renderInputHash !== documentHash(initial)
    )
      failures.push("검증 원고와 렌더가 일치하지 않습니다.");
    if (
      !initial.assets.length ||
      initial.assets.some(
        (asset) => !asset.rightsConfirmed || !asset.licenseUrl,
      )
    )
      failures.push("자산 사용 권리를 확인하세요.");
    if (failures.length) throw new ConflictException(failures);
    const youtube = this.client(),
      filename = await this.media.restore(initial, "final.mp4");
    if ((await fileHash(filename)) !== initial.renderHash)
      throw new ConflictException("저장된 영상 파일이 승인 대상과 다릅니다.");
    const description = this.uploadDescription(initial);
    if (Buffer.byteLength(description) > 5000 || /[<>]/.test(initial.title))
      throw new BadRequestException(
        "YouTube 설명은 출처·크레딧을 포함해 5,000바이트 이하여야 하며 제목에 < >를 사용할 수 없습니다.",
      );
    let content = await this.store.saveContent({
      ...initial,
      status: "uploading",
      currentStep: "upload",
      uploadedAt: new Date().toISOString(),
    });
    const response = await youtube.videos.insert(
      {
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: content.title,
            description,
            defaultLanguage: "en",
            categoryId: "27",
          },
          status: { ...this.videoStatus(content) },
        },
        media: { body: createReadStream(filename) },
      },
      { retry: false, timeout: 1800000 },
    );
    if (!response.data.id)
      throw new BadRequestException(
        "업로드 결과 ID가 없습니다. 재업로드하지 말고 결과를 대조하세요.",
      );
    content = await this.store.saveContent({
      ...content,
      youtubeId: response.data.id,
      status: "uploaded_private",
      currentStep: undefined,
    });
    if (content.format === "longform") content = await this.thumbnail(content);
    return content;
  }

  async thumbnail(content: ContentRecord) {
    if (!content.youtubeId || !content.thumbnailHash)
      throw new ConflictException(
        "비공개 영상과 생성된 롱폼 썸네일이 필요합니다.",
      );
    const filename = await this.media.restore(content, "thumbnail.jpg");
    if ((await fileHash(filename)) !== content.thumbnailHash)
      throw new ConflictException("썸네일 파일이 변경되었습니다.");
    await this.client().thumbnails.set(
      {
        videoId: content.youtubeId,
        media: { body: createReadStream(filename) },
      },
      { retry: false, timeout: 60000 },
    );
    return this.store.saveContent({
      ...content,
      thumbnailUploaded: true,
      error: undefined,
    });
  }

  async syncStatus(content: ContentRecord) {
    if (!content.youtubeId)
      throw new ConflictException("YouTube 영상 ID가 없습니다.");
    const { data } = await this.client().videos.list({
      part: ["snippet", "status"],
      id: [content.youtubeId],
    });
    const video = data.items?.[0];
    if (!video?.snippet?.description?.includes(`[Noctivault:${content.id}]`))
      throw new ConflictException(
        "YouTube 영상이 없거나 콘텐츠 식별자가 일치하지 않습니다.",
      );
    const visibility = video.status?.privacyStatus;
    if (!visibility || !["public", "private", "unlisted"].includes(visibility))
      throw new ConflictException(
        "YouTube 영상 공개 상태를 확인하지 못했습니다.",
      );
    const published =
      visibility === "public" ||
      content.status === "published" ||
      Boolean(content.publishedAt);
    return this.store.saveContent({
      ...content,
      status: published ? "published" : "uploaded_private",
      ...(published
        ? { publishedAt: content.publishedAt || new Date().toISOString() }
        : {}),
      youtubeVisibility: visibility,
      youtubeSyncedAt: new Date().toISOString(),
      error: undefined,
      currentStep: undefined,
    });
  }

  async reconcile(content: ContentRecord, input: Record<string, unknown>) {
    const youtube = this.client();
    if (content.youtubeId) return this.syncStatus(content);
    const channel = await youtube.channels.list({
      part: ["contentDetails"],
      mine: true,
    });
    const playlistId =
      channel.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlistId)
      throw new ConflictException("채널 업로드 목록을 확인하지 못했습니다.");
    let pageToken: string | undefined;
    const matches: string[] = [];
    do {
      const page = await youtube.playlistItems.list({
        part: ["contentDetails"],
        playlistId,
        maxResults: 50,
        pageToken,
      });
      const ids = (page.data.items || [])
        .map((item) => item.contentDetails?.videoId)
        .filter((value): value is string => Boolean(value));
      if (ids.length) {
        const videos = await youtube.videos.list({
          part: ["snippet", "status"],
          id: ids,
        });
        for (const video of videos.data.items || [])
          if (
            video.snippet?.description?.includes(
              `[Noctivault:${content.id}]`,
            ) &&
            video.id
          ) {
            matches.push(video.id);
          }
      }
      pageToken = page.data.nextPageToken || undefined;
    } while (pageToken);
    if (
      !matches.length &&
      input.confirmedNoUpload === true &&
      content.currentStep === "upload" &&
      content.uploadedAt &&
      Date.now() - Date.parse(content.uploadedAt) >= 3600000
    ) {
      return this.store.saveContent({
        ...content,
        status: "rendered",
        noUploadConfirmedAt: new Date().toISOString(),
        currentStep: undefined,
        error: undefined,
      });
    }
    if (matches.length !== 1)
      throw new ConflictException(
        `일치 영상 ${matches.length}건. 원격 확인 전 재업로드를 차단합니다.`,
      );
    return this.syncStatus({ ...content, youtubeId: matches[0] });
  }

  private uploadDescription(content: ContentRecord) {
    const credits = content.assets
      .map(
        (asset) =>
          `${asset.credit || asset.kind}\nLicense: ${asset.licenseUrl}`,
      )
      .join("\n");
    // Signed download URLs stay in the private asset registry, never in public credits.
    return `${content.description}\n\n${credits}\nNarration uses an AI-generated voice.\n[Noctivault:${content.id}]`;
  }

  private videoStatus(content: ContentRecord) {
    return {
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: content.assets.some((asset) => asset.aiGenerated),
    };
  }
}
