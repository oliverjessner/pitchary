import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
import { createFinance } from "../src/business/finance.js";
import { createInvoiceCreation } from "../src/business/invoice-creation.js";
import { invoiceSnapshot } from "./fixtures/invoice-snapshot.js";

const at = "2026-11-17T10:00:00.000Z";
const fakePDF = async (snapshot) =>
  Buffer.from("%PDF-1.4\n" + JSON.stringify(snapshot) + "\n%%EOF");
const period = {
  service_period_start: "2026-11-01",
  service_period_end: "2026-11-15",
};

async function fixture(t, options = {}) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const crm = createCRM(db, { clock: () => at });
  const finance = createFinance(db, { clock: () => at });
  const creation = createInvoiceCreation(db, {
    finance,
    clock: () => at,
    renderPDF: fakePDF,
    ...options,
  });
  const sample = invoiceSnapshot();
  await creation.saveSettings({
    company_name: sample.seller.name,
    company_email: sample.seller.email,
    street: sample.seller.street,
    postal_code: sample.seller.postal_code,
    city: sample.seller.city,
    country_code: sample.seller.country_code,
    vat_id: sample.seller.vat_id,
    iban: sample.bank.iban,
    account_holder: sample.bank.account_holder,
    bank_name: sample.bank.name,
  });
  const customer = crm.createEntity("customers", {
    name: sample.recipient.name,
    street: sample.recipient.street,
    postal_code: sample.recipient.postal_code,
    city: sample.recipient.city,
    country_code: sample.recipient.country_code,
    vat_id: sample.recipient.vat_id,
    billing_address: "Historische Freitextanschrift bleibt erhalten",
    invoice_email: "rechnung@example.test",
    buyer_reference: "FIKTIVER-AUFTRAG-17",
  });
  const draft = (input = {}) =>
    creation.create({ customer_id: customer.id, ...period, ...input });
  return { db, crm, finance, creation, customer, sample, draft };
}

test("customer numbers are sequential, editable, case-insensitively unique and survive reopening", (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), "pitchary-customer-numbers-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "customers.sqlite");
  let db = openDatabase(filename);
  t.after(() => {
    if (db.isOpen) db.close();
  });
  let crm = createCRM(db, { clock: () => at });
  const first = crm.createEntity("customers", { name: "Fiktiver Kunde Alpha" });
  const second = crm.createEntity("customers", { name: "Fiktiver Kunde Beta" });
  assert.equal(first.customer_number, "K-00001");
  assert.equal(second.customer_number, "K-00002");
  assert.notEqual(first.customer_number, first.id);
  crm.updateEntity("customers", first.id, {
    customer_number: "BEISPIEL-ALPHA",
  });
  assert.throws(
    () =>
      crm.updateEntity("customers", second.id, {
        name: "Unzulässige Änderung",
        customer_number: "beispiel-alpha",
      }),
    /bereits vergeben/,
  );
  assert.equal(crm.entity("customers", second.id).name, second.name);
  assert.equal(crm.entity("customers", second.id).customer_number, "K-00002");
  assert.throws(
    () => crm.updateEntity("customers", first.id, { customer_number: "" }),
    /Kundennummer/,
  );
  crm.updateEntity("customers", second.id, { customer_number: "K-00040" });
  assert.equal(
    crm.createEntity("customers", { name: "Fiktiver Kunde Gamma" })
      .customer_number,
    "K-00041",
  );
  db.close();
  db = openDatabase(filename);
  crm = createCRM(db, { clock: () => at });
  assert.equal(
    crm.entity("customers", first.id).customer_number,
    "BEISPIEL-ALPHA",
  );
  assert.equal(
    crm.createEntity("customers", { name: "Fiktiver Kunde Delta" })
      .customer_number,
    "K-00042",
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM finance_customer_profiles").get().n,
    4,
  );
});

test("CRM billing fields feed canonical read-only draft recipients and forged invoice fields are rejected", async (t) => {
  const { crm, finance, creation, customer, draft } = await fixture(t);
  const document = draft();
  assert.equal(document.recipient.customer_number, customer.customer_number);
  assert.equal(document.recipient.street, customer.street);
  assert.equal(document.recipient.email, "rechnung@example.test");
  assert.equal(document.buyer_reference, "FIKTIVER-AUFTRAG-17");
  for (const forged of [
    { recipient: { name: "Falscher Empfänger", street: "Falsche Straße 99" } },
    { recipient: { customer_number: "FALSCHE-NUMMER" } },
    { buyer_reference: "FALSCHER-AUFTRAG" },
  ]) {
    assert.throws(() => draft(forged), /ausschließlich im Kundenprofil/);
    assert.throws(
      () => creation.update(document.id, forged),
      /ausschließlich im Kundenprofil/,
    );
  }
  assert.equal(creation.list().length, 1);
  assert.equal(creation.get(document.id).version, document.version);
  crm.updateEntity("customers", customer.id, {
    street: "Neue fiktive Straße 17",
    customer_number: "KUNDE-FIKTIV-17",
    invoice_email: "neue-rechnung@example.test",
  });
  const savedCustomer = crm.entity("customers", customer.id);
  assert.equal(savedCustomer.street, "Neue fiktive Straße 17");
  assert.equal(
    savedCustomer.billing_address,
    "Historische Freitextanschrift bleibt erhalten",
  );
  assert.equal(finance.customer(customer.id).street, savedCustomer.street);
  assert.equal(
    creation.get(document.id).recipient.street,
    savedCustomer.street,
  );
  const issued = await creation.finalize(document.id);
  assert.equal(issued.recipient.customer_number, "KUNDE-FIKTIV-17");
  assert.equal(issued.recipient.email, "neue-rechnung@example.test");
  const bytes = finance.file(issued.invoice_id).data;
  crm.updateEntity("customers", customer.id, {
    street: "Später geänderte Straße 18",
    customer_number: "KUNDE-FIKTIV-18",
  });
  assert.equal(
    creation.get(issued.id).recipient.customer_number,
    "KUNDE-FIKTIV-17",
  );
  assert.deepEqual(finance.file(issued.invoice_id).data, bytes);
});

test("new invoices require a complete ordered service period and reject the former single service date", async (t) => {
  const { creation, draft } = await fixture(t);
  assert.throws(
    () => draft({ service_date: "2026-11-05" }),
    /Von- und Bis-Datum/,
  );
  assert.throws(
    () =>
      draft({
        service_period_start: "2026-11-16",
        service_period_end: "2026-11-01",
      }),
    /Leistungsbeginn/,
  );
  assert.throws(
    () => draft({ service_period_start: "2026-02-30" }),
    /Kalendertag/,
  );
  const incomplete = draft({ service_period_end: "" });
  await assert.rejects(creation.finalize(incomplete.id), /Leistungszeitraum/);
  const sameDay = draft({
    service_period_start: "2026-11-05",
    service_period_end: "2026-11-05",
  });
  assert.equal(Object.hasOwn(sameDay, "service_date"), false);
  assert.throws(
    () => creation.update(sameDay.id, { service_date: "2026-11-06" }),
    /Von- und Bis-Datum/,
  );
  const issued = await creation.finalize(sameDay.id);
  assert.equal(issued.service_period_start, "2026-11-05");
  assert.equal(issued.service_period_end, "2026-11-05");
  assert.equal(Object.hasOwn(issued, "service_date"), false);
});

test("customer edits during PDF generation prevent committing stale recipient details or consuming a number", async (t) => {
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { db, crm, finance, creation, customer, draft } = await fixture(t, {
    renderPDF: async (snapshot) => {
      entered();
      await gate;
      return fakePDF(snapshot);
    },
  });
  const pending = draft();
  const finalizing = creation.finalize(pending.id);
  await started;
  crm.updateEntity("customers", customer.id, {
    street: "Während der Erstellung geänderte Straße 17",
  });
  release();
  await assert.rejects(
    finalizing,
    (error) => error.code === "invoice_customer_conflict",
  );
  assert.equal(creation.get(pending.id).state, "draft");
  assert.equal(creation.settings().next_number, 1);
  assert.equal(finance.list().length, 0);
  const retry = createInvoiceCreation(db, {
    finance,
    clock: () => at,
    renderPDF: fakePDF,
  });
  const issued = await retry.finalize(pending.id);
  assert.equal(issued.invoice_number, "R-00001");
  assert.equal(
    issued.recipient.street,
    "Während der Erstellung geänderte Straße 17",
  );
});

test("migration 016 backfills customer numbers and converts old drafts while preserving issued snapshots and bytes", (t) => {
  const folder = mkdtempSync(
    path.join(tmpdir(), "pitchary-billing-migration-"),
  );
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "legacy.sqlite");
  let db = openDatabase(filename);
  t.after(() => {
    if (db.isOpen) db.close();
  });
  // Reconstruct schema 015 only inside this isolated historical fixture.
  db.exec(
    `DROP TRIGGER customer_number_on_create; DROP TRIGGER customer_number_profile_insert; DROP TRIGGER customer_number_profile_update; DROP INDEX finance_customer_number_unique; DROP TABLE customer_number_sequence; PRAGMA user_version=15;`,
  );
  const crm = createCRM(db, { clock: () => at });
  const retained = crm.createEntity("customers", {
    name: "Historischer fiktiver Kunde Alpha",
    customer_number: "ALT-FIKTIV-17",
    billing_address: "Alte Freitextanschrift 17",
  });
  crm.createEntity("customers", {
    name: "Historischer fiktiver Kunde Beta",
    customer_number: "K-00042",
  });
  const unnumbered = crm.createEntity("customers", {
    name: "Historischer fiktiver Kunde Gamma",
  });
  const withoutProfile = randomUUID();
  db.prepare(
    "INSERT INTO customers(id,name,note,website,created_at,updated_at) VALUES(?,?,'','',?,?)",
  ).run(
    withoutProfile,
    "Historischer Kunde ohne Rechnungsprofil",
    "2026-11-17T10:00:01.000Z",
    at,
  );
  assert.equal(
    db
      .prepare(
        "SELECT customer_id FROM finance_customer_profiles WHERE customer_id=?",
      )
      .get(withoutProfile),
    undefined,
  );
  const finance = createFinance(db, { clock: () => at });
  const legacy = {
    ...invoiceSnapshot(),
    customer_id: retained.id,
    employee_id: null,
    service_date: "2026-10-15",
  };
  delete legacy.service_period_start;
  delete legacy.service_period_end;
  const issuedId = randomUUID(),
    draftId = randomUUID();
  const pdf = Buffer.from("%PDF-1.4\nFICTIONAL-LEGACY-PDF\n%%EOF");
  const xml = Buffer.from(
    "<FictionalLegacyInvoice>unchanged</FictionalLegacyInvoice>",
  );
  finance.record({
    id: issuedId,
    category: "revenue",
    customer_id: retained.id,
    invoice_number: legacy.invoice_number,
    invoice_date: legacy.invoice_date,
    due_date: legacy.due_date,
    total_amount_minor: legacy.totals.total_amount_minor,
    net_amount_minor: legacy.totals.net_amount_minor,
    tax_amount_minor: legacy.totals.tax_amount_minor,
    pdf_data: pdf,
    file_name: "fictional-legacy.pdf",
    ingestion_status: "processed",
    status: "paid",
    paid_at: "2026-11-16",
  });
  const insert = (id) => {
    db.prepare(
      "INSERT INTO invoice_documents(id,customer_id,content_json,created_at,updated_at) VALUES(?,?,?,?,?)",
    ).run(id, retained.id, JSON.stringify(legacy), at, at);
    for (const item of legacy.items)
      db.prepare(
        "INSERT INTO invoice_document_lines(document_id,position,line_json) VALUES(?,?,?)",
      ).run(id, item.position, JSON.stringify(item));
  };
  insert(draftId);
  insert(issuedId);
  db.prepare(
    "UPDATE invoice_documents SET state='issued',invoice_id=?,xml_data=?,validation_json=? WHERE id=?",
  ).run(
    issuedId,
    xml,
    JSON.stringify({ valid: true, legacy_fixture: true }),
    issuedId,
  );
  const originalSnapshot = db
    .prepare("SELECT content_json FROM invoice_documents WHERE id=?")
    .get(issuedId).content_json;
  db.close();
  db = openDatabase(filename);
  const updatedCRM = createCRM(db, { clock: () => at });
  const updatedFinance = createFinance(db, { clock: () => at });
  const creation = createInvoiceCreation(db, {
    finance: updatedFinance,
    clock: () => at,
    renderPDF: fakePDF,
  });
  assert.equal(
    updatedCRM.entity("customers", retained.id).customer_number,
    "ALT-FIKTIV-17",
  );
  assert.equal(
    updatedCRM.entity("customers", retained.id).billing_address,
    "Alte Freitextanschrift 17",
  );
  assert.equal(
    updatedCRM.entity("customers", unnumbered.id).customer_number,
    "K-00043",
  );
  assert.equal(
    updatedCRM.entity("customers", withoutProfile).customer_number,
    "K-00044",
  );
  assert.equal(
    updatedCRM.createEntity("customers", {
      name: "Neuer fiktiver Kunde nach Migration",
    }).customer_number,
    "K-00045",
  );
  const converted = creation.get(draftId);
  assert.equal(converted.service_period_start, "2026-10-15");
  assert.equal(converted.service_period_end, "2026-10-15");
  assert.equal(Object.hasOwn(converted, "service_date"), false);
  assert.equal(converted.version, 2);
  assert.equal(
    db
      .prepare("SELECT content_json FROM invoice_documents WHERE id=?")
      .get(issuedId).content_json,
    originalSnapshot,
  );
  assert.equal(creation.get(issuedId).service_date, "2026-10-15");
  assert.deepEqual(updatedFinance.file(issuedId).data, pdf);
  assert.deepEqual(creation.xml(issuedId).data, xml);
  assert.equal(updatedFinance.get(issuedId).status, "paid");
  assert.equal(updatedFinance.get(issuedId).paid_at, "2026-11-16");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
