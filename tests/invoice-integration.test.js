import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup } from "node:sqlite";
import { buildApp } from "../src/server/app.js";
import { openDatabase } from "../src/database/database.js";
import { invoiceSnapshot } from "./fixtures/invoice-snapshot.js";
import { demoCustomerLogo } from "../scripts/demo-assets.js";

const clock = () => "2026-11-16T10:00:00.000Z";
async function setup(t) {
  const app = await buildApp({
    databasePath: ":memory:",
    clock,
    financeOptions: { watchEnabled: false },
  });
  t.after(() => app.close());
  const example = invoiceSnapshot();
  await app.invoiceCreation.saveSettings({
    company_name: example.seller.name,
    company_email: example.seller.email,
    company_address: "Beispielweg 1\n10115 Berlin",
    street: example.seller.street,
    postal_code: example.seller.postal_code,
    city: example.seller.city,
    country_code: example.seller.country_code,
    vat_id: example.seller.vat_id,
    phone: example.seller.phone,
    contact_name: example.seller.contact_name,
    endpoint_id: example.seller.endpoint_id,
    endpoint_scheme: example.seller.endpoint_scheme,
    bank_name: example.bank.name,
    account_holder: example.bank.account_holder,
    iban: example.bank.iban,
    bic: example.bank.bic,
    tax_rate: "19",
    number_prefix: "TEST-",
  });
  const customer = app.crm.createEntity("customers", {
    name: example.recipient.name,
  });
  app.invoiceCreation.saveProfile(customer.id, {
    ...Object.fromEntries(
      [
        "street",
        "postal_code",
        "city",
        "country_code",
        "vat_id",
        "endpoint_id",
        "endpoint_scheme",
        "customer_number",
      ].map((key) => [key, example.recipient[key]]),
    ),
    buyer_reference: example.buyer_reference,
    billing_address: "Musterstraße 2\n20095 Hamburg",
  });
  const offers = [10000, 20000].map((price, index) => {
    const service = app.crm.createEntity("services", {
      name: `Fiktive Leistung ${index + 1}`,
    });
    const offer = app.crm.createRelationship({
      customer_id: customer.id,
      service_id: service.id,
      current_offered_price_minor: price,
    });
    app.crm.changeStatus(offer.id, { status: "pitched" });
    return app.crm.changeStatus(offer.id, { status: "accepted" });
  });
  const input = {
    customer_id: customer.id,
    customer_service_ids: offers.map(({ id }) => id),
    service_period_start: "2026-11-15",
    service_period_end: "2026-11-15",
    e_invoice: true,
  };
  return { app, customer, offers, input };
}

test(
  "decimal quantities and rounded cents agree in the ledger, snapshot, PDF and validated XML",
  { timeout: 60000 },
  async (t) => {
    const { app, input } = await setup(t);
    const draft = app.invoiceCreation.create({
      ...input,
      items: [
        {
          name: "Fiktiver Dezimalfall",
          quantity: "1.234567",
          unit_price: "12.3456",
          tax_category: "S",
          tax_rate: "19",
        },
        {
          name: "Fiktiver Rundungsfall",
          quantity: "1",
          unit_price: "0.005",
          tax_category: "S",
          tax_rate: "19",
        },
      ],
    });
    assert.equal(draft.totals.net_amount_minor, 1525);
    assert.equal(draft.totals.tax_amount_minor, 290);
    assert.equal(draft.totals.total_amount_minor, 1815);
    const issued = await app.invoiceCreation.finalize(draft.id);
    assert.equal(issued.validation.valid, true);
    const ledger = app.finance.get(issued.id);
    assert.equal(ledger.total_amount_minor, 1815);
    assert.equal(ledger.net_amount_minor, 1525);
    assert.equal(ledger.tax_amount_minor, 290);
    const xml = app.invoiceCreation.xml(issued.id).data.toString();
    assert.match(
      xml,
      /<cbc:PayableAmount currencyID="EUR">18\.15<\/cbc:PayableAmount>/,
    );
    assert.match(
      xml,
      /<cbc:InvoicedQuantity unitCode="C62">1\.234567<\/cbc:InvoicedQuantity>/,
    );
    assert.match(
      xml,
      /<cbc:PriceAmount currencyID="EUR">12\.3456<\/cbc:PriceAmount>/,
    );
    const folder = mkdtempSync(
      path.join(tmpdir(), "pitchary-invoice-decimal-"),
    );
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    const filename = path.join(folder, "invoice.pdf");
    writeFileSync(filename, app.finance.file(issued.id).data);
    const text = execFileSync("pdftotext", ["-layout", filename, "-"], {
      encoding: "utf8",
    });
    assert.match(text, /1,234567/);
    assert.match(text, /12,3456/);
    assert.match(text, /18,15/);
  },
);

test(
  "two offers produce one validated outgoing invoice, protected downloads and an administratively editable payment",
  { timeout: 60000 },
  async (t) => {
    const { app, customer, offers, input } = await setup(t);
    const number = app.invoiceCreation.settings().next_number;
    const created = await app.inject({
      method: "POST",
      url: "/api/finance/creation/drafts",
      payload: input,
    });
    assert.equal(created.statusCode, 201, created.body);
    const draft = created.json();
    assert.equal(draft.items.length, 2);
    assert.equal(app.finance.list().length, 0);
    assert.equal(
      app.crm.entity("customers", customer.id).customer_type,
      "lead",
    );
    const preview = await app.inject(
      `/api/finance/creation/drafts/${draft.id}/preview`,
    );
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.rawPayload.subarray(0, 5).toString(), "%PDF-");
    assert.equal(app.invoiceCreation.settings().next_number, number);
    const issued = await app.inject({
      method: "POST",
      url: `/api/finance/creation/drafts/${draft.id}/finalize`,
      payload: { expected_version: draft.version },
    });
    assert.equal(issued.statusCode, 200, issued.body);
    const document = issued.json();
    assert.equal(document.validation.valid, true);
    assert.equal(document.validation.profile.version, "3.0.2");
    assert.equal(app.invoiceCreation.settings().next_number, number + 1);
    assert.equal(app.finance.list().length, 1);
    assert.equal(app.finance.get(document.id).is_generated, true);
    assert.equal(
      app.crm.entity("customers", customer.id).customer_type,
      "customer",
    );
    for (const offer of offers) {
      const filtered = await app.inject(
        `/api/finance/invoices?customer_service_id=${offer.id}`,
      );
      assert.deepEqual(
        filtered.json().items.map(({ id }) => id),
        [document.id],
      );
      assert.equal(app.crm.relationship(offer.id).status, "accepted");
    }
    const summary = app.finance.revenueOverview().overall_revenue;
    assert.equal(summary.invoice_count, 1);
    assert.equal(summary.total_amount_minor, 35700);
    const pdf = await app.inject(
      `/api/finance/invoices/${document.id}/file?download=1`,
    );
    assert.equal(pdf.statusCode, 200);
    assert.match(pdf.headers["content-disposition"], /^attachment;/);
    const xml = await app.inject(`/api/finance/invoices/${document.id}/xml`);
    assert.equal(xml.statusCode, 200, xml.body);
    assert.match(
      xml.body,
      new RegExp(`<cbc:ID>${document.invoice_number}</cbc:ID>`),
    );
    for (const category of ["revenue", "payable"]) {
      const duplicate = await app.inject({
        method: "POST",
        url: "/api/finance/import",
        payload: {
          category,
          file_name: "copied.pdf",
          data: pdf.rawPayload.toString("base64"),
        },
      });
      assert.equal(duplicate.statusCode, 200, duplicate.body);
      assert.equal(duplicate.json().invoice.id, document.id);
      assert.equal(duplicate.json().skipped, true);
    }
    assert.equal(app.finance.list().length, 1);
    for (const [method, suffix, payload] of [
      ["PATCH", "", { total_amount_minor: 1 }],
      ["POST", "/reset", {}],
      ["DELETE", "", undefined],
      ["POST", "/reprocess", undefined],
    ]) {
      const response = await app.inject({
        method,
        url: `/api/finance/invoices/${document.id}${suffix}`,
        ...(payload ? { payload } : {}),
      });
      assert.equal(response.statusCode, 409, response.body);
    }
    assert.throws(
      () => app.finance.record({ id: document.id, invoice_number: "REPLACED" }),
      /Zahlungsstatus/,
    );
    const paid = await app.inject({
      method: "PATCH",
      url: `/api/finance/invoices/${document.id}`,
      payload: { status: "paid", paid_at: "2026-11-16" },
    });
    assert.equal(paid.statusCode, 200, paid.body);
    assert.equal(paid.json().status, "paid");
    assert.deepEqual(app.finance.file(document.id).data, pdf.rawPayload);
  },
);

test(
  "customer merges, deleted offers and database backup preserve issued content, logo and all bytes",
  { timeout: 60000 },
  async (t) => {
    const { app, customer, offers, input } = await setup(t);
    await app.invoiceCreation.saveSettings({ logo: demoCustomerLogo });
    const draft = app.invoiceCreation.create({ ...input, e_invoice: false });
    const invoice = await app.invoiceCreation.finalize(draft.id);
    const bytes = app.finance.file(invoice.id).data;
    const snapshot = app.database
      .prepare("SELECT content_json FROM invoice_documents WHERE id=?")
      .get(invoice.id).content_json;
    const unfinished = app.invoiceCreation.create({
      ...input,
      e_invoice: false,
    });
    await app.invoiceCreation.saveSettings({
      company_name: "Geänderter fiktiver Name",
      logo: null,
    });
    app.invoiceCreation.saveProfile(customer.id, {
      street: "Geänderte Teststraße 8",
    });
    const target = app.crm.createEntity("customers", {
      name: "Fiktiver Zielkunde",
    });
    app.customerMerge.merge(customer.id, target.id);
    assert.equal(app.finance.get(invoice.id).customer_id, target.id);
    assert.equal(app.invoiceCreation.get(unfinished.id).customer_id, target.id);
    assert.equal(
      app.invoiceCreation.get(unfinished.id).version,
      unfinished.version + 1,
    );
    assert.equal(
      app.invoiceCreation.profile(target.id).street,
      "Geänderte Teststraße 8",
    );
    for (const offer of offers) app.crm.deleteRelationship(offer.id);
    assert.equal(
      app.invoiceCreation
        .get(invoice.id)
        .items.every((item) => item.customer_service_id === null),
      true,
    );
    assert.equal(
      app.database
        .prepare("SELECT content_json FROM invoice_documents WHERE id=?")
        .get(invoice.id).content_json,
      snapshot,
    );
    assert.deepEqual(app.finance.file(invoice.id).data, bytes);
    const folder = mkdtempSync(
      path.join(tmpdir(), "pitchary-authored-backup-"),
    );
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    const filename = path.join(folder, "backup.sqlite");
    await backup(app.database, filename);
    const restored = openDatabase(filename);
    t.after(() => restored.close());
    assert.equal(
      restored.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      restored
        .prepare("SELECT content_json FROM invoice_documents WHERE id=?")
        .get(invoice.id).content_json,
      snapshot,
    );
    assert.deepEqual(
      Buffer.from(
        restored
          .prepare("SELECT pdf_data FROM finance_invoices WHERE id=?")
          .get(invoice.id).pdf_data,
      ),
      bytes,
    );
  },
);
