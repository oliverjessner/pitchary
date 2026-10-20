import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, projectRoot } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
import { createFinance } from "../src/business/finance.js";
import { inspectLegacy, importLegacy } from "../src/business/legacy-import.js";
import { invoicePDF } from "./fixtures/finance-pdf.js";

const revenueId = "50000000-0000-4000-8000-000000000001";
const payableId = "50000000-0000-4000-8000-000000000002";
const customerId = "60000000-0000-4000-8000-000000000001";
const time = "2026-10-01T10:00:00.000Z";
const secret = "sk-test-legacy-import-secret-never-copy";
const mailCanary = "EMAIL-TEMPLATE-DO-NOT-IMPORT";

function digest(filename) {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

function fixture(t, { invalidDate = false } = {}) {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-legacy-import-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const databasePath = path.join(folder, "legacy.sqlite");
  const pdfPath = path.join(folder, "credit-note.pdf");
  const pdf = invoicePDF("CREDIT-1");
  writeFileSync(pdfPath, pdf);
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY, category TEXT, file_path TEXT, file_hash TEXT,
      file_modified_at TEXT, ingestion_status TEXT, ocr_text TEXT,
      extracted_json TEXT, confidence_score REAL, invoice_number TEXT,
      invoice_date TEXT, due_date TEXT, counterparty_name TEXT,
      total_amount TEXT, currency TEXT, tax_amount TEXT, net_amount TEXT,
      status TEXT, paid_at TEXT, send_date TEXT, document_language TEXT,
      tags TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE invoice_overrides (id TEXT PRIMARY KEY, invoice_id TEXT,
      field_name TEXT, override_value TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, source_name TEXT,
      normalized_name TEXT, billing_address TEXT, general_email TEXT,
      enrichment_status TEXT, enriched_at TEXT, enrichment_source_invoice_id TEXT,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE customer_contacts (id TEXT PRIMARY KEY, customer_id TEXT,
      name TEXT, email TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE email_templates (id TEXT PRIMARY KEY, name TEXT, subject TEXT, body TEXT);
    PRAGMA user_version = 3;
  `);
  const insert = legacy.prepare(
    "INSERT INTO invoices VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  insert.run(
    revenueId,
    "revenue",
    pdfPath,
    digest(pdfPath),
    time,
    "processed",
    "Invoice OCR text",
    '{"total_amount": -123.45, "currency": "EUR"}',
    0.91,
    "CREDIT-1",
    invalidDate ? "2026-02-30" : "2026-10-01",
    "15.10.2026",
    " ACME   GmbH ",
    "-123.45",
    "EUR",
    "-20.58",
    "-102.87",
    "open",
    null,
    "2026-10-02",
    "de",
    "[]",
    time,
    time,
  );
  insert.run(
    payableId,
    "payable",
    path.join(folder, "missing.pdf"),
    "a".repeat(64),
    time,
    "failed",
    null,
    "{}",
    0.3,
    "COST-1",
    null,
    null,
    "Provider",
    "-9.99",
    "USD",
    null,
    "-9.99",
    "paid",
    "2026-10-02",
    null,
    "en",
    '["SaaS","Domain"]',
    time,
    time,
  );
  const override = legacy.prepare(
    "INSERT INTO invoice_overrides VALUES (?,?,?,?,?,?)",
  );
  override.run(
    "amount-override",
    revenueId,
    "total_amount",
    "-100,01",
    time,
    time,
  );
  override.run("status-override", revenueId, "status", "paid", time, time);
  override.run("paid-override", revenueId, "paid_at", "02.10.2026", time, time);
  legacy
    .prepare("INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      customerId,
      "Acme Display",
      " ACME   GmbH ",
      "acme gmbh",
      "Invoice Street 1",
      "billing@example.com",
      "completed",
      time,
      revenueId,
      time,
      time,
    );
  const contact = legacy.prepare(
    "INSERT INTO customer_contacts VALUES (?,?,?,?,?,?)",
  );
  contact.run(
    "70000000-0000-4000-8000-000000000001",
    customerId,
    "Anna Billing",
    "anna@example.com",
    time,
    time,
  );
  contact.run(
    "70000000-0000-4000-8000-000000000002",
    customerId,
    "Max Billing",
    "max@example.com",
    time,
    time,
  );
  contact.run(
    "70000000-0000-4000-8000-000000000003",
    customerId,
    "Max Duplicate",
    "MAX@example.com",
    time,
    time,
  );
  contact.run(
    "70000000-0000-4000-8000-000000000004",
    customerId,
    "",
    "",
    time,
    time,
  );
  const setting = legacy.prepare("INSERT INTO settings VALUES (?,?,?)");
  setting.run("company_name", "Own company", time);
  setting.run("revenue_folder", folder, time);
  setting.run("openai_api_key", secret, time);
  setting.run("google_refresh_token", "GOOGLE-SECRET-NEVER-COPY", time);
  setting.run("email_signature", mailCanary, time);
  legacy
    .prepare("INSERT INTO email_templates VALUES (?,?,?,?)")
    .run("email", mailCanary, mailCanary, mailCanary);
  legacy.close();
  return { databasePath, pdfPath, pdf, folder };
}

test("Legacy processing log import is opt-in, sanitized, mapped and idempotent without copying mail events", (t) => {
  const source = fixture(t);
  const legacy = new DatabaseSync(source.databasePath);
  legacy.exec(
    "CREATE TABLE processing_logs(id TEXT PRIMARY KEY,invoice_id TEXT,file_hash TEXT,process_type TEXT,status TEXT,message TEXT,created_at TEXT)",
  );
  const insert = legacy.prepare(
    "INSERT INTO processing_logs VALUES(?,?,?,?,?,?,?)",
  );
  const logId = "70000000-0000-4000-8000-000000000001";
  const bearer = "fixture-bearer-do-not-copy";
  insert.run(
    logId,
    revenueId,
    "invoice-hash",
    "process",
    "success",
    `Processed; ${secret}; Bearer ${bearer}; api_key=fixture-other-secret`,
    "2026-10-01 10:00:00",
  );
  insert.run(
    "legacy-processing-id",
    payableId,
    null,
    "ocr",
    "success",
    "OCR completed",
    time,
  );
  insert.run(
    "70000000-0000-4000-8000-000000000003",
    null,
    null,
    "scan",
    "success",
    null,
    time,
  );
  insert.run(
    "70000000-0000-4000-8000-000000000004",
    "missing-source-invoice",
    null,
    "extract",
    "failed",
    "Source invoice unavailable",
    time,
  );
  for (const type of ["email", "send_invoice", "gmail", "oauth_refresh"])
    insert.run(
      `excluded-${type}`,
      revenueId,
      null,
      type,
      "success",
      mailCanary,
      time,
    );
  legacy.close();
  const before = digest(source.databasePath);
  const target = openDatabase(":memory:");
  t.after(() => target.close());
  const finance = createFinance(target, { clock: () => time });
  finance.record({
    id: revenueId,
    category: "payable",
    counterparty_name: "Unrelated target invoice",
  });
  importLegacy(source.databasePath, finance, { dryRun: false });
  assert.equal(
    target.prepare("SELECT count(*) AS n FROM finance_processing_logs").get().n,
    0,
  );
  const dryRun = importLegacy(source.databasePath, null, { includeLogs: true });
  assert.equal(dryRun.processing_logs, 4);
  assert.equal(dryRun.excluded_logs, 4);
  const imported = importLegacy(source.databasePath, finance, {
    dryRun: false,
    includeLogs: true,
  });
  assert.equal(imported.logs_imported, 4);
  assert.equal(imported.logs_skipped, 0);
  const rows = target
    .prepare("SELECT * FROM finance_processing_logs ORDER BY id")
    .all();
  const linked = rows.find((row) => row.id === logId);
  assert.equal(linked.invoice_id, finance.findLegacyInvoice(revenueId).id);
  assert.notEqual(linked.invoice_id, revenueId);
  assert.equal(linked.created_at, time);
  const mapped = rows.find((row) => row.process_type === "ocr");
  assert.match(
    mapped.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(mapped.invoice_id, finance.findLegacyInvoice(payableId).id);
  assert.equal(rows.filter((row) => row.invoice_id === null).length, 2);
  const serialized = JSON.stringify(rows);
  for (const canary of [secret, bearer, "fixture-other-secret", mailCanary])
    assert.equal(serialized.includes(canary), false);
  assert.equal(linked.message.includes("Zugangsdaten entfernt"), true);
  const repeated = importLegacy(source.databasePath, finance, {
    dryRun: false,
    includeLogs: true,
  });
  assert.equal(repeated.logs_imported, 0);
  assert.equal(repeated.logs_skipped, 4);
  assert.deepEqual(
    target.prepare("SELECT * FROM finance_processing_logs ORDER BY id").all(),
    rows,
  );
  assert.equal(digest(source.databasePath), before);
});

test("Legacy historical paid invoices preserve unknown payment dates and absent or empty corrections", (t) => {
  const source = fixture(t);
  const legacy = new DatabaseSync(source.databasePath);
  legacy.prepare("UPDATE invoices SET paid_at=NULL WHERE id=?").run(payableId);
  legacy
    .prepare(
      "UPDATE invoice_overrides SET override_value='' WHERE invoice_id=? AND field_name='paid_at'",
    )
    .run(revenueId);
  legacy.close();
  const before = digest(source.databasePath);
  const target = openDatabase(":memory:");
  t.after(() => target.close());
  const finance = createFinance(target, {
    clock: () => "2026-10-20T09:00:00.000Z",
  });
  const imported = importLegacy(source.databasePath, finance, {
    dryRun: false,
  });
  assert.equal(imported.imported, 2);
  const revenue = finance.findLegacyInvoice(revenueId),
    payable = finance.findLegacyInvoice(payableId);
  assert.equal(revenue.status, "paid");
  assert.equal(revenue.paid_at, null);
  assert.equal(Object.hasOwn(revenue.overrides, "paid_at"), true);
  assert.equal(revenue.overrides.paid_at, null);
  assert.equal(payable.status, "paid");
  assert.equal(payable.paid_at, null);
  assert.equal(Object.hasOwn(payable.overrides, "paid_at"), false);
  assert.equal(revenue.updated_at, time);
  assert.equal(payable.updated_at, time);
  finance.update(payable.id, { total_amount_minor: 2000 });
  assert.equal(finance.get(payable.id).paid_at, null);
  finance.update(payable.id, { status: "open" });
  assert.equal(
    finance.update(payable.id, { status: "paid" }).paid_at,
    "2026-10-20",
  );
  assert.equal(digest(source.databasePath), before);
});

test("Legacy processing log collisions preserve target logs and invalid source logs roll back before writes", (t) => {
  const source = fixture(t);
  const legacy = new DatabaseSync(source.databasePath);
  legacy.exec(
    "CREATE TABLE processing_logs(id TEXT PRIMARY KEY,invoice_id TEXT,process_type TEXT,status TEXT,message TEXT,created_at TEXT)",
  );
  const logId = "70000000-0000-4000-8000-000000000005";
  legacy
    .prepare("INSERT INTO processing_logs VALUES(?,?,?,?,?,?)")
    .run(logId, revenueId, "process", "success", "Legacy log", time);
  legacy.close();
  const target = openDatabase(":memory:");
  t.after(() => target.close());
  const finance = createFinance(target, { clock: () => time });
  finance.importProcessingLog({
    id: logId,
    invoice_id: null,
    process_type: "manual",
    status: "success",
    message: "Existing target log",
    created_at: time,
  });
  const before = target
    .prepare("SELECT * FROM finance_processing_logs WHERE id=?")
    .get(logId);
  const imported = importLegacy(source.databasePath, finance, {
    dryRun: false,
    includeLogs: true,
  });
  assert.equal(imported.logs_imported, 0);
  assert.equal(imported.logs_skipped, 1);
  assert.deepEqual(
    target
      .prepare("SELECT * FROM finance_processing_logs WHERE id=?")
      .get(logId),
    before,
  );
  const broken = new DatabaseSync(source.databasePath);
  broken
    .prepare("UPDATE processing_logs SET created_at=? WHERE id=?")
    .run("invalid-time", logId);
  broken.close();
  const fresh = openDatabase(":memory:");
  t.after(() => fresh.close());
  assert.throws(
    () =>
      importLegacy(source.databasePath, createFinance(fresh), {
        dryRun: false,
        includeLogs: true,
      }),
    (error) => error.code === "legacy_import_invalid",
  );
  assert.equal(
    fresh.prepare("SELECT count(*) AS n FROM finance_invoices").get().n,
    0,
  );
  assert.equal(fresh.prepare("SELECT count(*) AS n FROM customers").get().n, 0);
});

test("Legacy inspection and default import are read-only, sanitized and do not need a target", (t) => {
  const source = fixture(t);
  const before = digest(source.databasePath);
  const inspected = inspectLegacy(source.databasePath);
  assert.equal(inspected.schema_version, 3);
  assert.equal(inspected.invoices, 2);
  assert.equal(inspected.revenue, 1);
  assert.equal(inspected.payables, 1);
  assert.equal(inspected.overrides, 3);
  assert.deepEqual(inspected.files, {
    available: 1,
    missing: 1,
    invalid: 0,
    oversize: 0,
  });
  assert.deepEqual(inspected.available_settings, [
    "revenue_folder",
    "company_name",
  ]);
  const result = importLegacy(source.databasePath);
  assert.equal(result.dry_run, true);
  assert.equal(result.imported, 0);
  const serialized = JSON.stringify(result);
  for (const excluded of [
    secret,
    mailCanary,
    "GOOGLE-SECRET",
    "billing@example.com",
    "Invoice Street",
    "CREDIT-1",
    "-123.45",
  ])
    assert.equal(serialized.includes(excluded), false);
  assert.equal(digest(source.databasePath), before);
  assert.equal(
    digest(source.pdfPath),
    createHash("sha256").update(source.pdf).digest("hex"),
  );
});

test("Legacy import preserves original extraction, corrections, credits, PDFs and existing CRM data", (t) => {
  const source = fixture(t);
  const before = digest(source.databasePath);
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const crm = createCRM(db);
  const existing = crm.createEntity("customers", {
    name: "Acme GmbH",
    note: "Keep CRM note",
    website: "https://example.com",
  });
  const unrelated = crm.createEntity("customers", {
    name: "Unrelated prospect",
    note: "Do not remove",
  });
  crm.createEntity("employees", {
    customer_id: existing.id,
    name: "Anna Existing",
    email: "ANNA@example.com",
    position: "Keep position",
  });
  const finance = createFinance(db);
  finance.updateCustomer(existing.id, {
    general_email: "existing@example.com",
  });
  const result = importLegacy(source.databasePath, finance, { dryRun: false });
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 0);
  const revenue = finance.findLegacyInvoice(revenueId);
  assert.equal(revenue.id, revenueId);
  const detail = finance.get(revenue.id);
  assert.equal(detail.total_amount_minor, -10001);
  assert.equal(detail.status, "paid");
  assert.equal(detail.paid_at, "2026-10-02");
  assert.equal(detail.send_date, "2026-10-02");
  assert.equal(detail.due_date, "2026-10-15");
  assert.equal(detail.customer_id, existing.id);
  const stored = db
    .prepare("SELECT * FROM finance_invoices WHERE id = ?")
    .get(revenue.id);
  assert.equal(stored.total_amount_minor, -12345);
  assert.equal(
    stored.extracted_json,
    '{"total_amount": -123.45, "currency": "EUR"}',
  );
  assert.equal(stored.ocr_text, "Invoice OCR text");
  assert.deepEqual(Buffer.from(stored.pdf_data), source.pdf);
  assert.equal(stored.tax_amount_minor, -2058);
  assert.equal(stored.created_at, time);
  assert.equal(stored.updated_at, time);
  const payable = finance.get(payableId);
  assert.equal(payable.total_amount_minor, 999);
  assert.equal(payable.net_amount_minor, 999);
  assert.equal(payable.has_file, false);
  assert.deepEqual(payable.tags, ["SaaS", "Domain"]);
  const targetCustomer = crm.entity("customers", existing.id);
  assert.equal(targetCustomer.name, "Acme GmbH");
  assert.equal(targetCustomer.note, "Keep CRM note");
  assert.equal(targetCustomer.website, "https://example.com/");
  assert.equal(crm.entity("customers", unrelated.id).note, "Do not remove");
  const profile = db
    .prepare("SELECT * FROM finance_customer_profiles WHERE customer_id = ?")
    .get(existing.id);
  assert.equal(profile.billing_address, "Invoice Street 1");
  assert.equal(profile.general_email, "existing@example.com");
  const contacts = targetCustomer.employees;
  assert.equal(contacts.length, 2);
  assert.equal(
    contacts.find(
      (contact) => contact.email.toLowerCase() === "anna@example.com",
    ).name,
    "Anna Existing",
  );
  assert.equal(
    contacts.find(
      (contact) => contact.email.toLowerCase() === "anna@example.com",
    ).position,
    "Keep position",
  );
  finance.update(revenue.id, { total_amount_minor: -9000 });
  const repeated = importLegacy(source.databasePath, finance, {
    dryRun: false,
  });
  assert.equal(repeated.imported, 0);
  assert.equal(repeated.skipped, 2);
  assert.equal(finance.get(revenue.id).total_amount_minor, -9000);
  assert.equal(crm.entity("customers", existing.id).employees.length, 2);
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM finance_invoices").get().count,
    2,
  );
  finance.reset(revenue.id);
  assert.equal(finance.get(revenue.id).total_amount_minor, -12345);
  assert.equal(finance.get(revenue.id).status, "open");
  const targetTables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  assert.equal(targetTables.includes("email_templates"), false);
  const settings = JSON.stringify(
    db.prepare("SELECT * FROM finance_settings").all(),
  );
  assert.equal(settings.includes(secret), false);
  assert.equal(settings.includes("GOOGLE-SECRET"), false);
  assert.equal(settings.includes(mailCanary), false);
  assert.equal(digest(source.databasePath), before);
});

test("Legacy import validates all financial values before writes and rolls back target failures", (t) => {
  const invalid = fixture(t, { invalidDate: true });
  assert.throws(() => inspectLegacy(invalid.databasePath), /ungültiges Datum/);
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const finance = createFinance(db);
  assert.throws(
    () => importLegacy(invalid.databasePath, finance, { dryRun: false }),
    /ungültiges Datum/,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM finance_invoices").get().count,
    0,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM customers").get().count,
    0,
  );
  const valid = fixture(t);
  let writes = 0;
  const failing = new Proxy(finance, {
    get(target, property) {
      if (property === "record")
        return (input) => {
          if (++writes === 2) throw new Error("Target write failed");
          return target.record(input);
        };
      return target[property];
    },
  });
  assert.throws(
    () => importLegacy(valid.databasePath, failing, { dryRun: false }),
    /Target write failed/,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM finance_invoices").get().count,
    0,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM customers").get().count,
    0,
  );
});

test("Legacy invoice ID collisions preserve existing target invoices", (t) => {
  const source = fixture(t);
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const finance = createFinance(db);
  finance.record({
    id: revenueId,
    category: "revenue",
    counterparty_name: "Existing invoice",
    total_amount_minor: 42,
    currency: "EUR",
    file_hash: "b".repeat(64),
    extracted_json: "{}",
    ingestion_status: "processed",
  });
  const result = importLegacy(source.databasePath, finance, { dryRun: false });
  assert.equal(result.imported, 2);
  assert.equal(finance.get(revenueId).total_amount_minor, 42);
  assert.equal(finance.get(revenueId).counterparty_name, "Existing invoice");
  const imported = finance.findLegacyInvoice(revenueId);
  assert.notEqual(imported.id, revenueId);
  assert.match(imported.id, /^[0-9a-f-]{36}$/);
  assert.equal(finance.get(imported.id).total_amount_minor, -10001);
  assert.equal(
    importLegacy(source.databasePath, finance, { dryRun: false }).skipped,
    2,
  );
});

test("Legacy IDs and customer ID collisions map safely without duplicate customers", (t) => {
  const source = fixture(t);
  const legacy = new DatabaseSync(source.databasePath);
  const legacyId = "legacy-legacy-invoice-id";
  legacy
    .prepare("UPDATE invoices SET id = ? WHERE id = ?")
    .run(legacyId, revenueId);
  legacy
    .prepare("UPDATE invoice_overrides SET invoice_id = ? WHERE invoice_id = ?")
    .run(legacyId, revenueId);
  legacy
    .prepare("UPDATE customers SET enrichment_source_invoice_id = ?")
    .run(legacyId);
  legacy.close();
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  db.prepare(
    "INSERT INTO customers(id,name,note,website,created_at,updated_at,archived_at) VALUES(?,?,'Keep existing','',?,?,NULL)",
  ).run(customerId, "Unrelated customer with same UUID", time, time);
  const finance = createFinance(db);
  importLegacy(source.databasePath, finance, { dryRun: false });
  const imported = finance.findLegacyInvoice(legacyId);
  assert.match(
    imported.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.notEqual(imported.customer_id, customerId);
  assert.equal(
    db.prepare("SELECT name,note FROM customers WHERE id = ?").get(customerId)
      .note,
    "Keep existing",
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM customers").get().count,
    2,
  );
  assert.equal(
    importLegacy(source.databasePath, finance, { dryRun: false }).skipped,
    2,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM customers").get().count,
    2,
  );
  assert.equal(finance.findLegacyInvoice(legacyId).id, imported.id);
});

test("schema 10 import mappings remain idempotent after source identifiers are renamed", (t) => {
  const source = fixture(t);
  const legacy = new DatabaseSync(source.databasePath);
  legacy.exec(
    "CREATE TABLE processing_logs(id TEXT PRIMARY KEY,invoice_id TEXT,process_type TEXT,status TEXT,message TEXT,created_at TEXT)",
  );
  legacy
    .prepare("INSERT INTO processing_logs VALUES(?,?,?,?,?,?)")
    .run(
      "original-processing-log",
      revenueId,
      "process",
      "success",
      "Original log",
      time,
    );
  legacy.close();
  const filename = path.join(source.folder, "existing.sqlite");
  let db = openDatabase(filename);
  db.prepare(
    "INSERT INTO finance_settings(key,value,updated_at) VALUES('legacy_import_namespace','previous',?)",
  ).run(time);
  let finance = createFinance(db);
  finance.record({
    id: revenueId,
    category: "payable",
    counterparty_name: "Unrelated invoice",
  });
  const first = importLegacy(source.databasePath, finance, {
    dryRun: false,
    includeLogs: true,
  });
  assert.equal(first.imported, 2);
  assert.equal(first.logs_imported, 1);
  const tables = [
    "finance_invoices",
    "finance_processing_logs",
    "customers",
    "employees",
  ];
  const before = new Map(
    tables.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
    ]),
  );
  db.exec(
    "ALTER TABLE finance_invoices RENAME COLUMN source_legacy_id TO source_previous_id; DELETE FROM finance_settings WHERE key='legacy_import_namespace'; DROP TABLE customer_tag_assignments; PRAGMA user_version=10;",
  );
  db.close();
  db = openDatabase(filename);
  t.after(() => db.close());
  finance = createFinance(db);
  assert.equal(finance.importNamespace(), "previous");
  const repeated = importLegacy(source.databasePath, finance, {
    dryRun: false,
    includeLogs: true,
  });
  assert.equal(repeated.imported, 0);
  assert.equal(repeated.skipped, 2);
  assert.equal(repeated.logs_imported, 0);
  assert.equal(repeated.logs_skipped, 1);
  for (const table of tables)
    assert.deepEqual(
      db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      before.get(table),
    );
});

test("Legacy source cannot be used as the writable target", (t) => {
  const source = fixture(t);
  const before = digest(source.databasePath);
  assert.throws(
    () =>
      importLegacy(
        source.databasePath,
        { databasePath: source.databasePath },
        { dryRun: false },
      ),
    /Quell- und Zieldatenbank/,
  );
  assert.equal(digest(source.databasePath), before);
});

test("Legacy CLI dry-run leaves target unopened; apply backs up before migration and preserves source", (t) => {
  const source = fixture(t);
  const target = path.join(source.folder, "pitchary.sqlite");
  const script = path.join(projectRoot, "scripts/import-legacy.js");
  const missingSource = spawnSync(
    process.execPath,
    [script, "--database", target, "--apply"],
    { cwd: projectRoot, encoding: "utf8" },
  );
  assert.equal(missingSource.status, 1);
  assert.match(missingSource.stderr, /Quelldatenbank/);
  assert.equal(readdirSync(source.folder).includes("pitchary.sqlite"), false);
  const run = (...args) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          script,
          "--source",
          source.databasePath,
          "--database",
          target,
          ...args,
        ],
        { cwd: projectRoot, encoding: "utf8" },
      ),
    );
  const dry = run();
  assert.equal(dry.dry_run, true);
  assert.equal(readdirSync(source.folder).includes("pitchary.sqlite"), false);
  const legacyTarget = new DatabaseSync(target);
  legacyTarget.exec(
    "CREATE TABLE original_sentinel (note TEXT); INSERT INTO original_sentinel VALUES ('Keep before migration');",
  );
  legacyTarget.close();
  const sourceBefore = digest(source.databasePath);
  const result = run("--apply");
  assert.equal(result.imported, 2);
  assert.equal(result.dry_run, false);
  assert.ok(result.backup_path);
  const saved = new DatabaseSync(result.backup_path, { readOnly: true });
  assert.equal(saved.prepare("PRAGMA user_version").get().user_version, 0);
  assert.equal(
    saved.prepare("SELECT note FROM original_sentinel").get().note,
    "Keep before migration",
  );
  assert.equal(
    saved
      .prepare(
        "SELECT count(*) AS count FROM sqlite_schema WHERE name = 'finance_invoices'",
      )
      .get().count,
    0,
  );
  saved.close();
  const destination = new DatabaseSync(target, { readOnly: true });
  assert.equal(
    destination.prepare("SELECT count(*) AS count FROM finance_invoices").get()
      .count,
    2,
  );
  assert.equal(
    destination.prepare("SELECT note FROM original_sentinel").get().note,
    "Keep before migration",
  );
  destination.close();
  assert.equal(digest(source.databasePath), sourceBefore);
});
