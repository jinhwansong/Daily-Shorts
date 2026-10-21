const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { splitTextForTts, srtToAss } = require("../dist/vault/media.utils");

test("speech chunks preserve content order, obey 4000 characters and split long words", () => {
  const text = "Evidence remains incomplete. ".repeat(400);
  const chunks = splitTextForTts(text);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 4000));
  assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), text.trim());
  assert.deepEqual(splitTextForTts("  "), []);
  assert.deepEqual(
    splitTextForTts("x".repeat(8001)).map((chunk) => chunk.length),
    [4000, 4000, 1],
  );
});

test("SRT parser handles Windows newlines, escapes ASS overrides and rejects malformed timestamps", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noctivault-subtitles-"));
  try {
    const input = path.join(dir, "subtitles.srt");
    fs.writeFileSync(
      input,
      "1\r\n00:00:00,000 --> 00:00:01,200\r\nEvidence {\\b1} is incomplete.\r\n",
    );
    const ass = fs.readFileSync(srtToAss(input, dir), "utf8");
    assert.match(ass, /0:00:00\.00,0:00:01\.20/);
    assert.ok(ass.includes("\\{\\\\b1\\}"));
    fs.writeFileSync(input, "1\n00:99:00,000 --> 00:00:01,200\nInvalid");
    assert.throws(() => srtToAss(input, dir), /타임코드/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
