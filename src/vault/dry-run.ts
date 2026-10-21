import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { srtToAss } from "./media.utils";

const exec = promisify(execFile);

export async function runDryRun(genre: string) {
  const outputDir = path.resolve(
    __dirname,
    "../../output",
    `dry-run_${randomUUID()}`,
  );
  await exec("ffmpeg", ["-version"], { timeout: 5000 });
  await fs.mkdir(outputDir, { recursive: true });
  const width = genre === "mystery-long" ? 1920 : 1080,
    height = genre === "mystery-long" ? 1080 : 1920;
  const script =
    "Noctivault local rendering test. No paid API or YouTube request is made.";
  await fs.writeFile(path.join(outputDir, "script.txt"), script);
  await fs.writeFile(
    path.join(outputDir, "subtitles.srt"),
    `1\n00:00:00,000 --> 00:00:04,900\n${script}\n`,
  );
  const ass = srtToAss(path.join(outputDir, "subtitles.srt"), outputDir);
  if (genre === "mystery-long")
    await fs.writeFile(
      ass,
      (await fs.readFile(ass, "utf8"))
        .replace("PlayResX: 1080", "PlayResX: 1920")
        .replace("PlayResY: 1920", "PlayResY: 1080"),
    );
  const escaped = ass
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
  const fonts = path
    .resolve(__dirname, "../../assets/fonts")
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
  const finalPath = path.join(outputDir, "final.mp4");
  await exec(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=${width}x${height}:r=30:d=5`,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      "-t",
      "5",
      "-vf",
      `subtitles='${escaped}':fontsdir='${fonts}'`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      finalPath,
    ],
    { timeout: 120000, maxBuffer: 1024 * 1024 },
  );
  await fs.writeFile(
    path.join(outputDir, "dry-run.json"),
    JSON.stringify({ ok: true, genre, finalPath, apiCalls: 0 }),
  );
  console.log(`로컬 렌더 진단 완료: ${finalPath}`);
  return { finalPath, outputDir };
}
