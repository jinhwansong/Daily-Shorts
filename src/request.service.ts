import { BadRequestException, Injectable } from "@nestjs/common";
import { OperationsService } from "./vault/operations.service";
import { StoreService } from "./vault/store.service";
import { HistoryService } from "./vault/history.service";
import { object, text } from "./vault/input";

@Injectable()
export class RequestService {
  constructor(
    private readonly operations: OperationsService,
    private readonly store: StoreService,
    private readonly history: HistoryService,
  ) {}

  async execute(input: unknown): Promise<unknown> {
    const request = object(input);
    const command = text(request.command, "command", 40);
    const data = object(request.data ?? {});
    const id = () => {
      const value = text(request.id, "대상 UUID", 36);
      if (
        !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
          value,
        )
      )
        throw new BadRequestException("대상 id는 UUID여야 합니다.");
      return value;
    };
    switch (command) {
      case "status": {
        const [cases, contents, budgets, runs, history] = await Promise.all([
          this.store.cases(),
          this.store.contents(),
          this.store.budgets(),
          this.store.runs(),
          this.store.history(),
        ]);
        return { cases, contents, budgets, runs, history };
      }
      case "case":
        return this.operations.createCase(data);
      case "source":
        return this.operations.addSource(id(), data);
      case "claim":
        return this.operations.addClaim(id(), data);
      case "reserve":
        return this.operations.reserve(data);
      case "draft":
        return this.operations.saveDraft(id(), data);
      case "asset":
        return this.operations.asset(id(), data);
      case "recover":
        return this.operations.recover(id(), data);
      case "settle":
        return this.operations.settle(data);
      case "history-import":
        return this.history.import();
      case "history-map":
        return this.history.map(id(), data);
      default: {
        if (
          ![
            "generate",
            "verify",
            "render",
            "upload",
            "thumbnail",
            "reconcile",
            "kling",
            "kling-status",
            "sync-youtube",
          ].includes(command)
        )
          throw new BadRequestException(
            "지원하지 않는 command입니다. 공개·검수는 YouTube Studio에서 수행하세요.",
          );
        const contentId = id();
        await this.operations.action(contentId, command, data);
        const content = await this.operations.waitForContent(contentId);
        if (content.error) throw new Error(content.error);
        return content;
      }
    }
  }
}
