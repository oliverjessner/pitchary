import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { AppError, choice, text } from "./validation.js";
import {
  extractPDF,
  createOpenAIExtractor,
  redactProfile,
  validatePDF,
} from "./finance-extraction.js";
import { createFinanceProcessingRepository } from "../database/finance-processing-repository.js";

export function createInvoiceProcessor(
  db,
  finance,
  settings,
  {
    extractText = extractPDF,
    extractor,
    clock = () => new Date(),
    watchEnabled = true,
    pollMs = 10000,
    stabilityMs = 700,
    fileOperations = {},
  } = {},
) {
  const repo = createFinanceProcessingRepository(db);
  const sourceFiles = { readdir, stat, readFile, ...fileOperations };
  const controller = new AbortController();
  const ai = extractor ?? createOpenAIExtractor({ signal: controller.signal });
  let queue = Promise.resolve(),
    closed = false,
    timer,
    pendingScan,
    activeScan,
    watchers = [];
  const observed = new Map();
  const state = { running: false, last_scan: null, error: null };
  const now = () => new Date(clock()).toISOString();
  const enqueue = (fn) => {
    const result = queue.then(() => {
      if (closed)
        throw new AppError(503, "closing", "Der Server wird beendet.");
      return fn();
    });
    queue = result.catch(() => {});
    return result;
  };
  async function process(
    data,
    {
      category,
      file_name,
      file_path = null,
      file_modified_at = now(),
      id = null,
      force = false,
    },
  ) {
    validatePDF(data);
    choice(category, ["revenue", "payable"], "category");
    const filename = path.basename(
      text(file_name, "file_name", { required: true, max: 255 }),
    );
    if (!/\.pdf$/i.test(filename))
      throw new AppError(
        422,
        "invalid_pdf",
        "Die Datei muss die Endung .pdf haben.",
      );
    const hash = createHash("sha256").update(data).digest("hex");
    const byPath = file_path ? repo.findByPath(file_path, category) : null;
    const match = id ? { id } : (byPath ?? repo.findByHash(hash, category));
    const existing = match ? finance.get(match.id) : null;
    const sourceCategory = existing?.original.category ?? category;
    const extractionCategory = existing?.category ?? category;
    if (
      existing &&
      !force &&
      existing.file_hash === hash &&
      existing.ingestion_status === "processed"
    ) {
      if (file_path)
        finance.record({
          id: existing.id,
          file_path,
          file_name: filename,
          file_modified_at,
          pdf_data: data,
        });
      return { invoice: finance.get(existing.id), skipped: true };
    }
    let invoice = finance.record({
      ...(existing ? { id: existing.id } : {}),
      category: sourceCategory,
      file_name: filename,
      file_path,
      file_modified_at,
      file_hash: hash,
      pdf_data: data,
      ingestion_status: "pending",
    });
    try {
      const result = await extractText(data, { signal: controller.signal });
      finance.get(invoice.id);
      const sanitized = redactProfile(result.text, settings.values());
      invoice = finance.record({
        id: invoice.id,
        ocr_text: sanitized,
        document_language: result.document_language,
        extraction_notes: "",
      });
      const key = await settings.getKey();
      finance.get(invoice.id);
      if (!key) {
        invoice = finance.record({
          id: invoice.id,
          extraction_notes:
            "OpenAI-Schlüssel fehlt. Rechnungsdaten manuell ergänzen oder nach der Einrichtung erneut auslesen.",
        });
        finance.log(
          invoice.id,
          "extract",
          "pending",
          "PDF lokal gelesen; OpenAI-Schlüssel noch nicht eingerichtet.",
        );
        return { invoice, skipped: false };
      }
      const resultAI = await ai.invoice(key, sanitized, extractionCategory);
      finance.get(invoice.id);
      invoice = finance.record({
        id: invoice.id,
        ...resultAI.fields,
        extracted_json: resultAI.raw,
        ingestion_status: "processed",
      });
      finance.log(
        invoice.id,
        force ? "reprocess" : "process",
        "success",
        `PDF ${result.method === "ocr" ? "per OCR" : "als Text"} gelesen und Rechnungsdaten erkannt.`,
      );
    } catch (error) {
      if (closed) throw error;
      // A user can delete an invoice while extraction or the AI call is running.
      // Its pending task must never recreate that record in the failure path.
      finance.get(invoice.id);
      const message =
        error instanceof AppError
          ? error.message
          : "Rechnung konnte nicht verarbeitet werden. Erneut auslesen oder Daten manuell ergänzen.";
      invoice = finance.record({
        id: invoice.id,
        ingestion_status: "failed",
        extraction_notes: message,
      });
      finance.log(
        invoice.id,
        force ? "reprocess" : "process",
        "failed",
        message,
      );
    }
    return { invoice, skipped: false };
  }
  async function files(folder, depth = 0) {
    const found = [];
    for (const entry of await sourceFiles.readdir(folder, {
      withFileTypes: true,
    })) {
      if (controller.signal.aborted) break;
      const filename = path.join(folder, entry.name);
      if (entry.isDirectory() && depth < 2)
        found.push(...(await files(filename, depth + 1)));
      else if (entry.isFile() && /\.pdf$/i.test(entry.name))
        found.push(filename);
    }
    return found;
  }
  const ignored = () => {
    try {
      return JSON.parse(settings.read("finance_ignored_docs") || "[]");
    } catch {
      return [];
    }
  };
  async function scanImpl({ settle = false } = {}) {
    const result = {
      imported: 0,
      skipped: 0,
      failed: 0,
      missing: 0,
      pending: 0,
    };
    const config = settings.values();
    const tombstones = ignored();
    for (const category of ["revenue", "payable"]) {
      const folder = config[category + "_folder"];
      if (!folder) continue;
      const found = await files(folder);
      const foundSet = new Set(found);
      for (const filename of found) {
        try {
          const metadata = await sourceFiles.stat(filename);
          const signature = `${metadata.size}:${metadata.mtimeMs}`;
          let observation = observed.get(filename);
          if (!observation || observation.signature !== signature) {
            observation = { signature, since: Date.now() };
            observed.set(filename, observation);
          }
          if (Date.now() - observation.since < stabilityMs) {
            if (!settle) {
              result.pending++;
              continue;
            }
            await new Promise((resolve) => setTimeout(resolve, stabilityMs));
            const second = await sourceFiles.stat(filename);
            if (`${second.size}:${second.mtimeMs}` !== signature) {
              result.pending++;
              continue;
            }
          }
          if (metadata.size > 20 * 1024 * 1024) {
            result.failed++;
            state.error =
              "Ein PDF ist größer als 20 MB und wurde übersprungen.";
            continue;
          }
          const existing = repo.findByPath(filename, category);
          const mtime = metadata.mtime.toISOString();
          if (
            existing?.file_modified_at === mtime &&
            ["processed", "failed"].includes(existing.ingestion_status)
          ) {
            result.skipped++;
            continue;
          }
          // A pending document without a configured key needs no repeated local extraction.
          if (
            existing?.file_modified_at === mtime &&
            existing.ingestion_status === "pending" &&
            !(await settings.getKey())
          ) {
            result.skipped++;
            continue;
          }
          const bytes = await sourceFiles.readFile(filename);
          const hash = createHash("sha256").update(bytes).digest("hex");
          if (
            tombstones.some(
              (item) =>
                item.file_path === filename &&
                item.file_hash === hash &&
                item.category === category,
            )
          ) {
            result.skipped++;
            continue;
          }
          const processed = await enqueue(() => {
            // Deletion can happen while this scan waits for another document.
            // Read the current marks in the queue, immediately before creating
            // or updating an invoice, rather than trusting the scan snapshot.
            if (
              ignored().some(
                (item) =>
                  item.file_path === filename &&
                  item.file_hash === hash &&
                  item.category === category,
              )
            )
              return { skipped: true };
            return process(bytes, {
              category,
              file_name: path.basename(filename),
              file_path: filename,
              file_modified_at: mtime,
            });
          });
          if (processed.skipped) result.skipped++;
          else if (processed.invoice.ingestion_status === "failed")
            result.failed++;
          else result.imported++;
        } catch (error) {
          if (closed) throw error;
          if (error?.code === "ENOENT") {
            foundSet.delete(filename);
            observed.delete(filename);
            continue;
          }
          result.failed++;
          state.error =
            error instanceof AppError
              ? error.message
              : "Ein PDF konnte nicht eingelesen werden.";
        }
      }
      for (const invoice of repo.folderInvoices(category)) {
        const relative = path.relative(folder, invoice.file_path);
        if (
          !relative.startsWith("..") &&
          !path.isAbsolute(relative) &&
          !foundSet.has(invoice.file_path)
        ) {
          finance.record({ id: invoice.id, ingestion_status: "missing" });
          finance.log(
            invoice.id,
            "watch",
            "missing",
            "Die Quelldatei ist nicht mehr im überwachten Ordner. Die gespeicherte PDF-Kopie bleibt verfügbar.",
          );
          result.missing++;
        }
      }
    }
    state.last_scan = now();
    return result;
  }
  function scan(options) {
    if (activeScan) return activeScan;
    state.error = null;
    activeScan = scanImpl(options)
      .catch((error) => {
        state.error =
          error instanceof AppError
            ? error.message
            : "Ordner konnten nicht gelesen werden. Pfade und Berechtigungen prüfen.";
        throw new AppError(422, "scan_failed", state.error);
      })
      .finally(() => {
        activeScan = null;
      });
    return activeScan;
  }
  function requestScan() {
    clearTimeout(pendingScan);
    pendingScan = setTimeout(() => {
      if (!closed) scan().catch(() => {});
    }, stabilityMs + 50);
    pendingScan.unref?.();
  }
  function stopWatching() {
    clearInterval(timer);
    clearTimeout(pendingScan);
    for (const watcher of watchers) watcher.close();
    watchers = [];
    state.running = false;
  }
  function start() {
    stopWatching();
    if (!watchEnabled || closed) return;
    const folders = [
      settings.values().revenue_folder,
      settings.values().payable_folder,
    ].filter(Boolean);
    for (const folder of folders) {
      try {
        const watcher = watch(folder, { recursive: true }, requestScan);
        watcher.on("error", () => {
          state.error =
            "Ordnerbeobachtung unterbrochen; der regelmäßige Scan bleibt aktiv.";
        });
        watcher.unref();
        watchers.push(watcher);
      } catch {
        /* Periodic scan handles platforms without recursive fs.watch. */
      }
    }
    if (folders.length) {
      state.running = true;
      timer = setInterval(() => scan().catch(() => {}), pollMs);
      timer.unref();
      requestScan();
    }
  }
  return {
    state,
    start,
    scan,
    upload(data, options) {
      return enqueue(() => process(data, options));
    },
    reprocess(id) {
      return enqueue(async () => {
        const invoice = finance.get(id);
        const file = finance.file(id);
        return (
          await process(file.data, {
            id,
            category: invoice.category,
            file_name: file.name,
            file_path: invoice.file_path,
            file_modified_at: invoice.file_modified_at,
            force: true,
          })
        ).invoice;
      });
    },
    async testKey(input) {
      const key = input || (await settings.getKey());
      if (!key)
        throw new AppError(
          422,
          "missing_api_key",
          "Bitte zuerst einen OpenAI-Schlüssel eingeben.",
        );
      return ai.test(key);
    },
    enrich(id) {
      return enqueue(async () => {
        const customer = finance.customer(id);
        const latest = customer.latest_invoice_id;
        if (!latest)
          throw new AppError(
            422,
            "no_invoice",
            "Dieser Kunde hat noch keine Einnahmen-Rechnung.",
          );
        const key = await settings.getKey();
        if (!key)
          throw new AppError(
            422,
            "missing_api_key",
            "Bitte zuerst einen OpenAI-Schlüssel einrichten.",
          );
        const invoice = finance.get(latest);
        if (!invoice.ocr_text)
          throw new AppError(
            422,
            "no_invoice_text",
            "Bitte die letzte Rechnung zuerst auslesen.",
          );
        try {
          const data = await ai.customer(
            key,
            redactProfile(invoice.ocr_text, settings.values()),
          );
          const source = finance.get(latest);
          if (source.customer_id !== id)
            throw new AppError(
              422,
              "invoice_customer_changed",
              "Die Quellrechnung gehört inzwischen zu einem anderen Kunden.",
            );
          const current = finance.customer(id);
          return finance.updateCustomer(id, {
            billing_address:
              current.billing_address || data.billing_address || "",
            general_email: current.general_email || data.general_email || "",
            enrichment_status: "completed",
            enriched_at: now(),
            enrichment_invoice_id: latest,
          });
        } catch (error) {
          if (closed) throw error;
          const source = finance.get(latest);
          if (source.customer_id !== id) throw error;
          finance.updateCustomer(id, {
            enrichment_status: "failed",
            enriched_at: now(),
            enrichment_invoice_id: latest,
          });
          throw error;
        }
      });
    },
    async close() {
      closed = true;
      stopWatching();
      controller.abort();
      await Promise.allSettled([queue, activeScan]);
    },
  };
}
