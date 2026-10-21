const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { RequestService } = require("../dist/request.service");
const { CliService } = require("../dist/cli.service");

test("CLI consumes a JSON file and rejects malformed, oversized and mixed requests before execution", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noctivault request-"));
  const file = path.join(dir, "request.json");
  let received;
  const cli = new CliService(
    {},
    {
      execute: async (input) => {
        received = input;
        return { saved: true };
      },
    },
  );
  try {
    await fs.writeFile(
      file,
      JSON.stringify({ command: "case", data: { name: "A documented case" } }),
    );
    assert.deepEqual(await cli.run([`--request=${file}`]), { saved: true });
    assert.equal(received.data.name, "A documented case");
    received = undefined;
    await assert.rejects(cli.run([`--request=${file}`, "--run-once"]), /함께/);
    await fs.writeFile(file, "{broken");
    await assert.rejects(cli.run([`--request=${file}`]), /유효한 JSON/);
    await fs.writeFile(file, " ".repeat(512 * 1024 + 1));
    await assert.rejects(cli.run([`--request=${file}`]), /512KB/);
    assert.equal(received, undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("management validates IDs, blocks public actions and waits for actual worker completion", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  let run = false;
  const operations = {
    action: async (target, command) => {
      assert.equal(target, id);
      assert.equal(command, "verify");
      run = true;
    },
    waitForContent: async () => {
      assert.equal(run, true);
      throw new Error("verification failed");
    },
  };
  const requests = new RequestService(operations, {}, {});
  for (const command of ["publish", "approve", "reopen", "unknown"])
    await assert.rejects(requests.execute({ command, id }), /지원하지 않는/);
  await assert.rejects(
    requests.execute({ command: "verify", id: "invalid" }),
    /UUID/,
  );
  assert.equal(run, false);
  await assert.rejects(
    requests.execute({ command: "verify", id }),
    /verification failed/,
  );
  operations.waitForContent = async () => ({ id, error: "evidence rejected" });
  await assert.rejects(
    requests.execute({ command: "verify", id }),
    /evidence rejected/,
  );
});
