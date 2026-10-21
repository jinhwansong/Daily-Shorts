const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("dotenv");

test("environment example covers runtime and subtitle options without populated credentials", () => {
  const root = path.join(__dirname, "..");
  const example = parse(fs.readFileSync(path.join(root, ".env.example")));
  const required = new Set(["GOOGLE_APPLICATION_CREDENTIALS", "GCP_SA_KEY"]);
  function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(file);
      else if (/\.[jt]s$/.test(entry.name)) {
        const source = fs.readFileSync(file, "utf8");
        for (const match of source.matchAll(
          /process\.env\.([A-Z][A-Z0-9_]*)|(?:intEnv|colorEnv)\(["']([A-Z][A-Z0-9_]*)["']/g,
        ))
          required.add(match[1] || match[2]);
      }
    }
  }
  collect(path.join(root, "src"));
  collect(path.join(root, "scripts"));
  assert.deepEqual(
    [...required].filter((key) => !(key in example)),
    [],
    "Missing environment documentation",
  );
  assert.deepEqual(
    Object.keys(example).filter((key) => !required.has(key)),
    [],
    "Unused environment examples",
  );
  for (const key of [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "FAL_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "YOUTUBE_CLIENT_SECRET",
    "YOUTUBE_REFRESH_TOKEN_MYSTERY",
    "GCP_SA_KEY",
  ])
    assert.equal(example[key], "", key);
});
