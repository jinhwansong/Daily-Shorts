import fs from "node:fs";
import path from "node:path";

export function splitTextForTts(text: string): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > 4000) {
    const window = rest.slice(0, 4000);
    const boundary = Math.max(
      ...["\n\n", ". ", "? ", "! ", "\n", " "].map((separator) =>
        window.lastIndexOf(separator),
      ),
    );
    const cut = boundary > 800 ? boundary + 1 : 4000;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function intEnv(key: string, fallback: number, min: number, max: number) {
  const number = Number.parseInt(process.env[key] || String(fallback), 10);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}

function colorEnv(key: string, fallback: string) {
  const value = (process.env[key] || "").trim().replace(/^&H/i, "");
  return /^[\da-f]{8}$/i.test(value)
    ? `&H${value}`
    : /^[\da-f]{6}$/i.test(value)
      ? `&H00${value}`
      : fallback;
}

function fontFamily() {
  if (process.env.SUBTITLE_FONT_NAME?.trim())
    return process.env.SUBTITLE_FONT_NAME.trim();
  try {
    const config: unknown = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../assets/fonts/fonts.json"),
        "utf8",
      ),
    );
    if (
      config &&
      typeof config === "object" &&
      "subtitle" in config &&
      config.subtitle &&
      typeof config.subtitle === "object" &&
      "family" in config.subtitle &&
      typeof config.subtitle.family === "string"
    )
      return config.subtitle.family.trim() || "Oswald";
  } catch {}
  return "Oswald";
}

export function buildAssStyleLine() {
  const boxed = ["1", "true", "yes"].includes(
    (process.env.SUBTITLE_BACK_BOX || "").toLowerCase(),
  );
  const bottom =
    process.env.SUBTITLE_PLACEMENT?.trim().toLowerCase() === "bottom";
  const font = fontFamily().replace(/[,\r\n]/g, "");
  return `Style: Default,${font},${intEnv("SUBTITLE_FONT_SIZE", 78, 48, 120)},${colorEnv("SUBTITLE_PRIMARY_ABGR", "&H00FFFFFF")},${colorEnv("SUBTITLE_SECONDARY_ABGR", "&H000000FF")},${colorEnv("SUBTITLE_OUTLINE_ABGR", "&H00000000")},${colorEnv("SUBTITLE_BACK_ABGR", boxed ? "&HAA000000" : "&H80000000")},${process.env.SUBTITLE_BOLD === "0" ? 0 : -1},0,0,0,100,100,${intEnv("SUBTITLE_SPACING", 1, 0, 20)},0,${boxed ? 3 : 1},${intEnv("SUBTITLE_OUTLINE", 6, 0, 12)},${intEnv("SUBTITLE_SHADOW", 4, 0, 8)},${bottom ? 2 : 8},${intEnv("SUBTITLE_MARGIN_LR", 48, 20, 200)},${intEnv("SUBTITLE_MARGIN_LR", 48, 20, 200)},${intEnv("SUBTITLE_MARGIN_V", bottom ? 135 : 150, 60, 280)},1`;
}

function assTime(time: string) {
  const match = /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(time.trim());
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59)
    throw new Error("잘못된 SRT 타임코드입니다.");
  return `${Number(match[1])}:${match[2]}:${match[3]}.${match[4].slice(0, 2)}`;
}

export function srtToAss(srtPath: string, outputDir: string) {
  const srt = fs.readFileSync(srtPath, "utf8").replace(/\r\n?/g, "\n").trim();
  if (!srt) throw new Error("SRT 자막이 비어 있습니다.");
  const events = srt.split(/\n\s*\n/).map((block) => {
    const lines = block.split("\n");
    if (lines.length < 3) throw new Error("잘못된 SRT 자막 블록입니다.");
    const times = lines[1].split(" --> ");
    if (times.length !== 2) throw new Error("잘못된 SRT 타임코드입니다.");
    const text = lines
      .slice(2)
      .join(" ")
      .replace(/\\/g, "\\\\")
      .replace(/{/g, "\\{")
      .replace(/}/g, "\\}");
    return `Dialogue: 0,${assTime(times[0])},${assTime(times[1])},Default,,0,0,0,,${text}`;
  });
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${buildAssStyleLine()}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const output = path.join(outputDir, "subtitles.ass");
  fs.writeFileSync(output, header + events.join("\n"));
  return output;
}
