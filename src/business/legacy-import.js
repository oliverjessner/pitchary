import { createHash } from "node:crypto";
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { AppError } from "./validation.js";
import { redactFinanceLogMessage } from "./finance.js";
import { openLegacyRepository } from "../database/legacy-repository.js";

const maximumPdfSize = 20 * 1024 * 1024;
const maximumTextSize = 2000000;
const requiredInvoiceColumns = [
  "id",
  "category",
  "file_hash",
  "total_amount",
  "currency",
  "status",
  "created_at",
  "updated_at",
];
const invoiceTags = [
  "Device",
  "SaaS",
  "Insurance",
  "Membership",
  "Marketing",
  "Domain",
  "Rent",
];
const overrideFields = new Map([
  ["invoice_number", "invoice_number"],
  ["invoice_date", "invoice_date"],
  ["due_date", "due_date"],
  ["counterparty_name", "counterparty_name"],
  ["total_amount", "total_amount_minor"],
  ["currency", "currency"],
  ["tax_amount", "tax_amount_minor"],
  ["net_amount", "net_amount_minor"],
  ["status", "status"],
  ["paid_at", "paid_at"],
]);

function importError(message) {
  throw new AppError(422, "legacy_import_invalid", message);
}

function openSource(databasePath) {
  if (typeof databasePath !== "string" || !databasePath.trim())
    importError("Bitte den Pfad zur Quelldatenbank angeben.");
  const resolved = path.resolve(databasePath);
  if (!/\.(?:sqlite|sqlite3|db)$/i.test(resolved))
    importError("Als Quelle wird eine SQLite-Datei erwartet.");
  let canonical;
  try {
    canonical = realpathSync(resolved);
    if (!statSync(canonical).isFile()) throw new Error("Not a regular file");
  } catch {
    importError(
      "Die Quelldatenbank wurde nicht gefunden oder ist nicht lesbar.",
    );
  }
  let source;
  try {
    source = openLegacyRepository(canonical);
    if (!source.tables.has("invoices")) throw new Error("Missing invoices");
    const invoiceColumns = source.columns("invoices");
    if (!requiredInvoiceColumns.every((column) => invoiceColumns.has(column)))
      throw new Error("Unsupported invoice schema");
    return source;
  } catch {
    source?.close();
    importError("Die Datei enthält keine unterstützte Quelldatenbank.");
  }
}

function closeSource(source) {
  source.close();
}

function optionalText(value, field, maximum = 10000) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > maximum)
    importError(
      `Die Quelldatenbank enthält einen ungültigen Wert im Feld ${field}.`,
    );
  return value;
}

function calendarDate(value, field) {
  const raw = optionalText(value, field, 40);
  if (raw === null || !raw.trim()) return null;
  let normalized = raw.trim();
  const dayFirst = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(normalized);
  if (dayFirst) normalized = `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}`;
  const yearFirst = /^(\d{4})[./](\d{2})[./](\d{2})$/.exec(normalized);
  if (yearFirst) normalized = `${yearFirst[1]}-${yearFirst[2]}-${yearFirst[3]}`;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
    !Number.isFinite(Date.parse(normalized + "T00:00:00.000Z")) ||
    new Date(normalized + "T00:00:00.000Z").toISOString().slice(0, 10) !==
      normalized
  )
    importError(
      `Die Quelldatenbank enthält ein ungültiges Datum im Feld ${field}.`,
    );
  return normalized;
}

function contactEmail(value, field) {
  const email = optionalText(value, field, 254)?.trim() ?? "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    importError(
      `Die Quelldatenbank enthält eine ungültige Kontaktadresse im Feld ${field}.`,
    );
  return email;
}

function timestamp(value, field) {
  const raw = optionalText(value, field, 100);
  if (
    raw === null ||
    !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
      raw,
    ) ||
    !Number.isFinite(Date.parse(raw))
  )
    importError(
      `Die Quelldatenbank enthält einen ungültigen Zeitpunkt im Feld ${field}.`,
    );
  const date = calendarDate(raw.slice(0, 10), field);
  if (!date)
    importError(
      `Die Quelldatenbank enthält einen ungültigen Zeitpunkt im Feld ${field}.`,
    );
  // Older source versions also used SQLite's UTC datetime('now') format.
  const utc = /(?:Z|[+-]\d{2}:\d{2})$/.test(raw)
    ? raw
    : raw.replace(" ", "T") + "Z";
  return new Date(utc).toISOString();
}

function decimalCents(
  value,
  field,
  { nullable = false, payable = false } = {},
) {
  if (nullable && (value === null || value === undefined || value === ""))
    return null;
  // Legacy invoice money is stored as decimal TEXT. Do not pass it through
  // floating point before converting to minor units, including credit notes.
  if (typeof value !== "string")
    importError(
      `Die Quelldatenbank enthält einen ungültigen Betrag im Feld ${field}.`,
    );
  const match = /^([+-]?)(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match)
    importError(
      `Die Quelldatenbank enthält einen ungültigen Betrag im Feld ${field}.`,
    );
  const cents =
    BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  const signed = match[1] === "-" && !payable ? -cents : cents;
  if (signed < -1000000000000n || signed > 1000000000000n)
    importError(
      `Die Quelldatenbank enthält einen zu großen Betrag im Feld ${field}.`,
    );
  return Number(signed);
}

function currency(value) {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value.trim()))
    importError("Die Quelldatenbank enthält eine ungültige Währung.");
  return value.trim();
}

function status(value) {
  if (!["open", "paid"].includes(value))
    importError("Die Quelldatenbank enthält einen ungültigen Zahlungsstatus.");
  return value;
}

function jsonText(value, field) {
  const raw = optionalText(value, field, 1000000) ?? "{}";
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Expected object");
  } catch {
    importError(`Die Quelldatenbank enthält ungültiges JSON im Feld ${field}.`);
  }
  return raw;
}

function tags(value) {
  if (value === undefined || value === null || value === "") return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    importError("Die Quelldatenbank enthält ungültige Rechnungs-Tags.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > 30 ||
    parsed.some(
      (tag) =>
        typeof tag !== "string" ||
        !invoiceTags.some(
          (option) => option.toLowerCase() === tag.toLowerCase(),
        ),
    )
  )
    importError("Die Quelldatenbank enthält ungültige Rechnungs-Tags.");
  return [...new Set(parsed)];
}

function legacyId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 500)
    importError("Die Quelldatenbank enthält eine ungültige Datensatz-ID.");
  return value;
}

function targetId(value, type, namespace) {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    return value;
  return mappedId(value, type, namespace);
}

function mappedId(value, type, namespace) {
  const bytes = createHash("sha256")
    .update(`${namespace}:${type}:${value}`)
    .digest();
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function targetInvoice(finance, id) {
  try {
    return finance.get(id);
  } catch (error) {
    if (error?.status === 404 || error?.code === "not_found") return null;
    throw error;
  }
}

function mergeCustomer(finance, customer, extra = {}) {
  const { source_legacy_id, enrichment_source_invoice_id, ...payload } =
    customer;
  try {
    return finance.importCustomer({ ...payload, ...extra });
  } catch (error) {
    // Every supplied ID has already been validated. The finance adapter can
    // reject a valid ID occupied by an unrelated CRM customer; use a stable
    // alternative without changing or deleting the existing CRM record.
    if (error?.status !== 422 || !error?.fields?.id) throw error;
    return finance.importCustomer({
      ...payload,
      ...extra,
      id: mappedId(
        source_legacy_id,
        "customer-collision",
        finance.importNamespace?.() ?? "legacy",
      ),
    });
  }
}

function fileInfo(filePath, includeBytes) {
  const source = optionalText(filePath, "file_path", 8192);
  if (!source)
    return {
      file_path: null,
      file_name: "",
      pdf_data: null,
      file_state: "missing",
    };
  const result = {
    file_path: source,
    file_name: path.basename(source),
    pdf_data: null,
    file_state: "missing",
  };
  if (!/\.pdf$/i.test(source)) return { ...result, file_state: "invalid" };
  let descriptor;
  try {
    const stat = statSync(source);
    if (!stat.isFile() || !stat.size)
      return { ...result, file_state: "invalid" };
    if (stat.size > maximumPdfSize)
      return { ...result, file_state: "oversize" };
    descriptor = openSync(source, "r");
    const header = Buffer.alloc(8);
    const size = readSync(descriptor, header, 0, header.length, 0);
    if (size < 8 || !/^%PDF-[12]\.\d/.test(header.toString("ascii")))
      return { ...result, file_state: "invalid" };
    const bytes = includeBytes ? readFileSync(descriptor) : null;
    if (bytes && bytes.length > maximumPdfSize)
      return { ...result, file_state: "oversize" };
    return { ...result, pdf_data: bytes, file_state: "available" };
  } catch {
    return result;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function fileDigest(filePath) {
  let descriptor;
  try {
    descriptor = openSync(filePath, "r");
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(65536);
    let size;
    let total = 0;
    while ((size = readSync(descriptor, chunk, 0, chunk.length, null)) > 0) {
      total += size;
      if (total > maximumPdfSize) return null;
      hash.update(chunk.subarray(0, size));
    }
    return hash.digest("hex");
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function prepareInvoice(row, includeBytes, namespace) {
  const id = legacyId(row.id);
  if (!["revenue", "payable"].includes(row.category))
    importError(
      "Die Quelldatenbank enthält eine ungültige Rechnungskategorie.",
    );
  const file = fileInfo(row.file_path, includeBytes);
  const confidence = Number(row.confidence_score ?? 0);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    importError("Die Quelldatenbank enthält einen ungültigen Erkennungswert.");
  const createdAt = timestamp(row.created_at, "created_at");
  const ingestionStatus =
    optionalText(row.ingestion_status, "ingestion_status", 100) ?? "pending";
  if (!["pending", "processed", "failed", "missing"].includes(ingestionStatus))
    importError(
      "Die Quelldatenbank enthält einen ungültigen Verarbeitungsstatus.",
    );
  return {
    ...file,
    id: targetId(id, "invoice", namespace),
    source_legacy_id: id,
    category: row.category,
    file_hash:
      optionalText(row.file_hash, "file_hash", 128) ||
      (file.pdf_data
        ? createHash("sha256").update(file.pdf_data).digest("hex")
        : file.file_state === "available"
          ? fileDigest(file.file_path)
          : null) ||
      createHash("sha256").update(`${namespace}:missing:${id}`).digest("hex"),
    file_modified_at: row.file_modified_at
      ? timestamp(row.file_modified_at, "file_modified_at")
      : createdAt,
    ingestion_status: ingestionStatus,
    ocr_text: optionalText(row.ocr_text, "ocr_text", maximumTextSize),
    extracted_json: jsonText(row.extracted_json, "extracted_json"),
    confidence_score: confidence,
    invoice_number: optionalText(row.invoice_number, "invoice_number", 200),
    invoice_date: calendarDate(row.invoice_date, "invoice_date"),
    due_date: calendarDate(row.due_date, "due_date"),
    counterparty_name: optionalText(
      row.counterparty_name,
      "counterparty_name",
      200,
    ),
    total_amount_minor: decimalCents(row.total_amount, "total_amount", {
      payable: row.category === "payable",
    }),
    currency: currency(row.currency),
    tax_amount_minor: decimalCents(row.tax_amount, "tax_amount", {
      nullable: true,
      payable: row.category === "payable",
    }),
    net_amount_minor: decimalCents(row.net_amount, "net_amount", {
      nullable: true,
      payable: row.category === "payable",
    }),
    status: status(row.status),
    paid_at: calendarDate(row.paid_at, "paid_at"),
    send_date: calendarDate(row.send_date, "send_date"),
    document_language: optionalText(
      row.document_language,
      "document_language",
      100,
    ),
    tags: tags(row.tags),
    created_at: createdAt,
    updated_at: timestamp(row.updated_at, "updated_at"),
  };
}

function prepareOverride(row, invoice) {
  const field = overrideFields.get(row.field_name);
  if (!field) return null;
  const raw = row.override_value;
  let value;
  if (field.endsWith("_minor"))
    value = decimalCents(raw, row.field_name, {
      nullable: field !== "total_amount_minor",
      payable: invoice.category === "payable",
    });
  else if (["invoice_date", "due_date", "paid_at"].includes(field))
    value = calendarDate(raw, field);
  else if (field === "currency") value = currency(raw);
  else if (field === "status") value = status(raw);
  else value = optionalText(raw, field, 200) ?? "";
  return { field, value };
}

function readSettings(source) {
  const result = {};
  for (const [key, value] of Object.entries(source.nonSecretSettings())) {
    if (typeof value === "string" && value.length <= 32768) result[key] = value;
  }
  return result;
}

function readCustomers(source, namespace) {
  if (!source.tables.has("customers")) return [];
  const columns = source.columns("customers");
  if (!columns.has("id") || !columns.has("name"))
    importError("Die Quelldatenbank enthält eine ungültige Kundentabelle.");
  const contacts = new Map();
  if (source.tables.has("customer_contacts")) {
    for (const row of source.contacts()) {
      const name = optionalText(row.name, "contact_name", 200)?.trim() ?? "";
      const email = contactEmail(row.email, "contact_email");
      if (!name.trim() && !email.trim()) continue;
      if (!contacts.has(row.customer_id)) contacts.set(row.customer_id, []);
      contacts.get(row.customer_id).push({
        id: targetId(legacyId(row.id), "contact", namespace),
        name,
        email,
      });
    }
  }
  return source.customers().map((row) => {
    const name = optionalText(row.name, "customer_name", 200);
    const sourceName =
      optionalText(row.source_name, "source_name", 200) || name;
    if (!name?.trim() || !sourceName?.trim())
      importError("Die Quelldatenbank enthält einen ungültigen Kundennamen.");
    return {
      id: targetId(legacyId(row.id), "customer", namespace),
      source_legacy_id: row.id,
      name,
      source_name: sourceName,
      normalized_name: sourceName
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("en"),
      billing_address: optionalText(
        row.billing_address,
        "billing_address",
        10000,
      ),
      general_email: contactEmail(row.general_email, "general_email"),
      enrichment_status: ["pending", "completed", "skipped", "failed"].includes(
        row.enrichment_status,
      )
        ? row.enrichment_status
        : "pending",
      enriched_at: row.enriched_at
        ? timestamp(row.enriched_at, "enriched_at")
        : null,
      enrichment_source_invoice_id: row.enrichment_source_invoice_id ?? null,
      contacts: contacts.get(row.id) ?? [],
      created_at: row.created_at
        ? timestamp(row.created_at, "customer_created_at")
        : undefined,
      updated_at: row.updated_at
        ? timestamp(row.updated_at, "customer_updated_at")
        : undefined,
    };
  });
}

function prepareImport(
  source,
  includeBytes,
  { includeLogs = false, namespace = "legacy" } = {},
) {
  const invoices = source
    .invoices()
    .map((row) => prepareInvoice(row, includeBytes, namespace));
  const invoiceMap = new Map(
    invoices.map((invoice) => [invoice.source_legacy_id, invoice]),
  );
  const overrides = new Map();
  let ignoredOverrides = 0;
  if (source.tables.has("invoice_overrides")) {
    for (const row of source.overrides()) {
      const invoice = invoiceMap.get(row.invoice_id);
      if (!invoice) continue;
      const override = prepareOverride(row, invoice);
      if (!override) {
        ignoredOverrides++;
        continue;
      }
      if (!overrides.has(row.invoice_id)) overrides.set(row.invoice_id, {});
      overrides.get(row.invoice_id)[override.field] = override.value;
    }
  }
  const customers = readCustomers(source, namespace);
  const logs = [];
  let excludedLogs = 0;
  if (includeLogs)
    for (const row of source.processingLogs()) {
      const type = optionalText(row.process_type, "process_type", 100);
      if (type && /(?:e[-_]?mail|gmail|oauth|send|smtp|google)/i.test(type)) {
        excludedLogs++;
        continue;
      }
      const status = optionalText(row.status, "log_status", 100);
      if (!type?.trim() || !status?.trim())
        importError(
          "Die Quelldatenbank enthält ein ungültiges Verarbeitungsprotokoll.",
        );
      const id = legacyId(row.id);
      logs.push({
        id: targetId(id, "processing-log", namespace),
        source_invoice_id:
          row.invoice_id === null || row.invoice_id === undefined
            ? null
            : legacyId(row.invoice_id),
        process_type: type,
        status,
        message: redactFinanceLogMessage(
          optionalText(row.message, "log_message", maximumTextSize) ?? "",
        ).slice(0, 20000),
        created_at: timestamp(row.created_at, "log_created_at"),
      });
    }
  return {
    invoices,
    overrides,
    customers,
    ignoredOverrides,
    settings: readSettings(source),
    logs,
    includeLogs,
    excludedLogs,
  };
}

function summary(source, prepared) {
  const files = { available: 0, missing: 0, invalid: 0, oversize: 0 };
  for (const invoice of prepared.invoices) files[invoice.file_state]++;
  return {
    schema_version: source.schemaVersion(),
    invoices: prepared.invoices.length,
    revenue: prepared.invoices.filter(
      (invoice) => invoice.category === "revenue",
    ).length,
    payables: prepared.invoices.filter(
      (invoice) => invoice.category === "payable",
    ).length,
    overrides: [...prepared.overrides.values()].reduce(
      (count, values) => count + Object.keys(values).length,
      0,
    ),
    ignored_overrides: prepared.ignoredOverrides,
    customers: prepared.customers.length,
    contacts: prepared.customers.reduce(
      (count, customer) => count + customer.contacts.length,
      0,
    ),
    files,
    available_settings: Object.keys(prepared.settings),
    ...(prepared.includeLogs
      ? {
          processing_logs: prepared.logs.length,
          excluded_logs: prepared.excludedLogs,
        }
      : {}),
  };
}

/** Validate an import source and return counts only, never records or credentials. */
export function inspectLegacy(databasePath) {
  const source = openSource(databasePath);
  try {
    return summary(source, prepareImport(source, false));
  } finally {
    closeSource(source);
  }
}

/**
 * Import is deliberately dry-run by default. Repeated application leaves already
 * imported invoices untouched, including corrections made later in Pitchary.
 * The finance adapter owns the target transaction and CRM merge rules.
 */
export function importLegacy(
  sourcePath,
  finance,
  { dryRun = true, includeLogs = false } = {},
) {
  const source = openSource(sourcePath);
  try {
    if (
      finance?.databasePath &&
      finance.databasePath !== ":memory:" &&
      realpathSync(finance.databasePath) === source.canonical
    )
      importError("Quell- und Zieldatenbank müssen verschieden sein.");
    // Validate every record before writes, but retain only one PDF at a time.
    const namespace = finance?.importNamespace?.() ?? "legacy";
    const prepared = prepareImport(source, false, { includeLogs, namespace });
    const result = {
      ...summary(source, prepared),
      dry_run: dryRun,
      imported: 0,
      skipped: 0,
      ...(includeLogs ? { logs_imported: 0, logs_skipped: 0 } : {}),
    };
    if (dryRun) return result;
    if (
      typeof finance?.record !== "function" ||
      typeof finance?.update !== "function" ||
      typeof finance?.findLegacyInvoice !== "function" ||
      typeof finance?.importCustomer !== "function" ||
      typeof finance?.importTransaction !== "function"
    )
      throw new Error("Finance import adapter is incomplete.");
    if (includeLogs && typeof finance?.importProcessingLog !== "function")
      throw new Error("Finance processing log adapter is incomplete.");
    return finance.importTransaction(() => {
      const customerMap = new Map();
      for (const customer of prepared.customers) {
        const imported = mergeCustomer(finance, customer);
        customerMap.set(customer.normalized_name, imported.id);
      }
      for (const invoice of prepared.invoices) {
        if (finance.findLegacyInvoice(invoice.source_legacy_id)) {
          result.skipped++;
          continue;
        }
        const { file_state, ...payload } = invoice;
        const currentFile = fileInfo(invoice.file_path, true);
        payload.pdf_data = currentFile.pdf_data;
        if (currentFile.file_state !== file_state) {
          result.files[file_state]--;
          result.files[currentFile.file_state]++;
        }
        const corrections =
          prepared.overrides.get(invoice.source_legacy_id) ?? {};
        const name = corrections.counterparty_name ?? invoice.counterparty_name;
        const normalized = name
          ?.normalize("NFC")
          .trim()
          .replace(/\s+/g, " ")
          .toLocaleLowerCase("en");
        if (invoice.category === "revenue" && customerMap.has(normalized))
          payload.customer_id = customerMap.get(normalized);
        // A UUID shared with an unrelated target record must never overwrite it.
        if (targetInvoice(finance, payload.id)) {
          payload.id = mappedId(
            invoice.source_legacy_id,
            "invoice-collision",
            namespace,
          );
          if (targetInvoice(finance, payload.id))
            importError(
              "Eine importierte Rechnungs-ID kollidiert mit einer vorhandenen Rechnung.",
            );
        }
        const imported = finance.record(payload);
        if (Object.keys(corrections).length) {
          finance.update(imported.id, corrections, { legacyImport: true });
          // Applying historical corrections must not replace the source's last
          // invoice modification timestamp with today's import time.
          finance.record({ id: imported.id, updated_at: invoice.updated_at });
        }
        result.imported++;
      }
      for (const customer of prepared.customers) {
        if (!customer.enrichment_source_invoice_id) continue;
        const invoice = finance.findLegacyInvoice(
          customer.enrichment_source_invoice_id,
        );
        if (!invoice) continue;
        mergeCustomer(finance, customer, { enrichment_invoice_id: invoice.id });
      }
      for (const { source_invoice_id, ...log } of prepared.logs) {
        const invoice = source_invoice_id
          ? finance.findLegacyInvoice(source_invoice_id)
          : null;
        const imported = finance.importProcessingLog({
          ...log,
          invoice_id: invoice?.id ?? null,
        });
        imported.imported ? result.logs_imported++ : result.logs_skipped++;
      }
      return result;
    });
  } finally {
    closeSource(source);
  }
}
