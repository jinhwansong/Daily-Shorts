import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import OpenAI from "openai";
import { Storage } from "@google-cloud/storage";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { StoreService } from "./store.service";
import {
  documentHash,
  evidenceFailures,
  selectedClaims,
  fingerprint,
} from "./policy";
import { downloadAsset } from "./download";
import type { CaseRecord, ContentRecord } from "./models";
import { splitTextForTts, srtToAss } from "./media.utils";

const exec = promisify(execFile);
const ROOT = path.resolve(__dirname, "../..");
const AUDIO_PROFILE = {
  model: "tts-1" as const,
  voice: "onyx" as const,
  speed: 0.92,
};

export async function fileHash(filename: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

@Injectable()
export class MediaService {
  constructor(private readonly store: StoreService) {}

  directory(contentId: string) {
    return path.join(ROOT, "output", `vault_${contentId}`);
  }

  async captureKling(content: ContentRecord, assetId: string, url: string) {
    this.bucket();
    const filename = `${assetId}.mp4`;
    await fs.mkdir(this.directory(content.id), { recursive: true });
    await downloadAsset(
      url,
      path.join(this.directory(content.id), filename),
      "video",
    );
    await this.backup(content, [filename]);
    return `noctivault/${content.id}/${filename}`;
  }

  private bucket() {
    if (!process.env.GCS_BUCKET)
      throw new ServiceUnavailableException(
        "재개 파일 보존을 위한 GCS_BUCKET 설정이 필요합니다.",
      );
    return new Storage(
      process.env.GOOGLE_CLOUD_SA_JSON_PATH
        ? { keyFilename: process.env.GOOGLE_CLOUD_SA_JSON_PATH }
        : {},
    ).bucket(process.env.GCS_BUCKET);
  }

  async backup(content: ContentRecord, filenames: string[]) {
    const bucket = this.bucket();
    for (const filename of filenames)
      await bucket.upload(path.join(this.directory(content.id), filename), {
        destination: `noctivault/${content.id}/${filename}`,
        resumable: false,
      });
  }

  async restore(content: ContentRecord, filename: string) {
    const local = path.join(this.directory(content.id), filename);
    try {
      await fs.access(local);
      return local;
    } catch {}
    await fs.mkdir(this.directory(content.id), { recursive: true });
    await this.bucket()
      .file(`noctivault/${content.id}/${filename}`)
      .download({ destination: local });
    return local;
  }

  private async duration(filename: string) {
    const { stdout } = await exec(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        filename,
      ],
      { timeout: 30000 },
    );
    const seconds = Number(stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0)
      throw new BadRequestException(
        "유효한 미디어 길이를 확인하지 못했습니다.",
      );
    return seconds;
  }

  async render(initial: ContentRecord, record: CaseRecord) {
    const inputHash = documentHash(initial);
    if (
      !initial.verification?.passed ||
      initial.verification.hash !== documentHash(initial)
    )
      throw new ConflictException("최종 원고 검증이 필요합니다.");
    const failures = evidenceFailures(
      selectedClaims(initial, record),
      record.sources,
    );
    if (failures.length) throw new BadRequestException(failures);
    if (
      !initial.assets.some(
        (asset) => asset.kind === "video" || asset.kind === "image",
      ) ||
      initial.assets.some(
        (asset) =>
          !asset.rightsConfirmed || !asset.license || !asset.licenseUrl,
      )
    )
      throw new BadRequestException("권리가 확인된 화면 자료를 등록하세요.");
    if (!process.env.OPENAI_API_KEY)
      throw new ServiceUnavailableException(
        "OPENAI_API_KEY 설정이 필요합니다.",
      );
    await exec("ffmpeg", ["-version"], { timeout: 5000 });
    await exec("ffprobe", ["-version"], { timeout: 5000 });
    await this.bucket().getMetadata();
    const directory = this.directory(initial.id);
    await fs.mkdir(directory, { recursive: true });
    let content = await this.store.saveContent({
      ...initial,
      currentStep: "render",
      outputDir: directory,
      storagePrefix: `noctivault/${initial.id}/`,
      error: undefined,
    });
    await fs.writeFile(path.join(directory, "script.txt"), content.script);
    await fs.writeFile(
      path.join(directory, "metadata.json"),
      JSON.stringify({
        title: content.title,
        description: content.description,
        thumbnailText: content.thumbnailText,
      }),
    );
    await this.backup(content, ["script.txt", "metadata.json"]);

    const spoken = content.script.replace(/^\[[A-Z_]+\]\s*/gm, "").trim();
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: 120000,
    });
    const audioPath = path.join(directory, "audio.mp3");
    const audioManifest = path.join(directory, "audio-manifest.json");
    let audioReady = false;
    try {
      await this.restore(content, "audio-manifest.json");
      await this.restore(content, "audio.mp3");
      const manifest = JSON.parse(await fs.readFile(audioManifest, "utf8"));
      audioReady =
        manifest.input === documentHash(content) &&
        manifest.hash === (await fileHash(audioPath));
    } catch {}
    if (!audioReady) {
      const chunks: string[] = splitTextForTts(spoken);
      if (!chunks.length)
        throw new BadRequestException("음성을 만들 원고가 없습니다.");
      const parts: string[] = [];
      for (const input of chunks) {
        const hash = fingerprint([AUDIO_PROFILE, input]),
          filename = `tts_${hash}.wav`,
          part = path.join(directory, filename);
        const budgets = await this.store.budgets();
        let reservation = budgets.find(
          (item) =>
            item.operation_key === `${content.id}:tts:${hash}` ||
            item.operation_key.startsWith(`${content.id}:tts:${hash}:attempt:`),
        );
        let cached = false;
        try {
          await this.restore(content, filename);
          await this.restore(content, `${filename}.json`);
          const manifest = JSON.parse(
            await fs.readFile(path.join(directory, `${filename}.json`), "utf8"),
          );
          if (manifest.hash !== (await fileHash(part)))
            throw new Error("Speech chunk hash mismatch");
          await this.duration(part);
          cached = true;
        } catch {}
        if (cached && !reservation)
          throw new ConflictException("음성 청크의 비용 기록이 없습니다.");
        if (!cached) {
          reservation = await this.store.reserveCost(
            content.id,
            `tts:${hash}`,
            "tts",
            (Buffer.byteLength(input) * 15) / 1000000,
          );
          if (!reservation.created)
            throw new ConflictException(
              "기존 TTS 요청 결과가 불명확합니다. 공급자 비용과 저장 파일을 확인하세요.",
            );
          const response = await client.audio.speech.create({
            ...AUDIO_PROFILE,
            input,
            response_format: "wav",
          });
          const temporary = `${part}.part`;
          await fs.writeFile(
            temporary,
            Buffer.from(await response.arrayBuffer()),
          );
          await this.duration(temporary);
          await fs.rename(temporary, part);
          await fs.writeFile(
            path.join(directory, `${filename}.json`),
            JSON.stringify({ hash: await fileHash(part) }),
          );
          await this.backup(content, [filename, `${filename}.json`]);
        }
        if (reservation!.state === "reserved")
          await this.store.settleCost(
            reservation!.operation_key,
            (input.length * 15) / 1000000,
          );
        parts.push(part);
      }
      const list = path.join(directory, "audio-parts.txt");
      await fs.writeFile(
        list,
        parts
          .map(
            (filename) =>
              `file '${filename.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`,
          )
          .join("\n"),
      );
      await exec(
        "ffmpeg",
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          list,
          "-c:a",
          "libmp3lame",
          "-q:a",
          "2",
          audioPath,
        ],
        { timeout: 120000, maxBuffer: 1024 * 1024 },
      );
      await fs.writeFile(
        audioManifest,
        JSON.stringify({
          input: documentHash(content),
          hash: await fileHash(audioPath),
          profile: AUDIO_PROFILE,
        }),
      );
      await this.backup(content, ["audio.mp3", "audio-manifest.json"]);
    }
    const audioSeconds = await this.duration(audioPath);
    if (content.format === "shorts" && audioSeconds > 58.5)
      throw new BadRequestException(
        "Shorts 음성이 너무 깁니다. 원고를 줄이고 다시 검증하세요.",
      );

    const srtPath = path.join(directory, "subtitles.srt");
    let subtitlesReady = false;
    try {
      await this.restore(content, "subtitles.srt");
      await this.restore(content, "subtitle-manifest.json");
      const saved = JSON.parse(
        await fs.readFile(
          path.join(directory, "subtitle-manifest.json"),
          "utf8",
        ),
      );
      subtitlesReady = saved.audio === (await fileHash(audioPath));
    } catch {}
    if (!subtitlesReady) {
      const reservation = await this.store.reserveCost(
        content.id,
        `whisper:${documentHash(content)}`,
        "tts",
        (Math.ceil(audioSeconds) / 60) * 0.006,
      );
      if (!reservation.created)
        throw new ConflictException(
          "자막 작업 결과를 확인해야 합니다. 자동 재청구하지 않습니다.",
        );
      const srt = await client.audio.transcriptions.create({
        file: createReadStream(audioPath),
        model: "whisper-1",
        response_format: "srt",
      });
      await fs.writeFile(srtPath, srt);
      await fs.writeFile(
        path.join(directory, "subtitle-manifest.json"),
        JSON.stringify({ audio: await fileHash(audioPath) }),
      );
      await this.backup(content, ["subtitles.srt", "subtitle-manifest.json"]);
      await this.store.settleCost(
        reservation.operation_key,
        (Math.ceil(audioSeconds) / 60) * 0.006,
      );
    }

    const width = content.format === "shorts" ? 1080 : 1920,
      height = content.format === "shorts" ? 1920 : 1080;
    const visualAssets = content.assets.filter(
      (asset) => asset.kind === "image" || asset.kind === "video",
    );
    const visuals: {
      filename: string;
      kind: string;
      seconds: number;
      ai: boolean;
    }[] = [];
    for (const asset of visualAssets) {
      const filename = path.join(
        directory,
        `${asset.id}.${asset.kind === "image" ? "jpg" : "mp4"}`,
      );
      try {
        await fs.access(filename);
      } catch {
        if (asset.storageKey)
          await this.restore(content, path.basename(filename));
        else await downloadAsset(asset.sourceUrl, filename, asset.kind);
      }
      if (!asset.storageKey) {
        await this.backup(content, [path.basename(filename)]);
        asset.storageKey = `noctivault/${content.id}/${path.basename(filename)}`;
      }
      visuals.push({
        filename,
        kind: asset.kind,
        seconds: asset.kind === "video" ? await this.duration(filename) : 0,
        ai: asset.aiGenerated,
      });
    }
    content = await this.store.saveContent(content);
    const assetsHash = fingerprint(content.assets);
    const availableVideoSeconds = visuals.reduce(
      (sum, item) => sum + item.seconds,
      0,
    );
    const imageCount = visuals.filter((item) => item.kind === "image").length;
    if (!imageCount && availableVideoSeconds < audioSeconds)
      throw new BadRequestException(
        "영상 자료 길이가 음성보다 짧습니다. 반복 재생하지 않습니다. 사진·지도·기록 화면을 추가하세요.",
      );
    const imageSeconds = imageCount
      ? Math.max(0.5, audioSeconds - availableVideoSeconds) / imageCount
      : 0;
    const assPath = srtToAss(srtPath, directory);
    let ass = (await fs.readFile(assPath, "utf8"))
      .replace("PlayResX: 1080", `PlayResX: ${width}`)
      .replace("PlayResY: 1920", `PlayResY: ${height}`);
    if (content.format === "longform")
      ass = ass.replace(/Style: Default,([^,]+),\d+,/, "Style: Default,$1,42,");
    ass = ass.replace(
      "[Events]",
      `Style: Disclosure,Arial,30,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,7,32,32,32,1\n\n[Events]`,
    );
    let elapsed = 0;
    const segmentPaths: string[] = [];
    const assTime = (seconds: number) =>
      `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
    for (
      let index = 0;
      index < visuals.length && elapsed < audioSeconds;
      index++
    ) {
      const visual = visuals[index];
      const seconds = Math.min(
        audioSeconds - elapsed,
        visual.kind === "image" ? imageSeconds : visual.seconds,
      );
      if (seconds <= 0) continue;
      const output = path.join(directory, `scene_${index}.mp4`);
      const args = [
        "-y",
        ...(visual.kind === "image" ? ["-loop", "1"] : []),
        "-i",
        visual.filename,
        "-t",
        String(seconds),
        "-an",
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30,format=yuv420p`,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        output,
      ];
      await exec("ffmpeg", args, {
        timeout: 7200000,
        maxBuffer: 10 * 1024 * 1024,
      });
      if (visual.ai)
        ass += `\nDialogue: 0,${assTime(elapsed)},${assTime(elapsed + seconds)},Disclosure,,0,0,0,,AI reenactment - not original footage`;
      elapsed += seconds;
      segmentPaths.push(output);
    }
    await fs.writeFile(assPath, ass);
    await fs.writeFile(
      path.join(directory, "scenes.txt"),
      segmentPaths
        .map(
          (filename) =>
            `file '${filename.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`,
        )
        .join("\n"),
    );
    const timeline = path.join(directory, "timeline.mp4");
    await exec(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        path.join(directory, "scenes.txt"),
        "-c",
        "copy",
        timeline,
      ],
      { timeout: 7200000, maxBuffer: 10 * 1024 * 1024 },
    );
    const finalPath = path.join(directory, "final.mp4");
    const filterPath = assPath
      .replace(/\\/g, "/")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");
    const fontsPath = path
      .join(ROOT, "assets/fonts")
      .replace(/\\/g, "/")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");
    await exec(
      "ffmpeg",
      [
        "-y",
        "-i",
        timeline,
        "-i",
        audioPath,
        "-vf",
        `subtitles='${filterPath}':fontsdir='${fontsPath}'`,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        "-shortest",
        finalPath,
      ],
      { timeout: 7200000, maxBuffer: 10 * 1024 * 1024 },
    );
    await fs.writeFile(
      path.join(directory, "asset-manifest.json"),
      JSON.stringify(content.assets),
    );
    await this.backup(content, [
      "final.mp4",
      "subtitles.ass",
      "asset-manifest.json",
    ]);
    let thumbnailHash: string | undefined;
    if (content.format === "longform") {
      const thumbnailText =
        content.thumbnailText.match(/.{1,26}(?:\s|$)|\S{1,26}/g)?.join("\n") ||
        content.thumbnailText;
      const textFile = path.join(directory, "thumbnail-text.txt");
      await fs.writeFile(textFile, thumbnailText);
      const escaped = textFile
        .replace(/\\/g, "/")
        .replace(/:/g, "\\:")
        .replace(/'/g, "\\'");
      const thumbnail = path.join(directory, "thumbnail.jpg");
      await exec(
        "ffmpeg",
        [
          "-y",
          "-i",
          finalPath,
          "-frames:v",
          "1",
          "-vf",
          `scale=1280:720,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.55:t=fill,drawtext=textfile='${escaped}':fontcolor=white:fontsize=58:x=80:y=(h-text_h)/2:line_spacing=18`,
          "-update",
          "1",
          thumbnail,
        ],
        { timeout: 60000, maxBuffer: 1024 * 1024 },
      );
      await this.backup(content, ["thumbnail.jpg"]);
      thumbnailHash = await fileHash(thumbnail);
    }
    content = await this.store.content(content.id);
    if (
      documentHash(content) !== inputHash ||
      fingerprint(content.assets) !== assetsHash
    )
      throw new ConflictException(
        "렌더 중 원고 또는 자료가 변경되었습니다. 다시 검증하세요.",
      );
    if (Math.abs((await this.duration(finalPath)) - audioSeconds) > 1)
      throw new ConflictException("최종 영상 길이가 음성과 일치하지 않습니다.");
    return this.store.saveContent({
      ...content,
      status: "rendered",
      finalPath,
      renderHash: await fileHash(finalPath),
      renderInputHash: inputHash,
      thumbnailHash,
      thumbnailUploaded: false,
      currentStep: undefined,
    });
  }
}
