import { api } from "./api.js";
import { t, getLanguage, localizedMessage } from "./i18n.js";
import {
  el,
  field,
  button,
  heading,
  panel,
  link,
  money,
  facts,
  table,
} from "./dom.js";
import { logoEditor, billingAddress } from "./customer-branding.js";
import { defaultInvoiceSubject } from "./invoice-subject.js";
import { confirmDialog, toast } from "../vendor/oj-designsystem/index.js";

const base = "/finance/creation";
const tell = (message) => toast(message, { dismissLabel: t("Schließen") });
const units = () => [
  ["C62", t("Stück")],
  ["HUR", t("Stunde")],
  ["DAY", t("Tag")],
  ["MON", t("Monat")],
  ["ANN", t("Jahr")],
  ["KGM", t("Kilogramm")],
  ["MTR", t("Meter")],
];
const taxes = () => [
  ["S", t("Besteuerung mit Steuersatz")],
  ["AE", t("Reverse Charge")],
  ["E", t("Steuerbefreiung / Kleinunternehmen")],
];
const today = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};
const addDays = (date, days) => {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + Number(days || 0));
  return Number.isFinite(value.getTime())
    ? value.toISOString().slice(0, 10)
    : "";
};
const decimal = (minor) => (Number(minor || 0) / 100).toFixed(2);
const clone = (value) => JSON.parse(JSON.stringify(value));
const actionLink = (label, href, download = false) =>
  el(
    "a",
    {
      class: "oj-button oj-button-secondary",
      href,
      target: "_blank",
      rel: "noopener",
      ...(download ? { download: "" } : {}),
    },
    label,
  );

function alertBox() {
  const node = el("p", {
    class: "oj-alert oj-alert-danger",
    role: "alert",
    tabindex: -1,
    hidden: true,
  });
  return {
    node,
    clear() {
      node.hidden = true;
    },
    show(error, root) {
      node.textContent = error.message;
      node.hidden = false;
      const name = Object.keys(error.fields || {})[0];
      const input = name
        ? [...root.querySelectorAll("[name]")].find(
            (control) => control.name === name,
          )
        : null;
      if (input) {
        input.setAttribute("aria-invalid", "true");
        input.focus();
      } else node.focus();
    },
  };
}

const addressFields = () => [
  ["street", t("Straße und Hausnummer")],
  ["postal_code", t("Postleitzahl")],
  ["city", t("Ort")],
  ["country_code", t("Ländercode")],
];
const electronicFields = () => [
  ["vat_id", t("UID / USt-IdNr.")],
  ["tax_id", t("Weitere Steuerkennung")],
  ["endpoint_id", t("Elektronische Adresse")],
  ["endpoint_scheme", t("Adressschema")],
];

export async function invoiceProfileEditor(customerId, refresh) {
  const profile = await api(`${base}/profiles/${customerId}`);
  const data = { ...profile };
  const error = alertBox();
  const form = el("form", { class: "oj-stack invoice-profile-editor" });
  const grid = el("div", { class: "finance-form-grid" });
  const fields = [
    ["customer_number", t("Kundennummer")],
    ["additional_name", t("Zusätzliche Namenszeile")],
    ...addressFields(),
    ["general_email", t("Haupt-E-Mail")],
    ["invoice_email", t("E-Mail für Rechnungen")],
    ...electronicFields(),
    ["buyer_reference", t("Käuferreferenz (BT-10)")],
  ];
  for (const [name, label] of fields)
    grid.append(
      field(label, name, {
        value: data[name] || "",
        maxlength: name === "country_code" ? 2 : 500,
        type: name.endsWith("email") ? "email" : "text",
      }),
    );
  grid.append(
    field(t("Bisherige Freitextadresse"), "billing_address", {
      type: "textarea",
      value: data.billing_address || "",
      wide: true,
      maxlength: 4000,
      helper: t(
        "Die bisherige Adresse bleibt erhalten. Ergänze die strukturierten Felder für neue Rechnungen.",
      ),
    }),
  );
  const save = el(
    "button",
    { type: "submit", class: "oj-button oj-button-primary" },
    t("Rechnungsprofil speichern"),
  );
  form.append(grid, error.node, save);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    error.clear();
    try {
      await api(`${base}/profiles/${customerId}`, {
        method: "PATCH",
        body: Object.fromEntries(new FormData(form)),
      });
      tell(t("Rechnungsprofil gespeichert."));
      await refresh?.();
    } catch (err) {
      error.show(err, form);
    } finally {
      save.disabled = false;
    }
  });
  return form;
}

export async function invoiceCreationSettings({ onSaved } = {}) {
  const settings = await api(`${base}/settings`);
  const error = alertBox();
  const form = el("form", { class: "oj-stack invoice-creation-settings" });
  const companyError = alertBox();
  const companyForm = el("form", {
    class: "oj-stack finance-company-settings",
  });
  let companyAddress = settings.company_address || "";
  const companyAddressValue = () => companyAddress.replace(/\r?\n/g, ", ");
  const issuerLogo = logoEditor(
    {
      id: "invoice-issuer",
      logo_url: settings.logo_url,
      has_logo: settings.has_logo,
    },
    {
      label: t("Eigenes Rechnungslogo hochladen"),
      previewAlt: t("Vorschau des eigenen Rechnungslogos"),
    },
  );
  issuerLogo.node.classList.add("invoice-issuer-logo");
  issuerLogo.node.querySelector("label").textContent = t(
    "Eigenes Rechnungslogo hochladen",
  );
  const preview = issuerLogo.node.querySelector("img");
  if (preview) preview.alt = t("Vorschau des eigenen Rechnungslogos");
  const makeFields = (entries) =>
    el(
      "div",
      { class: "finance-form-grid" },
      entries.map(([name, label, options = {}]) =>
        field(label, name, {
          value: settings[name] ?? "",
          maxlength: 500,
          ...options,
        }),
      ),
    );
  const numberPreview = el(
    "p",
    { class: "oj-helper", role: "status" },
    settings.number_error
      ? localizedMessage(settings.number_error)
      : t("Nächste Rechnungsnummer: {number}", {
          number: settings.next_invoice_number || "–",
        }),
  );
  const company = makeFields([
    ["company_name", t("Firmenname")],
    ["owner_name", t("Inhaber / zusätzliche Namenszeile")],
    ...addressFields(),
    ["company_email", t("Firmen-E-Mail"), { type: "email" }],
    ["phone", t("Telefon")],
    ["website", t("Website"), { type: "url" }],
    ["vat_id", t("UID / USt-IdNr.")],
    [
      "company_address",
      t("Firmenadresse"),
      {
        type: "text",
        value: companyAddressValue(),
        maxlength: 2000,
        wide: true,
      },
    ],
  ]);
  const companySave = el(
    "button",
    { type: "submit", class: "oj-button oj-button-primary" },
    t("Einstellungen speichern"),
  );
  companyForm.append(
    panel(
      t("Eigene Rechnungsdaten"),
      el(
        "p",
        { class: "oj-helper" },
        t(
          "Firmenname und E-Mail werden mit den vorhandenen Firmeneinstellungen geteilt.",
        ),
      ),
      company,
      issuerLogo.node,
      el(
        "p",
        { class: "oj-small oj-muted" },
        t(
          "Firmenname, Firmen-E-Mail und Firmenadresse werden vor der KI-Erkennung von Ausgabenrechnungen aus dem Rechnungstext entfernt.",
        ),
      ),
    ),
    companyError.node,
    companySave,
  );
  companyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    companyError.clear();
    companySave.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(companyForm));
      delete data.logo;
      if (data.company_address === companyAddressValue())
        data.company_address = companyAddress;
      const logo = await issuerLogo.value();
      if (logo !== undefined) data.logo = logo;
      const result = await api(`${base}/settings`, {
        method: "PATCH",
        body: data,
      });
      companyAddress = result.company_address || "";
      onSaved?.(result);
      tell(t("Finanz-Einstellungen gespeichert."));
    } catch (err) {
      companyError.show(err, companyForm);
    } finally {
      companySave.disabled = false;
    }
  });
  const banking = makeFields([
    ["bank_name", t("Bankname")],
    ["account_holder", t("Kontoinhaber")],
    ["iban", t("IBAN")],
    ["bic", t("BIC")],
  ]);
  const defaults = makeFields([
    [
      "payment_days",
      t("Standardzahlungsziel (Tage)"),
      { type: "number", min: 0, max: 365, step: 1 },
    ],
    [
      "payment_text",
      t("Standardzahlungstext"),
      { type: "textarea", maxlength: 4000, wide: true },
    ],
    ["tax_category", t("Standard-Steuerbehandlung"), { options: taxes() }],
    ["tax_rate", t("Standard-Steuersatz (%)"), { inputmode: "decimal" }],
    [
      "tax_reason",
      t("Standard-Steuergrund"),
      { type: "textarea", maxlength: 2000, wide: true },
    ],
  ]);
  const categoryInput = defaults.querySelector('[name="tax_category"]');
  const rateInput = defaults.querySelector('[name="tax_rate"]');
  const changeDefaultTax = () => {
    if (categoryInput.value !== "S") rateInput.value = "0";
    else if (!Number(rateInput.value)) rateInput.value = "20";
    rateInput.disabled = categoryInput.value !== "S";
  };
  categoryInput.addEventListener("change", changeDefaultTax);
  changeDefaultTax();
  const numbering = makeFields([
    ["number_prefix", t("Nummernpräfix")],
    [
      "number_digits",
      t("Anzahl Ziffern"),
      { type: "number", min: 1, max: 12, step: 1 },
    ],
    [
      "next_number",
      t("Nächster Zählerwert"),
      { type: "number", min: 1, step: 1 },
    ],
  ]);
  const updateNumber = () => {
    const prefix = form.elements.namedItem("number_prefix").value;
    const digits = Math.min(
      12,
      Math.max(1, Number(form.elements.namedItem("number_digits").value) || 1),
    );
    const next = form.elements.namedItem("next_number").value;
    numberPreview.textContent = t("Nächste Rechnungsnummer: {number}", {
      number: prefix + next.padStart(digits, "0"),
    });
  };
  numbering.addEventListener("input", updateNumber);
  const save = el(
    "button",
    { type: "submit", class: "oj-button oj-button-primary" },
    t("Rechnungseinstellungen speichern"),
  );
  form.append(
    panel(t("Bankverbindung"), banking),
    panel(t("Zahlung und Steuer"), defaults),
    panel(
      t("Rechnungsnummern"),
      numbering,
      numberPreview,
      el(
        "p",
        { class: "oj-helper" },
        t(
          "Entwürfe und Vorschauen verbrauchen keine Nummer. Die Vergabe erfolgt erst beim verbindlichen Erstellen.",
        ),
      ),
    ),
    error.node,
    save,
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.clear();
    save.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      if (data.tax_category !== "S") data.tax_rate = "0";
      else data.tax_rate = String(data.tax_rate).replace(",", ".");
      for (const key of ["payment_days", "number_digits", "next_number"])
        data[key] = Number(data[key]);
      const result = await api(`${base}/settings`, {
        method: "PATCH",
        body: data,
      });
      numberPreview.textContent = t("Nächste Rechnungsnummer: {number}", {
        number: result.next_invoice_number || "–",
      });
      if (result.number_error)
        numberPreview.textContent = localizedMessage(result.number_error);
      onSaved?.(result);
      tell(t("Rechnungseinstellungen gespeichert."));
    } catch (err) {
      error.show(err, form);
    } finally {
      save.disabled = false;
    }
  });
  return {
    node: form,
    companyNode: companyForm,
    dispose: () => issuerLogo.cleanup(),
  };
}

export async function invoiceDrafts(params = new URLSearchParams()) {
  const response = await api(`${base}/drafts`, {
    query: {
      customer_id: params.get("customer_id"),
      customer_service_id: params.get("customer_service_id"),
    },
  });
  const drafts = Array.isArray(response) ? response : response.items || [];
  if (!drafts.length) return null;
  return panel(
    t("Rechnungsentwürfe"),
    el(
      "p",
      { class: "oj-helper" },
      t(
        "Entwürfe sind noch keine Rechnungen und werden in Finanzkennzahlen nicht mitgezählt.",
      ),
    ),
    table(
      t("Rechnungsentwürfe"),
      [t("Entwurf"), t("Kunde"), t("Datum"), t("Betrag")],
      drafts.map((draft) => [
        link(
          draft.subject || t("Entwurf ohne Betreff"),
          `#/invoice-editor/${draft.id}`,
        ),
        draft.recipient?.name || "–",
        draft.invoice_date || "–",
        money(draft.totals?.total_amount_minor || 0, draft.currency || "EUR"),
      ]),
    ),
  );
}

export async function invoiceEditor(id, params = new URLSearchParams()) {
  let saved = id ? await api(`${base}/drafts/${id}`) : null;
  if (saved?.state === "issued" && saved.invoice_id) {
    location.hash = "#/invoices/" + saved.invoice_id;
    return [];
  }
  let options = await api(`${base}/options`, {
    query: {
      customer_id: saved?.customer_id || params.get("customer_id"),
      customer_service_id: !saved
        ? params.get("customer_service_id")
        : undefined,
    },
  });
  const defaults = options.defaults || {};
  const state = {
    customer_id: "",
    employee_id: null,
    recipient: {},
    subject: "",
    invoice_date: today(),
    service_date: "",
    service_period_start: "",
    service_period_end: "",
    payment_days: 14,
    due_date: "",
    currency: "EUR",
    language: getLanguage(),
    note: "",
    payment_text: "",
    tax_text: "",
    buyer_reference: "",
    e_invoice: false,
    items: [],
    ...clone(defaults),
    ...(saved ? clone(saved) : {}),
    language: saved?.language || getLanguage(),
  };
  state.recipient = clone(defaults.recipient || {});
  state.buyer_reference =
    defaults.buyer_reference || state.recipient.buyer_reference || "";
  if (
    state.service_date &&
    !state.service_period_start &&
    !state.service_period_end
  ) {
    state.service_period_start = state.service_date;
    state.service_period_end = state.service_date;
  }
  if (!state.due_date)
    state.due_date = addDays(state.invoice_date, state.payment_days);
  let suggestedSubject = defaultInvoiceSubject(
    state.invoice_date,
    state.language,
  );
  if (!saved || !state.subject.trim()) state.subject = suggestedSubject;
  if (!state.recipient) state.recipient = {};
  if (!state.items?.length) state.items = [newLine()];
  const editedItems = new WeakSet();
  let placeholderLine =
    !saved && !params.get("customer_service_id") ? state.items[0] : null;
  let disposed = false,
    calculationToken = 0,
    calculationTimer,
    saving = false,
    dirty = false;
  const error = alertBox();
  const form = el("form", { class: "invoice-editor oj-stack" });
  const status = el("p", {
    class: "oj-helper",
    role: "status",
    "aria-live": "polite",
  });
  const totals = el("div", {
    class: "invoice-totals oj-stack",
    "aria-live": "polite",
  });
  const lineContainer = el("div", { class: "invoice-lines oj-stack" });
  const lineAmounts = new Map();
  const preview = el("div", {
    class: "invoice-preview-actions oj-cluster",
    hidden: true,
  });
  let customerSelect,
    contactSelect,
    offerSelect,
    recipientContainer,
    electronicContainer;

  function newLine(offer) {
    const settings = options?.settings || {};
    return {
      name: offer?.service_name || "",
      description: "",
      quantity: "1",
      unit: "C62",
      unit_price: offer
        ? decimal(
            offer.accepted_price_minor ?? offer.current_offered_price_minor,
          )
        : "0.00",
      tax_category: settings.tax_category || "S",
      tax_rate:
        settings.tax_category && settings.tax_category !== "S"
          ? "0"
          : settings.tax_rate || "20",
      tax_reason: settings.tax_reason || "",
      customer_service_id: offer?.id || null,
      ...(offer
        ? {
            price_source:
              offer.accepted_price_minor !== null &&
              offer.accepted_price_minor !== undefined
                ? "accepted"
                : "offered",
          }
        : {}),
    };
  }
  function payload() {
    return Object.fromEntries(
      [
        "customer_id",
        "employee_id",
        "subject",
        "invoice_date",
        "due_date",
        "payment_days",
        "service_period_start",
        "service_period_end",
        "currency",
        "language",
        "note",
        "payment_text",
        "tax_text",
        "e_invoice",
        "items",
      ].map((key) => [
        key,
        key === "items"
          ? state.items.map((item) => ({
              ...item,
              ...Object.fromEntries(
                ["quantity", "unit_price", "tax_rate"].map((name) => [
                  name,
                  String(item[name] ?? "").replace(",", "."),
                ]),
              ),
            }))
          : state[key],
      ]),
    );
  }
  function changed(recalculate = false) {
    dirty = true;
    preview.hidden = true;
    status.textContent = t("Ungespeicherte Änderungen");
    if (recalculate) scheduleCalculation();
  }
  function control(label, name, config = {}, owner = state, onChange) {
    return field(label, name, {
      value: owner[name] ?? "",
      maxlength: 2000,
      ...config,
      oninput: (event) => {
        if (state.items.includes(owner)) editedItems.add(owner);
        owner[name] =
          config.type === "number"
            ? Number(event.target.value)
            : event.target.value;
        event.target.removeAttribute("aria-invalid");
        changed(
          (owner !== state && owner !== state.recipient) || name === "currency",
        );
        onChange?.(event.target.value);
      },
    });
  }
  async function calculate() {
    const token = ++calculationToken;
    try {
      const result = await api(`${base}/calculate`, {
        method: "POST",
        body: payload(),
      });
      if (disposed || token !== calculationToken) return;
      const summary = result.totals;
      state.totals = summary;
      for (const [index, amount] of lineAmounts)
        amount.textContent = money(
          result.items[index]?.net_amount_minor ?? 0,
          state.currency,
        );
      totals.replaceChildren(
        facts([
          [t("Nettosumme"), money(summary.net_amount_minor, state.currency)],
          ...(summary.tax_breakdown || []).map((tax) => [
            tax.tax_category === "S"
              ? t("Umsatzsteuer {rate} %", { rate: tax.tax_rate })
              : tax.tax_category === "AE"
                ? t("Reverse Charge")
                : t("Steuerbefreiung / Kleinunternehmen"),
            money(tax.tax_amount_minor, state.currency),
          ]),
          [
            t("Gesamtbetrag"),
            el("strong", {}, money(summary.total_amount_minor, state.currency)),
          ],
        ]),
      );
    } catch (err) {
      if (!disposed && token === calculationToken)
        totals.replaceChildren(
          el(
            "p",
            { class: "oj-helper oj-helper-error", role: "status" },
            err.message,
          ),
        );
    }
  }
  function scheduleCalculation() {
    clearTimeout(calculationTimer);
    calculationTimer = setTimeout(calculate, 120);
  }
  function renderLines() {
    lineAmounts.clear();
    lineContainer.replaceChildren(
      ...state.items.map((item, index) => {
        const amount = el("strong", { class: "oj-mono" });
        lineAmounts.set(index, amount);
        const category = control(
          t("Steuerbehandlung"),
          "tax_category",
          { options: taxes() },
          item,
          (value) => {
            item.tax_rate =
              value !== "S"
                ? "0"
                : options.settings?.tax_category === "S"
                  ? options.settings.tax_rate
                  : "20";
            renderLines();
            scheduleCalculation();
          },
        );
        const row = el(
          "section",
          {
            class: "invoice-line oj-stack",
            "aria-label": t("Position {position}", { position: index + 1 }),
          },
          el(
            "div",
            { class: "invoice-line-heading oj-cluster" },
            el(
              "h3",
              { class: "oj-heading-4" },
              t("Position {position}", { position: index + 1 }),
            ),
            amount,
            button(t("Position nach oben"), () => moveLine(index, -1), {
              compact: true,
              disabled: index === 0,
              iconName: "arrow-up",
            }),
            button(t("Position nach unten"), () => moveLine(index, 1), {
              compact: true,
              disabled: index === state.items.length - 1,
              iconName: "arrow-down",
            }),
            button(
              t("Position entfernen"),
              () => {
                state.items.splice(index, 1);
                changed(true);
                renderLines();
              },
              {
                compact: true,
                danger: true,
                disabled: state.items.length === 1,
                iconName: "trash",
              },
            ),
          ),
          item.customer_service_id
            ? el(
                "p",
                { class: "oj-helper" },
                t(
                  "Preisvorschlag als Netto-Einzelpreis: {source}. Menge und Leistung bitte prüfen.",
                  {
                    source:
                      item.price_source === "accepted"
                        ? t("vereinbarter Preis")
                        : t("Angebotspreis"),
                  },
                ),
                " ",
                link(
                  t("Angebot öffnen"),
                  "#/relationships/" + item.customer_service_id,
                ),
              )
            : null,
          el(
            "div",
            { class: "finance-form-grid invoice-form-grid-three" },
            control(
              t("Bezeichnung"),
              "name",
              { required: true, maxlength: 500, wide: true },
              item,
            ),
            control(
              t("Menge"),
              "quantity",
              { inputmode: "decimal", required: true },
              item,
            ),
            control(t("Einheit"), "unit", { options: units() }, item),
            control(
              t("Netto-Einzelpreis"),
              "unit_price",
              { inputmode: "decimal", required: true },
              item,
            ),
            category,
            control(
              t("Steuersatz (%)"),
              "tax_rate",
              { inputmode: "decimal", disabled: item.tax_category !== "S" },
              item,
            ),
            control(
              t("Steuergrund"),
              "tax_reason",
              {
                required: item.tax_category !== "S",
                maxlength: 2000,
              },
              item,
            ),
          ),
        );
        return row;
      }),
    );
    scheduleCalculation();
  }
  function moveLine(index, direction) {
    const other = index + direction;
    [state.items[index], state.items[other]] = [
      state.items[other],
      state.items[index],
    ];
    changed(true);
    renderLines();
  }
  function renderRecipient() {
    recipientContainer.replaceChildren(
      ...[
        facts([
          [t("Empfängername"), state.recipient.name || "–"],
          [t("Kundennummer"), state.recipient.customer_number || "–"],
          [
            t("Rechnungsadresse"),
            el(
              "span",
              { class: "note-text" },
              billingAddress(state.recipient) || "–",
            ),
          ],
          [t("E-Mail für Rechnungen"), state.recipient.email || "–"],
          [t("UID / USt-IdNr."), state.recipient.vat_id || "–"],
          [t("Weitere Steuerkennung"), state.recipient.tax_id || "–"],
        ]),
        el(
          "p",
          { class: "oj-helper" },
          t(
            "Diese Angaben stammen aus dem Kundeneintrag und können nur dort geändert werden.",
          ),
        ),
        state.customer_id
          ? link(t("Kundeneintrag öffnen"), "#/customers/" + state.customer_id)
          : null,
      ].filter(Boolean),
    );
    electronicContainer.replaceChildren(
      facts([
        [t("Käuferreferenz (BT-10)"), state.buyer_reference || "–"],
        ...electronicFields()
          .slice(2)
          .map(([name, label]) => [label, state.recipient[name] || "–"]),
      ]),
      el(
        "p",
        { class: "oj-helper" },
        t(
          "Zusatzangaben werden nur für die gewählte E-Rechnung benötigt. Verkäuferdaten kommen aus den Rechnungseinstellungen.",
        ),
      ),
    );
  }
  function renderOffers() {
    offerSelect.replaceChildren(
      el("option", { value: "" }, t("Angebot auswählen")),
      ...(options.offers || []).map((offer) =>
        el(
          "option",
          { value: offer.id },
          `${offer.service_name} · ${money(offer.accepted_price_minor ?? offer.current_offered_price_minor, offer.currency)}`,
        ),
      ),
    );
    offerSelect.disabled = !state.customer_id || !options.offers?.length;
    contactSelect.replaceChildren(
      el("option", { value: "" }, t("Kein Ansprechpartner")),
      ...(options.employees || []).map((person) =>
        el("option", { value: person.id }, person.name),
      ),
    );
    contactSelect.value = state.employee_id || "";
  }
  async function changeCustomer(customerId) {
    const oldId = state.customer_id;
    if (
      oldId &&
      oldId !== customerId &&
      !(await confirmDialog({
        title: t("Rechnungskunde wechseln?"),
        message: t(
          "Empfängerangaben und Angebotspositionen werden für den neuen Kunden übernommen. Freie Positionen bleiben erhalten.",
        ),
        confirmLabel: t("Kunde wechseln"),
        cancelLabel: t("Abbrechen"),
      }))
    ) {
      customerSelect.value = oldId;
      return;
    }
    try {
      options = await api(`${base}/options`, {
        query: { customer_id: customerId },
      });
      state.customer_id = customerId;
      state.employee_id = null;
      state.recipient = clone(options.defaults?.recipient || {});
      state.buyer_reference =
        options.defaults?.buyer_reference ||
        state.recipient.buyer_reference ||
        "";
      state.items = state.items.filter((item) => !item.customer_service_id);
      if (!state.items.length) {
        state.items.push(newLine());
        placeholderLine = state.items[0];
      }
      renderRecipient();
      renderOffers();
      renderLines();
      changed(true);
    } catch (err) {
      customerSelect.value = oldId;
      error.show(err, form);
    }
  }
  const customerField = field(t("Rechnungskunde"), "customer_id", {
    options: [
      ["", t("Kunde auswählen")],
      ...(options.customers || []).map((customer) => [
        customer.id,
        customer.name,
      ]),
    ],
    value: state.customer_id,
    required: true,
    onchange: (event) => changeCustomer(event.target.value),
  });
  customerSelect = customerField.querySelector("select");
  const contactField = field(t("Ansprechpartner"), "employee_id", {
    options: [],
    onchange: (event) => {
      state.employee_id = event.target.value || null;
      changed();
    },
  });
  contactSelect = contactField.querySelector("select");
  const offerField = field(t("Weiteres Angebot übernehmen"), "offer_id", {
    options: [],
  });
  offerSelect = offerField.querySelector("select");
  recipientContainer = el("div", { class: "oj-stack" });
  electronicContainer = el("div", { class: "oj-stack" });
  const electronicDetails = el(
    "details",
    { class: "oj-accordion", open: state.e_invoice || undefined },
    el("summary", {}, t("Zusätzliche E-Rechnungsangaben")),
    el("div", { class: "oj-accordion-body" }, electronicContainer),
  );
  const check = el("input", {
    type: "checkbox",
    class: "oj-checkbox",
    checked: state.e_invoice,
    onchange: (event) => {
      state.e_invoice = event.target.checked;
      electronicDetails.open = state.e_invoice;
      changed();
    },
  });
  const subjectField = control(t("Betreff"), "subject", {
    required: true,
    maxlength: 500,
  });
  function updateSubject() {
    const automatic =
      !state.subject.trim() || state.subject === suggestedSubject;
    suggestedSubject = defaultInvoiceSubject(
      state.invoice_date,
      state.language,
    );
    if (automatic) {
      state.subject = suggestedSubject;
      subjectField.querySelector("input").value = state.subject;
    }
  }
  const due = control(t("Fälligkeitsdatum"), "due_date", {
    type: "date",
    required: true,
  });
  const setDue = () => {
    state.due_date = addDays(state.invoice_date, state.payment_days);
    due.querySelector("input").value = state.due_date;
    updateSubject();
  };
  const saveButton = button(t("Entwurf speichern"), () => saveDraft(), {
    iconName: "floppy-disk",
  });
  const previewButton = button(
    t("Vorschau ansehen"),
    async () => {
      try {
        await persist();
        preview.replaceChildren(
          actionLink(
            t("PDF-Vorschau öffnen"),
            `/api${base}/drafts/${saved.id}/preview`,
          ),
          el(
            "span",
            { class: "oj-helper" },
            t("Die Vorschau ist als Entwurf gekennzeichnet."),
          ),
        );
        preview.hidden = false;
        preview.querySelector("a").focus();
      } catch (err) {
        error.show(err, form);
      }
    },
    { iconName: "eye" },
  );
  const finalizeButton = button(
    t("Rechnung verbindlich erstellen"),
    async () => {
      if (!form.reportValidity() || saving) return;
      if (
        !(await confirmDialog({
          title: t("Rechnung verbindlich erstellen?"),
          message: t(
            "Beim Erstellen wird die endgültige Rechnungsnummer vergeben. Rechnungsinhalt, PDF und gegebenenfalls XML bleiben danach unveränderlich.",
          ),
          confirmLabel: t("Verbindlich erstellen"),
          cancelLabel: t("Abbrechen"),
        }))
      )
        return;
      try {
        await persist();
        setBusy(true);
        const issued = await api(`${base}/drafts/${saved.id}/finalize`, {
          method: "POST",
          body: { expected_version: saved.version },
        });
        tell(t("Rechnung erstellt."));
        location.hash = "#/invoices/" + (issued.invoice_id || issued.id);
      } catch (err) {
        error.show(err, form);
      } finally {
        setBusy(false);
      }
    },
    { primary: true, iconName: "file-invoice" },
  );
  const removeButton = button(
    t("Entwurf löschen"),
    async () => {
      if (!saved || saving) return;
      if (
        !(await confirmDialog({
          title: t("Entwurf löschen?"),
          message: t(
            "Dieser Entwurf wird gelöscht. Es wird keine Rechnungsnummer verbraucht.",
          ),
          confirmLabel: t("Löschen"),
          cancelLabel: t("Abbrechen"),
          variant: "danger",
        }))
      )
        return;
      try {
        await api(`${base}/drafts/${saved.id}`, { method: "DELETE" });
        dirty = false;
        location.hash = "#/invoices";
      } catch (err) {
        error.show(err, form);
      }
    },
    { danger: true, disabled: !saved, iconName: "trash" },
  );
  function setBusy(value) {
    saving = value;
    saveButton.disabled = value;
    previewButton.disabled = value;
    finalizeButton.disabled = value;
    removeButton.disabled = value || !saved;
    form.setAttribute("aria-busy", String(value));
  }
  async function persist() {
    if (saving)
      throw new Error(
        t("Bitte warte, bis der aktuelle Vorgang abgeschlossen ist."),
      );
    error.clear();
    setBusy(true);
    try {
      saved = await api(`${base}/drafts${saved ? "/" + saved.id : ""}`, {
        method: saved ? "PATCH" : "POST",
        body: {
          ...payload(),
          ...(saved ? { expected_version: saved.version } : {}),
        },
      });
      dirty = false;
      state.invoice_number = saved.invoice_number;
      state.subject = saved.subject;
      subjectField.querySelector("input").value = state.subject;
      state.recipient = clone(saved.recipient || {});
      state.buyer_reference =
        saved.buyer_reference || state.recipient.buyer_reference || "";
      renderRecipient();
      history.replaceState(null, "", "#/invoice-editor/" + saved.id);
      status.textContent = t("Entwurf gespeichert. Nummernvorschau: {number}", {
        number: saved.invoice_number || t("noch nicht vergeben"),
      });
      return saved;
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft() {
    try {
      await persist();
      tell(t("Entwurf gespeichert."));
    } catch (err) {
      error.show(err, form);
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveDraft();
  });
  form.append(
    panel(
      t("Kunde und Empfänger"),
      el("div", { class: "finance-form-grid" }, customerField, contactField),
      recipientContainer,
    ),
    panel(
      t("Rechnungsdaten"),
      el(
        "div",
        { class: "finance-form-grid invoice-form-grid-three" },
        subjectField,
        control(
          t("Dokumentsprache"),
          "language",
          {
            options: [
              ["de", t("Deutsch")],
              ["en", t("Englisch")],
            ],
          },
          state,
          updateSubject,
        ),
        control(
          t("Zahlungsziel (Tage)"),
          "payment_days",
          { type: "number", min: 0, max: 365, step: 1 },
          state,
          setDue,
        ),
        control(
          t("Rechnungsdatum"),
          "invoice_date",
          { type: "date", required: true },
          state,
          setDue,
        ),
        due,
        control(t("Währung"), "currency", {
          options: [
            ["EUR", "EUR"],
            ["USD", "USD"],
            ["GBP", "GBP"],
          ],
        }),
      ),
      el(
        "div",
        { class: "finance-form-grid" },
        control(t("Leistungsdatum von"), "service_period_start", {
          type: "date",
          required: true,
        }),
        control(t("Leistungsdatum bis"), "service_period_end", {
          type: "date",
          required: true,
        }),
      ),
    ),
    panel(
      t("Rechnungspositionen"),
      el(
        "div",
        { class: "invoice-offer-picker oj-cluster" },
        offerField,
        button(
          t("Angebot übernehmen"),
          () => {
            const offer = options.offers?.find(
              (item) => item.id === offerSelect.value,
            );
            if (!offer) return;
            const replacesPlaceholder =
              state.items.length === 1 &&
              state.items[0] === placeholderLine &&
              !editedItems.has(placeholderLine);
            if (
              !replacesPlaceholder &&
              ((state.items.some((item) => item.customer_service_id) &&
                state.currency !== offer.currency) ||
                (state.items.some(
                  (item) => item.name || item.unit_price !== "0.00",
                ) &&
                  state.currency !== offer.currency))
            ) {
              error.show(
                new Error(
                  t(
                    "Alle übernommenen Angebote müssen dieselbe Währung wie die Rechnung haben.",
                  ),
                ),
                form,
              );
              return;
            }
            if (
              replacesPlaceholder ||
              (state.items.length === 1 &&
                !state.items[0].name &&
                state.items[0].unit_price === "0.00" &&
                !editedItems.has(state.items[0]))
            )
              state.items = [];
            state.currency = offer.currency;
            form.elements.namedItem("currency").value = state.currency;
            state.items.push(newLine(offer));
            changed(true);
            renderLines();
          },
          { iconName: "plus" },
        ),
      ),
      el(
        "p",
        { class: "oj-helper" },
        t(
          "Angebote liefern überprüfbare Netto-Preisvorschläge. Menge und Leistungszeitraum werden nicht automatisch aus dem Abrechnungsmodell abgeleitet.",
        ),
      ),
      lineContainer,
      button(
        t("Freie Position hinzufügen"),
        () => {
          state.items.push(newLine());
          changed(true);
          renderLines();
        },
        { iconName: "plus" },
      ),
      totals,
    ),
    panel(
      t("Hinweise und E-Rechnung"),
      control(t("Bemerkungen"), "note", { type: "textarea", maxlength: 10000 }),
      control(t("Zahlungstext"), "payment_text", {
        type: "textarea",
        maxlength: 4000,
      }),
      control(t("Steuerhinweis"), "tax_text", {
        type: "textarea",
        maxlength: 4000,
      }),
      el(
        "label",
        { class: "oj-check" },
        check,
        el("span", {}, t("E-Rechnung zusätzlich erstellen")),
      ),
      el(
        "p",
        { class: "oj-helper" },
        t(
          "XRechnung als UBL-XML zusätzlich zum PDF. Die Ausstellung erfolgt erst nach erfolgreicher lokaler Prüfung.",
        ),
      ),
      electronicDetails,
    ),
    error.node,
    status,
    preview,
    el(
      "div",
      { class: "invoice-editor-actions oj-cluster" },
      saveButton,
      previewButton,
      finalizeButton,
      removeButton,
    ),
  );
  const beforeUnload = (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", beforeUnload);
  renderRecipient();
  renderOffers();
  renderLines();
  status.textContent = saved
    ? t("Entwurf gespeichert. Nummernvorschau: {number}", {
        number: saved.invoice_number || t("noch nicht vergeben"),
      })
    : t("Die Rechnungsnummer wird erst beim verbindlichen Erstellen vergeben.");
  const result = [
    heading(
      saved ? t("Rechnungsentwurf bearbeiten") : t("Neue Rechnung"),
      t(
        "Kunde auswählen, Positionen prüfen und als Entwurf speichern oder verbindlich erstellen.",
      ),
      [
        actionLink(
          t("Rechnungseinstellungen"),
          "#/finance-settings?tab=creation",
        ),
      ],
    ),
    link(t("← Alle Rechnungen"), "#/invoices"),
    form,
  ];
  result.dispose = () => {
    disposed = true;
    clearTimeout(calculationTimer);
    calculationToken++;
    window.removeEventListener("beforeunload", beforeUnload);
  };
  return result;
}
