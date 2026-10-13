import { randomUUID } from "node:crypto";
import {
  createFinanceRepository,
  financeInvoiceColumns,
} from "../database/finance-repository.js";
import { customerRecord } from "./customer-branding.js";
import {
  AppError,
  allowedKeys,
  choice,
  invalid,
  text,
  uuid,
} from "./validation.js";

export const payableTags = [
  "Device",
  "SaaS",
  "Insurance",
  "Membership",
  "Marketing",
  "Domain",
  "Rent",
];
const editable = [
  "category",
  "invoice_number",
  "invoice_date",
  "due_date",
  "counterparty_name",
  "total_amount_minor",
  "currency",
  "tax_amount_minor",
  "net_amount_minor",
  "status",
  "paid_at",
  "send_date",
  "document_language",
  "tags",
  "customer_id",
  "customer_service_id",
];
const writable = editable.filter((field) => field !== "send_date");
const metadata = [
  "source_billly_id",
  "file_path",
  "file_name",
  "pdf_data",
  "file_hash",
  "file_modified_at",
  "ingestion_status",
  "ocr_text",
  "extracted_json",
  "confidence_score",
  "extraction_notes",
  "created_at",
  "updated_at",
];
const normalizedName = (value) =>
  value
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("de-AT");
const own = (value, key) => Object.hasOwn(value, key);

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("Ein Objekt mit Feldern wird erwartet.");
  return value;
}
function optionalText(value, field, max = 1000) {
  return value === null || value === "" ? null : text(value, field, { max });
}
function signedMoney(value, field, nullable = false) {
  if (value === null && nullable) return null;
  if (!Number.isSafeInteger(value) || Math.abs(value) > 1000000000000)
    invalid(
      "Betrag muss in ganzen Cent vorliegen (maximal 1.000.000.000.000).",
      field,
    );
  return value;
}
function calendarDate(value, field) {
  if (value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\d$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value + "T00:00:00.000Z").toISOString().slice(0, 10) !== value
  )
    invalid("Bitte einen gültigen Kalendertag angeben.", field);
  return value;
}
function timestamp(value, field) {
  if (value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    invalid("Bitte einen gültigen Zeitpunkt angeben.", field);
  calendarDate(value.slice(0, 10), field);
  return new Date(value).toISOString();
}
function sum(a, b) {
  const value = a + b;
  if (!Number.isSafeInteger(value))
    invalid(
      "Die Summe der Rechnungsbeträge überschreitet den unterstützten Bereich.",
    );
  return value;
}

export function createFinance(
  db,
  { clock = () => new Date().toISOString(), idFactory = randomUUID } = {},
) {
  const now = () => {
    const value = clock();
    return value instanceof Date
      ? value.toISOString()
      : timestamp(value, "clock");
  };
  const repo = createFinanceRepository(db);
  const atomic = (callback) => repo.atomic(callback);
  const today = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Vienna",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(now()));
    const values = Object.fromEntries(
      parts.map(({ type, value }) => [type, value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  };
  const requireCustomer = (id) => {
    uuid(id, "customer_id");
    const row = repo.customer.get(id);
    if (!row) throw new AppError(404, "not_found", "Kunde nicht gefunden.");
    return row;
  };
  const base = (id) => {
    uuid(id, "id");
    const row = repo.invoice.get(id);
    if (!row) throw new AppError(404, "not_found", "Rechnung nicht gefunden.");
    row.tags = JSON.parse(row.tags);
    row.has_file = Boolean(row.has_file);
    return row;
  };
  function corrections(id) {
    return Object.fromEntries(
      repo.overrides
        .all(id)
        .map((row) => [row.field_name, JSON.parse(row.override_value)]),
    );
  }
  function effective(row) {
    const overrides = corrections(row.id);
    const result = { ...row, ...overrides, original: { ...row }, overrides };
    result.is_overdue = Boolean(
      result.status === "open" && result.due_date && result.due_date < today(),
    );
    if (result.customer_id) {
      const customer = repo.customerName.get(result.customer_id);
      result.customer_name = customer?.name ?? null;
    } else result.customer_name = null;
    if (result.customer_service_id) {
      const relationship = repo.relationship.get(result.customer_service_id);
      if (relationship && relationship.customer_id === result.customer_id) {
        result.relationship = relationship;
        result.service_name = relationship.service_name;
        result.relationship_name = relationship.service_name;
      } else {
        result.customer_service_id = null;
        result.relationship = null;
        result.service_name = null;
        result.relationship_name = null;
      }
    } else {
      result.relationship = null;
      result.service_name = null;
      result.relationship_name = null;
    }
    return result;
  }
  const all = () =>
    repo.invoices.all().map((row) =>
      effective({
        ...row,
        tags: JSON.parse(row.tags),
        has_file: Boolean(row.has_file),
      }),
    );
  function validateValues(input, { importing = false } = {}) {
    object(input);
    allowedKeys(input, importing ? ["id", ...editable, ...metadata] : writable);
    const result = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === "id") result.id = uuid(value, key);
      else if (key === "category")
        result[key] = choice(value, ["revenue", "payable"], key);
      else if (key === "status")
        result[key] = choice(value, ["open", "paid"], key);
      else if (key === "ingestion_status")
        result[key] = choice(
          value,
          ["pending", "processed", "failed", "missing"],
          key,
        );
      else if (
        ["invoice_date", "due_date", "paid_at", "send_date"].includes(key)
      )
        result[key] = calendarDate(value, key);
      else if (["created_at", "updated_at", "file_modified_at"].includes(key)) {
        result[key] = timestamp(value, key);
        if (key !== "file_modified_at" && result[key] === null)
          invalid("Ein Zeitpunkt wird benötigt.", key);
      } else if (
        ["total_amount_minor", "tax_amount_minor", "net_amount_minor"].includes(
          key,
        )
      )
        result[key] = signedMoney(value, key, key !== "total_amount_minor");
      else if (["customer_id", "customer_service_id"].includes(key))
        result[key] = value === null || value === "" ? null : uuid(value, key);
      else if (key === "currency") {
        if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value))
          invalid("Währung muss aus drei Großbuchstaben bestehen.", key);
        try {
          new Intl.NumberFormat("de-AT", {
            style: "currency",
            currency: value,
          });
        } catch {
          invalid("Ungültige Währung.", key);
        }
        result[key] = value;
      } else if (key === "tags") {
        if (
          !Array.isArray(value) ||
          value.length > 30 ||
          value.some(
            (tag) =>
              typeof tag !== "string" ||
              !payableTags.some(
                (option) => option.toLowerCase() === tag.toLowerCase(),
              ),
          )
        )
          invalid("Ungültige Rechnungstags.", key);
        result[key] = payableTags.filter((tag) =>
          value.some((item) => item.toLowerCase() === tag.toLowerCase()),
        );
      } else if (key === "pdf_data") {
        if (
          value !== null &&
          !Buffer.isBuffer(value) &&
          !(value instanceof Uint8Array)
        )
          invalid("PDF-Datei erwartet.", key);
        if (
          value !== null &&
          (value.byteLength > 20 * 1024 * 1024 ||
            !Buffer.from(value).subarray(0, 5).equals(Buffer.from("%PDF-")))
        )
          invalid("Bitte eine PDF-Datei bis 20 MiB verwenden.", key);
        result[key] = value === null ? null : Buffer.from(value);
      } else if (key === "confidence_score") {
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 1
        )
          invalid("Konfidenz muss zwischen 0 und 1 liegen.", key);
        result[key] = value;
      } else if (key === "extracted_json") {
        text(value, key, { required: true, max: 1000000 });
        try {
          JSON.parse(value);
        } catch {
          invalid("Gültiges JSON erwartet.", key);
        }
        result[key] = value;
      } else if (["extraction_notes", "file_name", "file_hash"].includes(key))
        result[key] = text(value, key, {
          max:
            key === "extraction_notes"
              ? 20000
              : key === "file_hash"
                ? 128
                : 1000,
        });
      else
        result[key] = optionalText(
          value,
          key,
          key === "ocr_text"
            ? 2000000
            : key === "counterparty_name"
              ? 200
              : key === "file_path"
                ? 8192
                : 1000,
        );
    }
    return result;
  }
  function ownCompany(name) {
    let companyName = repo.companyName.get()?.value ?? "";
    try {
      const parsed = JSON.parse(companyName);
      if (typeof parsed === "string") companyName = parsed;
    } catch {
      /* Settings also support plain text values. */
    }
    return Boolean(
      companyName && normalizedName(companyName) === normalizedName(name),
    );
  }
  function customerAliases() {
    let parsed;
    try {
      parsed = JSON.parse(repo.customerAliases.get()?.value ?? "{}");
    } catch {
      return new Map();
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return new Map();
    const aliases = new Map();
    for (const [name, id] of Object.entries(parsed)) {
      if (!name || name.length > 400 || typeof id !== "string") continue;
      try {
        uuid(id, "customer_id");
      } catch {
        continue;
      }
      if (repo.customerId.get(id)) aliases.set(normalizedName(name), id);
    }
    return aliases;
  }
  function rememberAlias(name, customerId) {
    if (!name || !customerId || ownCompany(name)) return;
    const key = normalizedName(name),
      aliases = customerAliases();
    // A historical source name keeps its first valid identity, even after a rename.
    if (!key || aliases.has(key)) return;
    requireCustomer(customerId);
    aliases.set(key, customerId);
    repo.saveCustomerAliases.run(
      JSON.stringify(
        Object.fromEntries([...aliases].sort(([a], [b]) => a.localeCompare(b))),
      ),
      now(),
    );
  }
  function matchCustomer(name) {
    const key = normalizedName(name);
    const customer = repo.customerCandidates
      .all()
      .find((row) => normalizedName(row.name) === key);
    if (customer) return customer;
    const alias = customerAliases().get(key);
    return alias ? repo.customer.get(alias) : null;
  }
  function resolveLinks(values, { match = true } = {}) {
    if (values.customer_service_id) {
      const relationship = repo.relationshipCustomer.get(
        values.customer_service_id,
      );
      if (!relationship)
        invalid(
          "Verknüpftes Angebot wurde nicht gefunden.",
          "customer_service_id",
        );
      if (!values.customer_id) values.customer_id = relationship.customer_id;
      if (relationship.customer_id !== values.customer_id)
        invalid(
          "Das Angebot gehört zu einem anderen Kunden.",
          "customer_service_id",
        );
    }
    if (values.customer_id) requireCustomer(values.customer_id);
    else if (
      match &&
      values.category === "revenue" &&
      values.counterparty_name
    ) {
      if (ownCompany(values.counterparty_name)) return values;
      const matched = matchCustomer(values.counterparty_name);
      if (matched) values.customer_id = matched.id;
      else {
        const id = idFactory(),
          at = now();
        repo.insertCustomer.run(id, values.counterparty_name, at, at);
        values.customer_id = id;
      }
    }
    rememberAlias(values.counterparty_name, values.customer_id);
    return values;
  }
  function saveOverride(id, field, value, at) {
    repo.saveOverride.run(id, field, JSON.stringify(value), at, at);
  }
  function reconcile(id, { match = true } = {}) {
    const row = effective(base(id));
    resolveLinks(row, {
      match:
        match &&
        (!own(row.overrides, "customer_id") || row.customer_id !== null),
    });
    const original = base(id);
    if (
      !own(row.overrides, "customer_id") &&
      row.customer_id !== original.customer_id
    )
      repo.setInvoiceCustomer.run(row.customer_id ?? null, id);
    return effective(base(id));
  }
  function datesFilter(filters) {
    const out = {};
    for (const key of ["from", "to"])
      if (filters[key]) out[key] = calendarDate(filters[key], key);
    if (out.from && out.to && out.from > out.to)
      invalid("Startdatum muss vor dem Enddatum liegen.", "from");
    return out;
  }
  function invoiceYears(rows = all()) {
    return [
      ...new Set(
        rows.map((row) => row.invoice_date?.slice(0, 4)).filter(Boolean),
      ),
    ]
      .sort()
      .reverse();
  }
  function profile(id) {
    return (
      repo.profile.get(id) ?? {
        billing_address: "",
        general_email: "",
        enrichment_status: "pending",
        enriched_at: null,
        enrichment_invoice_id: null,
      }
    );
  }
  function customerSummary(customer, invoices) {
    const dated = invoices
      .filter((row) => row.invoice_date)
      .sort(
        (a, b) =>
          a.invoice_date.localeCompare(b.invoice_date) ||
          a.id.localeCompare(b.id),
      );
    const first = dated[0]?.invoice_date ?? null,
      last = dated.at(-1)?.invoice_date ?? null;
    const activeMonths = first
      ? Math.max(
          1,
          (Number(today().slice(0, 4)) - Number(first.slice(0, 4))) * 12 +
            Number(today().slice(5, 7)) -
            Number(first.slice(5, 7)) +
            1,
        )
      : 1;
    const stats = new Map();
    for (const invoice of invoices) {
      if (!stats.has(invoice.currency))
        stats.set(invoice.currency, {
          currency: invoice.currency,
          lifetime_value_minor: 0,
          total_amount_minor: 0,
          open_amount_minor: 0,
          paid_amount_minor: 0,
          invoice_count: 0,
        });
      const stat = stats.get(invoice.currency);
      stat.lifetime_value_minor = sum(
        stat.lifetime_value_minor,
        invoice.total_amount_minor,
      );
      stat.total_amount_minor = stat.lifetime_value_minor;
      const key =
        invoice.status === "paid" ? "paid_amount_minor" : "open_amount_minor";
      stat[key] = sum(stat[key], invoice.total_amount_minor);
      stat.invoice_count++;
    }
    return {
      ...customerRecord(customer),
      ...profile(customer.id),
      invoice_count: invoices.length,
      first_invoice_date: first,
      last_invoice_date: last,
      oldest_invoice_date: first,
      newest_invoice_date: last,
      latest_invoice_id: dated.at(-1)?.id ?? invoices[0]?.id ?? null,
      active_months: activeMonths,
      days_since_last_invoice: last
        ? Math.max(
            0,
            Math.floor((Date.parse(today()) - Date.parse(last)) / 86400000),
          )
        : null,
      currencies: [...stats.values()]
        .sort((a, b) => a.currency.localeCompare(b.currency))
        .map((row) => ({
          ...row,
          avg_monthly_revenue_minor: Math.round(
            row.lifetime_value_minor / activeMonths,
          ),
        })),
    };
  }
  const finance = {
    databasePath: repo.databasePath,
    importTransaction(callback) {
      return atomic(callback);
    },
    findBilllyInvoice(sourceId) {
      const id = repo.billlyInvoice.get(
        text(sourceId, "source_billly_id", { required: true, max: 1000 }),
      )?.id;
      return id ? finance.get(id) : null;
    },
    list(filters = {}) {
      object(filters);
      const category = filters.category
        ? choice(filters.category, ["revenue", "payable"], "category")
        : null;
      const status = filters.status
        ? choice(filters.status, ["open", "paid", "overdue"], "status")
        : null;
      const customerId = filters.customer_id
        ? uuid(filters.customer_id, "customer_id")
        : null;
      const relationshipId = filters.customer_service_id
        ? uuid(filters.customer_service_id, "customer_service_id")
        : null;
      const search = text(filters.search ?? "", "search", {
        max: 200,
      }).toLocaleLowerCase("de-AT");
      const year =
        filters.year && filters.year !== "all" ? String(filters.year) : null;
      if (year && !/^\d{4}$/.test(year))
        invalid("Ungültiges Rechnungsjahr.", "year");
      const range = datesFilter(filters);
      const sort = choice(
        filters.sort || "invoice_date",
        [
          "invoice_date",
          "invoice_number",
          "counterparty_name",
          "total_amount_minor",
          "status",
          "file_name",
          "created_at",
          "due_date",
        ],
        "sort",
      );
      const direction =
        choice(
          filters.order || filters.direction || "desc",
          ["asc", "desc"],
          "order",
        ) === "asc"
          ? 1
          : -1;
      return all()
        .filter(
          (row) =>
            (!category || row.category === category) &&
            (!status ||
              (status === "overdue"
                ? row.status === "open" &&
                  row.due_date &&
                  row.due_date < today()
                : row.status === status)) &&
            (!customerId || row.customer_id === customerId) &&
            (!relationshipId || row.customer_service_id === relationshipId) &&
            (!year ||
              !row.invoice_date ||
              row.invoice_date.startsWith(year + "-")) &&
            (!range.from ||
              (row.invoice_date && row.invoice_date >= range.from)) &&
            (!range.to || (row.invoice_date && row.invoice_date <= range.to)) &&
            (!search ||
              [
                row.invoice_number,
                row.counterparty_name,
                row.customer_name,
                row.file_name,
              ].some((value) =>
                value?.toLocaleLowerCase("de-AT").includes(search),
              )),
        )
        .sort((a, b) => {
          const left = a[sort],
            right = b[sort];
          const compared =
            typeof left === "number" && typeof right === "number"
              ? left - right
              : String(left ?? "").localeCompare(String(right ?? ""), "de-AT", {
                  numeric: true,
                });
          return compared * direction || a.id.localeCompare(b.id);
        });
    },
    years(filters = {}) {
      return invoiceYears(finance.list({ ...filters, year: "all" }));
    },
    get(id) {
      return effective(base(id));
    },
    record(input) {
      const values = validateValues(input, { importing: true });
      return atomic(() => {
        const existingId =
          values.id ??
          (values.source_billly_id
            ? repo.billlyInvoice.get(values.source_billly_id)?.id
            : undefined);
        const existing = existingId ? repo.invoice.get(existingId) : null;
        const at = now(),
          id = existingId ?? idFactory();
        const row = {
          id,
          source_billly_id: null,
          category: "revenue",
          file_path: null,
          file_name: "",
          pdf_data: null,
          file_hash: "",
          file_modified_at: null,
          ingestion_status: "pending",
          ocr_text: null,
          extracted_json: "{}",
          confidence_score: 0,
          invoice_number: null,
          invoice_date: null,
          due_date: null,
          counterparty_name: null,
          total_amount_minor: 0,
          currency: "EUR",
          tax_amount_minor: null,
          net_amount_minor: null,
          status: "open",
          paid_at: null,
          send_date: null,
          document_language: null,
          tags: [],
          extraction_notes: "",
          customer_id: null,
          customer_service_id: null,
          created_at: at,
          updated_at: at,
          ...existing,
          ...(existing ? { tags: JSON.parse(existing.tags) } : {}),
          ...values,
          id,
          updated_at: values.updated_at ?? at,
        };
        delete row.has_file;
        // Reprocessing changes extraction fields while explicit corrections survive.
        if (
          own(values, "counterparty_name") &&
          !own(values, "customer_id") &&
          !row.customer_service_id &&
          (!existing ||
            normalizedName(values.counterparty_name ?? "") !==
              normalizedName(existing.counterparty_name ?? ""))
        )
          row.customer_id = null;
        resolveLinks(row);
        const keys = financeInvoiceColumns.filter(
          (key) => key !== "pdf_data" || own(values, "pdf_data") || !existing,
        );
        const params = keys.map((key) =>
          key === "tags" ? JSON.stringify(row.tags) : row[key],
        );
        repo.saveInvoice(keys, params);
        return finance.get(id);
      });
    },
    update(id, payload) {
      const values = validateValues(payload);
      return atomic(() => {
        const current = finance.get(id),
          candidate = { ...current, ...values };
        if (
          own(values, "counterparty_name") &&
          !own(values, "customer_id") &&
          !current.customer_service_id
        )
          candidate.customer_id = null;
        if (
          own(values, "customer_id") &&
          values.customer_id !== current.customer_id &&
          !own(values, "customer_service_id")
        )
          candidate.customer_service_id = null;
        if (
          own(values, "category") &&
          values.category === "payable" &&
          !own(values, "customer_id") &&
          !own(current.overrides, "customer_id")
        ) {
          candidate.customer_id = null;
          candidate.customer_service_id = null;
        }
        resolveLinks(candidate, {
          match: !own(values, "customer_id") || values.customer_id !== null,
        });
        if (own(values, "tags") && candidate.category !== "payable")
          invalid("Tags stehen nur für Ausgaben zur Verfügung.", "tags");
        if (
          values.status === "paid" &&
          !own(values, "paid_at") &&
          !candidate.paid_at
        )
          values.paid_at = today();
        if (values.status === "open") values.paid_at = null;
        if (
          candidate.status === "open" &&
          own(values, "paid_at") &&
          values.paid_at !== null
        )
          invalid(
            "Ein Zahlungsdatum setzt den Status bezahlt voraus.",
            "paid_at",
          );
        if (
          candidate.status === "paid" &&
          own(values, "paid_at") &&
          values.paid_at === null
        )
          invalid(
            "Bezahlte Rechnungen benötigen ein Zahlungsdatum.",
            "paid_at",
          );
        const at = now();
        for (const [key, value] of Object.entries(values))
          saveOverride(id, key, value, at);
        // Associations are corrections too; the imported association remains reversible.
        if (
          candidate.customer_id !== current.customer_id &&
          !own(values, "customer_id")
        )
          saveOverride(id, "customer_id", candidate.customer_id, at);
        if (
          candidate.customer_service_id !== current.customer_service_id &&
          !own(values, "customer_service_id")
        )
          saveOverride(
            id,
            "customer_service_id",
            candidate.customer_service_id,
            at,
          );
        repo.touchInvoice.run(at, id);
        return finance.get(id);
      });
    },
    reset(id, field = null) {
      if (field !== null) choice(field, editable, "field");
      return atomic(() => {
        finance.get(id);
        if (field === null) repo.clearOverrides.run(id);
        else {
          repo.clearOverride.run(id, field);
          if (field === "status") repo.clearPaymentDate.run(id);
          if (field === "counterparty_name" || field === "category")
            repo.clearAssociationOverrides.run(id);
        }
        repo.touchInvoice.run(now(), id);
        return reconcile(id);
      });
    },
    remove(id) {
      return atomic(() => {
        const invoice = finance.get(id);
        if (invoice.file_path) {
          let ignored = [];
          try {
            ignored = JSON.parse(repo.ignoredDocuments.get()?.value ?? "[]");
          } catch {
            /* Replace malformed local housekeeping metadata. */
          }
          if (!Array.isArray(ignored)) ignored = [];
          const identity = {
            file_path: invoice.file_path,
            file_hash: invoice.file_hash,
            category: invoice.original.category,
          };
          ignored = ignored.filter(
            (row) => row && row.file_path !== identity.file_path,
          );
          ignored.push(identity);
          repo.saveIgnoredDocuments.run(JSON.stringify(ignored), now());
        }
        repo.deleteInvoice.run(id);
        return { ok: true };
      });
    },
    file(id) {
      finance.get(id);
      const row = repo.invoiceFile.get(id);
      if (!row.pdf_data)
        throw new AppError(
          404,
          "file_missing",
          "Für diese Rechnung ist keine PDF-Datei gespeichert.",
        );
      return {
        data: Buffer.from(row.pdf_data),
        name: row.file_name || "Rechnung.pdf",
      };
    },
    log(id, type, status, message = "") {
      if (id !== null) finance.get(id);
      const row = {
        id: idFactory(),
        invoice_id: id,
        process_type: text(type, "process_type", { required: true, max: 100 }),
        status: text(status, "status", { required: true, max: 100 }),
        message: text(message, "message", { max: 20000 }),
        created_at: now(),
      };
      repo.insertLog.run(
        row.id,
        row.invoice_id,
        row.process_type,
        row.status,
        row.message,
        row.created_at,
      );
      return row;
    },
    logs(id) {
      finance.get(id);
      return repo.invoiceLogs.all(id);
    },
    dashboard(filters = {}) {
      object(filters);
      let year = String(filters.year ?? today().slice(0, 4));
      let month = String(filters.month ?? today().slice(5, 7));
      if (/^\d{4}-\d\d$/.test(month)) {
        if (!filters.year) year = month.slice(0, 4);
        month = month.slice(5, 7);
      }
      if (!/^\d{4}$/.test(year) || Number(year) < 1)
        invalid("Ungültiges Jahr.", "year");
      if (!/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12)
        invalid("Ungültiger Monat.", "month");
      const selected = `${year}-${month.padStart(2, "0")}`,
        rows = all(),
        stats = new Map();
      const empty = () => ({ revenue: 0, payable: 0, profit: 0 });
      for (const row of rows) {
        if (!stats.has(row.currency))
          stats.set(row.currency, {
            currency: row.currency,
            month: empty(),
            year: empty(),
            overdue: empty(),
            open: empty(),
          });
        const stat = stats.get(row.currency);
        for (const [key, include] of [
          ["month", row.invoice_date?.startsWith(selected)],
          ["year", row.invoice_date?.startsWith(year + "-")],
          ["open", row.status === "open"],
          [
            "overdue",
            row.status === "open" && row.due_date && row.due_date < today(),
          ],
        ])
          if (include)
            stat[key][row.category] = sum(
              stat[key][row.category],
              row.total_amount_minor,
            );
      }
      const currencies = [...stats.values()].sort((a, b) =>
        a.currency.localeCompare(b.currency),
      );
      for (const row of currencies)
        for (const key of ["month", "year", "overdue", "open"])
          row[key].profit = sum(row[key].revenue, -row[key].payable);
      const months = [];
      const serialMonth = Number(year) * 12 + Number(month) - 1;
      for (let offset = 11; offset >= 0; offset--) {
        const serial = serialMonth - offset,
          label = `${String(Math.floor(serial / 12)).padStart(4, "0")}-${String((serial % 12) + 1).padStart(2, "0")}`;
        for (const { currency } of currencies) {
          const item = { month: label, currency, ...empty() };
          for (const row of rows)
            if (
              row.currency === currency &&
              row.invoice_date?.startsWith(label)
            )
              item[row.category] = sum(
                item[row.category],
                row.total_amount_minor,
              );
          item.profit = sum(item.revenue, -item.payable);
          months.push(item);
        }
      }
      const top = (category) => {
        const groups = new Map();
        for (const row of rows)
          if (
            row.category === category &&
            row.invoice_date?.startsWith(year + "-")
          ) {
            const name =
                row.customer_name || row.counterparty_name || "Unbekannt",
              key = JSON.stringify([
                row.currency,
                row.customer_id || normalizedName(name),
              ]);
            if (!groups.has(key))
              groups.set(key, {
                customer_id: row.customer_id,
                name,
                label: name,
                currency: row.currency,
                total_amount_minor: 0,
                invoice_count: 0,
              });
            const entry = groups.get(key);
            entry.total_amount_minor = sum(
              entry.total_amount_minor,
              row.total_amount_minor,
            );
            entry.invoice_count++;
          }
        return [...groups.values()]
          .sort(
            (a, b) =>
              a.currency.localeCompare(b.currency) ||
              b.total_amount_minor - a.total_amount_minor ||
              a.name.localeCompare(b.name),
          )
          .filter(
            (row, index, values) =>
              values
                .slice(0, index)
                .filter((item) => item.currency === row.currency).length < 5,
          );
      };
      return {
        year,
        month: month.padStart(2, "0"),
        selected_month: selected,
        currencies,
        months,
        top_revenue: top("revenue"),
        top_payable: top("payable"),
        open_revenue: rows.filter(
          (row) => row.category === "revenue" && row.status === "open",
        ),
        open_payable: rows.filter(
          (row) => row.category === "payable" && row.status === "open",
        ),
        years: [...new Set([year, ...invoiceYears(rows)])].sort().reverse(),
      };
    },
    customers(filters = {}) {
      object(filters);
      const invoices = all().filter((row) => row.category === "revenue"),
        profileIds = new Set(
          repo.profileCustomerIds.all().map((row) => row.customer_id),
        );
      const search = text(filters.search ?? "", "search", {
        max: 200,
      }).toLocaleLowerCase("de-AT");
      const rows = repo.customers.all();
      return rows
        .filter(
          (row) =>
            (invoices.some((invoice) => invoice.customer_id === row.id) ||
              profileIds.has(row.id)) &&
            (!search || row.name.toLocaleLowerCase("de-AT").includes(search)) &&
            (filters.archived === undefined ||
              Boolean(row.archived_at) ===
                (filters.archived === true || filters.archived === "true")),
        )
        .map((row) =>
          customerSummary(
            row,
            invoices.filter((invoice) => invoice.customer_id === row.id),
          ),
        );
    },
    customer(id) {
      const row = requireCustomer(id),
        invoices = all().filter(
          (invoice) =>
            invoice.category === "revenue" && invoice.customer_id === id,
        );
      const employees = repo.employees.all(id);
      return {
        ...customerSummary(row, invoices),
        invoices,
        employees: employees.filter((employee) => !employee.archived_at),
        archived_employees: employees.filter(
          (employee) => employee.archived_at,
        ),
      };
    },
    updateCustomer(id, payload) {
      object(payload);
      allowedKeys(payload, [
        "name",
        "billing_address",
        "general_email",
        "enrichment_status",
        "enriched_at",
        "enrichment_invoice_id",
      ]);
      return atomic(() => {
        const customer = requireCustomer(id);
        const data = {};
        for (const [key, value] of Object.entries(payload)) {
          if (key === "name")
            data[key] = text(value, key, { required: true, max: 200 });
          else if (key === "billing_address")
            data[key] = text(value ?? "", key, { max: 10000 });
          else if (key === "general_email") {
            data[key] = text(value ?? "", key, { max: 500 });
            if (data[key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data[key]))
              invalid("Ungültige E-Mail-Adresse.", key);
          } else if (key === "enrichment_status")
            data[key] = choice(
              value,
              ["pending", "completed", "skipped", "failed"],
              key,
            );
          else if (key === "enriched_at") data[key] = timestamp(value, key);
          else {
            data[key] =
              value === null || value === "" ? null : uuid(value, key);
            if (data[key] && finance.get(data[key]).customer_id !== id)
              invalid("Die Rechnung gehört zu einem anderen Kunden.", key);
          }
        }
        const at = now(),
          existing = profile(id),
          values = {
            billing_address: "",
            general_email: "",
            enrichment_status: "pending",
            enriched_at: null,
            enrichment_invoice_id: null,
            ...existing,
            ...data,
          };
        if (own(data, "name") && data.name !== customer.name) {
          if (customer.archived_at)
            throw new AppError(
              409,
              "archived",
              "Archivierte Kunden können nicht umbenannt werden.",
            );
          rememberAlias(customer.name, id);
          rememberAlias(data.name, id);
          repo.renameCustomer.run(data.name, at, id);
        }
        repo.saveProfile.run(
          id,
          values.billing_address,
          values.general_email,
          values.enrichment_status,
          values.enriched_at,
          values.enrichment_invoice_id,
          at,
          at,
        );
        return finance.customer(id);
      });
    },
    importCustomer(payload) {
      object(payload);
      allowedKeys(payload, [
        "id",
        "name",
        "source_name",
        "normalized_name",
        "billing_address",
        "general_email",
        "contacts",
        "enrichment_status",
        "enriched_at",
        "enrichment_invoice_id",
        "created_at",
        "updated_at",
      ]);
      return atomic(() => {
        const name = text(payload.name ?? payload.source_name, "name", {
          required: true,
          max: 200,
        });
        const names = new Set(
          [name, payload.source_name]
            .filter((value) => typeof value === "string" && value.trim())
            .map(normalizedName),
        );
        let customer = repo.customerCandidates
          .all()
          .find((row) => names.has(normalizedName(row.name)));
        if (!customer) {
          const aliases = customerAliases();
          for (const key of names) {
            const id = aliases.get(key);
            if (id) {
              customer = repo.customer.get(id);
              break;
            }
          }
        }
        if (!customer) {
          let id = payload.id ? uuid(payload.id, "id") : idFactory();
          if (repo.customerId.get(id)) id = idFactory();
          const createdAt = payload.created_at
              ? timestamp(payload.created_at, "created_at")
              : now(),
            updatedAt = payload.updated_at
              ? timestamp(payload.updated_at, "updated_at")
              : now();
          repo.insertCustomer.run(id, name, createdAt, updatedAt);
          customer = { id, name };
        }
        rememberAlias(name, customer.id);
        if (typeof payload.source_name === "string")
          rememberAlias(
            text(payload.source_name, "source_name", { max: 200 }),
            customer.id,
          );
        const currentProfile = profile(customer.id),
          updates = {};
        for (const key of ["billing_address", "general_email"])
          if (!currentProfile[key] && payload[key]) updates[key] = payload[key];
        if (
          payload.enrichment_status &&
          ["pending", "failed"].includes(currentProfile.enrichment_status)
        ) {
          updates.enrichment_status = payload.enrichment_status;
          if (payload.enriched_at) updates.enriched_at = payload.enriched_at;
        }
        if (
          !currentProfile.enrichment_invoice_id &&
          payload.enrichment_invoice_id
        )
          updates.enrichment_invoice_id = payload.enrichment_invoice_id;
        if (Object.keys(updates).length)
          finance.updateCustomer(customer.id, updates);
        if (
          payload.contacts !== undefined &&
          (!Array.isArray(payload.contacts) || payload.contacts.length > 10000)
        )
          invalid("Eine Liste von Kontakten wird erwartet.", "contacts");
        for (const contact of payload.contacts ?? []) {
          object(contact);
          const contactName = text(
            contact.name || contact.email || "Kontakt",
            "name",
            { required: true, max: 200 },
          );
          const email = text(contact.email ?? "", "email", { max: 500 });
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            invalid("Ungültige Kontaktadresse.", "email");
          const existing = repo.contactCandidates
            .all(customer.id)
            .find(
              (row) =>
                (email && row.email.toLowerCase() === email.toLowerCase()) ||
                normalizedName(row.name) === normalizedName(contactName),
            );
          if (existing) {
            if (!existing.email && email)
              repo.setEmployeeEmail.run(email, now(), existing.id);
          } else {
            let id = contact.id ? uuid(contact.id, "id") : idFactory();
            if (repo.employeeId.get(id)) id = idFactory();
            const at = now();
            repo.insertEmployee.run(
              id,
              customer.id,
              contactName,
              email,
              at,
              at,
            );
          }
        }
        return finance.customer(customer.id);
      });
    },
  };
  return finance;
}
