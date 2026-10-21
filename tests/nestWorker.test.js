const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");

test("Nest worker exposes usage without API keys or media generation", () => {
  const main = path.join(root, "dist", "main.js");
  assert.ok(fs.existsSync(main), "Nest worker must be built at dist/main.js");
  const result = spawnSync(process.execPath, [main, "--help"], {
    cwd: root,
    encoding: "utf8",
    timeout: 20000,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--run-once/);
  assert.match(result.stdout, /--longform-phase1/);
  assert.match(result.stdout, /--longform-phase2/);
  assert.match(result.stdout, /--request=/);
  assert.match(result.stdout, /--sync-youtube/);
  assert.doesNotMatch(result.stdout, /--serve/);
});

test("Nest worker rejects unknown commands before starting paid work", () => {
  const main = path.join(root, "dist", "main.js");
  assert.ok(fs.existsSync(main), "Nest worker must be built at dist/main.js");
  const result = spawnSync(process.execPath, [main, "--unknown"], {
    cwd: root,
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, NODE_ENV: "test" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown|알 수 없는/);
});
