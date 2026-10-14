import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/server/app.js";
import { openDatabase } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";

test("service URLs are optional, searchable and validated atomically through the API", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  const empty = await app.inject({
    method: "POST",
    url: "/api/services",
    payload: { name: "Without URL" },
  });
  assert.equal(empty.statusCode, 201);
  assert.equal(empty.json().url, "");
  const created = await app.inject({
    method: "POST",
    url: "/api/services",
    payload: { name: "Service page", url: " https://EXAMPLE.com/service " },
  });
  assert.equal(created.statusCode, 201);
  const row = created.json();
  assert.equal(row.url, "https://example.com/service");
  const found = await app.inject({ url: "/api/services?search=example.com" });
  assert.deepEqual(
    found.json().map((item) => item.id),
    [row.id],
  );
  for (const url of [
    "bad URL",
    "javascript:alert(1)",
    "ftp://example.com",
    "https://user:password@example.com",
    "https://example.com/" + "x".repeat(2048),
  ]) {
    const rejected = await app.inject({
      method: "PATCH",
      url: "/api/services/" + row.id,
      payload: { name: "Must not change", url },
    });
    assert.equal(rejected.statusCode, 422);
    assert.ok(rejected.json().error.fields.url);
    assert.equal(app.crm.entity("services", row.id).name, "Service page");
    assert.equal(app.crm.entity("services", row.id).url, row.url);
  }
  await app.inject({
    method: "PATCH",
    url: "/api/services/" + row.id,
    payload: { note: "Keep URL" },
  });
  assert.equal(app.crm.entity("services", row.id).url, row.url);
  const cleared = await app.inject({
    method: "PATCH",
    url: "/api/services/" + row.id,
    payload: { url: "" },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().url, "");
});

test("service URLs survive reopening the database and archiving", (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-service-url-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "crm.sqlite");
  let db = openDatabase(filename);
  const crm = createCRM(db);
  const service = crm.createEntity("services", {
    name: "Persistent URL",
    url: "https://example.com/service",
  });
  crm.archive("services", service.id);
  db.close();
  db = openDatabase(filename);
  t.after(() => db.close());
  const saved = createCRM(db).entity("services", service.id);
  assert.equal(saved.url, service.url);
  assert.ok(saved.archived_at);
});
