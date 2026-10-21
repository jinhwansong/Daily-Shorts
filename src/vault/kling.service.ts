import {
  Injectable,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { StoreService } from "./store.service";
import type { ContentRecord } from "./models";
import { assetUrl } from "./download";

const ENDPOINT =
  "https://queue.fal.run/fal-ai/kling-video/v3/standard/image-to-video";

export function trustedFalUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "queue.fal.run" ||
    url.username ||
    url.password ||
    url.port
  )
    throw new BadRequestException("잘못된 fal 작업 URL입니다.");
  return url.toString();
}

@Injectable()
export class KlingService {
  constructor(private readonly store: StoreService) {}

  private async request(
    url: string,
    body?: object,
  ): Promise<Record<string, any>> {
    if (!process.env.FAL_KEY)
      throw new ServiceUnavailableException(
        "Kling 3.0 연결에 FAL_KEY가 필요합니다.",
      );
    const response = await fetch(trustedFalUrl(url), {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok)
      throw new ServiceUnavailableException(
        `Kling 공급사 응답 실패 (${response.status}). 결과 확인 전 재생성하지 마세요.`,
      );
    return response.json() as Promise<Record<string, any>>;
  }

  async submit(content: ContentRecord, imageUrl: string, prompt: string) {
    if (!process.env.FAL_KEY)
      throw new ServiceUnavailableException(
        "Kling 3.0 연결에 FAL_KEY가 필요합니다.",
      );
    assetUrl(imageUrl);
    if (!prompt.trim() || prompt.length > 2500)
      throw new BadRequestException("장면 설명을 1~2500자로 입력하세요.");
    const reservation = await this.store.reserveCost(
      content.id,
      "kling-3.0-5s",
      "video",
      0.42,
    );
    if (!reservation.created)
      throw new ConflictException(
        "Kling 작업이 이미 예약됐습니다. 기존 작업 상태를 조회하세요.",
      );
    const task = await this.request(ENDPOINT, {
      image_url: imageUrl,
      prompt,
      duration: "5",
      generate_audio: false,
    });
    if (
      typeof task.request_id !== "string" ||
      typeof task.status_url !== "string" ||
      typeof task.response_url !== "string"
    )
      throw new ServiceUnavailableException(
        "Kling 작업 응답이 불명확합니다. 예산 예약을 유지합니다.",
      );
    const statusUrl = trustedFalUrl(task.status_url),
      responseUrl = trustedFalUrl(task.response_url);
    await this.store.trackProvider(
      reservation.operation_key,
      JSON.stringify({ requestId: task.request_id, statusUrl, responseUrl }),
    );
    return { requestId: task.request_id, status: "IN_QUEUE" };
  }

  async status(content: ContentRecord) {
    const reservation = (await this.store.budgets()).find(
      (entry) =>
        entry.operation_key === `${content.id}:kling-3.0-5s` ||
        entry.operation_key.startsWith(`${content.id}:kling-3.0-5s:attempt:`),
    );
    if (!reservation?.provider_task_id)
      throw new ConflictException(
        "공급사 작업 ID가 없습니다. 결과가 불명확하므로 재생성을 차단합니다.",
      );
    const task = JSON.parse(reservation.provider_task_id) as {
      requestId: string;
      statusUrl: string;
      responseUrl: string;
    };
    const status = await this.request(task.statusUrl);
    if (status.status !== "COMPLETED")
      return { requestId: task.requestId, status: status.status };
    const result = await this.request(task.responseUrl);
    if (typeof result.video?.url !== "string")
      return {
        requestId: task.requestId,
        status: "FAILED",
        error: "사용 가능한 결과가 없습니다. 과금 내역을 확인하세요.",
      };
    if (reservation.state === "reserved")
      await this.store.settleCost(reservation.operation_key, 0.42);
    return {
      requestId: task.requestId,
      status: "COMPLETED",
      videoUrl: result.video.url as string,
    };
  }
}
