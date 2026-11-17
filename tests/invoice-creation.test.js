import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup } from "node:sqlite";
import { openDatabase } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
import { createFinance } from "../src/business/finance.js";
import { createInvoiceCreation } from "../src/business/invoice-creation.js";
import { createCustomerMerge } from "../src/business/customer-merge.js";
import { createInvoiceProcessor } from "../src/business/invoice-processor.js";
import { createFinanceSettings } from "../src/business/finance-settings.js";
import { invoiceSnapshot } from "./fixtures/invoice-snapshot.js";

const at = "2026-11-16T10:00:00.000Z";
const fakePDF = async (snapshot) =>
  Buffer.from("%PDF-1.4\n" + JSON.stringify(snapshot) + "\n%%EOF");
async function fixture(t, options = {}) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const finance = createFinance(db, { clock: () => at });
  const crm = createCRM(db, { clock: () => at });
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
    company_address: "Legacy fictional address retained",
    owner_name: sample.seller.additional_name,
    street: sample.seller.street,
    postal_code: sample.seller.postal_code,
    city: sample.seller.city,
    country_code: sample.seller.country_code,
    vat_id: sample.seller.vat_id,
    bank_name: sample.bank.name,
    account_holder: sample.bank.account_holder,
    iban: sample.bank.iban,
    bic: sample.bank.bic,
    endpoint_id: sample.seller.endpoint_id,
    endpoint_scheme: sample.seller.endpoint_scheme,
    contact_name: sample.seller.contact_name,
    phone: sample.seller.phone,
  });
  const customer = crm.createEntity("customers", {
    name: sample.recipient.name,
  });
  const other = crm.createEntity("customers", {
    name: "Other fictional customer",
  });
  const { name: recipientName, ...recipientProfile } = sample.recipient;
  creation.saveProfile(customer.id, recipientProfile);
  const service = crm.createEntity("services", {
    name: "Fictional consulting",
  });
  const offer = (customer_id = customer.id, currency = "EUR") => {
    const row = crm.createRelationship({
      customer_id,
      service_id: service.id,
      current_offered_price_minor: 10000,
      currency,
    });
    crm.changeStatus(row.id, { status: "pitched" });
    return crm.changeStatus(row.id, {
      status: "accepted",
      accepted_price_minor: 12000,
    });
  };
  const draft = (patch = {}) =>
    creation.create({
      customer_id: customer.id,
      service_period_start: "2026-11-15",
      service_period_end: "2026-11-15",
      subject: "Fictional consulting",
      ...patch,
    });
  return { db, finance, crm, creation, customer, other, offer, draft, sample };
}

test("invoice subjects default to the invoice month and document language while retaining custom text", async (t) => {
  const { creation, customer } = await fixture(t);
  assert.equal(
    creation.options({ customer_id: customer.id }).defaults.subject,
    "November Rechnung 2026",
  );
  const draft = creation.create({
    customer_id: customer.id,
    invoice_date: "2026-12-01",
    due_date: "2026-12-15",
    language: "en",
  });
  assert.equal(draft.subject, "December Invoice 2026");
  const january = creation.update(draft.id, {
    invoice_date: "2027-01-01",
    due_date: "2027-01-15",
  });
  assert.equal(january.subject, "January Invoice 2027");
  assert.equal(
    creation.update(draft.id, { language: "de" }).subject,
    "Jänner Rechnung 2027",
  );
  creation.update(draft.id, { subject: "Individuelle Beratung" });
  assert.equal(
    creation.update(draft.id, {
      invoice_date: "2027-02-01",
      due_date: "2027-02-15",
      language: "en",
    }).subject,
    "Individuelle Beratung",
  );
});

test("drafts do not consume numbers, revenue or customer classification; multiple offers invoice once", async (t) => {
  const { crm, finance, creation, customer, offer, draft } = await fixture(t);
  const first = offer(),
    second = offer();
  const before = crm.relationship(first.id);
  const doc = draft({ customer_service_ids: [first.id, second.id] });
  assert.equal(doc.items.length, 2);
  assert.equal(doc.items[0].unit_price, "120.00");
  assert.equal(doc.items[0].price_source, "accepted");
  assert.equal(creation.settings().next_number, 1);
  assert.equal(finance.list().length, 0);
  assert.equal(crm.entity("customers", customer.id).customer_type, "lead");
  const issued = await creation.finalize(doc.id);
  assert.equal(issued.state, "issued");
  assert.equal(issued.invoice_number, "R-00001");
  assert.equal(creation.settings().next_number, 2);
  assert.equal(finance.list({ customer_service_id: first.id }).length, 1);
  assert.equal(finance.list({ customer_service_id: second.id }).length, 1);
  assert.equal(finance.customer(customer.id).invoice_count, 1);
  assert.equal(
    finance.customer(customer.id).currencies[0].total_amount_minor,
    28800,
  );
  assert.equal(crm.entity("customers", customer.id).customer_type, "customer");
  assert.deepEqual(crm.relationship(first.id), before);
});

test("offers of other customers or currencies are rejected; preview and deletion leave number untouched", async (t) => {
  const { creation, other, offer, draft } = await fixture(t);
  const wrongCustomer = offer(other.id);
  assert.throws(
    () => draft({ customer_service_ids: [wrongCustomer.id] }),
    /anderen Kunden/,
  );
  const usd = offer(undefined, "USD");
  assert.throws(
    () => draft({ customer_service_ids: [usd.id], currency: "EUR" }),
    /Währung/,
  );
  const doc = draft();
  const preview = await creation.preview(doc.id);
  assert.equal(preview.data.subarray(0, 5).toString(), "%PDF-");
  assert.equal(creation.settings().next_number, 1);
  creation.remove(doc.id);
  assert.equal(creation.list().length, 0);
  assert.equal(creation.settings().next_number, 1);
});

test("parallel finalizations are idempotent per draft and allocate distinct numbers across drafts", async (t) => {
  const { creation, finance, draft } = await fixture(t, {
    renderPDF: async (snapshot) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return fakePDF(snapshot);
    },
  });
  const first = draft(),
    second = draft();
  const [a, again, b] = await Promise.all([
    creation.finalize(first.id),
    creation.finalize(first.id),
    creation.finalize(second.id),
  ]);
  assert.equal(a.invoice_id, again.invoice_id);
  assert.equal(a.invoice_number, again.invoice_number);
  assert.notEqual(a.invoice_number, b.invoice_number);
  assert.equal(finance.list().length, 2);
  assert.equal(creation.settings().next_number, 3);
  assert.equal(
    (await creation.finalize(first.id)).invoice_number,
    a.invoice_number,
  );
  assert.equal(creation.settings().next_number, 3);
});

test("existing outgoing numbers are skipped and failed PDF/XML or stale versions leave complete drafts", async (t) => {
  const { db, creation, finance, draft } = await fixture(t);
  finance.record({
    category: "revenue",
    invoice_number: "R-00001",
    counterparty_name: "Imported fictional issuer",
    total_amount_minor: 1,
  });
  const doc = draft();
  assert.equal(doc.invoice_number, "R-00002");
  assert.equal((await creation.finalize(doc.id)).invoice_number, "R-00002");
  const failing = createInvoiceCreation(db, {
    finance,
    clock: () => at,
    renderPDF: async () => {
      throw new Error("Renderer failed");
    },
  });
  const failed = draft();
  await assert.rejects(failing.finalize(failed.id), /Renderer failed/);
  assert.equal(creation.get(failed.id).state, "draft");
  assert.equal(creation.settings().next_number, 3);
  assert.equal(finance.list().length, 2);
  const xmlFailure = createInvoiceCreation(db, {
    finance,
    clock: () => at,
    renderPDF: fakePDF,
    createXML: () => Buffer.from("<Invoice/>"),
    validateXML: async () => {
      throw new Error("XML rejected");
    },
  });
  const electronic = draft({ e_invoice: true });
  await assert.rejects(xmlFailure.finalize(electronic.id), /XML rejected/);
  assert.equal(creation.get(electronic.id).state, "draft");
  assert.equal(creation.settings().next_number, 3);
  const edited = creation.update(failed.id, {
    subject: "Edited",
    expected_version: failed.version,
  });
  await assert.rejects(
    creation.finalize(edited.id, { expected_version: failed.version }),
    /inzwischen geändert/,
  );
});

test("issued documents remain frozen through edits, merge, offer deletion, import and payment", async (t) => {
  const { db, finance, creation, crm, customer, other, offer, draft } =
    await fixture(t);
  const source = offer();
  const doc = await creation.finalize(
    draft({ customer_service_ids: [source.id] }).id,
  );
  const bytes = finance.file(doc.invoice_id).data;
  await creation.saveSettings({ company_name: "New fictional issuer" });
  creation.saveProfile(customer.id, { street: "Changed street 99" });
  crm.updateEntity("customers", customer.id, {
    name: "Renamed fictional recipient",
  });
  assert.deepEqual(finance.file(doc.invoice_id).data, bytes);
  for (const action of [
    () => finance.update(doc.invoice_id, { total_amount_minor: 1 }),
    () => finance.reset(doc.invoice_id),
    () => finance.remove(doc.invoice_id),
    () => finance.record({ id: doc.invoice_id, total_amount_minor: 1 }),
    () => creation.update(doc.id, { subject: "Tampered" }),
    () => creation.remove(doc.id),
    () =>
      db
        .prepare("UPDATE invoice_documents SET content_json='{}' WHERE id=?")
        .run(doc.id),
  ])
    assert.throws(action);
  finance.update(doc.invoice_id, { status: "paid", paid_at: "2026-11-16" });
  assert.equal(finance.get(doc.invoice_id).status, "paid");
  const merge = createCustomerMerge(db);
  merge.merge(customer.id, other.id);
  assert.equal(creation.get(doc.id).customer_id, other.id);
  assert.equal(creation.get(doc.id).recipient.name, doc.recipient.name);
  crm.deleteRelationship(source.id);
  assert.equal(creation.get(doc.id).items[0].customer_service_id, null);
  assert.deepEqual(finance.file(doc.invoice_id).data, bytes);
  const settings = createFinanceSettings(db, { tools: async () => ({}) });
  const processor = createInvoiceProcessor(db, finance, settings, {
    watchEnabled: false,
  });
  t.after(() => processor.close());
  const imported = await processor.upload(bytes, {
    file_name: "Copied.pdf",
    category: "payable",
  });
  assert.equal(imported.invoice.id, doc.invoice_id);
  assert.equal(finance.list().length, 1);
});

test("SQLite backup restores drafts, settings and immutable document bytes", async (t) => {
  const { db, creation, finance, draft } = await fixture(t);
  const pending = draft();
  const issued = await creation.finalize(draft().id);
  const folder = mkdtempSync(path.join(tmpdir(), "pitchary-created-backup-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "backup.sqlite");
  await backup(db, filename);
  const restored = openDatabase(filename);
  t.after(() => restored.close());
  const restoredFinance = createFinance(restored);
  const restoredCreation = createInvoiceCreation(restored, {
    finance: restoredFinance,
    renderPDF: fakePDF,
  });
  assert.equal(restoredCreation.get(pending.id).state, "draft");
  assert.equal(restoredCreation.settings().next_number, 2);
  assert.deepEqual(
    restoredFinance.file(issued.id).data,
    finance.file(issued.id).data,
  );
  assert.equal(restored.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("editing a draft or issuer during asynchronous rendering never commits stale documents", async (t) => {
  for (const change of ["draft", "issuer"]) {
    let entered, release;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { creation, finance, draft } = await fixture(t, {
      renderPDF: async (snapshot) => {
        entered();
        await gate;
        return fakePDF(snapshot);
      },
    });
    const doc = draft();
    const finalizing = creation.finalize(doc.id);
    await started;
    if (change === "draft") creation.update(doc.id, { subject: "New subject" });
    else
      await creation.saveSettings({ company_name: "Changed fictional issuer" });
    release();
    await assert.rejects(finalizing, (error) => error.status === 409);
    assert.equal(creation.get(doc.id).state, "draft");
    assert.equal(finance.list().length, 0);
    assert.equal(creation.settings().next_number, 1);
  }
});

test("issued contact identity is a snapshot even when its live contact is changed or deleted", async (t) => {
  const { db, creation, finance, crm, customer, draft } = await fixture(t);
  const employee = crm.createEntity("employees", {
    customer_id: customer.id,
    name: "Fictional Contact",
    email: "contact@example.test",
    position: "Accounting",
  });
  const issued = await creation.finalize(
    draft({ employee_id: employee.id }).id,
  );
  const bytes = finance.file(issued.id).data;
  crm.updateEntity("employees", employee.id, { name: "Changed Contact" });
  db.prepare("DELETE FROM employees WHERE id=?").run(employee.id);
  const saved = creation.get(issued.id);
  assert.equal(saved.employee_id, null);
  assert.deepEqual(saved.contact, {
    name: "Fictional Contact",
    email: "contact@example.test",
    position: "Accounting",
  });
  assert.deepEqual(finance.file(issued.id).data, bytes);
});

test("exhausted invoice numbering leaves settings readable and can be reset without changing issued numbers", async (t) => {
  const { creation, finance, draft } = await fixture(t);
  await creation.saveSettings({ next_number: 999999999999 });
  const last = await creation.finalize(draft().id);
  assert.equal(last.invoice_number, "R-999999999999");
  const exhausted = creation.settings();
  assert.equal(exhausted.next_number, 1000000000000);
  assert.equal(exhausted.next_invoice_number, null);
  assert.equal(exhausted.number_exhausted, true);
  assert.match(exhausted.number_error, /ausgeschöpft/);
  const pending = draft();
  await assert.rejects(creation.finalize(pending.id), /ausgeschöpft/);
  assert.equal(creation.get(pending.id).state, "draft");
  assert.equal(finance.list().length, 1);
  const recovered = await creation.saveSettings({ next_number: 1 });
  assert.equal(recovered.number_exhausted, false);
  assert.equal(recovered.number_error, null);
  assert.equal(recovered.next_invoice_number, "R-00001");
  assert.equal((await creation.finalize(pending.id)).invoice_number, "R-00001");
  assert.equal(creation.get(last.id).invoice_number, "R-999999999999");
});

test(
  "visible issuer settings provide validated XML seller defaults while explicit electronic settings and issued snapshots stay intact",
  { timeout: 60000 },
  async (t) => {
    const { creation, customer, draft, sample } = await fixture(t);
    await creation.saveSettings({
      tax_id: "",
      endpoint_id: "",
      endpoint_scheme: "",
      contact_name: "",
    });
    creation.saveProfile(customer.id, {
      buyer_reference: sample.buyer_reference,
    });
    const before = creation.settings();
    const seller = creation.options({ customer_id: customer.id }).defaults
      .seller;
    assert.equal(seller.endpoint_id, sample.seller.email);
    assert.equal(seller.endpoint_scheme, "EM");
    assert.equal(seller.contact_name, sample.seller.additional_name);
    assert.equal(creation.settings().revision, before.revision);
    for (const field of [
      "tax_id",
      "endpoint_id",
      "endpoint_scheme",
      "contact_name",
    ])
      assert.equal(creation.settings()[field], "");
    const issued = await creation.finalize(draft({ e_invoice: true }).id);
    assert.equal(issued.validation.valid, true);
    assert.equal(issued.validation.profile.version, "3.0.2");
    assert.equal(issued.seller.endpoint_id, sample.seller.email);
    assert.equal(issued.seller.contact_name, sample.seller.additional_name);
    const xml = creation.xml(issued.id).data;
    assert.ok(
      xml
        .toString()
        .includes(
          `<cbc:EndpointID schemeID="EM">${sample.seller.email}</cbc:EndpointID>`,
        ),
    );

    await creation.saveSettings({ owner_name: "" });
    assert.equal(
      creation.options({ customer_id: customer.id }).defaults.seller
        .contact_name,
      sample.seller.name,
    );
    await creation.saveSettings({
      endpoint_id: "1234567890128",
      endpoint_scheme: "0088",
      contact_name: "Explicit fictional seller contact",
    });
    const explicit = creation.options({ customer_id: customer.id }).defaults
      .seller;
    assert.equal(explicit.endpoint_id, "1234567890128");
    assert.equal(explicit.endpoint_scheme, "0088");
    assert.equal(explicit.contact_name, "Explicit fictional seller contact");
    assert.deepEqual(creation.xml(issued.id).data, xml);
    assert.deepEqual(creation.get(issued.id).seller, issued.seller);
  },
);
