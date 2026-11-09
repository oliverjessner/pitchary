import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/server/app.js";
import { openDatabase } from "../src/database/database.js";
import { restrictMCPDatabase } from "../src/mcp/database.js";

test("language settings validate atomically and never change CRM or finance data", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  const customer = app.crm.createEntity("customers", {
    name: "Kunden",
    note: "Offen {name} <b>Deutsch</b>",
  });
  const before = app.crm.entity("customers", customer.id);
  assert.deepEqual((await app.inject("/api/settings")).json(), {
    language: "de",
  });
  const save = (payload) =>
    app.inject({ method: "PATCH", url: "/api/settings", payload });
  assert.deepEqual((await save({ language: "en" })).json(), { language: "en" });
  for (const input of [
    { language: "fr" },
    { language: "DE" },
    { language: 1 },
    { language: "de", company_name: "Must not change" },
    {},
    [],
  ]) {
    const response = await save(input);
    assert.equal(response.statusCode, 422, response.body);
    assert.equal((await app.inject("/api/settings")).json().language, "en");
  }
  assert.deepEqual(app.crm.entity("customers", customer.id), before);
  assert.equal(
    app.database.prepare("SELECT count(*) AS n FROM finance_settings").get().n,
    0,
  );
  const english = await app.inject({
    method: "PATCH",
    url: "/api/settings",
    headers: { "accept-language": "en-GB,en;q=0.9" },
    payload: { language: "fr" },
  });
  assert.equal(english.json().error.message, "language: Invalid selection.");
  assert.equal(
    english.json().error.fields.language,
    "language: Invalid selection.",
  );
  const german = await save({ language: "fr" });
  assert.equal(german.json().error.message, "language: Ungültige Auswahl.");
  const missing = await app.inject({
    url: "/api/not-a-route",
    headers: { "accept-language": "en" },
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.message, "Endpoint not found.");
  assert.throws(
    () => app.appSettings.save(Object.create({ language: "de" })),
    /Ungültige Auswahl/,
  );
});

test("language preference survives reopening the database independently of browser origin or storage", async (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-language-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const databasePath = path.join(folder, "crm.sqlite");
  let app = await buildApp({ databasePath });
  await app.inject({
    method: "PATCH",
    url: "/api/settings",
    payload: { language: "en" },
  });
  await app.close();
  app = await buildApp({ databasePath });
  t.after(() => app.close());
  assert.deepEqual((await app.inject("/api/settings")).json(), {
    language: "en",
  });
});

test("migration 014 defaults existing installations to German and keeps business records intact", (t) => {
  const folder = mkdtempSync(
    path.join(os.tmpdir(), "pitchary-language-migrate-"),
  );
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "crm.sqlite");
  let db = openDatabase(filename);
  db.exec(
    "INSERT INTO customers(id,name,note,created_at,updated_at) VALUES('00000000-0000-4000-8000-000000000001','Kunden','Notiz','2024-01-01','2024-01-01'); DROP TABLE app_settings; PRAGMA user_version=13;",
  );
  const before = db.prepare("SELECT * FROM customers").all();
  db.close();
  db = openDatabase(filename);
  t.after(() => db.close());
  assert.equal(
    db.prepare("SELECT language FROM app_settings").get().language,
    "de",
  );
  assert.deepEqual(db.prepare("SELECT * FROM customers").all(), before);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  restrictMCPDatabase(db);
  assert.throws(
    () => db.exec("UPDATE app_settings SET language='en'"),
    /authorized|authorization/i,
  );
  assert.throws(
    () => db.prepare("SELECT * FROM app_settings").all(),
    /prohibited|authorized|authorization/i,
  );
});
