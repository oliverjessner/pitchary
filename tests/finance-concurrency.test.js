import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { stat, readdir, readFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import os from "node:os";
import { buildApp } from "../src/server/app.js";
import { invoicePDF } from "./fixtures/finance-pdf.js";
const clock = () => "2026-10-13T10:00:00.000Z";
const textResult = {
  text: "Invoice to Example Studio, total EUR 120.00",
  document_language: "eng",
  method: "text",
};
const fields = {
  invoice_number: "CON-1",
  invoice_date: "2026-10-01",
  counterparty_name: "Example Studio",
  total_amount_minor: 12000,
  currency: "EUR",
  tags: [],
  confidence_score: 0.9,
  extraction_notes: "",
};
const ai = {
  invoice: async () => ({ fields, raw: JSON.stringify(fields) }),
  test: async () => ({ ok: true }),
  customer: async () => ({
    billing_address: "AI Road",
    general_email: "ai@example.com",
  }),
};
const deferred = () => Promise.withResolvers();
async function setup(t, options = {}) {
  const folder = mkdtempSync(
    path.join(os.tmpdir(), "pitchary-finance-concurrency-"),
  );
  const app = await buildApp({
    databasePath: path.join(folder, "test.sqlite"),
    clock,
    financeOptions: {
      watchEnabled: false,
      stabilityMs: 0,
      extractText: async () => textResult,
      extractor: ai,
      ...options,
    },
  });
  t.after(async () => {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  });
  await app.financeSettings.save({ openai_api_key: "sk-fixture-not-real" });
  const source = path.join(folder, "revenue");
  mkdirSync(source);
  await app.financeSettings.save({ revenue_folder: source });
  return { app, source: realpathSync(source) };
}
test("enrichment respects concurrent manual profile edits, source deletion and customer reassignment", async (t) => {
  for (const action of ["manual", "deleted", "reassigned"])
    await t.test(action, async (t) => {
      const entered = deferred(),
        reply = deferred();
      t.after(() =>
        reply.resolve({
          billing_address: "AI Road",
          general_email: "ai@example.com",
        }),
      );
      const { app } = await setup(t, {
        extractor: {
          ...ai,
          customer: async () => {
            entered.resolve();
            return reply.promise;
          },
        },
      });
      const invoice = app.finance.record({
        category: "revenue",
        ...fields,
        ocr_text: "Invoice for Example Studio",
      });
      const task = app.invoiceProcessor.enrich(invoice.customer_id);
      await entered.promise;
      if (action === "manual")
        app.finance.updateCustomer(invoice.customer_id, {
          billing_address: "Manual Road",
          general_email: "manual@example.com",
        });
      else if (action === "deleted") app.finance.remove(invoice.id);
      else {
        const other = app.crm.createEntity("customers", {
          name: "Another customer",
        });
        app.finance.update(invoice.id, { customer_id: other.id });
      }
      reply.resolve({
        billing_address: "AI Road",
        general_email: "ai@example.com",
      });
      if (action === "manual") {
        const result = await task;
        assert.equal(result.billing_address, "Manual Road");
        assert.equal(result.general_email, "manual@example.com");
      } else {
        await assert.rejects(
          task,
          (error) => error.status === (action === "deleted" ? 404 : 422),
        );
        assert.equal(
          app.finance.customer(invoice.customer_id).billing_address,
          "",
        );
        assert.equal(
          app.finance.customer(invoice.customer_id).enrichment_invoice_id,
          null,
        );
      }
    });
});
test("reprocessing a moved category preserves watcher identity and a deleted source stays ignored", async (t) => {
  const { app, source } = await setup(t);
  writeFileSync(path.join(source, "invoice.pdf"), invoicePDF());
  await app.invoiceProcessor.scan();
  const first = app.finance.list()[0];
  app.finance.update(first.id, { category: "payable" });
  const result = await app.invoiceProcessor.reprocess(first.id);
  assert.equal(result.category, "payable");
  assert.equal(result.original.category, "revenue");
  await app.invoiceProcessor.scan();
  assert.equal(app.finance.list().length, 1);
  app.finance.remove(first.id);
  await app.invoiceProcessor.scan();
  assert.equal(app.finance.list().length, 0);
});
test("queued folder imports recheck deletion marks instead of resurrecting a deleted source", async (t) => {
  const entered = deferred(),
    release = deferred(),
    read = deferred();
  t.after(() => release.resolve());
  let count = 0;
  const { app, source } = await setup(t, {
    extractText: async () => {
      if (++count === 1) {
        entered.resolve();
        await release.promise;
      }
      return textResult;
    },
    fileOperations: {
      stat,
      readdir,
      readFile: async (filename) => {
        const bytes = await readFile(filename);
        read.resolve();
        return bytes;
      },
    },
  });
  const bytes = invoicePDF("WATCHED"),
    filename = path.join(source, "watched.pdf");
  writeFileSync(filename, bytes);
  const watched = app.finance.record({
    category: "revenue",
    ...fields,
    pdf_data: bytes,
    file_name: "watched.pdf",
    file_path: filename,
    file_hash: createHash("sha256").update(bytes).digest("hex"),
    file_modified_at: "2026-01-01T00:00:00.000Z",
    ingestion_status: "processed",
  });
  const blocker = app.invoiceProcessor.upload(invoicePDF("BLOCKER"), {
    category: "revenue",
    file_name: "blocker.pdf",
  });
  await entered.promise;
  const scan = app.invoiceProcessor.scan();
  await read.promise;
  await delay(0);
  app.finance.remove(watched.id);
  release.resolve();
  await blocker;
  assert.equal((await scan).skipped, 1);
  assert.equal(app.finance.list().length, 1);
  assert.equal(app.finance.list()[0].file_name, "blocker.pdf");
});
test("a disappearing PDF does not prevent the remaining folder from being scanned", async (t) => {
  let removed = false;
  const { app, source } = await setup(t, {
    fileOperations: {
      readdir,
      readFile,
      stat: async (filename) => {
        if (!removed && path.basename(filename) === "vanished.pdf") {
          removed = true;
          await unlink(filename);
        }
        return stat(filename);
      },
    },
  });
  writeFileSync(path.join(source, "vanished.pdf"), invoicePDF("VANISHED"));
  writeFileSync(path.join(source, "kept.pdf"), invoicePDF("KEPT"));
  const result = await app.invoiceProcessor.scan();
  assert.equal(result.failed, 0);
  assert.equal(result.imported, 1);
  assert.equal(app.finance.list()[0].file_name, "kept.pdf");
});
test("closing during a folder listing never marks existing revenue or payable PDFs as missing", async (t) => {
  const entered = deferred(),
    release = deferred();
  let pause = false;
  t.after(() => release.resolve());
  const { app, source } = await setup(t, {
    fileOperations: {
      readdir: async (...args) => {
        if (pause) {
          entered.resolve();
          await release.promise;
        }
        return readdir(...args);
      },
    },
  });
  const payable = path.join(path.dirname(source), "payable");
  mkdirSync(payable);
  await app.financeSettings.save({ payable_folder: payable });
  writeFileSync(path.join(source, "revenue.pdf"), invoicePDF("REVENUE"));
  writeFileSync(path.join(payable, "payable.pdf"), invoicePDF("PAYABLE"));
  await app.invoiceProcessor.scan();
  const before = app.finance.list();
  assert.equal(before.length, 2);
  pause = true;
  const scan = app.invoiceProcessor.scan();
  await entered.promise;
  const closing = app.invoiceProcessor.close();
  release.resolve();
  await Promise.allSettled([scan, closing]);
  assert.deepEqual(app.finance.list(), before);
  assert.ok(
    before.every(
      (invoice) =>
        !app.finance.logs(invoice.id).some((log) => log.status === "missing"),
    ),
  );
});
test("an incomplete directory listing or a denied source check never marks a present PDF as missing", async (t) => {
  let incomplete = false,
    denied = false;
  const { app, source } = await setup(t, {
    fileOperations: {
      readdir: (...args) => (incomplete ? [] : readdir(...args)),
      stat: (...args) => {
        if (denied) throw Object.assign(new Error("Denied"), { code: "EPERM" });
        return stat(...args);
      },
    },
  });
  const bytes = invoicePDF("PRESENT");
  writeFileSync(path.join(source, "present.pdf"), bytes);
  await app.invoiceProcessor.scan();
  const before = app.finance.list()[0];
  incomplete = true;
  assert.equal((await app.invoiceProcessor.scan()).missing, 0);
  assert.deepEqual(app.finance.get(before.id), before);
  denied = true;
  const deniedScan = await app.invoiceProcessor.scan();
  assert.equal(deniedScan.missing, 0);
  assert.equal(deniedScan.failed, 1);
  assert.match(app.invoiceProcessor.state.error, /Berechtigungen/);
  assert.deepEqual(app.finance.get(before.id), before);
  assert.deepEqual(app.finance.file(before.id).data, bytes);
});
test("unchanged returning PDFs restore their prior processing state without OCR or AI and preserve corrections", async (t) => {
  for (const status of ["processed", "failed", "pending"])
    await t.test(status, async (t) => {
      let extractions = 0,
        aiCalls = 0;
      const { app, source } = await setup(t, {
        extractText: async () => {
          extractions++;
          return textResult;
        },
        extractor: {
          ...ai,
          invoice: async (...args) => {
            aiCalls++;
            return ai.invoice(...args);
          },
        },
      });
      const bytes = invoicePDF("RETURNED");
      writeFileSync(path.join(source, "returned.pdf"), bytes);
      await app.invoiceProcessor.scan();
      const invoice = app.finance.list()[0];
      app.finance.update(invoice.id, {
        invoice_number: "Manual",
        total_amount_minor: 98765,
        status: "paid",
      });
      app.finance.record({ id: invoice.id, ingestion_status: status });
      app.finance.log(
        invoice.id,
        status === "pending" ? "extract" : "process",
        { processed: "success", failed: "failed", pending: "pending" }[status],
      );
      const before = app.finance.get(invoice.id);
      app.finance.record({ id: invoice.id, ingestion_status: "missing" });
      app.finance.log(invoice.id, "watch", "missing");
      const scan = await app.invoiceProcessor.scan();
      assert.equal(scan.skipped, 1);
      assert.equal(scan.missing, 0);
      assert.equal(extractions, 1);
      assert.equal(aiCalls, 1);
      assert.deepEqual(app.finance.get(invoice.id), before);
      assert.deepEqual(app.finance.file(invoice.id).data, bytes);
      assert.equal(
        app.finance.logs(invoice.id).filter((log) => log.status === "restored")
          .length,
        1,
      );
    });
});
test("a changed returning PDF is processed normally while keeping manual corrections", async (t) => {
  let extractions = 0;
  const { app, source } = await setup(t, {
    extractText: async () => {
      extractions++;
      return textResult;
    },
  });
  const filename = path.join(source, "changed.pdf");
  writeFileSync(filename, invoicePDF("ORIGINAL"));
  await app.invoiceProcessor.scan();
  const original = app.finance.list()[0];
  app.finance.update(original.id, { invoice_number: "Keep correction" });
  app.finance.record({ id: original.id, ingestion_status: "missing" });
  const changed = invoicePDF("CHANGED");
  writeFileSync(filename, changed);
  await app.invoiceProcessor.scan();
  const result = app.finance.get(original.id);
  assert.equal(extractions, 2);
  assert.equal(result.ingestion_status, "processed");
  assert.equal(result.invoice_number, "Keep correction");
  assert.notEqual(result.file_hash, original.file_hash);
  assert.deepEqual(app.finance.file(original.id).data, changed);
});
test("the real folder watcher imports startup and new PDFs and stops on app close", async (t) => {
  const { app, source } = await setup(t, {
    watchEnabled: true,
    pollMs: 50,
    stabilityMs: 20,
  });
  writeFileSync(path.join(source, "startup.pdf"), invoicePDF("STARTUP"));
  await app.ready();
  async function untilCount(count) {
    const deadline = Date.now() + 3000;
    while (app.finance.list().length < count && Date.now() < deadline)
      await delay(25);
    assert.equal(app.finance.list().length, count);
  }
  await untilCount(1);
  writeFileSync(path.join(source, "new.pdf"), invoicePDF("NEW"));
  await untilCount(2);
  assert.equal(app.invoiceProcessor.state.running, true);
  await app.close();
  assert.equal(app.invoiceProcessor.state.running, false);
});
