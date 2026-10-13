import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { buildApp } from "../src/server/app.js";
import { invoicePDF } from "./fixtures/finance-pdf.js";

test("Billly API inspection is read-only and applying imports keeps source untouched with a restorable snapshot", async (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-import-api-"));
  const source = path.join(folder, "billly.sqlite"),
    target = path.join(folder, "pitchary.sqlite");
  const pdfPath = path.join(folder, "invoice.pdf"),
    pdf = invoicePDF();
  writeFileSync(pdfPath, pdf);
  const legacy = new DatabaseSync(source);
  legacy.exec(
    "CREATE TABLE invoices(id TEXT PRIMARY KEY,category TEXT,file_path TEXT,file_hash TEXT,invoice_number TEXT,invoice_date TEXT,counterparty_name TEXT,total_amount TEXT,currency TEXT,status TEXT,created_at TEXT,updated_at TEXT); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE email_templates(body TEXT);",
  );
  const id = "70000000-0000-4000-8000-000000000001";
  legacy
    .prepare("INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      id,
      "revenue",
      pdfPath,
      createHash("sha256").update(pdf).digest("hex"),
      "API-1",
      "2026-10-01",
      "Existing Customer",
      "120.00",
      "EUR",
      "open",
      "2026-10-01T10:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
    );
  legacy
    .prepare("INSERT INTO settings VALUES(?,?)")
    .run("openai_api_key", "DO-NOT-COPY-KEY");
  legacy
    .prepare("INSERT INTO email_templates VALUES(?)")
    .run("DO-NOT-COPY-MAIL");
  legacy.close();
  const sourceBytes = readFileSync(source);
  const app = await buildApp({
    databasePath: target,
    financeOptions: { watchEnabled: false },
  });
  t.after(async () => {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const customer = app.crm.createEntity("customers", {
    name: "Existing Customer",
    note: "Preserve me",
  });
  const inspect = await app.inject({
    url: "/api/finance/billly/inspect?source=" + encodeURIComponent(source),
  });
  assert.equal(inspect.statusCode, 200, inspect.body);
  assert.equal(inspect.json().invoices, 1);
  assert.equal(app.finance.list().length, 0);
  assert.ok(!inspect.body.includes("Existing Customer"));
  const applied = await app.inject({
    method: "POST",
    url: "/api/finance/billly/import",
    payload: { source },
  });
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(applied.json().imported, 1);
  assert.deepEqual(readFileSync(source), sourceBytes);
  assert.equal(app.finance.get(id).customer_id, customer.id);
  assert.deepEqual(app.finance.file(id).data, pdf);
  assert.equal(app.crm.entity("customers", customer.id).note, "Preserve me");
  assert.equal(await app.financeSettings.getKey(), null);
  const snapshot = new DatabaseSync(applied.json().backup, { readOnly: true });
  assert.equal(
    snapshot.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.equal(
    snapshot.prepare("SELECT count(*) AS n FROM finance_invoices").get().n,
    0,
  );
  assert.equal(
    snapshot.prepare("SELECT note FROM customers WHERE id=?").get(customer.id)
      .note,
    "Preserve me",
  );
  snapshot.close();
  const repeat = await app.inject({
    method: "POST",
    url: "/api/finance/billly/import",
    payload: { source },
  });
  assert.equal(repeat.json().skipped, 1);
  assert.equal(app.finance.list().length, 1);
  const alias = path.join(folder, "target-alias.sqlite");
  symlinkSync(target, alias);
  const invalid = await app.inject({
    method: "POST",
    url: "/api/finance/billly/import",
    payload: { source: alias },
  });
  assert.equal(invalid.statusCode, 422);
  assert.equal(app.finance.list().length, 1);
});
