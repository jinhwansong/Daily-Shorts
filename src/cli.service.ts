import { Injectable } from "@nestjs/common";
import { ProductionService } from "./production.service";
import { RequestService } from "./request.service";
import { readFile, stat } from "node:fs/promises";

export const USAGE = `Noctivault worker (NestJS)
  --dry-run [--genre=mystery]
  --run-once [--genre=mystery]
  --run-daily [--genre=mystery] [--count=5]
  --longform-phase1 [--genre=mystery-long]
  --longform-phase2
  --sync-youtube
  --request=<JSON file>   status/case/source/claim/reserve/draft/asset/recover/settle/history-import/history-map
                         generate/verify/render/upload/thumbnail/reconcile/kling/kling-status/sync-youtube
  --help`;

@Injectable()
export class CliService {
  constructor(
    private readonly production: ProductionService,
    private readonly requests: RequestService,
  ) {}

  async run(args: string[]) {
    if (!args.length || (args.length === 1 && args[0] === "--help")) {
      console.log(USAGE);
      return;
    }
    if (args[0]?.startsWith("--request=")) {
      if (args.length !== 1)
        throw new Error("--request는 다른 명령과 함께 사용할 수 없습니다.");
      const filename = args[0].slice("--request=".length);
      if (!filename || (await stat(filename)).size > 512 * 1024)
        throw new Error("512KB 이하의 JSON 요청 파일이 필요합니다.");
      let request: unknown;
      try {
        request = JSON.parse(
          (await readFile(filename, "utf8")).replace(/^\uFEFF/, ""),
        );
      } catch {
        throw new Error("요청 파일이 유효한 JSON이 아닙니다.");
      }
      const result = await this.requests.execute(request);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    const commands = [
      "--dry-run",
      "--run-once",
      "--run-daily",
      "--longform-phase1",
      "--longform-phase2",
      "--sync-youtube",
    ];
    const unknown = args.find(
      (arg) =>
        !commands.includes(arg) &&
        !arg.startsWith("--genre=") &&
        !arg.startsWith("--count="),
    );
    if (unknown) throw new Error(`Unknown command: ${unknown}`);
    const selected = commands.filter((command) => args.includes(command));
    if (selected.length !== 1)
      throw new Error("Choose exactly one worker command.");
    const command = selected[0];
    const genre =
      args.find((arg) => arg.startsWith("--genre="))?.slice(8) ||
      (command === "--longform-phase1" ? "mystery-long" : "mystery");
    if (!["mystery", "mystery-long"].includes(genre))
      throw new Error(`Unknown genre: ${genre}`);
    const countValue =
      args.find((arg) => arg.startsWith("--count="))?.slice(8) ||
      process.env.DAILY_UPLOAD_COUNT ||
      "1";
    if (
      !/^\d+$/.test(countValue) ||
      !Number.isSafeInteger(Number(countValue)) ||
      Number(countValue) < 1
    ) {
      throw new Error("--count must be a positive integer.");
    }
    switch (command) {
      case "--dry-run":
        return this.production.dryRun(genre);
      case "--run-once":
        return this.production.runBatch(genre, 1);
      case "--run-daily":
        return this.production.runBatch(genre, Number(countValue));
      case "--longform-phase1":
        return this.production.phase1(genre);
      case "--longform-phase2":
        return this.production.phase2();
      case "--sync-youtube": {
        const result = await this.production.syncYoutube();
        console.log(JSON.stringify(result, null, 2));
        return result;
      }
    }
  }
}
