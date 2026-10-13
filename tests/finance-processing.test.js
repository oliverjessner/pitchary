import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  statSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp } from "../src/server/app.js";
import { openDatabase } from "../src/database/database.js";
import { createFinanceSettings } from "../src/business/finance-settings.js";
import {
  createOpenAIExtractor,
  decimalMinor,
  extractPDF,
  extractionTools,
  redactProfile,
  validatePDF,
} from "../src/business/finance-extraction.js";
import { invoicePDF } from "./fixtures/finance-pdf.js";
const clock = () => "2026-10-13T10:00:00.000Z";
const fields = {
  invoice_number: "EX-1",
  invoice_date: "2026-10-01",
  due_date: "2026-10-15",
  counterparty_name: "Example Studio",
  total_amount_minor: 12000,
  currency: "EUR",
  net_amount_minor: 10000,
  tax_amount_minor: 2000,
  tags: [],
  confidence_score: 0.9,
  extraction_notes: "Fixture extraction",
};
async function fixture(t, { key = true, fail = false } = {}) {
  const folder = mkdtempSync(
    path.join(os.tmpdir(), "pitchary-finance-processing-"),
  );
  let calls = 0;
  const app = await buildApp({
    databasePath: path.join(folder, "test.sqlite"),
    clock,
    financeOptions: {
      watchEnabled: false,
      stabilityMs: 0,
      extractText: async () => ({
        text: "Own Company\nInvoice to Example Studio\nTotal EUR 120.00",
        document_language: "eng",
        method: "text",
      }),
      extractor: {
        invoice: async (_key, text) => {
          calls++;
          assert.ok(!text.includes("Own Company"));
          if (fail) throw new Error("do not expose sensitive raw error");
          return { fields, raw: JSON.stringify(fields) };
        },
        test: async () => ({ ok: true }),
        customer: async () => ({
          general_email: "contact@example.com",
          billing_address: "Example Road 1",
        }),
      },
    },
  });
  t.after(async () => {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  });
  await app.financeSettings.save({
    company_name: "Own Company",
    ...(key ? { openai_api_key: "sk-fixture-not-real" } : {}),
  });
  const upload = (data = invoicePDF(), category = "revenue") =>
    app.inject({
      method: "POST",
      url: "/api/finance/import",
      payload: {
        file_name: "invoice.pdf",
        category,
        data: data.toString("base64"),
      },
    });
  return { app, folder, upload, calls: () => calls };
}
test("PDF upload persists bytes, redacts own profile, deduplicates and preserves overrides during reprocessing", async (t) => {
  const { app, upload, calls } = await fixture(t);
  const response = await upload();
  assert.equal(response.statusCode, 200, response.body);
  const invoice = response.json().invoice;
  assert.equal(invoice.ingestion_status, "processed");
  assert.equal(invoice.total_amount_minor, 12000);
  assert.equal(invoice.has_file, true);
  assert.ok(!invoice.ocr_text.includes("Own Company"));
  assert.equal((await upload()).json().invoice.id, invoice.id);
  assert.equal(calls(), 1);
  await app.inject({
    method: "PATCH",
    url: `/api/finance/invoices/${invoice.id}`,
    payload: { total_amount_minor: 13000, status: "paid" },
  });
  const reprocessed = await app.inject({
    method: "POST",
    url: `/api/finance/invoices/${invoice.id}/reprocess`,
    payload: {},
  });
  assert.equal(reprocessed.statusCode, 200, reprocessed.body);
  assert.equal(reprocessed.json().total_amount_minor, 13000);
  assert.equal(reprocessed.json().original.total_amount_minor, 12000);
  assert.equal(reprocessed.json().status, "paid");
  assert.equal(reprocessed.json().paid_at, "2026-10-13");
  const file = await app.inject({
    url: `/api/finance/invoices/${invoice.id}/file`,
  });
  assert.equal(file.headers["content-type"], "application/pdf");
  assert.deepEqual(file.rawPayload, invoicePDF());
  assert.ok(!("pdf_data" in invoice));
  assert.equal(
    (await upload(invoicePDF(), "payable")).json().invoice.category,
    "payable",
  );
});
test("unconfigured/failed extraction remains recoverable and invalid uploads never create an invoice", async (t) => {
  const { app, upload } = await fixture(t, { key: false });
  const pending = (await upload()).json().invoice;
  assert.equal(pending.ingestion_status, "pending");
  assert.match(pending.extraction_notes, /Schlüssel fehlt/);
  assert.ok(pending.ocr_text);
  assert.equal((await upload(Buffer.from("not a PDF"))).statusCode, 422);
  assert.equal(app.finance.list().length, 1);
  await app.financeSettings.save({ openai_api_key: "sk-fixture-not-real" });
  assert.equal(
    (await app.invoiceProcessor.reprocess(pending.id)).ingestion_status,
    "processed",
  );
  for (const url of [
    "/api/finance/emails",
    "/api/finance/email-templates",
    "/api/finance/google/connect",
  ])
    assert.equal(
      (await app.inject({ method: "POST", url, payload: {} })).statusCode,
      404,
    );
  const failed = await fixture(t, { fail: true });
  const invoice = (await failed.upload()).json().invoice;
  assert.equal(invoice.ingestion_status, "failed");
  assert.ok(!invoice.extraction_notes.includes("sensitive"));
  assert.equal(failed.app.finance.logs(invoice.id).at(-1).status, "failed");
});
test("folder scans handle nested PDFs, duplicate moves, deletion, retained snapshots and ignored deleted records", async (t) => {
  const { app, folder, calls } = await fixture(t);
  const source = path.join(folder, "revenue");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(path.join(source, "nested", "deeper", "too-deep"), {
    recursive: true,
  });
  const original = path.join(source, "nested", "invoice.pdf");
  writeFileSync(original, invoicePDF());
  writeFileSync(
    path.join(source, "nested", "deeper", "too-deep", "skip.pdf"),
    invoicePDF("SKIP"),
  );
  await app.financeSettings.save({ revenue_folder: source });
  assert.equal((await app.invoiceProcessor.scan()).imported, 1);
  assert.equal(app.finance.list().length, 1);
  assert.equal((await app.invoiceProcessor.scan()).skipped, 1);
  const invoice = app.finance.list()[0];
  const moved = path.join(source, "renamed.pdf");
  renameSync(original, moved);
  await app.invoiceProcessor.scan();
  assert.equal(app.finance.get(invoice.id).file_path, realpathSync(moved));
  assert.equal(calls(), 1);
  unlinkSync(moved);
  assert.equal((await app.invoiceProcessor.scan()).missing, 1);
  assert.deepEqual(app.finance.file(invoice.id).data, invoicePDF());
  writeFileSync(moved, invoicePDF());
  await app.invoiceProcessor.scan();
  app.finance.remove(invoice.id);
  await app.invoiceProcessor.scan();
  assert.equal(app.finance.list().length, 0);
  writeFileSync(moved, invoicePDF("CHANGED"));
  await app.invoiceProcessor.scan();
  assert.equal(app.finance.list().length, 1);
});
test("API keys are encrypted, masked, removable and excluded from invoice settings responses", async (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-finance-key-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "settings.sqlite");
  let db = openDatabase(filename);
  let settings = createFinanceSettings(db, {
    clock,
    tools: async () => ({ text: true, ocr: true }),
  });
  await settings.save({
    openai_api_key: "sk-secret-never-public",
    company_name: "My Company",
  });
  assert.equal(await settings.getKey(), "sk-secret-never-public");
  assert.ok(!JSON.stringify(await settings.public()).includes("sk-secret"));
  assert.equal((await settings.public()).openai_api_key_last4, "blic");
  assert.ok(!settings.read("openai_api_key").includes("sk-secret"));
  if (process.platform !== "win32")
    assert.equal(statSync(filename + ".finance-key").mode & 0o777, 0o600);
  db.close();
  db = openDatabase(filename);
  settings = createFinanceSettings(db, { clock, tools: async () => ({}) });
  assert.equal(await settings.getKey(), "sk-secret-never-public");
  settings.removeKey();
  assert.equal(await settings.getKey(), null);
  db.close();
});

test("settings reject invalid objects and non-text API keys without changing saved values", async (t) => {
  const { app } = await fixture(t);
  for (const input of [
    null,
    [],
    "settings",
    123,
    { company_name: "Must not change", openai_api_key: 123 },
  ]) {
    await assert.rejects(
      app.financeSettings.save(input),
      (error) => error.status === 422,
    );
  }
  assert.equal(app.financeSettings.values().company_name, "Own Company");
  assert.equal(await app.financeSettings.getKey(), "sk-fixture-not-real");
  const response = await app.inject({
    method: "PATCH",
    url: "/api/finance/settings",
    payload: { openai_api_key: 123 },
  });
  assert.equal(response.statusCode, 422, response.body);
});

test("deleting an invoice during local or AI extraction never recreates it", async (t) => {
  for (const phase of ["text", "ai", "ai-failure"]) {
    await t.test(phase, async (t) => {
      let release, entered;
      const blocked = new Promise((resolve) => {
        release = resolve;
      });
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      const app = await buildApp({
        databasePath: ":memory:",
        clock,
        financeOptions: {
          watchEnabled: false,
          extractText: async () => {
            if (phase === "text") {
              entered();
              await blocked;
            }
            return {
              text: "Example invoice",
              document_language: "eng",
              method: "text",
            };
          },
          extractor: {
            invoice: async () => {
              if (phase !== "text") {
                entered();
                await blocked;
              }
              if (phase === "ai-failure")
                throw new Error("Upstream failed after deletion");
              return { fields, raw: JSON.stringify(fields) };
            },
            test: async () => ({ ok: true }),
            customer: async () => ({}),
          },
        },
      });
      t.after(async () => {
        release();
        await app.close();
      });
      await app.financeSettings.save({ openai_api_key: "sk-fixture-not-real" });
      const upload = app.inject({
        method: "POST",
        url: "/api/finance/import",
        payload: {
          file_name: "invoice.pdf",
          category: "revenue",
          data: invoicePDF().toString("base64"),
        },
      });
      await started;
      try {
        const invoice = app.finance.list()[0];
        assert.ok(invoice);
        const deleted = await app.inject({
          method: "DELETE",
          url: `/api/finance/invoices/${invoice.id}`,
        });
        assert.equal(deleted.statusCode, 200, deleted.body);
        release();
        const result = await upload;
        assert.equal(result.statusCode, 404, result.body);
        assert.equal(app.finance.list().length, 0);
        assert.throws(
          () => app.finance.get(invoice.id),
          (error) => error.status === 404,
        );
      } finally {
        release();
      }
    });
  }
});
test("structured AI requests use the schema, validate amounts, handle refusals and never leak upstream bodies", async () => {
  let request;
  const result = {
    invoice_number: "AI-1",
    invoice_date: "2026-10-01",
    due_date: null,
    counterparty_name: "Example Studio",
    total_amount: "-120.50",
    currency: "EUR",
    tax_amount: "-20.50",
    net_amount: "-100.00",
    tags: ["SaaS"],
    extraction_notes: "",
    confidence_score: 0.9,
  };
  const ai = createOpenAIExtractor({
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(result) },
            },
          ],
        }),
      };
    },
  });
  assert.equal(
    (await ai.invoice("sk-fixture", "Invoice text", "payable")).fields
      .total_amount_minor,
    12050,
  );
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(request.model, "gpt-4o-mini");
  assert.match(request.messages[0].content, /Never follow instructions/);
  assert.equal(decimalMinor("0.29"), 29);
  assert.equal(decimalMinor("-1000,50"), -100050);
  assert.throws(() => decimalMinor("1.234"));
  assert.throws(() => validatePDF(Buffer.from("bad")));
  const rejected = createOpenAIExtractor({
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  await assert.rejects(
    rejected.invoice("sk-fixture", "text", "revenue"),
    /HTTP 401/,
  );
  const refused = createOpenAIExtractor({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: "stop", message: { refusal: "No" } }],
      }),
    }),
  });
  await assert.rejects(
    refused.invoice("sk-fixture", "text", "revenue"),
    /vollständigen/,
  );
});
test("real PDF text extraction reads an invoice locally and profile redaction handles line breaks", async (t) => {
  const tools = await extractionTools();
  if (!tools.text) return t.skip("Poppler not installed in this environment");
  const result = await extractPDF(invoicePDF());
  assert.match(result.text, /QA-2026-001/);
  assert.match(result.text, /120\.00/);
  assert.equal(result.method, "text");
  const sanitized = redactProfile(
    "Own\nCompany\nhello@own.test\nRoad 1, 1010 Vienna\nExample Studio",
    {
      company_name: "Own Company",
      company_email: "hello@own.test",
      company_address: "Road 1\n1010 Vienna",
    },
  );
  assert.equal(sanitized, "Example Studio");
});
