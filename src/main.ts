import "reflect-metadata";
import path from "node:path";
import { config } from "dotenv";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { CliService } from "./cli.service";
import { HttpException } from "@nestjs/common";

export async function bootstrap(args = process.argv.slice(2)) {
  if (process.env.NODE_ENV !== "test")
    config({
      path: path.resolve(__dirname, "../.env"),
      quiet: true,
    } as Parameters<typeof config>[0]);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
    abortOnError: false,
  });
  try {
    return await app.get(CliService).run(args);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error(
      error instanceof HttpException
        ? JSON.stringify(error.getResponse())
        : error instanceof Error
          ? error.message
          : String(error),
    );
    process.exitCode = 1;
  });
}
