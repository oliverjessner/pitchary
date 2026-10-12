import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, projectRoot } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
test("online backup includes WAL data; restore validates and never overwrites files", (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-backup-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const source = path.join(folder, "source.sqlite"),
    snapshot = path.join(folder, "backup.sqlite"),
    restored = path.join(folder, "restored.sqlite");
  const db = openDatabase(source);
  t.after(() => db.close());
  const crm = createCRM(db),
    c = crm.createEntity("customers", { name: "WAL customer" }),
    s = crm.createEntity("services", { name: "Backup service" });
  const r = crm.createRelationship({
    customer_id: c.id,
    service_id: s.id,
    current_offered_price_minor: 43210,
  });
  crm.changeStatus(r.id, { status: "pitched" });
  crm.addActivity(r.id, { type: "follow_up", note: "Preserve history" });
  const run = (script, args = []) =>
    spawnSync(
      process.execPath,
      [path.join(projectRoot, "scripts", script), ...args],
      {
        cwd: projectRoot,
        env: { ...process.env, DATABASE_PATH: source },
        encoding: "utf8",
      },
    );
  let result = run("backup.js", [snapshot]);
  assert.equal(result.status, 0, result.stderr);
  const originalBytes = readFileSync(snapshot);
  assert.notEqual(run("backup.js", [snapshot]).status, 0);
  assert.deepEqual(readFileSync(snapshot), originalBytes);
  result = run("restore.js", [snapshot, restored]);
  assert.equal(result.status, 0, result.stderr);
  const copy = new DatabaseSync(restored);
  try {
    assert.equal(
      copy.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.equal(
      copy.prepare("SELECT status FROM customer_services WHERE id=?").get(r.id)
        .status,
      "pitched",
    );
    assert.equal(
      copy
        .prepare("SELECT count(*) AS n FROM customer_service_status_history")
        .get().n,
      2,
    );
    assert.equal(
      copy.prepare("SELECT note FROM activities").get().note,
      "Preserve history",
    );
  } finally {
    copy.close();
  }
  assert.notEqual(run("restore.js", [snapshot, restored]).status, 0);
  const unrelated = path.join(folder, "unrelated.sqlite");
  const other = new DatabaseSync(unrelated);
  other.exec("CREATE TABLE unrelated(id INTEGER)");
  other.close();
  assert.notEqual(
    run("restore.js", [unrelated, path.join(folder, "bad.sqlite")]).status,
    0,
  );
});
test("asset synchronization is reproducible and includes notices and local fonts", () => {
  const directory = path.join(projectRoot, "public/vendor/oj-designsystem");
  const before = readFileSync(path.join(directory, "styles.css"));
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts/sync-designsystem.js")],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(path.join(directory, "styles.css")), before);
  assert.deepEqual(
    before,
    readFileSync(
      path.join(projectRoot, "node_modules/oj-designsystem/dist/styles.css"),
    ),
  );
  assert.match(readFileSync(path.join(directory, "LICENSE"), "utf8"), /MIT/);
  assert.match(
    readFileSync(path.join(directory, "styles.css"), "utf8"),
    /\.woff2/,
  );
});
