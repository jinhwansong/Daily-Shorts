const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("database migration reserves content and budget atomically", async () => {
  const { PGlite } = require("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role;",
    );
    await db.exec(
      fs.readFileSync(
        path.join(
          __dirname,
          "../supabase/migrations/202610190001_noctivault.sql",
        ),
        "utf8",
      ),
    );
    await db.exec(
      fs.readFileSync(
        path.join(
          __dirname,
          "../supabase/migrations/202610210001_studio_publication.sql",
        ),
        "utf8",
      ),
    );
    const caseId = "00000000-0000-4000-8000-000000000001";
    await db.query(
      "insert into vault_cases(id,canonical_key,data) values($1,$2,$3)",
      [caseId, "case", { id: caseId }],
    );
    const first = {
      id: "00000000-0000-4000-8000-000000000002",
      caseId,
      format: "shorts",
      angleId: "clue",
      editionId: "original",
      coreClaimIds: ["a"],
      status: "reserved",
    };
    await db.query("select vault_reserve_content($1::jsonb)", [
      JSON.stringify(first),
    ]);
    await assert.rejects(
      db.query("select vault_reserve_content($1::jsonb)", [
        JSON.stringify({
          ...first,
          id: "00000000-0000-4000-8000-000000000003",
          angleId: "renamed",
        }),
      ]),
      /duplicate/i,
    );
    await db.query("select vault_reserve_budget($1,$2,$3,$4,$5)", [
      "op1",
      first.id,
      "2026-10",
      "video",
      5460000,
    ]);
    const repeated = await db.query(
      "select vault_reserve_budget($1,$2,$3,$4,$5) as reservation",
      ["op1", first.id, "2026-10", "video", 5460000],
    );
    assert.equal(repeated.rows[0].reservation.created, false);
    await assert.rejects(
      db.query("select vault_reserve_budget($1,$2,$3,$4,$5)", [
        "november",
        first.id,
        "2026-11",
        "video",
        2000000,
      ]),
      /budget/i,
    );
    await assert.rejects(
      db.query("select vault_reserve_budget($1,$2,$3,$4,$5)", [
        "op2",
        first.id,
        "2026-10",
        "video",
        2000000,
      ]),
      /budget/i,
    );
    await db.query("select vault_settle_budget($1,$2,$3)", [
      "op1",
      5460000,
      "settled",
    ]);
    const result = await db.query(
      "select sum(spent_micros)::integer as spent from vault_budget",
    );
    assert.equal(result.rows[0].spent, 5460000);
    await db.query("select vault_reserve_budget($1,$2,$3,$4,$5)", [
      "tts-retry",
      first.id,
      "2026-10",
      "tts",
      10000,
    ]);
    await db.query("select vault_settle_budget($1,$2,$3)", [
      "tts-retry",
      0,
      "released",
    ]);
    const retry = await db.query(
      "select vault_reserve_budget($1,$2,$3,$4,$5) as reservation",
      ["tts-retry", first.id, "2026-10", "tts", 10000],
    );
    assert.equal(retry.rows[0].reservation.created, true);
    assert.equal(
      retry.rows[0].reservation.operation_key,
      "tts-retry:attempt:1",
    );
    const retryAgain = await db.query(
      "select vault_reserve_budget($1,$2,$3,$4,$5) as reservation",
      ["tts-retry", first.id, "2026-10", "tts", 10000],
    );
    assert.equal(retryAgain.rows[0].reservation.created, false);
    assert.equal(
      retryAgain.rows[0].reservation.operation_key,
      "tts-retry:attempt:1",
    );
    const draft = { ...first, status: "draft", revision: 1 };
    await db.query("select vault_update_content($1::jsonb,$2)", [
      JSON.stringify(draft),
      1,
    ]);
    await assert.rejects(
      db.query("select vault_update_content($1::jsonb,$2)", [
        JSON.stringify(draft),
        1,
      ]),
      /concurrently/i,
    );
    await assert.rejects(
      db.query("select vault_update_content($1::jsonb,$2)", [
        JSON.stringify({ ...draft, status: "published", revision: 2 }),
        2,
      ]),
      /transition/i,
    );
    const run = {
      id: "00000000-0000-4000-8000-000000000004",
      contentId: first.id,
      status: "running",
      step: "verify",
    };
    await db.query("select vault_start_run($1::jsonb)", [JSON.stringify(run)]);
    await assert.rejects(
      db.query("select vault_start_run($1::jsonb)", [
        JSON.stringify({ ...run, id: "00000000-0000-4000-8000-000000000005" }),
      ]),
      /unique/i,
    );
    await assert.rejects(
      db.query("select vault_update_content($1::jsonb,$2)", [
        JSON.stringify({ ...draft, revision: 2 }),
        2,
      ]),
      /worker running/i,
    );
    await db.query("select vault_update_content($1::jsonb,$2,$3)", [
      JSON.stringify({ ...draft, status: "verified", revision: 2 }),
      2,
      run.id,
    ]);
    let recovering = { ...draft, revision: 3, status: "rendered" };
    for (const status of ["rendered", "uploading", "reconciliation_required"]) {
      recovering = {
        ...recovering,
        status,
        uploadedAt: new Date(Date.now() - 7200000).toISOString(),
        currentStep: "upload",
      };
      const updated = await db.query(
        "select vault_update_content($1::jsonb,$2,$3) as content",
        [JSON.stringify(recovering), recovering.revision, run.id],
      );
      recovering = updated.rows[0].content;
    }
    await assert.rejects(
      db.query("select vault_update_content($1::jsonb,$2,$3)", [
        JSON.stringify({ ...recovering, status: "rendered" }),
        recovering.revision,
        run.id,
      ]),
      /absence not confirmed/i,
    );
    const restored = await db.query(
      "select vault_update_content($1::jsonb,$2,$3) as content",
      [
        JSON.stringify({
          ...recovering,
          status: "rendered",
          noUploadConfirmedAt: new Date().toISOString(),
        }),
        recovering.revision,
        run.id,
      ],
    );
    assert.equal(restored.rows[0].content.status, "rendered");
    let studio = restored.rows[0].content;
    for (const status of ["uploading", "uploaded_private"]) {
      const updated = await db.query(
        "select vault_update_content($1::jsonb,$2,$3) as content",
        [
          JSON.stringify({ ...studio, status, youtubeId: "video" }),
          studio.revision,
          run.id,
        ],
      );
      studio = updated.rows[0].content;
    }
    await assert.rejects(
      db.query("select vault_update_content($1::jsonb,$2,$3)", [
        JSON.stringify({ ...studio, status: "approved" }),
        studio.revision,
        run.id,
      ]),
      /invalid status transition/,
    );
    await assert.rejects(
      db.query("select vault_update_content($1::jsonb,$2,$3)", [
        JSON.stringify({ ...studio, status: "published" }),
        studio.revision,
        run.id,
      ]),
      /must be observed/,
    );
    const synced = await db.query(
      "select vault_update_content($1::jsonb,$2,$3) as content",
      [
        JSON.stringify({
          ...studio,
          status: "published",
          youtubeVisibility: "public",
          youtubeSyncedAt: new Date().toISOString(),
        }),
        studio.revision,
        run.id,
      ],
    );
    assert.equal(synced.rows[0].content.status, "published");
    await db.query("select vault_save_case($1::jsonb,$2::jsonb)", [
      JSON.stringify({ id: caseId, canonicalKey: "case", claims: ["a"] }),
      JSON.stringify({ id: caseId }),
    ]);
    await assert.rejects(
      db.query("select vault_save_case($1::jsonb,$2::jsonb)", [
        JSON.stringify({ id: caseId, canonicalKey: "case", claims: ["b"] }),
        JSON.stringify({ id: caseId }),
      ]),
      /concurrently/i,
    );
    await db.exec("set role anon");
    try {
      await assert.rejects(
        db.query("select * from vault_cases"),
        /permission denied/i,
      );
      await assert.rejects(
        db.query("select vault_reserve_content($1::jsonb)", [
          JSON.stringify(first),
        ]),
        /permission denied/i,
      );
    } finally {
      await db.exec("reset role");
    }
  } finally {
    await db.close();
  }
});
