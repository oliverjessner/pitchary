import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFinance } from "../src/business/finance.js";
import { createCRM } from "../src/business/crm.js";
import { openDatabase, projectRoot } from "../src/database/database.js";
import { buildApp } from "../src/server/app.js";
import { seedLegacyDemo } from "./fixtures/legacy-database.js";
import { demoCustomerLogo } from "../scripts/demo-assets.js";

const fixedTime = "2026-10-13T07:00:00.000Z";
const pdf = Buffer.from("%PDF-1.4\n% Finance fixture\n%%EOF");
function fixture(t, filename = ":memory:") {
  const db = openDatabase(filename);
  t.after(() => {
    if (db.isOpen) db.close();
  });
  return {
    db,
    finance: createFinance(db, { clock: () => fixedTime }),
    crm: createCRM(db, { clock: () => fixedTime }),
  };
}
function invoice(finance, patch = {}) {
  return finance.record({
    category: "revenue",
    counterparty_name: "Studio Nord",
    invoice_number: "R-2026-001",
    invoice_date: "2026-10-01",
    due_date: "2026-10-10",
    total_amount_minor: 12345,
    currency: "EUR",
    file_name: "Rechnung.pdf",
    pdf_data: pdf,
    file_hash: "finance-fixture-hash",
    ingestion_status: "processed",
    extracted_json: ' {\n  "source": "fixture"\n} ',
    ...patch,
  });
}

test("finance records preserve raw extraction and PDF while partial reprocessing retains corrections", (t) => {
  const { finance, db } = fixture(t);
  const original = invoice(finance, {
    total_amount_minor: -1200,
    tax_amount_minor: -200,
    net_amount_minor: -1000,
    send_date: "2026-10-02",
  });
  assert.equal(original.total_amount_minor, -1200);
  assert.equal(original.has_file, true);
  assert.equal(original.pdf_data, undefined);
  assert.equal(original.original.pdf_data, undefined);
  assert.equal(original.extracted_json, ' {\n  "source": "fixture"\n} ');
  finance.update(original.id, {
    total_amount_minor: 9000,
    invoice_date: "2026-09-01",
    status: "paid",
  });
  const reprocessed = finance.record({
    id: original.id,
    total_amount_minor: 7000,
    extracted_json: '{"reprocessed":true}',
    ingestion_status: "processed",
  });
  assert.equal(reprocessed.total_amount_minor, 9000);
  assert.equal(reprocessed.original.total_amount_minor, 7000);
  assert.equal(reprocessed.invoice_date, "2026-09-01");
  assert.equal(reprocessed.original.invoice_date, "2026-10-01");
  assert.equal(reprocessed.send_date, "2026-10-02");
  assert.equal(reprocessed.status, "paid");
  assert.equal(reprocessed.paid_at, "2026-10-13");
  assert.deepEqual(finance.file(original.id).data, pdf);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM finance_invoices").get().n,
    1,
  );
  const resetOne = finance.reset(original.id, "total_amount_minor");
  assert.equal(resetOne.total_amount_minor, 7000);
  assert.equal(resetOne.status, "paid");
  const resetAll = finance.reset(original.id);
  assert.equal(resetAll.status, "open");
  assert.equal(resetAll.paid_at, null);
  assert.equal(resetAll.invoice_date, "2026-10-01");
  assert.deepEqual(resetAll.overrides, {});
});

test("finance matching reuses normalized CRM names, preserves branding, and excludes own company", (t) => {
  const { finance, crm, db } = fixture(t);
  const customer = crm.createEntity("customers", {
    name: "Äudit   Studio",
    note: "CRM note",
    website: "https://example.com",
    logo: demoCustomerLogo,
  });
  const before = db
    .prepare("SELECT rowid,* FROM customers WHERE id=?")
    .get(customer.id);
  const matched = invoice(finance, { counterparty_name: "A\u0308UDIT Studio" });
  assert.equal(matched.customer_id, customer.id);
  assert.deepEqual(
    db.prepare("SELECT rowid,* FROM customers WHERE id=?").get(customer.id),
    Object.assign(Object.create(null), before, { customer_type: "customer" }),
  );
  assert.equal(finance.customer(customer.id).has_logo, true);
  db.prepare(
    "INSERT INTO finance_settings(key,value,updated_at) VALUES('company_name',?,?)",
  ).run("Own Company", fixedTime);
  assert.equal(
    invoice(finance, { counterparty_name: " OWN   COMPANY " }).customer_id,
    null,
  );
  assert.equal(db.prepare("SELECT count(*) AS n FROM customers").get().n, 1);
  const payable = invoice(finance, {
    category: "payable",
    counterparty_name: "Supplier",
  });
  assert.equal(payable.customer_id, null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM customers").get().n, 1);
});

test("effective counterparty corrections and reprocessing update finance attribution without changing CRM customers", (t) => {
  const { finance, crm, db } = fixture(t);
  const old = crm.createEntity("customers", { name: "Original" });
  const target = crm.createEntity("customers", { name: "Corrected" });
  const row = invoice(finance, { counterparty_name: old.name });
  const corrected = finance.update(row.id, { counterparty_name: target.name });
  assert.equal(corrected.customer_id, target.id);
  assert.equal(corrected.original.customer_id, old.id);
  assert.equal(finance.customer(target.id).invoice_count, 1);
  assert.equal(finance.customer(old.id).invoice_count, 0);
  assert.equal(finance.reset(row.id, "counterparty_name").customer_id, old.id);
  const reprocessed = finance.record({
    id: row.id,
    counterparty_name: target.name,
  });
  assert.equal(reprocessed.customer_id, target.id);
  assert.equal(db.prepare("SELECT count(*) AS n FROM customers").get().n, 2);
  const unlinked = finance.update(row.id, { customer_id: null });
  assert.equal(unlinked.customer_id, null);
  assert.equal(
    finance.record({ id: row.id, counterparty_name: "Later extraction" })
      .customer_id,
    null,
  );
  assert.equal(finance.reset(row.id).counterparty_name, "Later extraction");
});

test("customer renames retain source aliases through reprocessing, future invoices and removal of historical invoices", (t) => {
  const { finance, crm, db } = fixture(t);
  const original = invoice(finance, { counterparty_name: "Original Company" });
  finance.updateCustomer(original.customer_id, { name: "Renamed Company" });
  const reprocessed = finance.record({
    id: original.id,
    counterparty_name: " ORIGINAL   COMPANY ",
  });
  assert.equal(reprocessed.customer_id, original.customer_id);
  assert.equal(reprocessed.customer_name, "Renamed Company");
  const future = invoice(finance, {
    counterparty_name: "Original Company",
    invoice_number: "Future",
  });
  assert.equal(future.customer_id, original.customer_id);
  assert.equal(db.prepare("SELECT count(*) AS n FROM customers").get().n, 1);
  finance.remove(original.id);
  finance.remove(future.id);
  assert.equal(finance.customer(original.customer_id).invoice_count, 0);
  crm.updateEntity("customers", original.customer_id, {
    name: "Another rename in CRM",
  });
  const later = invoice(finance, {
    counterparty_name: "Original Company",
    invoice_number: "Later",
  });
  assert.equal(later.customer_id, original.customer_id);
  assert.equal(later.customer_name, "Another rename in CRM");
  assert.equal(db.prepare("SELECT count(*) AS n FROM customers").get().n, 1);
  const aliases = JSON.parse(
    db
      .prepare(
        "SELECT value FROM finance_settings WHERE key='finance_customer_aliases'",
      )
      .get().value,
  );
  assert.equal(aliases["original company"], original.customer_id);
  assert.equal(aliases["renamed company"], original.customer_id);
});

test("customer aliases preserve imported source identity, validate targets, and prefer current CRM names", (t) => {
  const { finance, crm, db } = fixture(t);
  const imported = finance.importCustomer({
    name: "Imported display name",
    source_name: "Legacy invoice name",
  });
  assert.equal(
    invoice(finance, { counterparty_name: "Legacy invoice name" }).customer_id,
    imported.id,
  );
  const other = crm.createEntity("customers", { name: "Other company" });
  assert.equal(
    invoice(finance, {
      counterparty_name: "Legacy invoice name",
      customer_id: other.id,
    }).customer_id,
    other.id,
  );
  assert.equal(
    invoice(finance, { counterparty_name: "Legacy invoice name" }).customer_id,
    imported.id,
  );
  const currentName = crm.createEntity("customers", {
    name: "Legacy invoice name",
  });
  assert.equal(
    invoice(finance, { counterparty_name: "Legacy invoice name" }).customer_id,
    currentName.id,
  );
  const explicit = invoice(finance, {
    counterparty_name: "Alternate billing identity",
    customer_id: other.id,
  });
  assert.equal(
    invoice(finance, { counterparty_name: "Alternate billing identity" })
      .customer_id,
    explicit.customer_id,
  );
  const aliases = JSON.parse(
    db
      .prepare(
        "SELECT value FROM finance_settings WHERE key='finance_customer_aliases'",
      )
      .get().value,
  );
  aliases.invalid = "not-a-uuid";
  aliases.stale = randomUUID();
  db.prepare(
    "UPDATE finance_settings SET value=? WHERE key='finance_customer_aliases'",
  ).run(JSON.stringify(aliases));
  const stale = invoice(finance, { counterparty_name: "Stale" });
  assert.notEqual(stale.customer_id, aliases.stale);
  assert.equal(
    invoice(finance, { counterparty_name: "Invalid" }).customer_name,
    "Invalid",
  );
});

test("invoice relationship links enforce ownership and survive relationship deletion as retained finance records", (t) => {
  const { finance, crm, db } = fixture(t);
  const customer = crm.createEntity("customers", { name: "Customer" });
  const other = crm.createEntity("customers", { name: "Other" });
  const service = crm.createEntity("services", { name: "Service" });
  const relationship = crm.createRelationship({
    customer_id: customer.id,
    service_id: service.id,
    current_offered_price_minor: 1000,
  });
  const row = invoice(finance, {
    customer_id: customer.id,
    customer_service_id: relationship.id,
  });
  assert.equal(row.service_name, "Service");
  assert.throws(
    () =>
      finance.update(row.id, {
        customer_id: other.id,
        customer_service_id: relationship.id,
      }),
    (error) => error.status === 422,
  );
  assert.throws(
    () =>
      finance.record({
        customer_id: other.id,
        customer_service_id: relationship.id,
      }),
    (error) => error.status === 422,
  );
  assert.equal(finance.get(row.id).customer_id, customer.id);
  assert.throws(
    () =>
      db
        .prepare("UPDATE finance_invoices SET customer_id=? WHERE id=?")
        .run(other.id, row.id),
    /another customer/,
  );
  const unlinked = finance.update(row.id, { customer_id: other.id });
  assert.equal(unlinked.customer_service_id, null);
  assert.equal(finance.reset(row.id).customer_service_id, relationship.id);
  finance.update(row.id, { customer_service_id: relationship.id });
  crm.deleteRelationship(relationship.id);
  assert.equal(finance.get(row.id).customer_service_id, null);
  assert.equal(finance.get(row.id).customer_id, customer.id);
  assert.deepEqual(finance.file(row.id).data, pdf);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("finance updates validate all fields and roll back newly matched customers and corrections together", (t) => {
  const { finance, db } = fixture(t);
  const row = invoice(finance);
  const before = finance.get(row.id);
  for (const patch of [
    { total_amount_minor: 1.5 },
    { total_amount_minor: 1000000000001 },
    { total_amount_minor: NaN },
    { invoice_date: "2026-02-30" },
    { due_date: "yesterday" },
    { currency: "euR" },
    { status: "done" },
    { customer_id: randomUUID() },
    { ingestion_status: "processed" },
    { send_date: "2026-10-03" },
    { category: "anything" },
    { paid_at: "2026-10-01" },
    { tags: ["Device"] },
    { tags: ["<script>"] },
    { status: "paid", total_amount_minor: "1.00" },
  ]) {
    assert.throws(() => finance.update(row.id, patch));
    assert.deepEqual(finance.get(row.id), before);
  }
  db.exec(
    "CREATE TRIGGER fail_finance_override BEFORE INSERT ON finance_invoice_overrides WHEN NEW.field_name='total_amount_minor' BEGIN SELECT RAISE(ABORT,'test finance failure'); END",
  );
  const count = db.prepare("SELECT count(*) AS n FROM customers").get().n;
  assert.throws(
    () =>
      finance.update(row.id, {
        counterparty_name: "Created then rolled back",
        total_amount_minor: 999,
      }),
    /test finance failure/,
  );
  assert.deepEqual(finance.get(row.id), before);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM customers").get().n,
    count,
  );
});

test("paid status and canonical payable tags support reopen and reversible corrections", (t) => {
  const { finance } = fixture(t);
  const row = invoice(finance, {
    category: "payable",
    counterparty_name: "Supplier",
    tags: ["saas", "DEVICE", "SaaS"],
  });
  assert.deepEqual(row.tags, ["Device", "SaaS"]);
  const paid = finance.update(row.id, {
    status: "paid",
    paid_at: "2026-10-03",
    tags: ["Rent"],
  });
  assert.equal(paid.paid_at, "2026-10-03");
  assert.deepEqual(paid.tags, ["Rent"]);
  assert.equal(finance.update(row.id, { status: "open" }).paid_at, null);
  assert.equal(finance.reset(row.id, "tags").tags[1], "SaaS");
  assert.equal(
    finance.update(row.id, { category: "revenue", counterparty_name: "Client" })
      .customer_name,
    "Client",
  );
  assert.equal(finance.reset(row.id, "category").customer_id, null);
});

test("dashboard uses effective dates, statuses and integer amounts separately per currency including credits", (t) => {
  const { finance } = fixture(t);
  const a = invoice(finance, {
    total_amount_minor: 10001,
    invoice_date: "2026-10-01",
    due_date: "2026-10-12",
  });
  invoice(finance, {
    total_amount_minor: -1001,
    invoice_date: "2026-10-02",
    status: "paid",
    paid_at: "2026-10-04",
  });
  invoice(finance, {
    category: "payable",
    counterparty_name: "Supplier",
    total_amount_minor: 3000,
    invoice_date: "2026-10-03",
    due_date: "2026-10-12",
  });
  invoice(finance, {
    category: "payable",
    counterparty_name: "Supplier",
    total_amount_minor: -200,
    invoice_date: "2026-10-03",
    status: "paid",
  });
  invoice(finance, {
    currency: "USD",
    total_amount_minor: 999999,
    invoice_date: "2026-10-03",
    due_date: "2026-10-12",
  });
  invoice(finance, {
    total_amount_minor: 111,
    invoice_date: "2025-10-03",
    due_date: null,
  });
  invoice(finance, {
    total_amount_minor: 777,
    invoice_date: null,
    due_date: null,
  });
  const stats = finance.dashboard({ year: "2026", month: "10" });
  const eur = stats.currencies.find((row) => row.currency === "EUR"),
    usd = stats.currencies.find((row) => row.currency === "USD");
  assert.deepEqual(eur.month, { revenue: 9000, payable: 2800, profit: 6200 });
  assert.equal(usd.month.revenue, 999999);
  assert.equal(eur.overdue.revenue, 10001);
  assert.equal(eur.overdue.payable, 3000);
  assert.equal(stats.months.length, 24);
  assert.deepEqual(stats.years, ["2026", "2025"]);
  finance.update(a.id, {
    invoice_date: "2025-10-01",
    total_amount_minor: 1200,
    status: "paid",
  });
  const changed = finance.dashboard({ year: "2026", month: "10" });
  assert.equal(
    changed.currencies.find((row) => row.currency === "EUR").month.revenue,
    -1001,
  );
  assert.equal(
    changed.currencies.find((row) => row.currency === "EUR").overdue.revenue,
    0,
  );
  assert.equal(
    changed.top_revenue.find((row) => row.currency === "EUR")
      .total_amount_minor,
    -1001,
  );
  assert.equal(
    finance
      .dashboard({ year: "2025", month: "10" })
      .currencies.find((row) => row.currency === "EUR").month.revenue,
    1311,
  );
  assert.throws(
    () => finance.dashboard({ year: "2026", month: "13" }),
    (error) => error.status === 422,
  );
});

test("invoice filters and sort use effective corrections while undated documents remain visible", (t) => {
  const { finance } = fixture(t);
  const a = invoice(finance, {
    invoice_date: "2025-01-01",
    invoice_number: "R-2",
    total_amount_minor: 20,
  });
  const b = invoice(finance, {
    invoice_date: "2026-01-01",
    invoice_number: "R-10",
    total_amount_minor: 10,
  });
  const unknown = invoice(finance, {
    invoice_date: null,
    due_date: null,
    invoice_number: null,
    file_name: "undated.pdf",
    total_amount_minor: 5,
  });
  finance.update(a.id, {
    invoice_date: "2026-10-01",
    status: "paid",
    counterparty_name: "Renamed",
  });
  assert.deepEqual(
    finance.list({ search: "renamed" }).map((row) => row.id),
    [a.id],
  );
  assert.equal(finance.list({ year: "2026" }).length, 3);
  assert.deepEqual(
    finance.list({ status: "overdue" }).map((row) => row.id),
    [b.id],
  );
  assert.deepEqual(
    finance.list({ from: "2026-02-01", to: "2026-12-31" }).map((row) => row.id),
    [a.id],
  );
  assert.deepEqual(
    finance
      .list({ sort: "total_amount_minor", order: "asc" })
      .map((row) => row.id),
    [unknown.id, b.id, a.id],
  );
  assert.deepEqual(
    finance.list({ sort: "invoice_number", order: "asc" }).map((row) => row.id),
    [unknown.id, a.id, b.id],
  );
  assert.deepEqual(finance.years(), ["2026"]);
  assert.throws(() =>
    finance.list({ sort: "total_amount_minor;DROP TABLE customers" }),
  );
});

test("customer revenue projections and billing profiles reuse CRM contacts and preserve branding atomically", (t) => {
  const { finance, crm, db } = fixture(t);
  const customer = crm.createEntity("customers", {
    name: "Customer",
    note: "Keep",
    website: "https://example.com",
    logo: demoCustomerLogo,
  });
  const employee = crm.createEntity("employees", {
    customer_id: customer.id,
    name: "Existing contact",
    email: "hello@example.com",
  });
  invoice(finance, {
    customer_id: customer.id,
    counterparty_name: "Customer",
    invoice_date: "2026-08-01",
    total_amount_minor: 9000,
  });
  const paid = invoice(finance, {
    customer_id: customer.id,
    counterparty_name: "Customer",
    invoice_date: "2026-10-01",
    total_amount_minor: -1000,
    status: "paid",
  });
  invoice(finance, {
    customer_id: customer.id,
    counterparty_name: "Customer",
    currency: "USD",
    total_amount_minor: 15000,
  });
  const detail = finance.updateCustomer(customer.id, {
    name: "Customer updated",
    billing_address: "Example street 1",
    general_email: "billing@example.com",
    enrichment_status: "completed",
    enriched_at: fixedTime,
    enrichment_invoice_id: paid.id,
  });
  assert.equal(detail.invoice_count, 3);
  assert.equal(detail.active_months, 3);
  assert.equal(detail.first_invoice_date, "2026-08-01");
  assert.equal(detail.last_invoice_date, "2026-10-01");
  assert.equal(
    detail.currencies.find((row) => row.currency === "EUR")
      .lifetime_value_minor,
    8000,
  );
  assert.equal(
    detail.currencies.find((row) => row.currency === "EUR")
      .avg_monthly_revenue_minor,
    2667,
  );
  assert.equal(detail.employees[0].id, employee.id);
  assert.equal(detail.invoices.length, 3);
  assert.equal(detail.note, "Keep");
  assert.equal(detail.has_logo, true);
  const before = finance.customer(customer.id);
  assert.throws(() =>
    finance.updateCustomer(customer.id, {
      name: "Must not save",
      general_email: "invalid",
    }),
  );
  assert.deepEqual(finance.customer(customer.id), before);
  db.exec(
    "CREATE TRIGGER fail_finance_profile BEFORE UPDATE ON finance_customer_profiles BEGIN SELECT RAISE(ABORT,'test profile failure'); END",
  );
  assert.throws(
    () =>
      finance.updateCustomer(customer.id, {
        name: "Must not save",
        billing_address: "Other address",
      }),
    /test profile failure/,
  );
  assert.deepEqual(finance.customer(customer.id), before);
  db.exec("DROP TRIGGER fail_finance_profile");
  crm.archive("customers", customer.id);
  assert.equal(finance.customers()[0].id, customer.id);
  assert.equal(finance.customers({ archived: true })[0].id, customer.id);
  assert.equal(finance.customers({ archived: false }).length, 0);
  const beforeArchivedEdit = finance.customer(customer.id);
  assert.throws(
    () =>
      finance.updateCustomer(customer.id, {
        name: "Archived rename",
        billing_address: "Must not save",
      }),
    (error) => error.status === 409 && error.code === "archived",
  );
  assert.deepEqual(finance.customer(customer.id), beforeArchivedEdit);
  assert.equal(
    finance.updateCustomer(customer.id, {
      name: "Customer updated",
      billing_address: "Historical billing address",
    }).billing_address,
    "Historical billing address",
  );
});

test("invoice deletion cascades finance metadata, retains CRM customers, and ignores the same watched source", (t) => {
  const { finance, db } = fixture(t);
  const row = invoice(finance, { file_path: "/tmp/finance-source.pdf" });
  finance.update(row.id, { total_amount_minor: 100 });
  finance.log(row.id, "extract", "processed", "Source processed");
  finance.updateCustomer(row.customer_id, { enrichment_invoice_id: row.id });
  assert.deepEqual(finance.remove(row.id), { ok: true });
  for (const table of [
    "finance_invoices",
    "finance_invoice_overrides",
    "finance_processing_logs",
  ])
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM customers").get().n, 1);
  assert.equal(finance.customer(row.customer_id).enrichment_invoice_id, null);
  assert.deepEqual(
    JSON.parse(
      db
        .prepare(
          "SELECT value FROM finance_settings WHERE key='finance_ignored_docs'",
        )
        .get().value,
    ),
    [
      {
        file_path: row.file_path,
        file_hash: row.file_hash,
        category: row.category,
      },
    ],
  );
  assert.throws(
    () => finance.get(row.id),
    (error) => error.status === 404,
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("deleting a watched invoice after a category correction retains its ingestion source identity", (t) => {
  const { finance, db } = fixture(t);
  const row = invoice(finance, {
    category: "revenue",
    file_path: "/tmp/finance-revenue-source.pdf",
  });
  assert.equal(
    finance.update(row.id, { category: "payable" }).category,
    "payable",
  );
  finance.remove(row.id);
  assert.deepEqual(
    JSON.parse(
      db
        .prepare(
          "SELECT value FROM finance_settings WHERE key='finance_ignored_docs'",
        )
        .get().value,
    ),
    [
      {
        file_path: row.file_path,
        file_hash: row.file_hash,
        category: "revenue",
      },
    ],
  );
});

test("Legacy import helpers match customers, fill empty data and contacts, and roll back nested imports", (t) => {
  const { finance, crm, db } = fixture(t);
  const existing = crm.createEntity("customers", {
    name: "Renamed customer",
    note: "Keep CRM",
  });
  finance.updateCustomer(existing.id, { billing_address: "Manual address" });
  const imported = finance.importCustomer({
    id: randomUUID(),
    name: "Renamed customer",
    source_name: "Legacy name",
    billing_address: "Imported address",
    general_email: "billing@example.com",
    contacts: [
      { id: randomUUID(), name: "Person", email: "person@example.com" },
    ],
  });
  assert.equal(imported.id, existing.id);
  assert.equal(imported.billing_address, "Manual address");
  assert.equal(imported.general_email, "billing@example.com");
  finance.importCustomer({
    name: "Renamed customer",
    contacts: [{ name: "Person", email: "person@example.com" }],
  });
  assert.equal(finance.customer(existing.id).employees.length, 1);
  const collision = finance.importCustomer({
    id: existing.id,
    name: "Unrelated source customer",
  });
  assert.notEqual(collision.id, existing.id);
  const row = invoice(finance, { source_legacy_id: "legacy-source-123" });
  assert.equal(finance.findLegacyInvoice("legacy-source-123").id, row.id);
  assert.equal(
    finance.record({
      source_legacy_id: "legacy-source-123",
      invoice_number: "Updated",
    }).id,
    row.id,
  );
  const counts = ["customers", "employees", "finance_invoices"].map(
    (table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,
  );
  assert.throws(
    () =>
      finance.importTransaction(() => {
        finance.importCustomer({
          name: "Rolled back",
          contacts: [{ name: "Added" }],
        });
        invoice(finance, { source_legacy_id: "rollback-source" });
        throw new Error("import failure");
      }),
    /import failure/,
  );
  assert.deepEqual(
    ["customers", "employees", "finance_invoices"].map(
      (table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,
    ),
    counts,
  );
  assert.equal(finance.findLegacyInvoice("rollback-source"), null);
});

test("finance API exposes effective records and scoped PDF bytes with structured errors", async (t) => {
  const app = await buildApp({
    databasePath: ":memory:",
    clock: () => fixedTime,
    financeOptions: { watchEnabled: false },
  });
  t.after(() => app.close());
  const row = invoice(app.finance, { file_name: 'Rechnung "x"\r\nHeader.pdf' });
  let response = await app.inject("/api/finance/invoices");
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items[0].id, row.id);
  assert.deepEqual(response.json().years, ["2026"]);
  assert.equal(JSON.stringify(response.json()).includes("pdf_data"), false);
  response = await app.inject({
    method: "PATCH",
    url: `/api/finance/invoices/${row.id}`,
    payload: { status: "paid", total_amount_minor: 999 },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().total_amount_minor, 999);
  response = await app.inject(`/api/finance/invoices/${row.id}/file`);
  assert.equal(response.headers["content-type"], "application/pdf");
  assert.equal(response.headers["content-disposition"].includes("\r"), false);
  assert.equal(response.headers["content-disposition"].includes("\n"), false);
  assert.deepEqual(response.rawPayload, pdf);
  app.finance.log(row.id, "test", "processed", "Fixture log");
  assert.equal(
    (await app.inject(`/api/finance/invoices/${row.id}/logs`)).json().items
      .length,
    1,
  );
  assert.equal(
    (await app.inject(`/api/finance/customers/${row.customer_id}`)).json()
      .invoices.length,
    1,
  );
  assert.equal(
    (await app.inject("/api/finance/customers")).json().items.length,
    1,
  );
  assert.equal(
    (await app.inject("/api/finance/dashboard?year=2026&month=10")).json()
      .currencies[0].month.revenue,
    999,
  );
  response = await app.inject({
    method: "POST",
    url: `/api/finance/invoices/${row.id}/reset`,
    payload: { field: "total_amount_minor" },
  });
  assert.equal(response.json().total_amount_minor, 12345);
  for (const payload of [
    { total_amount_minor: "1.00" },
    { send_date: "2026-10-10" },
    { customer_service_id: randomUUID() },
  ])
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/finance/invoices/${row.id}`,
          payload,
        })
      ).statusCode,
      422,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/finance/invoices/${row.id}/reset`,
        payload: { unknown: true },
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (await app.inject(`/api/finance/invoices/${randomUUID()}`)).statusCode,
    404,
  );
  assert.equal(
    (await app.inject("/api/finance/invoices/not-uuid")).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/finance/invoices/${row.id}`,
      })
    ).statusCode,
    200,
  );
});

test("finance data, PDFs, corrections and profiles survive reopening and SQLite backup", async (t) => {
  const folder = mkdtempSync(
    path.join(os.tmpdir(), "pitchary-finance-persist-"),
  );
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "finance.sqlite"),
    snapshot = path.join(folder, "backup.sqlite");
  let db = openDatabase(filename),
    finance = createFinance(db, { clock: () => fixedTime });
  const row = invoice(finance);
  finance.update(row.id, { status: "paid", total_amount_minor: 99 });
  finance.updateCustomer(row.customer_id, { billing_address: "Keep address" });
  await backup(db, snapshot);
  db.close();
  for (const source of [filename, snapshot]) {
    db = openDatabase(source);
    try {
      finance = createFinance(db, { clock: () => fixedTime });
      assert.equal(finance.get(row.id).total_amount_minor, 99);
      assert.equal(finance.get(row.id).original.total_amount_minor, 12345);
      assert.equal(finance.get(row.id).status, "paid");
      assert.equal(
        finance.customer(row.customer_id).billing_address,
        "Keep address",
      );
      assert.deepEqual(finance.file(row.id).data, pdf);
      assert.equal(
        db.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok",
      );
      assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    } finally {
      db.close();
    }
  }
});

test("migration 008 preserves every populated schema 7 CRM row and immutable history guard", (t) => {
  const folder = mkdtempSync(
    path.join(os.tmpdir(), "pitchary-finance-migration-"),
  );
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "schema7.sqlite"),
    migrationFolder = path.join(projectRoot, "src/database/migrations");
  let db = new DatabaseSync(filename);
  for (const name of readdirSync(migrationFolder)
    .filter((file) => /^00[1-7]_/.test(file))
    .sort()) {
    const sql = readFileSync(path.join(migrationFolder, name), "utf8");
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec(sql);
    if (name.startsWith("003_")) seedLegacyDemo(db);
  }
  db.exec("PRAGMA foreign_keys=ON; PRAGMA user_version=7");
  const crm = createCRM(db, { clock: () => fixedTime });
  const tag = crm.createTag({
    name: "Keep tag",
    note: "Keep note",
    color: "#4d8dff",
  });
  const service = crm.listEntities("services")[0];
  crm.updateEntity("services", service.id, { tag_ids: [tag.id] });
  const tables = [
    "customers",
    "employees",
    "services",
    "customer_services",
    "customer_service_status_history",
    "activities",
    "service_tags",
    "service_tag_assignments",
  ];
  const before = tables.map((table) =>
    db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all(),
  );
  db.close();
  db = openDatabase(filename);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 11);
    for (const [index, table] of tables.entries())
      assert.deepEqual(
        db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all(),
        table === "customers"
          ? before[index].map((row) =>
              Object.assign(Object.create(null), row, {
                customer_type: "lead",
              }),
            )
          : table === "services"
            ? before[index].map((row) =>
                Object.assign(Object.create(null), row, { url: "" }),
              )
            : before[index],
      );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM finance_invoices").get().n,
      0,
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    for (const table of ["activities", "customer_service_status_history"]) {
      assert.throws(() => db.exec(`UPDATE ${table} SET id=id`), /immutable/);
      assert.throws(() => db.exec(`DELETE FROM ${table}`), /immutable/);
    }
  } finally {
    db.close();
  }
});

test("Vienna calendar dates and Date-valued clocks drive payment and overdue state", (t) => {
  const { db } = fixture(t);
  const finance = createFinance(db, {
    clock: () => new Date("2026-10-13T22:30:00.000Z"),
  });
  const row = invoice(finance, { due_date: "2026-10-13" });
  assert.equal(finance.list({ status: "overdue" }).length, 1);
  assert.equal(
    finance.update(row.id, { status: "paid" }).paid_at,
    "2026-10-14",
  );
  assert.equal(finance.get(row.id).created_at, "2026-10-13T22:30:00.000Z");
});

test("historical processing log adapter preserves dates, refuses mail events and protects existing log IDs", (t) => {
  const { finance, db } = fixture(t);
  const row = invoice(finance),
    id = randomUUID();
  const sensitive = "sk-fixture-secret-not-for-log";
  const payload = {
    id,
    invoice_id: row.id,
    process_type: "extract",
    status: "success",
    message: `Result ${sensitive}; Bearer private-fixture-token`,
    created_at: "2026-10-01T12:00:00+02:00",
  };
  assert.equal(finance.importProcessingLog(payload).imported, true);
  const log = finance.logs(row.id)[0];
  assert.equal(log.created_at, "2026-10-01T10:00:00.000Z");
  assert.equal(log.message.includes(sensitive), false);
  assert.equal(log.message.includes("private-fixture-token"), false);
  assert.equal(
    finance.importProcessingLog({ ...payload, message: "Must not replace" })
      .imported,
    false,
  );
  assert.deepEqual(finance.logs(row.id)[0], log);
  for (const patch of [
    { id: "bad" },
    { invoice_id: randomUUID() },
    { process_type: "email" },
    { process_type: "send_invoice" },
    { created_at: "bad-date" },
    { created_at: null },
  ])
    assert.throws(() => finance.importProcessingLog({ ...payload, ...patch }));
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM finance_processing_logs").get().n,
    1,
  );
});

test("legacy corrections preserve unknown payment history while public payment actions keep current rules", (t) => {
  const { finance } = fixture(t);
  const row = invoice(finance);
  const paidUnknown = finance.update(
    row.id,
    { status: "paid" },
    { legacyImport: true },
  );
  assert.equal(paidUnknown.paid_at, null);
  assert.equal(Object.hasOwn(paidUnknown.overrides, "paid_at"), false);
  assert.equal(
    finance.update(row.id, { total_amount_minor: 101 }).paid_at,
    null,
  );
  assert.throws(
    () => finance.update(row.id, { paid_at: null }),
    (error) => error.status === 422,
  );
  const explicitUnknown = finance.update(
    row.id,
    { paid_at: null },
    { legacyImport: true },
  );
  assert.equal(explicitUnknown.overrides.paid_at, null);
  finance.update(row.id, { paid_at: "2026-10-01" }, { legacyImport: true });
  const openHistorical = finance.update(
    row.id,
    { status: "open" },
    { legacyImport: true },
  );
  assert.equal(openHistorical.paid_at, "2026-10-01");
  assert.equal(finance.update(row.id, { status: "open" }).paid_at, null);
  assert.equal(
    finance.update(row.id, { status: "paid" }).paid_at,
    "2026-10-13",
  );
  assert.throws(
    () => finance.update(row.id, { status: "open", legacyImport: true }),
    (error) => error.status === 422,
  );
});
