import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, transaction } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
import { createFinance } from "../src/business/finance.js";
import { createCustomerMerge } from "../src/business/customer-merge.js";
import { demoCustomerLogo } from "../scripts/demo-assets.js";
import { logoFormats } from "./fixtures/logo-formats.js";

const at = "2026-10-13T10:00:00.000Z";
const allTables = [
  "customers",
  "employees",
  "services",
  "customer_services",
  "customer_service_status_history",
  "activities",
  "service_tags",
  "service_tag_assignments",
  "finance_invoices",
  "finance_invoice_overrides",
  "finance_customer_profiles",
  "finance_processing_logs",
  "finance_settings",
];
const snapshot = (db) =>
  Object.fromEntries(
    allTables.map((table) => [
      table,
      db
        .prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`)
        .all()
        .map((row) => ({ ...row })),
    ]),
  );
function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const crm = createCRM(db, { clock: () => at }),
    finance = createFinance(db, { clock: () => at }),
    merge = createCustomerMerge(db);
  const source = crm.createEntity("customers", {
    name: "Short customer name",
    note: "Source CRM note",
    website: "https://example.com/customer",
    logo: demoCustomerLogo,
  });
  const target = crm.createEntity("customers", {
    name: "Full legal customer name",
    note: "Target CRM note",
  });
  const unrelated = crm.createEntity("customers", {
    name: "Unrelated customer",
    note: "Must stay exact",
  });
  const sourceContact = crm.createEntity("employees", {
    customer_id: source.id,
    name: "Same contact name",
    email: "source@example.com",
  });
  const archivedContact = crm.createEntity("employees", {
    customer_id: source.id,
    name: "Archived source contact",
    email: "old@example.com",
  });
  const targetContact = crm.createEntity("employees", {
    customer_id: target.id,
    name: "Same contact name",
    email: "target@example.com",
  });
  const service = crm.createEntity("services", {
    name: "Service",
    note: "Unchanged",
  });
  const relationship = crm.createRelationship({
    customer_id: source.id,
    service_id: service.id,
    primary_employee_id: sourceContact.id,
    current_offered_price_minor: 12345,
  });
  crm.changeStatus(relationship.id, { status: "pitched" });
  crm.addActivity(relationship.id, {
    type: "follow_up",
    employee_id: sourceContact.id,
    channel: "email",
    note: "Immutable contact history",
  });
  crm.changeStatus(relationship.id, { status: "ghosted" });
  const archivedRelationship = crm.createRelationship({
    customer_id: source.id,
    service_id: service.id,
    primary_employee_id: archivedContact.id,
    current_offered_price_minor: 999,
  });
  crm.archive("employees", archivedContact.id);
  crm.archive("customer_services", archivedRelationship.id);
  const targetRelationship = crm.createRelationship({
    customer_id: target.id,
    service_id: service.id,
    primary_employee_id: targetContact.id,
    current_offered_price_minor: 54321,
  });
  const pdf = Buffer.from("%PDF-1.4\nFixture merge\n%%EOF");
  const sourceInvoice = finance.record({
    customer_id: source.id,
    customer_service_id: relationship.id,
    counterparty_name: source.name,
    invoice_number: "S-1",
    invoice_date: "2026-10-01",
    total_amount_minor: 12345,
    currency: "EUR",
    pdf_data: pdf,
    file_name: "source.pdf",
    extracted_json: '{"merge":true}',
    ingestion_status: "processed",
  });
  const targetInvoice = finance.record({
    customer_id: target.id,
    customer_service_id: targetRelationship.id,
    counterparty_name: target.name,
    invoice_number: "T-1",
    invoice_date: "2026-10-02",
    total_amount_minor: 54321,
    currency: "USD",
  });
  const overrideInvoice = finance.record({
    customer_id: unrelated.id,
    counterparty_name: "Original extraction",
    total_amount_minor: 777,
    currency: "GBP",
  });
  finance.update(overrideInvoice.id, {
    customer_id: source.id,
    customer_service_id: relationship.id,
    total_amount_minor: 888,
  });
  finance.log(
    sourceInvoice.id,
    "process",
    "success",
    "Keep PDF processing evidence",
  );
  finance.log(targetInvoice.id, "process", "success", "Keep target evidence");
  finance.updateCustomer(target.id, {
    billing_address: "Destination billing address",
    general_email: "billing@example.com",
    enrichment_status: "completed",
    enriched_at: at,
    enrichment_invoice_id: targetInvoice.id,
  });
  db.prepare(
    "INSERT INTO finance_settings(key,value,updated_at) VALUES('sentinel',?,?)",
  ).run("Must remain exact", at);
  return {
    db,
    crm,
    finance,
    merge,
    source,
    target,
    unrelated,
    sourceContact,
    archivedContact,
    targetContact,
    relationship,
    archivedRelationship,
    targetRelationship,
    sourceInvoice,
    targetInvoice,
    overrideInvoice,
    pdf,
  };
}

test("customer merge rewires only ownership while preserving contacts, immutable events, PDFs, logs and destination profiles", (t) => {
  const f = fixture(t),
    before = snapshot(f.db);
  const result = f.merge.merge(f.source.id, f.target.id),
    after = snapshot(f.db);
  assert.equal(result.source, f.source.id);
  assert.equal(result.target, f.target.id);
  assert.equal(result.merged, true);
  assert.equal(result.counts.employees, 2);
  assert.equal(result.counts.customer_services, 2);
  assert.equal(result.counts.finance_invoices, 1);
  assert.equal(result.counts.finance_customer_overrides, 1);
  assert.equal(JSON.stringify(result).includes("billing@example.com"), false);
  for (const table of ["employees", "customer_services", "finance_invoices"])
    assert.deepEqual(
      after[table],
      before[table].map((row) => ({
        ...row,
        customer_id:
          row.customer_id === f.source.id ? f.target.id : row.customer_id,
      })),
    );
  assert.deepEqual(
    after.finance_invoice_overrides,
    before.finance_invoice_overrides.map((row) =>
      row.field_name === "customer_id" &&
      JSON.parse(row.override_value) === f.source.id
        ? { ...row, override_value: JSON.stringify(f.target.id) }
        : row,
    ),
  );
  for (const table of [
    "services",
    "customer_service_status_history",
    "activities",
    "service_tags",
    "service_tag_assignments",
    "finance_processing_logs",
    "finance_customer_profiles",
  ])
    assert.deepEqual(after[table], before[table]);
  assert.equal(
    f.db.prepare("SELECT id FROM customers WHERE id=?").get(f.source.id),
    undefined,
  );
  const destination = f.crm.entity("customers", f.target.id);
  assert.equal(destination.name, f.target.name);
  assert.equal(destination.website, f.source.website);
  assert.equal(destination.note, "Target CRM note\n\nSource CRM note");
  assert.equal(destination.has_logo, true);
  assert.equal(destination.employees.length, 2);
  assert.equal(destination.archived_employees.length, 1);
  assert.deepEqual(f.finance.file(f.sourceInvoice.id).data, f.pdf);
  assert.equal(f.finance.get(f.overrideInvoice.id).customer_id, f.target.id);
  assert.equal(
    f.finance.get(f.overrideInvoice.id).customer_service_id,
    f.relationship.id,
  );
  assert.equal(f.finance.customer(f.target.id).invoice_count, 3);
  assert.deepEqual(
    after.customers.find((row) => row.id === f.unrelated.id),
    before.customers.find((row) => row.id === f.unrelated.id),
  );
  assert.deepEqual(
    after.finance_settings.find((row) => row.key === "sentinel"),
    before.finance_settings.find((row) => row.key === "sentinel"),
  );
  assert.equal(f.merge.resolve(f.source.id), f.target.id);
  assert.equal(f.db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(
    f.db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.equal(
    f.db.prepare("PRAGMA defer_foreign_keys").get().defer_foreign_keys,
    0,
  );
});

test("nested customer merges can commit together and an outer failure restores every original row", (t) => {
  const f = fixture(t),
    before = snapshot(f.db);
  assert.throws(
    () =>
      transaction(f.db, () => {
        f.merge.merge(f.source.id, f.target.id);
        assert.equal(f.db.isTransaction, true);
        throw new Error("outer failure");
      }),
    /outer failure/,
  );
  assert.deepEqual(snapshot(f.db), before);
  assert.equal(
    f.db.prepare("PRAGMA defer_foreign_keys").get().defer_foreign_keys,
    0,
  );
  const secondSource = f.crm.createEntity("customers", {
      name: "Second source",
    }),
    secondTarget = f.crm.createEntity("customers", { name: "Second target" });
  transaction(f.db, () => {
    f.merge.merge(f.source.id, f.target.id);
    f.merge.merge(secondSource.id, secondTarget.id);
    assert.equal(f.db.isTransaction, true);
  });
  assert.equal(f.merge.resolve(f.source.id), f.target.id);
  assert.equal(f.merge.resolve(secondSource.id), secondTarget.id);
  assert.equal(f.db.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("customer merge rolls back rewiring, profiles, aliases and source deletion when a later statement fails", (t) => {
  const f = fixture(t),
    before = snapshot(f.db);
  f.db.exec(
    "CREATE TRIGGER fail_customer_merge BEFORE DELETE ON customers BEGIN SELECT RAISE(ABORT,'merge delete failure'); END",
  );
  assert.throws(
    () => f.merge.merge(f.source.id, f.target.id),
    /merge delete failure/,
  );
  assert.deepEqual(snapshot(f.db), before);
  assert.equal(f.db.isTransaction, false);
  assert.equal(f.db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(
    f.db.prepare("PRAGMA defer_foreign_keys").get().defer_foreign_keys,
    0,
  );
});

test("conflicting customer websites, logos and billing profiles fail without dropping any data", (t) => {
  for (const type of [
    "website",
    "logo",
    "general_email",
    "billing_address",
    "enrichment_invoice_id",
  ]) {
    const f = fixture(t);
    if (type === "website")
      f.crm.updateEntity("customers", f.target.id, {
        website: "https://different.example.com/",
      });
    else if (type === "logo")
      f.crm.updateEntity("customers", f.target.id, {
        logo: logoFormats.jpeg,
      });
    else
      f.finance.updateCustomer(f.source.id, {
        [type]:
          type === "general_email"
            ? "different@example.com"
            : type === "billing_address"
              ? "Different source address"
              : f.sourceInvoice.id,
      });
    const before = snapshot(f.db);
    assert.throws(
      () => f.merge.merge(f.source.id, f.target.id),
      (error) =>
        error.status === 409 &&
        error.code === "customer_merge_conflict" &&
        Object.hasOwn(error.fields, type),
    );
    assert.deepEqual(snapshot(f.db), before);
  }
});

test("source billing profile moves to an empty destination and preserves its invoice source and timestamps", (t) => {
  const f = fixture(t);
  f.db
    .prepare("DELETE FROM finance_customer_profiles WHERE customer_id=?")
    .run(f.target.id);
  f.finance.updateCustomer(f.source.id, {
    billing_address: "Source billing",
    general_email: "source-billing@example.com",
    enrichment_status: "completed",
    enriched_at: at,
    enrichment_invoice_id: f.sourceInvoice.id,
  });
  const profile = f.db
    .prepare("SELECT * FROM finance_customer_profiles WHERE customer_id=?")
    .get(f.source.id);
  f.merge.merge(f.source.id, f.target.id);
  assert.deepEqual(
    {
      ...f.db
        .prepare("SELECT * FROM finance_customer_profiles WHERE customer_id=?")
        .get(f.target.id),
    },
    { ...profile, customer_id: f.target.id },
  );
  assert.equal(
    f.db
      .prepare("SELECT * FROM finance_customer_profiles WHERE customer_id=?")
      .get(f.source.id),
    undefined,
  );
  assert.equal(
    f.finance.customer(f.target.id).enrichment_invoice_id,
    f.sourceInvoice.id,
  );
});

test("merge resolution is idempotent, compresses later merges, and preserves source names for future invoices", (t) => {
  const f = fixture(t);
  f.merge.merge(f.source.id, f.target.id);
  const before = snapshot(f.db);
  assert.equal(f.merge.merge(f.source.id, f.target.id).merged, false);
  assert.deepEqual(snapshot(f.db), before);
  const ultimate = f.crm.createEntity("customers", {
    name: "Ultimate company",
  });
  f.merge.merge(f.target.id, ultimate.id);
  assert.equal(f.merge.resolve(f.source.id), ultimate.id);
  assert.equal(f.merge.resolve(f.target.id), ultimate.id);
  assert.equal(f.merge.resolve(f.unrelated.id), f.unrelated.id);
  const invoice = f.finance.record({
    counterparty_name: f.source.name,
    total_amount_minor: 1,
    invoice_date: "2026-10-13",
  });
  assert.equal(invoice.customer_id, ultimate.id);
  const mappings = JSON.parse(
    f.db
      .prepare("SELECT value FROM finance_settings WHERE key='customer_merges'")
      .get().value,
  );
  assert.equal(mappings[f.source.id], ultimate.id);
  assert.equal(mappings[f.target.id], ultimate.id);
});

test("customer merge rejects invalid IDs, self-merges, missing targets, alias collisions and malformed route mappings", (t) => {
  const f = fixture(t),
    before = snapshot(f.db);
  for (const action of [
    () => f.merge.merge("invalid", f.target.id),
    () => f.merge.merge(f.source.id, f.source.id),
    () => f.merge.merge(f.source.id, randomUUID()),
  ])
    assert.throws(action);
  assert.deepEqual(snapshot(f.db), before);
  const aliases = JSON.parse(
    f.db
      .prepare(
        "SELECT value FROM finance_settings WHERE key='finance_customer_aliases'",
      )
      .get().value,
  );
  aliases[f.source.name.toLowerCase()] = f.unrelated.id;
  f.db
    .prepare(
      "UPDATE finance_settings SET value=? WHERE key='finance_customer_aliases'",
    )
    .run(JSON.stringify(aliases));
  const conflictState = snapshot(f.db);
  assert.throws(
    () => f.merge.merge(f.source.id, f.target.id),
    (error) => Boolean(error.fields.finance_customer_aliases),
  );
  assert.deepEqual(snapshot(f.db), conflictState);
  f.db
    .prepare(
      "INSERT INTO finance_settings(key,value,updated_at) VALUES('customer_merges',?,?)",
    )
    .run(
      JSON.stringify({
        [f.source.id]: f.target.id,
        [f.target.id]: f.source.id,
      }),
      at,
    );
  assert.throws(
    () => f.merge.resolve(f.source.id),
    (error) => Boolean(error.fields.customer_merges),
  );
  assert.throws(
    () => f.merge.merge(f.source.id, f.target.id),
    (error) => Boolean(error.fields.customer_merges),
  );
});

test("explicitly cleared finance relationship overrides remain valid through a customer merge", (t) => {
  const f = fixture(t);
  f.finance.update(f.sourceInvoice.id, {
    customer_id: null,
    customer_service_id: null,
  });
  f.merge.merge(f.source.id, f.target.id);
  const invoice = f.finance.get(f.sourceInvoice.id);
  assert.equal(invoice.customer_id, null);
  assert.equal(invoice.customer_service_id, null);
  assert.equal(invoice.original.customer_id, f.target.id);
  assert.equal(invoice.original.customer_service_id, f.relationship.id);
});
