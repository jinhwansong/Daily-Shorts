import { Injectable } from "@nestjs/common";
import { runDryRun } from "./vault/dry-run";
import { OperationsService } from "./vault/operations.service";
import { StoreService } from "./vault/store.service";

@Injectable()
export class ProductionService {
  constructor(
    private readonly operations: OperationsService,
    private readonly store: StoreService,
  ) {}
  dryRun(genre: string) {
    return runDryRun(genre);
  }

  async syncYoutube() {
    const contents = (await this.store.contents()).filter(
      (content) =>
        content.youtubeId &&
        [
          "uploaded_private",
          "approved",
          "publishing",
          "published",
          "reconciliation_required",
        ].includes(content.status),
    );
    const results = [];
    for (const content of contents) {
      await this.operations.action(content.id, "sync-youtube");
      const updated = await this.operations.waitForContent(content.id);
      results.push({
        id: updated.id,
        youtubeId: updated.youtubeId,
        status: updated.status,
        visibility: updated.youtubeVisibility,
      });
    }
    return results;
  }

  async runBatch(
    genre: string,
    count: number,
    phase: "all" | "script" | "media" = "all",
  ) {
    const format = genre === "mystery-long" ? "longform" : "shorts";
    const queue = (await this.store.contents())
      .filter(
        (item) =>
          item.format === format &&
          ["reserved", "draft", "verified", "rendered"].includes(item.status),
      )
      .reverse()
      .slice(0, count);
    if (!queue.length) {
      console.log(
        "제작 대기 콘텐츠가 없습니다. --request JSON 명령으로 사건·출처·주장을 등록하고 콘텐츠를 예약하세요.",
      );
      return [];
    }
    const results = [];
    for (let content of queue) {
      for (const command of ["generate", "verify", "render", "upload"]) {
        if (
          (phase === "script" && ["render", "upload"].includes(command)) ||
          (phase === "media" && ["generate", "verify"].includes(command))
        )
          continue;
        const needed = {
          generate: "reserved",
          verify: "draft",
          render: "verified",
          upload: "rendered",
        }[command];
        if (content.status !== needed) continue;
        await this.operations.action(content.id, command);
        content = await this.operations.waitForContent(content.id);
        if (content.error)
          throw new Error(`${content.title}: ${content.error}`);
      }
      results.push(content);
      console.log(`${content.id}: ${content.status}`);
      if (content.youtubeId)
        console.log(
          `YouTube: https://www.youtube.com/watch?v=${encodeURIComponent(content.youtubeId)} — 검수·공개는 YouTube Studio에서 진행하세요.`,
        );
    }
    return results;
  }

  phase1(genre: string) {
    return this.runBatch(genre, 1, "script");
  }

  phase2() {
    return this.runBatch("mystery-long", 1, "media");
  }
}
