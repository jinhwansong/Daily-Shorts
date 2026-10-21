import { Module } from "@nestjs/common";
import { CliService } from "./cli.service";
import { RequestService } from "./request.service";
import { ProductionService } from "./production.service";
import { StoreService } from "./vault/store.service";
import { AiService } from "./vault/ai.service";
import { KlingService } from "./vault/kling.service";
import { MediaService } from "./vault/media.service";
import { PublishingService } from "./vault/publishing.service";
import { OperationsService } from "./vault/operations.service";
import { HistoryService } from "./vault/history.service";

@Module({
  providers: [
    ProductionService,
    CliService,
    RequestService,
    StoreService,
    AiService,
    KlingService,
    MediaService,
    PublishingService,
    OperationsService,
    HistoryService,
  ],
})
export class AppModule {}
