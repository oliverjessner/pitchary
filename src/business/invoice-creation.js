import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { transaction } from "../database/database.js";
import { logo as validateLogo } from "./customer-branding.js";
import {
  AppError,
  allowedKeys,
  calendarDate,
  choice,
  invalid,
  text,
  uuid,
} from "./validation.js";
import { calculateInvoice } from "./invoice-calculation.js";
import { defaultInvoiceSubject } from "../../public/js/invoice-subject.js";
import {
  invoiceProfileFields,
  saveCustomerBilling,
} from "./customer-billing.js";

export { invoiceProfileFields } from "./customer-billing.js";
const settingDefaults = {
  company_name: "",
  company_email: "",
  company_address: "",
  owner_name: "",
  street: "",
  postal_code: "",
  city: "",
  country_code: "",
  phone: "",
  website: "",
  vat_id: "",
  tax_id: "",
  bank_name: "",
  account_holder: "",
  iban: "",
  bic: "",
  payment_days: 14,
  payment_text: "",
  tax_category: "S",
  tax_rate: "20",
  tax_reason: "",
  number_prefix: "R-",
  number_digits: 5,
  next_number: 1,
  endpoint_id: "",
  endpoint_scheme: "",
  contact_name: "",
  logo: null,
};
const settingKey = (key) =>
  key.startsWith("company_") ? key : `invoice_${key}`;
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    invalid("Ein Objekt mit Feldern wird erwartet.");
  return input;
};
const integer = (value, field, min, max) => {
  if (
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    invalid(
      "Bitte eine ganze Zahl innerhalb der erlaubten Grenzen angeben.",
      field,
    );
  return Number(value);
};
const email = (value, field) => {
  const result = text(value ?? "", field, { max: 500 });
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    invalid("Ungültige E-Mail-Adresse.", field);
  return result;
};
const date = (value, field) => (value ? calendarDate(value, field) : "");
const addDays = (value, days) =>
  new Date(Date.parse(value + "T00:00:00.000Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
const minorPrice = (value) =>
  `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;

export function createInvoiceCreation(
  db,
  {
    finance,
    settings: financeSettings,
    clock = () => new Date(),
    renderPDF = async (...args) =>
      (await import("./invoice-pdf.js")).renderInvoicePDF(...args),
    createXML = async (...args) =>
      (await import("./invoice-xml.js")).createInvoiceXML(...args),
    validateXML = async (...args) =>
      (await import("./invoice-validation.js")).validateInvoiceXML(...args),
  } = {},
) {
  const now = () => new Date(clock()).toISOString();
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
  const atomic = (callback) =>
    db.isTransaction ? callback() : transaction(db, callback);
  const storedSetting = db.prepare(
    "SELECT value FROM finance_settings WHERE key=?",
  );
  const writeSetting = db.prepare(
    "INSERT INTO finance_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
  );
  const requireCustomer = (id) => {
    uuid(id, "customer_id");
    const customer = db.prepare("SELECT * FROM customers WHERE id=?").get(id);
    if (!customer)
      throw new AppError(404, "not_found", "Kunde nicht gefunden.");
    return customer;
  };
  const rowFor = (id) => {
    uuid(id, "id");
    const row = db
      .prepare("SELECT * FROM invoice_documents WHERE id=?")
      .get(id);
    if (!row)
      throw new AppError(404, "not_found", "Rechnungsentwurf nicht gefunden.");
    return row;
  };
  const formatNumber = (config, number = config.next_number) =>
    config.number_prefix + String(number).padStart(config.number_digits, "0");
  const numberExists = (number) =>
    finance
      .list({ category: "revenue" })
      .some((invoice) => invoice.invoice_number === number);
  function availableNumber(config) {
    let number = config.next_number;
    for (let attempts = 0; attempts < 10000; attempts++, number++) {
      if (!Number.isSafeInteger(number) || number > 999999999999)
        invalid("Der Rechnungsnummernkreis ist ausgeschöpft.", "next_number");
      const candidate = formatNumber(config, number);
      if (!numberExists(candidate))
        return { number, invoice_number: candidate };
    }
    invalid(
      "Bitte den nächsten Rechnungszähler auf einen freien Bereich setzen.",
      "next_number",
    );
  }
  function settings() {
    const config = Object.fromEntries(
      Object.entries(settingDefaults).map(([key, fallback]) => {
        const raw = storedSetting.get(settingKey(key))?.value;
        const value =
          raw === undefined
            ? fallback
            : key === "logo"
              ? JSON.parse(raw)
              : typeof fallback === "number"
                ? Number(raw)
                : raw;
        return [key, value];
      }),
    );
    let nextInvoiceNumber = null,
      numberError = null;
    try {
      nextInvoiceNumber = availableNumber(config).invoice_number;
    } catch (error) {
      if (!(error instanceof AppError) || !error.fields?.next_number)
        throw error;
      // Exhaustion must not lock the settings editor out: the user can still
      // select a new prefix or counter. Only finalization needs a free number.
      numberError = error.message;
    }
    return {
      ...config,
      revision: hash(config),
      next_invoice_number: nextInvoiceNumber,
      number_exhausted: numberError !== null,
      number_error: numberError,
      has_logo: Boolean(config.logo),
      logo_url: config.logo
        ? `data:${config.logo.mime_type};base64,${config.logo.data_base64}`
        : null,
    };
  }
  async function saveSettings(input) {
    object(input);
    allowedKeys(input, Object.keys(settingDefaults));
    const patch = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === "logo") {
        if (value === null) patch.logo = null;
        else {
          const validated = validateLogo(value);
          try {
            const image = sharp(validated.logo_data, {
              limitInputPixels: 16_777_216,
            });
            const metadata = await image.metadata();
            if (
              !metadata.width ||
              !metadata.height ||
              metadata.width > 4096 ||
              metadata.height > 4096
            )
              invalid(
                "Das Logo darf maximal 4096 × 4096 Pixel groß sein.",
                "logo",
              );
            const data = await image
              .rotate()
              .resize({
                width: 1600,
                height: 800,
                fit: "inside",
                withoutEnlargement: true,
              })
              .png()
              .toBuffer();
            if (data.length > 1048576)
              invalid("Das Logo darf höchstens 1 MiB groß sein.", "logo");
            patch.logo = {
              mime_type: "image/png",
              data_base64: data.toString("base64"),
            };
          } catch (error) {
            if (error instanceof AppError) throw error;
            invalid("Das Logo konnte nicht gelesen werden.", "logo");
          }
        }
      } else if (key === "payment_days")
        patch[key] = integer(value, key, 0, 3650);
      else if (key === "number_digits") patch[key] = integer(value, key, 1, 12);
      else if (key === "next_number")
        patch[key] = integer(value, key, 1, 999999999999);
      else if (key === "tax_category")
        patch[key] = choice(value, ["S", "AE", "E"], key);
      else if (key === "company_email") patch[key] = email(value, key);
      else {
        patch[key] = text(value, key, {
          max: ["company_address", "payment_text", "tax_reason"].includes(key)
            ? 4000
            : key === "number_prefix"
              ? 40
              : 500,
        });
        if (key === "country_code" && patch[key])
          patch[key] = country(patch[key], key);
        if (key === "iban")
          patch[key] = patch[key].replace(/\s/g, "").toUpperCase();
        if (key === "bic")
          patch[key] = patch[key].replace(/\s/g, "").toUpperCase();
      }
    }
    const combined = { ...settings(), ...patch };
    calculateInvoice({
      items: [
        {
          name: "Steuerprüfung",
          quantity: "1",
          unit_price: "0",
          tax_category: combined.tax_category,
          tax_rate: combined.tax_category === "S" ? combined.tax_rate : "0",
          tax_reason: combined.tax_reason,
        },
      ],
    });
    atomic(() => {
      for (const [key, value] of Object.entries(patch))
        writeSetting.run(
          settingKey(key),
          key === "logo" ? JSON.stringify(value) : String(value),
          now(),
        );
    });
    return settings();
  }
  function country(value, field) {
    const result = text(value, field, { max: 2 }).toUpperCase();
    if (!/^[A-Z]{2}$/.test(result))
      invalid("Bitte einen zweistelligen Ländercode angeben.", field);
    try {
      if (
        new Intl.DisplayNames(["en"], { type: "region", fallback: "none" }).of(
          result,
        ) === undefined ||
        ["ZZ", "EU", "UN", "XK"].includes(result)
      )
        throw new Error();
    } catch {
      invalid("Bitte einen gültigen Ländercode angeben.", field);
    }
    return result;
  }
  function profile(id) {
    const customer = requireCustomer(id);
    const existing =
      db
        .prepare("SELECT * FROM finance_customer_profiles WHERE customer_id=?")
        .get(id) ?? {};
    const out = {
      customer_id: id,
      name: customer.name,
      billing_address: existing.billing_address ?? "",
      general_email: existing.general_email ?? "",
    };
    for (const field of invoiceProfileFields)
      out[field] = existing[field] ?? "";
    out.email = out.invoice_email || out.general_email;
    return out;
  }
  function saveProfile(id, input) {
    object(input);
    requireCustomer(id);
    allowedKeys(input, [
      ...invoiceProfileFields,
      "billing_address",
      "general_email",
      "email",
    ]);
    const patch = { ...input };
    if (Object.hasOwn(patch, "email")) {
      patch.invoice_email = patch.email;
      delete patch.email;
    }
    atomic(() => {
      saveCustomerBilling(db, id, patch, now());
    });
    return profile(id);
  }
  const sellerFrom = (config) => {
    const hasElectronicAddress = Boolean(
      config.endpoint_id || config.endpoint_scheme,
    );
    return {
      name: config.company_name,
      additional_name: config.owner_name,
      street: config.street,
      postal_code: config.postal_code,
      city: config.city,
      country_code: config.country_code,
      billing_address: config.company_address,
      email: config.company_email,
      phone: config.phone,
      website: config.website,
      vat_id: config.vat_id,
      tax_id: config.tax_id,
      endpoint_id: hasElectronicAddress
        ? config.endpoint_id
        : config.company_email,
      endpoint_scheme: hasElectronicAddress
        ? config.endpoint_scheme
        : config.company_email
          ? "EM"
          : "",
      contact_name:
        config.contact_name || config.owner_name || config.company_name,
      logo: config.logo,
    };
  };
  const bankFrom = (config) => ({
    name: config.bank_name,
    account_holder: config.account_holder,
    iban: config.iban,
    bic: config.bic,
  });
  function offerRows(customerId) {
    return db
      .prepare(
        "SELECT cs.id,cs.customer_id,cs.status,cs.accepted_price_minor,cs.current_offered_price_minor,cs.currency,cs.billing_type,cs.offer_date,s.name AS service_name FROM customer_services cs JOIN services s ON s.id=cs.service_id WHERE cs.customer_id=? AND cs.archived_at IS NULL AND cs.status IN ('accepted','done') ORDER BY s.name,cs.id",
      )
      .all(customerId);
  }
  function selectedOffers(customerId, ids, currency) {
    if (!Array.isArray(ids))
      invalid("Bitte Angebote als Liste angeben.", "customer_service_ids");
    return ids.map((id) => {
      uuid(id, "customer_service_ids");
      const row = db
        .prepare(
          "SELECT cs.*,s.name AS service_name FROM customer_services cs JOIN services s ON s.id=cs.service_id WHERE cs.id=?",
        )
        .get(id);
      if (!row || row.customer_id !== customerId)
        invalid(
          "Das Angebot gehört zu einem anderen Kunden.",
          "customer_service_ids",
        );
      if (row.currency !== currency)
        invalid("Alle Angebote müssen dieselbe Währung verwenden.", "currency");
      return row;
    });
  }
  function defaults(input = {}) {
    const config = settings();
    let customerId = input.customer_id || null;
    let ids =
      input.customer_service_ids ??
      (input.customer_service_id ? [input.customer_service_id] : []);
    if (typeof ids === "string") ids = [ids];
    if (!customerId && ids.length)
      customerId = db
        .prepare("SELECT customer_id FROM customer_services WHERE id=?")
        .get(ids[0])?.customer_id;
    const customer = customerId ? requireCustomer(customerId) : null;
    const recipient = customerId ? profile(customerId) : {};
    const offers = customerId
      ? selectedOffers(
          customerId,
          ids,
          input.currency ||
            (ids.length
              ? db
                  .prepare("SELECT currency FROM customer_services WHERE id=?")
                  .get(ids[0])?.currency
              : "EUR"),
        )
      : [];
    const currency = input.currency || offers[0]?.currency || "EUR";
    const invoiceDate = today();
    const items = offers.length
      ? offers.map((offer) => ({
          name: offer.service_name,
          description: "",
          quantity: "1",
          unit: "C62",
          unit_price: minorPrice(
            offer.accepted_price_minor ?? offer.current_offered_price_minor,
          ),
          customer_service_id: offer.id,
          price_source:
            offer.accepted_price_minor !== null ? "accepted" : "offered",
          tax_category: config.tax_category,
          tax_rate: config.tax_category === "S" ? config.tax_rate : "0",
          tax_reason: config.tax_reason,
        }))
      : [
          {
            name: "Leistung",
            description: "",
            quantity: "1",
            unit: "C62",
            unit_price: "0.00",
            tax_category: config.tax_category,
            tax_rate: config.tax_category === "S" ? config.tax_rate : "0",
            tax_reason: config.tax_reason,
          },
        ];
    return {
      customer_id: customerId,
      employee_id: null,
      recipient: { ...recipient, name: customer?.name ?? "" },
      seller: sellerFrom(config),
      bank: bankFrom(config),
      invoice_number: config.next_invoice_number,
      invoice_date: invoiceDate,
      due_date: addDays(invoiceDate, config.payment_days),
      payment_days: config.payment_days,
      subject: defaultInvoiceSubject(invoiceDate),
      service_period_start: "",
      service_period_end: "",
      currency,
      language: "de",
      note: "",
      payment_text: config.payment_text,
      tax_text: config.tax_reason,
      buyer_reference: recipient.buyer_reference ?? "",
      e_invoice: false,
      ...calculateInvoice({ items }),
    };
  }
  function options(input = {}) {
    const initial = defaults(input);
    return {
      customers: db
        .prepare(
          "SELECT id,name,customer_type FROM customers WHERE archived_at IS NULL ORDER BY name,id",
        )
        .all(),
      customer: initial.customer_id
        ? requireCustomer(initial.customer_id)
        : null,
      employees: initial.customer_id
        ? db
            .prepare(
              "SELECT id,name,email FROM employees WHERE customer_id=? AND archived_at IS NULL ORDER BY name,id",
            )
            .all(initial.customer_id)
        : [],
      offers: initial.customer_id ? offerRows(initial.customer_id) : [],
      settings: settings(),
      defaults: initial,
    };
  }
  const recipientKeys = [
    "name",
    "additional_name",
    "street",
    "postal_code",
    "city",
    "country_code",
    "billing_address",
    "vat_id",
    "tax_id",
    "email",
    "endpoint_id",
    "endpoint_scheme",
    "customer_number",
    "buyer_reference",
  ];
  function normalize(input, previous = null) {
    object(input);
    if (
      Object.hasOwn(input, "recipient") ||
      Object.hasOwn(input, "buyer_reference")
    )
      invalid(
        "Empfängerangaben werden ausschließlich im Kundenprofil geändert.",
        "customer_id",
      );
    if (Object.hasOwn(input, "service_date"))
      invalid(
        "Bitte den Leistungszeitraum mit Von- und Bis-Datum angeben.",
        "service_period_start",
      );
    const customerId = input.customer_id ?? previous?.customer_id;
    if (!customerId)
      invalid("Bitte einen Rechnungskunden auswählen.", "customer_id");
    requireCustomer(customerId);
    const base = previous ?? defaults(input);
    const config = settings();
    const out = {
      ...base,
      customer_id: customerId,
      seller: sellerFrom(config),
      bank: bankFrom(config),
    };
    const recipient = profile(customerId);
    object(recipient);
    out.recipient = {};
    for (const key of recipientKeys)
      out.recipient[key] =
        key === "email"
          ? email(recipient[key] ?? "", `recipient.${key}`)
          : text(recipient[key] ?? "", `recipient.${key}`, {
              max: key === "billing_address" ? 10000 : 1000,
            });
    if (out.recipient.country_code)
      out.recipient.country_code = country(
        out.recipient.country_code,
        "recipient.country_code",
      );
    out.buyer_reference = out.recipient.buyer_reference;
    out.employee_id =
      input.employee_id === undefined
        ? base.employee_id
        : input.employee_id || null;
    out.contact = null;
    if (out.employee_id) {
      uuid(out.employee_id, "employee_id");
      const contact = db
        .prepare(
          "SELECT customer_id,name,email,position FROM employees WHERE id=? AND archived_at IS NULL",
        )
        .get(out.employee_id);
      if (!contact || contact.customer_id !== customerId)
        invalid(
          "Der Ansprechpartner gehört zu einem anderen Kunden.",
          "employee_id",
        );
      out.contact = {
        name: contact.name,
        email: contact.email,
        position: contact.position,
      };
    }
    for (const key of [
      "invoice_date",
      "due_date",
      "service_period_start",
      "service_period_end",
    ])
      out[key] = date(input[key] === undefined ? base[key] : input[key], key);
    delete out.service_date;
    if (
      out.service_period_start &&
      out.service_period_end &&
      out.service_period_start > out.service_period_end
    )
      invalid(
        "Der Leistungsbeginn muss vor dem Leistungsende liegen.",
        "service_period_end",
      );
    if (out.due_date && out.invoice_date && out.due_date < out.invoice_date)
      invalid(
        "Das Fälligkeitsdatum darf nicht vor dem Rechnungsdatum liegen.",
        "due_date",
      );
    out.payment_days = integer(
      input.payment_days ?? base.payment_days,
      "payment_days",
      0,
      3650,
    );
    for (const key of ["subject", "note", "payment_text", "tax_text"])
      out[key] = text(input[key] ?? base[key] ?? "", key, {
        max: key === "subject" || key === "buyer_reference" ? 1000 : 10000,
      });
    out.currency = choice(
      input.currency ?? base.currency,
      ["EUR", "USD", "GBP"],
      "currency",
    );
    out.language = choice(
      input.language ?? base.language,
      ["de", "en"],
      "language",
    );
    if (
      !out.subject ||
      (input.subject === undefined &&
        (!previous ||
          !base.subject ||
          base.subject ===
            defaultInvoiceSubject(base.invoice_date, base.language)))
    )
      out.subject = defaultInvoiceSubject(out.invoice_date, out.language);
    if (input.e_invoice !== undefined && typeof input.e_invoice !== "boolean")
      invalid(
        "Bitte die E-Rechnungsoption als Ja oder Nein angeben.",
        "e_invoice",
      );
    out.e_invoice =
      input.e_invoice === undefined
        ? Boolean(base.e_invoice)
        : input.e_invoice === true;
    Object.assign(out, calculateInvoice({ items: input.items ?? base.items }));
    selectedOffers(
      customerId,
      out.items.map((item) => item.customer_service_id).filter(Boolean),
      out.currency,
    );
    out.invoice_number = config.next_invoice_number;
    return out;
  }
  function saveLines(id, items) {
    db.prepare("DELETE FROM invoice_document_lines WHERE document_id=?").run(
      id,
    );
    const insert = db.prepare(
      "INSERT INTO invoice_document_lines(document_id,position,customer_service_id,line_json) VALUES(?,?,?,?)",
    );
    for (const item of items)
      insert.run(
        id,
        item.position,
        item.customer_service_id,
        JSON.stringify(item),
      );
  }
  function get(id) {
    const row = rowFor(id);
    const snapshot = JSON.parse(row.content_json);
    if (row.state === "draft") {
      if (snapshot.service_date) {
        snapshot.service_period_start ||= snapshot.service_date;
        snapshot.service_period_end ||= snapshot.service_date;
      }
      delete snapshot.service_date;
      if (row.customer_id) {
        snapshot.recipient = profile(row.customer_id);
        snapshot.buyer_reference = snapshot.recipient.buyer_reference;
      }
    }
    // These associations are live; the issued recipient and all document data
    // remain snapshots after customer merges and offer/contact deletion.
    const links = new Map(
      db
        .prepare(
          "SELECT position,customer_service_id FROM invoice_document_lines WHERE document_id=?",
        )
        .all(id)
        .map((line) => [line.position, line.customer_service_id]),
    );
    return {
      ...snapshot,
      customer_id: row.customer_id,
      employee_id: row.employee_id,
      items: snapshot.items.map((item) => ({
        ...item,
        customer_service_id: links.get(item.position) ?? null,
      })),
      id: row.id,
      state: row.state,
      version: row.version,
      invoice_id: row.invoice_id,
      has_xml: Boolean(row.xml_data),
      validation: row.validation_json ? JSON.parse(row.validation_json) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      ...(row.state === "draft"
        ? { invoice_number: settings().next_invoice_number }
        : {}),
    };
  }
  function create(input) {
    const snapshot = normalize(input);
    const id = randomUUID(),
      at = now();
    atomic(() => {
      db.prepare(
        "INSERT INTO invoice_documents(id,customer_id,employee_id,content_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      ).run(
        id,
        snapshot.customer_id,
        snapshot.employee_id,
        JSON.stringify(snapshot),
        at,
        at,
      );
      saveLines(id, snapshot.items);
    });
    return get(id);
  }
  function requireDraft(row, expected) {
    if (row.state !== "draft")
      throw new AppError(
        409,
        "invoice_immutable",
        "Ausgestellte Rechnungen können nicht verändert werden.",
      );
    if (expected !== undefined && expected !== row.version)
      throw new AppError(
        409,
        "draft_conflict",
        "Der Entwurf wurde inzwischen geändert. Bitte neu laden.",
      );
  }
  function update(id, input) {
    object(input);
    return atomic(() => {
      const row = rowFor(id);
      requireDraft(row, input.expected_version);
      const snapshot = normalize(input, get(id));
      for (const key of [
        "id",
        "state",
        "version",
        "invoice_id",
        "has_xml",
        "validation",
        "created_at",
        "updated_at",
      ])
        delete snapshot[key];
      db.prepare(
        "UPDATE invoice_documents SET customer_id=?,employee_id=?,content_json=?,version=version+1,updated_at=? WHERE id=?",
      ).run(
        snapshot.customer_id,
        snapshot.employee_id,
        JSON.stringify(snapshot),
        now(),
        id,
      );
      saveLines(id, snapshot.items);
      return get(id);
    });
  }
  function finalSnapshot(row, config, invoiceNumber, draft = false) {
    const source = get(row.id);
    delete source.recipient;
    delete source.buyer_reference;
    const snapshot = normalize(source);
    for (const key of [
      "id",
      "state",
      "version",
      "invoice_id",
      "has_xml",
      "validation",
      "created_at",
      "updated_at",
    ])
      delete snapshot[key];
    snapshot.seller = sellerFrom(config);
    snapshot.bank = bankFrom(config);
    snapshot.invoice_number = invoiceNumber;
    if (!draft) {
      for (const side of ["seller", "recipient"])
        for (const field of [
          "name",
          "street",
          "postal_code",
          "city",
          "country_code",
        ])
          if (!snapshot[side][field])
            invalid(
              "Bitte die vollständigen Aussteller- und Empfängerangaben ergänzen.",
              `${side}.${field}`,
            );
      if (!snapshot.invoice_date)
        invalid("Bitte ein Rechnungsdatum angeben.", "invoice_date");
      if (!snapshot.due_date)
        invalid("Bitte ein Fälligkeitsdatum angeben.", "due_date");
      if (!(snapshot.service_period_start && snapshot.service_period_end))
        invalid(
          "Bitte den vollständigen Leistungszeitraum mit Von- und Bis-Datum angeben.",
          "service_period_start",
        );
      if (!snapshot.seller.vat_id && !snapshot.seller.tax_id)
        invalid(
          "Bitte die eigene UID oder Steuerkennung ergänzen.",
          "seller.vat_id",
        );
      if (
        snapshot.items.some((item) => item.tax_category === "AE") &&
        (!snapshot.seller.vat_id || !snapshot.recipient.vat_id)
      )
        invalid(
          "Reverse Charge benötigt die UID von Aussteller und Empfänger.",
          "recipient.vat_id",
        );
      if (!snapshot.bank.iban || !snapshot.bank.account_holder)
        invalid("Bitte IBAN und Kontoinhaber ergänzen.", "bank.iban");
      if (!validIBAN(snapshot.bank.iban))
        invalid("Bitte eine gültige IBAN angeben.", "bank.iban");
      if (
        snapshot.bank.bic &&
        !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(snapshot.bank.bic)
      )
        invalid("Bitte eine gültige BIC angeben.", "bank.bic");
    }
    return snapshot;
  }
  async function preview(id) {
    const row = rowFor(id);
    if (row.state === "issued")
      return {
        data: finance.file(row.invoice_id).data,
        name: `${JSON.parse(row.content_json).invoice_number}.pdf`,
      };
    const config = settings();
    return {
      data: await renderPDF(
        finalSnapshot(row, config, config.next_invoice_number, true),
        { draft: true },
      ),
      name: "Entwurf.pdf",
    };
  }
  async function finalize(id, input = {}) {
    object(input);
    for (let attempt = 0; attempt < 12; attempt++) {
      const row = rowFor(id);
      if (row.state === "issued") return get(id);
      requireDraft(row, input.expected_version);
      const config = settings(),
        next = availableNumber(config);
      const snapshot = finalSnapshot(row, config, next.invoice_number);
      const recipientRevision = () =>
        hash({
          recipient: profile(snapshot.customer_id),
          contact: snapshot.employee_id
            ? (db
                .prepare("SELECT name,email,position FROM employees WHERE id=?")
                .get(snapshot.employee_id) ?? null)
            : null,
        });
      const customerRevision = recipientRevision();
      let xml = null,
        validation = null;
      if (snapshot.e_invoice) {
        xml = Buffer.from(await createXML(snapshot));
        validation = await validateXML(xml);
        if (!validation || validation.valid !== true)
          throw new AppError(
            422,
            "xml_validation_failed",
            "Die E-Rechnung konnte nicht erfolgreich geprüft werden.",
          );
      }
      const pdf = Buffer.from(await renderPDF(snapshot, { draft: false }));
      if (!pdf.length || pdf.subarray(0, 5).toString() !== "%PDF-")
        throw new AppError(
          422,
          "pdf_generation_failed",
          "Das Rechnungs-PDF konnte nicht erstellt werden.",
        );
      const committed = finance.importTransaction(() => {
        const current = rowFor(id);
        if (current.state === "issued") return true;
        if (current.version !== row.version)
          throw new AppError(
            409,
            "draft_conflict",
            "Der Entwurf wurde inzwischen geändert. Bitte neu laden.",
          );
        if (recipientRevision() !== customerRevision)
          throw new AppError(
            409,
            "invoice_customer_conflict",
            "Die Kundendaten wurden inzwischen geändert. Bitte die Vorschau erneut prüfen.",
          );
        const latestSettings = settings();
        if (latestSettings.revision !== config.revision) {
          const contentRevision = (value) => {
            const {
              next_number,
              next_invoice_number,
              number_exhausted,
              number_error,
              revision,
              ...content
            } = value;
            return hash(content);
          };
          if (contentRevision(latestSettings) !== contentRevision(config))
            throw new AppError(
              409,
              "invoice_settings_conflict",
              "Die Rechnungsdaten wurden inzwischen geändert. Bitte die Vorschau erneut prüfen.",
            );
          return false;
        }
        if (numberExists(next.invoice_number)) return false;
        const at = now();
        finance.record({
          id,
          category: "revenue",
          customer_id: snapshot.customer_id,
          customer_service_id:
            snapshot.items.find((item) => item.customer_service_id)
              ?.customer_service_id ?? null,
          invoice_number: snapshot.invoice_number,
          invoice_date: snapshot.invoice_date,
          due_date: snapshot.due_date,
          counterparty_name: snapshot.recipient.name,
          total_amount_minor: snapshot.totals.total_amount_minor,
          net_amount_minor: snapshot.totals.net_amount_minor,
          tax_amount_minor: snapshot.totals.tax_amount_minor,
          currency: snapshot.currency,
          document_language: snapshot.language,
          status: "open",
          file_name:
            snapshot.invoice_number.replace(/[^\p{L}\p{N}._-]/gu, "_") + ".pdf",
          pdf_data: pdf,
          file_hash: createHash("sha256").update(pdf).digest("hex"),
          ingestion_status: "processed",
          extracted_json: JSON.stringify({
            source: "created",
            document_id: id,
          }),
          confidence_score: 1,
        });
        db.prepare(
          "UPDATE invoice_documents SET state='issued',invoice_id=?,content_json=?,xml_data=?,validation_json=?,updated_at=? WHERE id=?",
        ).run(
          id,
          JSON.stringify(snapshot),
          xml,
          validation ? JSON.stringify(validation) : null,
          at,
          id,
        );
        writeSetting.run(
          settingKey("next_number"),
          String(next.number + 1),
          at,
        );
        return true;
      });
      if (committed) return get(id);
    }
    throw new AppError(
      409,
      "number_conflict",
      "Die Rechnungsnummer wurde gleichzeitig vergeben. Bitte erneut versuchen.",
    );
  }
  return {
    settings,
    saveSettings,
    profile,
    saveProfile,
    options,
    defaults,
    create,
    get,
    update,
    preview,
    finalize,
    calculate: calculateInvoice,
    list(filters = {}) {
      if (filters.customer_id) uuid(filters.customer_id, "customer_id");
      if (filters.customer_service_id)
        uuid(filters.customer_service_id, "customer_service_id");
      if (filters.category && filters.category !== "revenue") return [];
      return db
        .prepare(
          "SELECT id FROM invoice_documents d WHERE state='draft' AND (? IS NULL OR customer_id=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM invoice_document_lines l WHERE l.document_id=d.id AND l.customer_service_id=?)) ORDER BY updated_at DESC,id",
        )
        .all(
          filters.customer_id ?? null,
          filters.customer_id ?? null,
          filters.customer_service_id ?? null,
          filters.customer_service_id ?? null,
        )
        .map(({ id }) => get(id));
    },
    remove(id, input = {}) {
      return atomic(() => {
        requireDraft(rowFor(id), input.expected_version);
        db.prepare("DELETE FROM invoice_documents WHERE id=?").run(id);
        return { id, deleted: true };
      });
    },
    xml(id) {
      const row = rowFor(id);
      if (row.state !== "issued" || !row.xml_data)
        throw new AppError(
          409,
          "xml_unavailable",
          "Für diese Rechnung wurde keine E-Rechnung ausgestellt.",
        );
      return {
        data: Buffer.from(row.xml_data),
        name:
          JSON.parse(row.content_json).invoice_number.replace(
            /[^\p{L}\p{N}._-]/gu,
            "_",
          ) + ".xml",
      };
    },
  };
}

function validIBAN(value) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return false;
  const rearranged = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged)
    for (const digit of /[A-Z]/.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character)
      remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}
