import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase } from "../src/database/database.js";
import { createFinance } from "../src/business/finance.js";
import { seedDemo } from "../scripts/seed.js";
import { invoicePDF } from "./fixtures/finance-pdf.js";

function schema10(t) {
  const folder = mkdtempSync(path.join(tmpdir(), "pitchary-source-migration-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "previous.sqlite");
  const db = openDatabase(filename);
  seedDemo(db);
  const finance = createFinance(db);
  const customer = db.prepare("SELECT id FROM customers ORDER BY id").get();
  const invoice = finance.record({
    source_legacy_id: "source-001",
    customer_id: customer.id,
    counterparty_name: "Migration fixture",
    total_amount_minor: 12000,
    invoice_date: "2026-10-01",
    pdf_data: invoicePDF(),
    file_name: "retained.pdf",
  });
  finance.update(invoice.id, { total_amount_minor: 15000, status: "paid" });
  finance.log(invoice.id, "import", "success", "Preserve log");
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='finance_settings' ORDER BY name",
    )
    .all()
    .map(({ name }) => name);
  const before = new Map(
    tables.map((table) => [
      table,
      db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
  db.exec(
    "ALTER TABLE finance_invoices RENAME COLUMN source_legacy_id TO source_previous_id; DROP TABLE customer_tag_assignments; PRAGMA user_version=10;",
  );
  db.close();
  return { filename, before, invoice };
}

test("migration 011 preserves complete invoice data, PDFs, corrections, logs, CRM history and unique source IDs", (t) => {
  const { filename, before, invoice } = schema10(t);
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = openDatabase(filename);
    try {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 12);
      for (const [table, rows] of before)
        assert.deepEqual(
          db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all(),
          rows,
        );
      const finance = createFinance(db);
      assert.equal(finance.importNamespace(), "previous");
      assert.equal(finance.findLegacyInvoice("source-001").id, invoice.id);
      assert.deepEqual(finance.file(invoice.id).data, invoicePDF());
      assert.equal(finance.get(invoice.id).total_amount_minor, 15000);
      assert.throws(
        () =>
          finance.record({
            id: "99999999-9999-4999-8999-999999999999",
            source_legacy_id: "source-001",
          }),
        /UNIQUE/,
      );
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(
        db.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok",
      );
    } finally {
      db.close();
    }
  }
});

test("a failed source-column migration rolls back the column, namespace and schema version together", (t) => {
  const { filename } = schema10(t);
  const broken = new DatabaseSync(filename);
  broken.exec(
    "PRAGMA foreign_keys=OFF; UPDATE finance_invoices SET customer_id='missing-customer';",
  );
  broken.close();
  assert.throws(
    () => openDatabase(filename),
    /Foreign key violation after migration/,
  );
  const unchanged = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(
      unchanged.prepare("PRAGMA user_version").get().user_version,
      10,
    );
    const columns = unchanged
      .prepare("PRAGMA table_info(finance_invoices)")
      .all()
      .map(({ name }) => name);
    assert.ok(columns.includes("source_previous_id"));
    assert.equal(columns.includes("source_legacy_id"), false);
    assert.equal(
      unchanged
        .prepare(
          "SELECT value FROM finance_settings WHERE key='legacy_import_namespace'",
        )
        .get(),
      undefined,
    );
  } finally {
    unchanged.close();
  }
});
