import { api } from "./api.js";
import { showForm } from "./dialogs.js";
import { toast, confirmDialog } from "../vendor/oj-designsystem/index.js";
import {
  el,
  icon,
  link,
  button,
  field,
  table,
  panel,
  heading,
  metric,
  empty,
  facts,
  money,
  datetime,
} from "./dom.js";
import { customerLogo } from "./customer-branding.js";

const categories = { revenue: "Einnahmen", payable: "Ausgaben" };
const states = { open: "Offen", paid: "Bezahlt" };
const ingestion = {
  pending: "Erkennung ausstehend",
  processed: "Verarbeitet",
  failed: "Verarbeitung fehlgeschlagen",
  missing: "Datei fehlt",
};
const payableTags = [
  "Device",
  "SaaS",
  "Insurance",
  "Membership",
  "Marketing",
  "Domain",
  "Rent",
];
const monthNames = [
  "Jänner",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];
const financePath = "/finance";
let groupNumber = 0;

const notice = (message, type = "success") =>
  toast(message, { type, dismissLabel: "Schließen" });
const options = (map, first) => [
  ...(first ? [["", first]] : []),
  ...Object.entries(map),
];
const amountText = (value) =>
  value === null || value === undefined
    ? ""
    : `${value < 0 ? "-" : ""}${Math.trunc(Math.abs(value) / 100)},${String(Math.abs(value) % 100).padStart(2, "0")}`;
function amountMinor(value, optional = false) {
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized && optional) return null;
  if (!/^-?\d{1,11}(\.\d{1,2})?$/.test(normalized))
    throw new Error(
      "Betrag mit maximal zwei Nachkommastellen eingeben, z. B. 1200,50. Gutschriften können negativ sein.",
    );
  const sign = normalized.startsWith("-") ? -1 : 1;
  const [whole, fraction = ""] = normalized.replace(/^-/, "").split(".");
  const valueMinor =
    Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * sign;
  if (Math.abs(valueMinor) > 1000000000000)
    throw new Error("Der Betrag ist zu groß.");
  return valueMinor;
}
function dateLabel(value) {
  if (!value) return "–";
  const date = new Date(value.slice(0, 10) + "T12:00:00");
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("de-AT", { dateStyle: "medium" }).format(date)
    : value;
}
const daysSince = (date) =>
  !date
    ? "–"
    : `${Math.max(0, Math.floor((Date.now() - Date.parse(date + "T00:00:00Z")) / 86400000))} Tage`;
const customerDays = (row) =>
  Number.isInteger(row.days_since_last_invoice)
    ? `${row.days_since_last_invoice} Tage`
    : daysSince(row.last_invoice_date);
const invoiceLabel = (row) =>
  row.invoice_number || row.file_name || "Rechnung ohne Nummer";
const currencyMetrics = (row) => row.currencies || row.stats || [];
const currencyTotal = (row) =>
  row.total_amount_minor ?? row.lifetime_value_minor ?? 0;
const currencyAverage = (row) =>
  row.average_monthly_minor ?? row.avg_monthly_revenue_minor ?? 0;
const invoiceURL = (id) => "#/invoices/" + id;
const fileLink = (row) =>
  row.has_file
    ? el(
        "a",
        {
          class: "oj-button oj-button-secondary",
          href: `/api/finance/invoices/${row.id}/file`,
          target: "_blank",
          rel: "noopener",
        },
        icon("file-pdf"),
        "PDF öffnen",
      )
    : el("span", { class: "oj-small oj-muted" }, "Keine PDF-Datei verfügbar");
function routeFilter(route, params, values) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(values))
    value === "" || value === null
      ? next.delete(key)
      : next.set(key, String(value));
  location.hash = "#" + route + (next.size ? "?" + next : "");
}
function rememberSearch(route, params, value) {
  value ? params.set("search", value) : params.delete("search");
  history.replaceState(
    null,
    "",
    "#" + route + (params.size ? "?" + params : ""),
  );
}
function disposable(nodes, actions, ...cleanups) {
  let busy = false;
  const timer = setInterval(async () => {
    const active = document.activeElement;
    if (
      busy ||
      document.hidden ||
      document.querySelector("dialog[open]") ||
      active?.matches("input,textarea,select,summary")
    )
      return;
    busy = true;
    try {
      await actions.financeRefresh();
    } finally {
      busy = false;
    }
  }, 10000);
  nodes.dispose = () => {
    clearInterval(timer);
    cleanups.forEach((cleanup) => cleanup());
  };
  return nodes;
}
function statusControl(row, actions) {
  const id = "finance-status-" + ++groupNumber;
  return el(
    "div",
    {
      class: "oj-segmented finance-status",
      role: "group",
      "aria-label": "Rechnungsstatus: " + invoiceLabel(row),
    },
    Object.entries(states).map(([value, text]) =>
      el(
        "label",
        {},
        el("input", {
          type: "radio",
          name: id,
          value,
          checked: row.status === value,
          onchange: async (event) => {
            event.target
              .closest(".finance-status")
              .querySelectorAll("input")
              .forEach((input) => (input.disabled = true));
            const result = await actions.financePatch(row.id, {
              status: value,
            });
            if (event.target.isConnected) {
              event.target
                .closest(".finance-status")
                .querySelectorAll("input")
                .forEach((input) => {
                  input.disabled = false;
                  if (!result) input.checked = input.value === row.status;
                });
            }
          },
        }),
        el("span", {}, text),
      ),
    ),
  );
}
function tagEditor(selected = []) {
  const choices = payableTags.map((name) =>
    el(
      "label",
      { class: "finance-tag-choice" },
      el("input", {
        type: "checkbox",
        value: name,
        checked: selected.includes(name),
      }),
      el("span", { class: "oj-tag" }, name),
    ),
  );
  return {
    node: el(
      "fieldset",
      { class: "finance-tag-picker wide" },
      el("legend", { class: "oj-label" }, "Ausgaben-Tags"),
      el("div", { class: "finance-tag-options" }, choices),
    ),
    value: () =>
      choices.flatMap((choice) =>
        choice.querySelector("input").checked
          ? [choice.querySelector("input").value]
          : [],
      ),
  };
}
function moneyCell(value, currency) {
  return el("span", { class: "oj-mono finance-money" }, money(value, currency));
}
function invoiceTable(rows, actions, { sorting, onSort } = {}) {
  const heads = [
    ["Rechnung", "invoice_number"],
    ["Datum", "invoice_date"],
    ["Firma", "counterparty_name"],
    ["Betrag", "total_amount_minor"],
    ["Status", "status"],
    ["Datei", "file_name"],
  ];
  const result = table(
    "Rechnungen",
    heads.map(([label, key]) =>
      !onSort
        ? label
        : el(
            "button",
            {
              type: "button",
              class: "finance-sort",
              onclick: () => onSort(key),
              "aria-label": label + " sortieren",
            },
            label,
            sorting.sort === key
              ? icon(sorting.order === "asc" ? "arrow-up" : "arrow-down")
              : icon("sort"),
          ),
    ),
    rows.map((row) => [
      el(
        "div",
        {},
        link(invoiceLabel(row), invoiceURL(row.id)),
        row.ingestion_status === "failed" || row.ingestion_status === "missing"
          ? el(
              "p",
              { class: "oj-small finance-warning" },
              icon("triangle-exclamation"),
              " ",
              ingestion[row.ingestion_status],
            )
          : null,
      ),
      dateLabel(row.invoice_date),
      el(
        "div",
        {},
        row.customer_id
          ? link(
              row.customer_name || row.counterparty_name || "–",
              "#/customers/" + row.customer_id,
            )
          : row.counterparty_name || "–",
        row.is_overdue
          ? el(
              "p",
              { class: "oj-small finance-warning" },
              "Überfällig seit ",
              dateLabel(row.due_date),
            )
          : null,
      ),
      moneyCell(row.total_amount_minor, row.currency),
      statusControl(row, actions),
      row.has_file
        ? el(
            "a",
            {
              class: "oj-link finance-file-name",
              href: `/api/finance/invoices/${row.id}/file`,
              title: row.file_name || "PDF öffnen",
              target: "_blank",
              rel: "noopener",
            },
            icon("file-pdf"),
            " ",
            row.file_name || "PDF öffnen",
          )
        : el("span", { class: "oj-small oj-muted" }, row.file_name || "–"),
    ]),
  );
  result.classList.add("finance-invoice-table");
  if (onSort)
    result
      .querySelectorAll("th")
      .forEach((head, index) =>
        head.setAttribute(
          "aria-sort",
          sorting.sort === heads[index][1]
            ? sorting.order === "asc"
              ? "ascending"
              : "descending"
            : "none",
        ),
      );
  return result;
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Die PDF-Datei konnte nicht gelesen werden."));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
}

export function createFinanceActions(refresh, navigate) {
  const saved = async (request, message = "Gespeichert.") => {
    const result = await request;
    if (message) notice(message);
    await refresh();
    return result;
  };
  return {
    financeRefresh: () => refresh(),
    financeImport: (category = "revenue") =>
      showForm(
        "PDF importieren",
        [
          field("Art", "category", {
            value: category,
            options: options(categories),
          }),
          field("PDF-Datei", "file", {
            type: "file",
            accept: ".pdf,application/pdf",
            required: true,
            wide: true,
            helper:
              "Die PDF wird lokal gespeichert. Mit einem hinterlegten OpenAI-Schlüssel werden die Rechnungsdaten automatisch erkannt.",
          }),
        ],
        async (data, form) => {
          const file = form.elements.namedItem("file").files[0];
          if (!file || !/\.pdf$/i.test(file.name))
            throw new Error("Bitte eine PDF-Datei auswählen.");
          if (file.size > 20 * 1024 * 1024)
            throw new Error("Die PDF darf maximal 20 MiB groß sein.");
          return api(financePath + "/import", {
            method: "POST",
            body: {
              category: data.category,
              file_name: file.name,
              data: await readFile(file),
            },
          });
        },
        {
          submitLabel: "Importieren",
          onSaved: (result) => navigate("/invoices/" + result.invoice.id),
          successMessage: "PDF importiert.",
        },
      ),
    financePatch: (id, body) =>
      saved(api(financePath + "/invoices/" + id, { method: "PATCH", body })),
    financeReset: async (id, fieldName) => {
      if (
        !(await confirmDialog({
          title: fieldName
            ? "Korrektur zurücksetzen?"
            : "Alle Korrekturen zurücksetzen?",
          message:
            "Die ursprünglich erkannten Rechnungsdaten werden wieder verwendet.",
          confirmLabel: "Zurücksetzen",
          cancelLabel: "Abbrechen",
        }))
      )
        return;
      return saved(
        api(financePath + "/invoices/" + id + "/reset", {
          method: "POST",
          body: fieldName ? { field: fieldName } : {},
        }),
        "Korrekturen zurückgesetzt.",
      );
    },
    financeReprocess: (id) =>
      saved(
        api(financePath + "/invoices/" + id + "/reprocess", {
          method: "POST",
          body: {},
        }),
        "Rechnung neu verarbeitet. Manuelle Korrekturen bleiben erhalten.",
      ),
    financeDelete: async (row) => {
      if (
        !(await confirmDialog({
          title: "Rechnung löschen?",
          message: `„${invoiceLabel(row)}“ wird mit den Korrekturen und Verarbeitungsprotokollen aus Pitchary gelöscht. Die ursprüngliche PDF im überwachten Ordner bleibt erhalten.`,
          confirmLabel: "Löschen",
          cancelLabel: "Abbrechen",
          variant: "danger",
        }))
      )
        return;
      await api(financePath + "/invoices/" + row.id, { method: "DELETE" });
      notice("Rechnung gelöscht.");
      navigate("/invoices");
    },
    financeProfile: (row) =>
      showForm(
        "Rechnungsdaten des Kunden",
        [
          field("Kundenname", "name", {
            value: row.name,
            required: true,
            maxlength: 200,
          }),
          field("Haupt-E-Mail", "general_email", {
            type: "email",
            value: row.general_email || "",
            maxlength: 500,
          }),
          field("Rechnungsadresse", "billing_address", {
            type: "textarea",
            value: row.billing_address || "",
            maxlength: 2000,
            wide: true,
          }),
        ],
        (body) =>
          api(financePath + "/customers/" + row.id, { method: "PATCH", body }),
        { onSaved: refresh },
      ),
    financeContact: (customerId, row) =>
      showForm(
        row ? "Ansprechpartner bearbeiten" : "Ansprechpartner hinzufügen",
        [
          field("Name", "name", {
            value: row?.name || "",
            required: true,
            maxlength: 200,
          }),
          field("E-Mail", "email", {
            type: "email",
            value: row?.email || "",
            maxlength: 500,
          }),
          field("Position", "position", {
            value: row?.position || "",
            maxlength: 500,
          }),
          field("LinkedIn", "linkedin", {
            type: "url",
            value: row?.linkedin || "",
            maxlength: 500,
          }),
        ],
        (data) =>
          api("/employees" + (row ? "/" + row.id : ""), {
            method: row ? "PATCH" : "POST",
            body: row ? data : { ...data, customer_id: customerId },
          }),
        { onSaved: refresh },
      ),
    financeArchiveContact: async (row) => {
      if (
        !(await confirmDialog({
          title: "Ansprechpartner archivieren?",
          message: `„${row.name}“ bleibt in historischen Vorgängen erhalten.`,
          confirmLabel: "Archivieren",
          cancelLabel: "Abbrechen",
        }))
      )
        return;
      return saved(
        api("/employees/" + row.id, { method: "DELETE" }),
        "Ansprechpartner archiviert.",
      );
    },
    financeRestoreContact: (row) =>
      saved(
        api("/employees/" + row.id + "/restore", { method: "POST", body: {} }),
        "Ansprechpartner wiederhergestellt.",
      ),
    financeEnrich: (id) =>
      saved(
        api(financePath + "/customers/" + id + "/enrich", {
          method: "POST",
          body: {},
        }),
        "Kundenangaben geprüft.",
      ),
    financeScan: async () => {
      const result = await api(financePath + "/scan", {
        method: "POST",
        body: {},
      });
      notice(
        `${result.imported || 0} importiert · ${result.skipped || 0} unverändert · ${result.failed || 0} fehlgeschlagen · ${result.missing || 0} fehlende Dateien`,
        result.failed ? "warning" : "success",
      );
      await refresh();
      return result;
    },
    financeSettingsSave: (body) =>
      saved(
        api(financePath + "/settings", { method: "PATCH", body }),
        "Finanz-Einstellungen gespeichert.",
      ),
    financeKeyTest: async (key, model) => {
      const result = await api(financePath + "/settings/test-key", {
        method: "POST",
        body: { ...(key ? { api_key: key } : {}), ...(model ? { model } : {}) },
      });
      notice(
        result.ok
          ? "OpenAI-Schlüssel gültig."
          : "OpenAI-Schlüssel konnte nicht bestätigt werden.",
        result.ok ? "success" : "error",
      );
      return result;
    },
    financeKeyRemove: async () => {
      if (
        !(await confirmDialog({
          title: "OpenAI-Schlüssel entfernen?",
          message:
            "Manuelle Bearbeitung und lokal gespeicherte Rechnungen bleiben verfügbar.",
          confirmLabel: "Entfernen",
          cancelLabel: "Abbrechen",
        }))
      )
        return;
      return saved(
        api(financePath + "/settings/key", { method: "DELETE" }),
        "OpenAI-Schlüssel entfernt.",
      );
    },
  };
}

function svgNode(tag, attrs = {}, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attrs))
    node.setAttribute(name, String(value));
  children
    .flat()
    .forEach((child) =>
      node.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      ),
    );
  return node;
}
function monthlyChart(rows, currency, { split = false } = {}) {
  const series = rows.filter((row) => row.currency === currency);
  if (!series.length)
    return el("p", { class: "oj-muted" }, "Noch keine Monatswerte.");
  const containerWidth =
    document.querySelector(".app-content")?.clientWidth || window.innerWidth;
  const chartWidth =
    split && window.innerWidth > 900
      ? ((containerWidth - 88 - 16) * 2) / 3
      : containerWidth - 88;
  const narrow = chartWidth <= 700;
  const width = Math.max(360, chartWidth),
    height = 290,
    left = narrow ? 60 : 76,
    right = 18,
    top = 20,
    bottom = 45;
  const all = series.flatMap((row) => [
    row.revenue || 0,
    row.payable || 0,
    row.profit || 0,
  ]);
  const max = Math.max(100, ...all),
    min = Math.min(0, ...all),
    range = max - min;
  const x = (index) =>
    left + (index * (width - left - right)) / Math.max(1, series.length - 1);
  const y = (value) => top + ((max - value) / range) * (height - top - bottom);
  const svg = svgNode(
    "svg",
    {
      viewBox: `0 0 ${width} ${height}`,
      class: "finance-chart",
      role: "img",
      "aria-label": `Einnahmen, Ausgaben und Gewinn der letzten zwölf Monate in ${currency}`,
    },
    svgNode(
      "title",
      {},
      `Monatsentwicklung in ${currency}. Die genauen Werte stehen in der Tabelle unter dem Diagramm.`,
    ),
  );
  for (let index = 0; index <= 4; index++) {
    const value = min + (range * index) / 4;
    svg.append(
      svgNode("line", {
        x1: left,
        x2: width - right,
        y1: y(value),
        y2: y(value),
        class: "finance-chart-grid",
      }),
      svgNode(
        "text",
        {
          x: left - 8,
          y: y(value) + 4,
          "text-anchor": "end",
          class: "finance-chart-label",
        },
        new Intl.NumberFormat("de-AT", {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(value / 100),
      ),
    );
  }
  series.forEach((row, index) =>
    svg.append(
      svgNode(
        "text",
        {
          x: x(index),
          y: height - 14,
          "text-anchor": "middle",
          class: "finance-chart-label",
        },
        row.month.slice(5, 7),
      ),
    ),
  );
  for (const [key, label] of [
    ["revenue", "Einnahmen"],
    ["payable", "Ausgaben"],
    ["profit", "Gewinn"],
  ]) {
    svg.append(
      svgNode("polyline", {
        points: series
          .map((row, index) => `${x(index)},${y(row[key] || 0)}`)
          .join(" "),
        class: "finance-chart-line finance-chart-" + key,
        fill: "none",
      }),
    );
    series.forEach((row, index) =>
      svg.append(
        svgNode(
          "circle",
          {
            cx: x(index),
            cy: y(row[key] || 0),
            r: 3.5,
            class: "finance-chart-point finance-chart-" + key,
          },
          svgNode(
            "title",
            {},
            `${row.month} · ${label}: ${money(row[key] || 0, currency)}`,
          ),
        ),
      ),
    );
  }
  return el(
    "div",
    { class: "finance-chart-wrap" },
    el(
      "div",
      { class: "finance-chart-legend oj-small" },
      ["revenue", "payable", "profit"].map((key) =>
        el(
          "span",
          {},
          el("span", {
            class: "finance-legend-dot finance-chart-" + key,
            "aria-hidden": "true",
          }),
          { revenue: "Einnahmen", payable: "Ausgaben", profit: "Gewinn" }[key],
        ),
      ),
    ),
    svg,
    el(
      "details",
      { class: "oj-accordion" },
      el("summary", {}, "Monatswerte anzeigen"),
      el(
        "div",
        { class: "oj-accordion-body" },
        table(
          "Monatliche Finanzwerte",
          ["Monat", "Einnahmen", "Ausgaben", "Gewinn"],
          series.map((row) => [
            row.month,
            moneyCell(row.revenue, currency),
            moneyCell(row.payable, currency),
            moneyCell(row.profit, currency),
          ]),
        ),
      ),
    ),
  );
}
function combinedAmount(group) {
  if (group.amounts.length === 1)
    return money(group.total_amount_minor, group.amounts[0].currency);
  return new Intl.NumberFormat("de-AT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(group.total_amount_minor / 100);
}
function topList(title, rows) {
  return panel(
    title,
    rows.length
      ? el(
          "ol",
          { class: "finance-ranking" },
          rows.slice(0, 4).map((row) =>
            el(
              "li",
              {},
              el(
                "span",
                { class: "finance-ellipsis", title: row.name },
                row.name,
              ),
              el(
                "span",
                {
                  class: "finance-money",
                  title: row.amounts
                    .map(({ currency, total_amount_minor }) =>
                      money(total_amount_minor, currency),
                    )
                    .join(" + "),
                },
                combinedAmount(row),
              ),
            ),
          ),
        )
      : el("p", { class: "oj-muted" }, "Noch keine Rechnungen in diesem Jahr."),
  );
}

export async function financeDashboard(
  actions,
  params = new URLSearchParams(),
) {
  const today = new Date();
  const year = params.get("year") || String(today.getFullYear()),
    month =
      params.get("month") || String(today.getMonth() + 1).padStart(2, "0");
  const data = await api(financePath + "/dashboard", {
    query: { year, month },
  });
  const years = [...new Set([year, ...(data.years || [])])].sort().reverse();
  const visibleCurrency = (row) => row.currency !== "USD";
  const currencies = data.currencies.filter(visibleCurrency);
  const currency = currencies.some(
    (row) => row.currency === params.get("currency"),
  )
    ? params.get("currency")
    : currencies[0]?.currency || "EUR";
  const controls = el(
    "div",
    { class: "finance-filters" },
    field("Jahr", "year", {
      options: years.map((value) => [value, value]),
      value: year,
      onchange: (event) =>
        routeFilter("/dashboard", params, { year: event.target.value }),
    }),
    field("Monat", "month", {
      options: monthNames.map((label, index) => [
        String(index + 1).padStart(2, "0"),
        label,
      ]),
      value: month,
      onchange: (event) =>
        routeFilter("/dashboard", params, { month: event.target.value }),
    }),
    currencies.length > 1
      ? field("Diagramm-Währung", "currency", {
          options: currencies.map((row) => [row.currency, row.currency]),
          value: currency,
          onchange: (event) =>
            routeFilter("/dashboard", params, { currency: event.target.value }),
        })
      : null,
  );
  const metrics = currencies.map((row) =>
    el(
      "section",
      {
        class: "finance-currency-group oj-stack",
        "aria-label": "Kennzahlen in " + row.currency,
      },
      currencies.length > 1
        ? el("h2", { class: "oj-heading-3" }, row.currency)
        : null,
      el(
        "div",
        { class: "finance-kpis" },
        [
          [
            "Einnahmen · " + monthNames[Number(month) - 1],
            row.month.revenue,
            "revenue",
          ],
          [
            "Ausgaben · " + monthNames[Number(month) - 1],
            row.month.payable,
            "payable",
          ],
          [
            "Gewinn · " + monthNames[Number(month) - 1],
            row.month.profit,
            "profit",
          ],
          ["Einnahmen · " + year, row.year.revenue, "revenue"],
          ["Ausgaben · " + year, row.year.payable, "payable"],
          ["Gewinn · " + year, row.year.profit, "profit"],
        ].map(([label, value, kind]) => {
          const card = metric(label, money(value, row.currency));
          card.classList.add("finance-metric-" + kind);
          return card;
        }),
      ),
    ),
  );
  const overdueValue = (category) =>
    currencies.length === 1
      ? money(currencies[0].overdue[category], currencies[0].currency)
      : el(
          "span",
          { class: "finance-money-list" },
          currencies.map((row) =>
            moneyCell(row.overdue[category], row.currency),
          ),
        );
  const nodes = [
    controls,
    ...metrics,
    !currencies.length
      ? empty(
          data.currencies.length
            ? "Keine Finanzwerte für diese Übersicht"
            : "Noch keine Rechnungen",
          data.currencies.length
            ? "Deine gespeicherten Rechnungen findest du in der Rechnungsverwaltung."
            : "Importiere eine PDF oder hinterlege deine Rechnungsordner in den Finanz-Einstellungen.",
          link("Rechnungen öffnen", "#/invoices"),
        )
      : null,
    currencies.length
      ? el(
          "div",
          { class: "finance-chart-overdue" },
          panel(
            "Monatsentwicklung · " + currency,
            monthlyChart(data.months.filter(visibleCurrency), currency, {
              split: true,
            }),
          ),
          el(
            "div",
            { class: "finance-overdue" },
            metric(
              "Überfällige Einnahmen",
              overdueValue("revenue"),
              "Offene Rechnungen vor dem heutigen Fälligkeitsdatum",
            ),
            metric(
              "Überfällige Ausgaben",
              overdueValue("payable"),
              "Offene Rechnungen vor dem heutigen Fälligkeitsdatum",
            ),
          ),
        )
      : null,
    el(
      "div",
      { class: "finance-two-columns finance-open-invoices" },
      panel("Offene Einnahmen", invoiceTable(data.open_revenue || [], actions)),
      panel("Offene Ausgaben", invoiceTable(data.open_payable || [], actions)),
    ),
  ];
  return disposable(
    [
      el(
        "section",
        {
          class: "dashboard-finance oj-stack",
          "aria-label": "Finanzübersicht",
        },
        nodes,
      ),
    ],
    actions,
  );
}

export async function invoiceList(actions, params = new URLSearchParams()) {
  const category = params.get("category") === "payable" ? "payable" : "revenue";
  const query = {
    category,
    year: params.get("year") || "",
    status: params.get("status") || "",
    search: params.get("search") || "",
    sort: params.get("sort") || "invoice_date",
    order: params.get("order") === "asc" ? "asc" : "desc",
    customer_id: params.get("customer_id") || "",
    customer_service_id: params.get("customer_service_id") || "",
  };
  const data = await api(financePath + "/invoices", { query });
  let timer,
    requestNumber = 0,
    disposed = false;
  const content = el("div", {});
  const count = el("p", { class: "oj-small oj-muted", role: "status" });
  function renderRows(items) {
    count.textContent = `${items.length} ${category === "payable" ? "Ausgaben" : "Einnahmen"}`;
    content.replaceChildren(
      invoiceTable(items, actions, {
        sorting: query,
        onSort: (sort) =>
          routeFilter("/invoices", params, {
            sort,
            order:
              query.sort === sort && query.order === "asc" ? "desc" : "asc",
          }),
      }),
    );
  }
  renderRows(data.items);
  const filters = el(
    "div",
    { class: "finance-filters" },
    field("Suchen", "search", {
      type: "search",
      value: query.search,
      placeholder: "Firma, Nummer oder Datei",
      oninput: (event) => {
        clearTimeout(timer);
        const value = event.target.value;
        const token = ++requestNumber;
        timer = setTimeout(async () => {
          query.search = value;
          rememberSearch("/invoices", params, value);
          content.setAttribute("aria-busy", "true");
          try {
            const result = await api(financePath + "/invoices", { query });
            if (!disposed && token === requestNumber) renderRows(result.items);
          } catch (error) {
            if (!disposed && token === requestNumber)
              notice(error.message, "error");
          } finally {
            if (!disposed && token === requestNumber)
              content.removeAttribute("aria-busy");
          }
        }, 300);
      },
    }),
    field("Jahr", "year", {
      options: [
        ["", "Alle Jahre"],
        ...(data.years || []).map((value) => [value, value]),
      ],
      value: query.year,
      onchange: (event) =>
        routeFilter("/invoices", params, { year: event.target.value }),
    }),
    field("Status", "status", {
      options: options(states, "Alle Status"),
      value: query.status,
      onchange: (event) =>
        routeFilter("/invoices", params, { status: event.target.value }),
    }),
  );
  const categoryId = "finance-category-" + ++groupNumber;
  const segment = el(
    "div",
    {
      class: "oj-segmented finance-category",
      role: "group",
      "aria-label": "Rechnungsart",
    },
    Object.entries(categories).map(([value, label]) =>
      el(
        "label",
        {},
        el("input", {
          type: "radio",
          name: categoryId,
          value,
          checked: value === category,
          onchange: () =>
            routeFilter("/invoices", params, { category: value, year: "" }),
        }),
        el("span", {}, label),
      ),
    ),
  );
  return disposable(
    [
      heading(
        "Rechnungen",
        "PDFs, Zahlungsstatus und erkannte Rechnungsdaten.",
        [
          button("PDF importieren", () => actions.financeImport(category), {
            primary: true,
            iconName: "file-arrow-up",
          }),
          button("Ordner einlesen", () => actions.financeScan(), {
            iconName: "folder-open",
          }),
        ],
      ),
      query.customer_id || query.customer_service_id
        ? el(
            "div",
            { class: "finance-actions" },
            el(
              "p",
              { class: "oj-small oj-muted" },
              query.customer_service_id
                ? "Rechnungen für diesen Vorgang"
                : "Rechnungen für diesen Kunden",
            ),
            button(
              "Zuordnungsfilter entfernen",
              () =>
                routeFilter("/invoices", params, {
                  customer_id: "",
                  customer_service_id: "",
                }),
              { compact: true, iconName: "xmark" },
            ),
          )
        : null,
      segment,
      filters,
      count,
      content,
    ],
    actions,
    () => {
      disposed = true;
      clearTimeout(timer);
    },
  );
}

async function editInvoice(row, actions) {
  const [customers, relationships] = await Promise.all([
    api("/customers", { query: { archived: "false" } }),
    api("/customer-services", { query: { archived: "false" } }),
  ]);
  const allCustomers = [...customers];
  if (
    row.customer_id &&
    !allCustomers.some((customer) => customer.id === row.customer_id)
  )
    allCustomers.push({
      id: row.customer_id,
      name: row.customer_name || "Archivierter Kunde",
    });
  const allRelationships = [...relationships];
  if (
    row.customer_service_id &&
    !allRelationships.some(
      (relationship) => relationship.id === row.customer_service_id,
    )
  )
    allRelationships.push({
      id: row.customer_service_id,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      service_name: row.service_name || "Archiviertes Angebot",
    });
  const tags = tagEditor(row.tags);
  const fields = [
    field("Art", "category", {
      value: row.category,
      options: options(categories),
    }),
    field("Rechnungsnummer", "invoice_number", {
      value: row.invoice_number || "",
      maxlength: 200,
    }),
    field("Rechnungsdatum", "invoice_date", {
      type: "date",
      value: row.invoice_date || "",
    }),
    field("Fällig am", "due_date", { type: "date", value: row.due_date || "" }),
    field("Firma auf der Rechnung", "counterparty_name", {
      value: row.counterparty_name || "",
      maxlength: 500,
    }),
    field("Währung", "currency", {
      value: row.currency || "EUR",
      minlength: 3,
      maxlength: 3,
      required: true,
      pattern: "[A-Za-z]{3}",
    }),
    field("Gesamtbetrag", "total_amount_minor", {
      value: amountText(row.total_amount_minor),
      inputmode: "decimal",
      required: true,
      helper: "Ohne Tausendertrennzeichen. Negative Beträge für Gutschriften.",
    }),
    field("Netto", "net_amount_minor", {
      value: amountText(row.net_amount_minor),
      inputmode: "decimal",
    }),
    field("Steuer", "tax_amount_minor", {
      value: amountText(row.tax_amount_minor),
      inputmode: "decimal",
    }),
    field("Status", "status", { value: row.status, options: options(states) }),
    field("Bezahlt am", "paid_at", {
      type: "date",
      value: row.paid_at?.slice(0, 10) || "",
      helper:
        "Beim Wechsel auf Bezahlt wird ohne Angabe das heutige Datum gesetzt.",
    }),
    field("CRM-Kunde", "customer_id", {
      value: row.customer_id || "",
      options: [
        ["", "Keine Zuordnung"],
        ...allCustomers.map((customer) => [customer.id, customer.name]),
      ],
    }),
    field("Angebot / Vorgang", "customer_service_id", {
      value: row.customer_service_id || "",
      options: [
        ["", "Keine Zuordnung"],
        ...allRelationships
          .filter(
            (relationship) =>
              !row.customer_id || relationship.customer_id === row.customer_id,
          )
          .map((relationship) => [
            relationship.id,
            relationship.customer_name + " · " + relationship.service_name,
          ]),
      ],
      wide: true,
    }),
    tags.node,
  ];
  showForm(
    "Rechnung bearbeiten",
    fields,
    (data) => {
      const body = {
        ...data,
        currency: data.currency.toUpperCase(),
        customer_id: data.customer_id || null,
        customer_service_id: data.customer_service_id || null,
        invoice_number: data.invoice_number || null,
        counterparty_name: data.counterparty_name || null,
        invoice_date: data.invoice_date || null,
        due_date: data.due_date || null,
        ...(data.status === "paid"
          ? data.paid_at
            ? { paid_at: data.paid_at }
            : {}
          : { paid_at: null }),
        ...(data.category === "payable" ? { tags: tags.value() } : {}),
      };
      if (body.status === "paid" && !data.paid_at) delete body.paid_at;
      for (const name of [
        "total_amount_minor",
        "net_amount_minor",
        "tax_amount_minor",
      ])
        body[name] = amountMinor(data[name], name !== "total_amount_minor");
      for (const [name, value] of Object.entries(body)) {
        const previous = row[name] ?? null;
        if (JSON.stringify(value) === JSON.stringify(previous))
          delete body[name];
      }
      return api(financePath + "/invoices/" + row.id, {
        method: "PATCH",
        body,
      });
    },
    {
      onSaved: () => actions.financeRefresh(),
      pinnedFooter: true,
      dialogClass: "offer-dialog finance-invoice-dialog",
      onMount: (form) => {
        const customer = form.elements.namedItem("customer_id"),
          relationship = form.elements.namedItem("customer_service_id"),
          category = form.elements.namedItem("category");
        const status = form.elements.namedItem("status"),
          paidDate = form.elements.namedItem("paid_at");
        const updatePaidDate = () =>
          (paidDate.disabled = status.value !== "paid");
        status.addEventListener("change", updatePaidDate);
        updatePaidDate();
        const updateTags = () =>
          (tags.node.hidden = category.value !== "payable");
        category.addEventListener("change", updateTags);
        updateTags();
        customer.addEventListener("change", () => {
          relationship.replaceChildren(
            el("option", { value: "" }, "Keine Zuordnung"),
            ...allRelationships
              .filter(
                (item) =>
                  !customer.value || item.customer_id === customer.value,
              )
              .map((item) =>
                el(
                  "option",
                  { value: item.id },
                  item.customer_name + " · " + item.service_name,
                ),
              ),
          );
        });
        relationship.addEventListener("change", () => {
          const selected = allRelationships.find(
            (item) => item.id === relationship.value,
          );
          if (selected) customer.value = selected.customer_id;
        });
      },
    },
  );
}

export async function invoiceDetail(id, actions) {
  const [row, logs] = await Promise.all([
    api(financePath + "/invoices/" + id),
    api(financePath + "/invoices/" + id + "/logs"),
  ]);
  const fields = [
    ["invoice_number", "Rechnungsnummer", row.invoice_number || "–"],
    ["category", "Art", categories[row.category]],
    ["invoice_date", "Rechnungsdatum", dateLabel(row.invoice_date)],
    ["due_date", "Fällig am", dateLabel(row.due_date)],
    ["counterparty_name", "Firma", row.counterparty_name || "–"],
    [
      "total_amount_minor",
      "Gesamtbetrag",
      money(row.total_amount_minor, row.currency),
    ],
    ["net_amount_minor", "Netto", money(row.net_amount_minor, row.currency)],
    ["tax_amount_minor", "Steuer", money(row.tax_amount_minor, row.currency)],
    ["currency", "Währung", row.currency],
    ["paid_at", "Bezahlt am", dateLabel(row.paid_at)],
    [
      "customer_id",
      "CRM-Kunde",
      row.customer_id
        ? link(row.customer_name || "Kunde", "#/customers/" + row.customer_id)
        : "Nicht zugeordnet",
    ],
    [
      "customer_service_id",
      "Angebot / Vorgang",
      row.customer_service_id
        ? link(
            row.service_name || row.relationship_name || "Angebot",
            "#/relationships/" + row.customer_service_id,
          )
        : "Nicht zugeordnet",
    ],
  ];
  const overrides = row.overrides || {};
  let rawJSON = row.extracted_json || "{}";
  try {
    rawJSON = JSON.stringify(JSON.parse(rawJSON), null, 2);
  } catch {}
  const nodes = [
    heading(
      invoiceLabel(row),
      `${categories[row.category]} · ${row.counterparty_name || "Firma noch nicht erkannt"}`,
      [
        fileLink(row),
        button(
          "Bearbeiten",
          () =>
            editInvoice(row, actions).catch((error) =>
              notice(error.message, "error"),
            ),
          { primary: true, iconName: "pen" },
        ),
      ],
    ),
    link("← Alle Rechnungen", "#/invoices"),
    ["failed", "missing", "pending"].includes(row.ingestion_status)
      ? el(
          "div",
          { class: "oj-alert oj-alert-warning", role: "status" },
          icon("triangle-exclamation"),
          " ",
          ingestion[row.ingestion_status],
          row.ingestion_status === "failed"
            ? ". Du kannst die Werte manuell bearbeiten oder die Verarbeitung erneut starten."
            : row.ingestion_status === "pending"
              ? ". Ohne OpenAI-Schlüssel bleiben die lokal erkannten Angaben zur manuellen Bearbeitung verfügbar."
              : ". Die gespeicherten Rechnungsdaten bleiben verfügbar.",
        )
      : null,
    panel(
      "Rechnungsdaten",
      el(
        "div",
        { class: "finance-detail-status" },
        el("span", { class: "oj-label" }, "Zahlungsstatus"),
        statusControl(row, actions),
      ),
      el(
        "dl",
        { class: "finance-invoice-facts" },
        fields.map(([name, label, value]) =>
          el(
            "div",
            {},
            el("dt", {}, label),
            el(
              "dd",
              {},
              el("span", { class: "finance-fact-value" }, value),
              Object.hasOwn(overrides, name)
                ? button(
                    "Korrektur zurücksetzen",
                    () => actions.financeReset(id, name),
                    { compact: true, iconName: "rotate-left" },
                  )
                : null,
            ),
          ),
        ),
      ),
      row.category === "payable"
        ? el(
            "div",
            { class: "oj-stack" },
            el("h3", { class: "oj-heading-4" }, "Ausgaben-Tags"),
            el(
              "div",
              { class: "finance-tag-options" },
              payableTags.map((tag) => {
                const selected = (row.tags || []).includes(tag);
                return el(
                  "button",
                  {
                    class: "oj-tag finance-tag-button",
                    type: "button",
                    "aria-pressed": String(selected),
                    onclick: () =>
                      actions.financePatch(id, {
                        tags: selected
                          ? row.tags.filter((value) => value !== tag)
                          : [...(row.tags || []), tag],
                      }),
                  },
                  selected ? icon("check") : icon("plus"),
                  " ",
                  tag,
                );
              }),
            ),
          )
        : null,
    ),
    panel(
      "Erkennung",
      facts([
        [
          "Verarbeitung",
          ingestion[row.ingestion_status] || row.ingestion_status,
        ],
        [
          "Sprache",
          { deu: "Deutsch", eng: "Englisch" }[row.document_language] ||
            row.document_language ||
            "–",
        ],
        [
          "Konfidenz",
          row.confidence_score === null || row.confidence_score === undefined
            ? "–"
            : new Intl.NumberFormat("de-AT", {
                style: "percent",
                maximumFractionDigits: 0,
              }).format(row.confidence_score),
        ],
        ["Datei", row.file_name || "–"],
        ["Historisch versendet am", dateLabel(row.send_date)],
      ]),
      row.extraction_notes
        ? el("p", { class: "note-text oj-small" }, row.extraction_notes)
        : null,
      el(
        "div",
        { class: "finance-actions" },
        button("Erneut verarbeiten", () => actions.financeReprocess(id), {
          disabled: !row.has_file,
          iconName: "rotate",
        }),
        Object.keys(overrides).length
          ? button(
              "Alle Korrekturen zurücksetzen",
              () => actions.financeReset(id),
              { iconName: "rotate-left" },
            )
          : null,
      ),
      el(
        "details",
        { class: "oj-accordion" },
        el("summary", {}, "Ausgelesener Text"),
        el(
          "div",
          { class: "oj-accordion-body" },
          el(
            "pre",
            { class: "finance-source-text oj-mono" },
            row.ocr_text || "Noch kein Text gespeichert.",
          ),
        ),
      ),
      el(
        "details",
        { class: "oj-accordion" },
        el("summary", {}, "Extraktions-JSON"),
        el(
          "div",
          { class: "oj-accordion-body" },
          el("pre", { class: "finance-source-text oj-mono" }, rawJSON),
        ),
      ),
    ),
    panel(
      "Verarbeitungsprotokoll",
      table(
        "Verarbeitungsprotokoll",
        ["Zeitpunkt", "Vorgang", "Status", "Meldung"],
        (logs.items || []).map((log) => [
          datetime(log.created_at),
          log.process_type,
          log.status,
          log.message || "–",
        ]),
      ),
    ),
    el(
      "div",
      { class: "finance-actions" },
      button("Rechnung löschen", () => actions.financeDelete(row), {
        danger: true,
        iconName: "trash",
      }),
    ),
  ];
  return disposable(nodes, actions);
}

export async function financeCustomers(
  actions,
  params = new URLSearchParams(),
) {
  const year = params.get("year") || String(new Date().getFullYear());
  const [data, rankings] = await Promise.all([
    api(financePath + "/customers"),
    api(financePath + "/revenue-overview", { query: { year } }),
  ]);
  const years = [...new Set([year, ...(rankings.years || [])])]
    .sort()
    .reverse();
  const search = params.get("search") || "",
    sort = params.get("sort") || "last_invoice_date",
    order = params.get("order") === "asc" ? "asc" : "desc",
    currency = params.get("currency") || "";
  const currencies = [
    ...new Set(
      data.items.flatMap((row) =>
        currencyMetrics(row).map((stat) => stat.currency),
      ),
    ),
  ].sort();
  const selectedCurrency =
    currency || (currencies.length === 1 ? currencies[0] : null);
  const rows = [...data.items].sort((a, b) => {
    const value = (row) =>
      sort === "lifetime_value"
        ? selectedCurrency
          ? currencyTotal(
              currencyMetrics(row).find(
                (stat) => stat.currency === selectedCurrency,
              ) || {},
            )
          : 0
        : sort === "days_since_last_invoice"
          ? row.last_invoice_date
            ? Date.now() - Date.parse(row.last_invoice_date)
            : -1
          : row[sort] || "";
    const left = value(a),
      right = value(b);
    return (
      (typeof left === "number"
        ? left - right
        : String(left).localeCompare(String(right), "de")) *
      (order === "asc" ? 1 : -1)
    );
  });
  const heads = [
    ["Kunde", "name"],
    ["Erste Rechnung", "first_invoice_date"],
    ["Letzte Rechnung", "last_invoice_date"],
    ["Umsatz gesamt", "lifetime_value"],
    ["Seit letzter Rechnung", "days_since_last_invoice"],
  ];
  const list = table(
    "Umsatz",
    heads.map(([label, key]) =>
      el(
        "button",
        {
          type: "button",
          class: "finance-sort",
          onclick: () =>
            routeFilter("/finance-customers", params, {
              sort: key,
              order: sort === key && order === "asc" ? "desc" : "asc",
            }),
          disabled: key === "lifetime_value" && !selectedCurrency,
        },
        label,
        sort === key
          ? icon(order === "asc" ? "arrow-up" : "arrow-down")
          : icon("sort"),
      ),
    ),
    rows.map((row) => [
      el(
        "div",
        { class: "finance-customer-identity" },
        customerLogo(row),
        link(row.name, "#/customers/" + row.id),
      ),
      dateLabel(row.first_invoice_date),
      dateLabel(row.last_invoice_date),
      el(
        "div",
        { class: "finance-money-list" },
        currencyMetrics(row)
          .filter((stat) => !currency || stat.currency === currency)
          .map((stat) => moneyCell(currencyTotal(stat), stat.currency)),
      ),
      customerDays(row),
    ]),
  );
  list
    .querySelectorAll("th")
    .forEach((head, index) =>
      head.setAttribute(
        "aria-sort",
        sort === heads[index][1]
          ? order === "asc"
            ? "ascending"
            : "descending"
          : "none",
      ),
    );
  const bodyRows = [...list.querySelectorAll("tbody tr")];
  const noResults = rows.length
    ? el(
        "tr",
        { hidden: true },
        el(
          "td",
          { colspan: heads.length, class: "oj-muted" },
          "Keine Kunden gefunden.",
        ),
      )
    : null;
  if (noResults) list.querySelector("tbody").append(noResults);
  function searchRows(value) {
    if (!rows.length) return;
    let matches = 0;
    bodyRows.forEach((node, index) => {
      node.hidden = !rows[index].name
        .toLocaleLowerCase()
        .includes(value.toLocaleLowerCase());
      if (!node.hidden) matches++;
    });
    noResults.hidden = matches > 0;
  }
  searchRows(search);
  return disposable(
    [
      heading("Umsatz", "Jahresranglisten und Rechnungsumsatz deiner Kunden."),
      el(
        "section",
        {
          class: "finance-rankings oj-stack",
          "aria-label": "Jahresranglisten",
        },
        el(
          "div",
          { class: "finance-ranking-year" },
          field("Jahr", "year", {
            options: years.map((value) => [value, value]),
            value: year,
            onchange: (event) =>
              routeFilter("/finance-customers", params, {
                year: event.target.value,
              }),
          }),
        ),
        el(
          "div",
          { class: "finance-summary-grid" },
          el(
            "div",
            { class: "finance-overall-revenue" },
            metric(
              "Gesamtumsatz",
              combinedAmount(rankings.overall_revenue),
              "Alle Einnahmenrechnungen, über alle Jahre" +
                (rankings.overall_revenue.amounts.length > 1
                  ? " · " +
                    rankings.overall_revenue.amounts
                      .map(({ currency }) => currency)
                      .join(" + ") +
                    ", ohne Währungsumrechnung"
                  : ""),
            ),
          ),
          topList("Beste Kunden · " + year, rankings.top_revenue || []),
          topList("Höchste Kosten · " + year, rankings.top_payable || []),
        ),
      ),
      el(
        "div",
        { class: "finance-filters" },
        field("Kunden suchen", "search", {
          type: "search",
          value: search,
          placeholder: "Kundenname",
          oninput: (event) => {
            const value = event.target.value;
            rememberSearch("/finance-customers", params, value);
            searchRows(value);
          },
        }),
        currencies.length > 1
          ? field("Währung", "currency", {
              options: [
                ["", "Alle Währungen"],
                ...currencies.map((value) => [value, value]),
              ],
              value: currency,
              helper: "Für die Umsatzsortierung eine Währung auswählen.",
              onchange: (event) =>
                routeFilter("/finance-customers", params, {
                  currency: event.target.value,
                }),
            })
          : null,
      ),
      list,
    ],
    actions,
  );
}

export function withFinanceRefresh(nodes, actions) {
  return disposable(nodes, actions);
}

export function customerFinanceSections(row, actions) {
  const enrichmentLabels = {
    pending: "Noch nicht geprüft",
    completed: "Ergänzt",
    failed: "Prüfung fehlgeschlagen",
    skipped: "Keine Angaben gefunden",
  };
  return [
    el(
      "div",
      { class: "finance-customer-metrics" },
      metric("Rechnungen", row.invoice_count || 0),
      metric("Seit letzter Rechnung", customerDays(row)),
      metric(
        "Kundenbeziehung",
        row.invoice_count
          ? `${row.active_months} ${row.active_months === 1 ? "Monat" : "Monate"}`
          : "–",
      ),
    ),
    ...currencyMetrics(row).map((stat) =>
      panel(
        "Umsatz · " + stat.currency,
        el(
          "div",
          { class: "finance-customer-metrics" },
          metric("Umsatz gesamt", money(currencyTotal(stat), stat.currency)),
          metric(
            "Pro aktivem Monat",
            money(currencyAverage(stat), stat.currency),
          ),
          metric("Noch offen", money(stat.open_amount_minor, stat.currency)),
        ),
      ),
    ),
    panel(
      "Rechnungsprofil",
      button("Rechnungsdaten bearbeiten", () => actions.financeProfile(row), {
        iconName: "pen",
      }),
      facts([
        [
          "Rechnungsadresse",
          el("span", { class: "note-text" }, row.billing_address || "–"),
        ],
        ["Haupt-E-Mail", row.general_email || "–"],
        ["Erste Rechnung", dateLabel(row.first_invoice_date)],
        ["Letzte Rechnung", dateLabel(row.last_invoice_date)],
        [
          "Automatische Ergänzung",
          enrichmentLabels[row.enrichment_status] || "Noch nicht geprüft",
        ],
      ]),
      button(
        "Angaben aus Rechnung ergänzen",
        () => actions.financeEnrich(row.id),
        { iconName: "wand-magic-sparkles", disabled: !row.latest_invoice_id },
      ),
      el(
        "p",
        { class: "oj-small oj-muted" },
        "Ergänzt fehlende Adresse und E-Mail aus der letzten Rechnung. Vorhandene Angaben bleiben erhalten.",
      ),
    ),
    panel("Rechnungen", invoiceTable(row.invoices || [], actions)),
  ];
}

export async function financeSettings(actions) {
  const row = await api(financePath + "/settings");
  const addressValue = String(row.company_address || "").replace(
    /\r?\n/g,
    ", ",
  );
  const models = row.models || [{ id: "gpt-4o-mini", label: "GPT-4o Mini" }];
  const error = el("p", {
    class: "oj-alert oj-alert-danger",
    role: "alert",
    hidden: true,
    tabindex: -1,
  });
  const save = el(
    "button",
    { type: "submit", class: "oj-button oj-button-primary" },
    "Einstellungen speichern",
  );
  const keyField = field("Neuer OpenAI-Schlüssel", "openai_api_key", {
    type: "password",
    autocomplete: "off",
    placeholder: row.openai_api_key_present
      ? "Gespeicherten Schlüssel ersetzen"
      : "sk-…",
    helper:
      "Der Schlüssel bleibt auf deinem Rechner und wird nicht an den Browser zurückgegeben.",
  });
  const form = el(
    "form",
    {
      class: "finance-settings-form oj-stack",
      onsubmit: async (event) => {
        event.preventDefault();
        if (save.disabled) return;
        error.hidden = true;
        save.disabled = true;
        save.setAttribute("aria-busy", "true");
        try {
          const body = Object.fromEntries(new FormData(form));
          if (body.company_address === addressValue)
            body.company_address = row.company_address || "";
          if (!body.openai_api_key) delete body.openai_api_key;
          await api(financePath + "/settings", { method: "PATCH", body });
          notice("Finanz-Einstellungen gespeichert.");
          await actions.financeRefresh();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          error.focus();
        } finally {
          save.disabled = false;
          save.removeAttribute("aria-busy");
        }
      },
    },
    panel(
      "Rechnungsordner",
      el(
        "p",
        { class: "oj-small oj-muted" },
        "Absolute Ordnerpfade auf diesem Rechner. PDFs werden beim Start und bei Änderungen eingelesen, bis zu zwei Unterordner tief.",
      ),
      el(
        "div",
        { class: "finance-form-grid" },
        field("Einnahmen-Ordner", "revenue_folder", {
          value: row.revenue_folder || "",
          placeholder: "/Users/…/Rechnungen/Einnahmen",
          wide: true,
        }),
        field("Ausgaben-Ordner", "payable_folder", {
          value: row.payable_folder || "",
          placeholder: "/Users/…/Rechnungen/Ausgaben",
          wide: true,
        }),
      ),
    ),
    panel(
      "Eigene Firma",
      el(
        "p",
        { class: "oj-small oj-muted" },
        "Diese Angaben werden vor der automatischen Erkennung aus dem Rechnungstext entfernt, damit die Kundenangaben erkannt werden.",
      ),
      el(
        "div",
        { class: "finance-form-grid" },
        field("Firmenname", "company_name", {
          value: row.company_name || "",
          maxlength: 200,
        }),
        field("Firmen-E-Mail", "company_email", {
          type: "email",
          value: row.company_email || "",
          maxlength: 200,
        }),
        field("Firmenadresse", "company_address", {
          type: "text",
          value: addressValue,
          maxlength: 2000,
          wide: true,
        }),
      ),
    ),
    panel(
      "Automatische Erkennung",
      el(
        "p",
        { class: "oj-small" },
        "OpenAI: ",
        row.openai_api_key_error
          ? el(
              "span",
              { class: "oj-badge oj-badge-warning" },
              "Erneut einrichten",
            )
          : row.openai_api_key_present
            ? el(
                "span",
                { class: "oj-badge oj-badge-success" },
                "Gespeichert · •••• " + (row.openai_api_key_last4 || ""),
              )
            : el(
                "span",
                { class: "oj-badge oj-badge-neutral" },
                "Nicht konfiguriert",
              ),
      ),
      row.openai_api_key_error
        ? el(
            "p",
            { class: "oj-alert oj-alert-warning", role: "status" },
            "Der gespeicherte Schlüssel ist auf dieser Datenbank nicht lesbar. Bitte erneut eingeben.",
          )
        : null,
      keyField,
      field("Erkennungsmodell", "model", {
        value: row.model || "gpt-4o-mini",
        options: models.map(({ id, label }) => [id, label]),
        helper:
          "Wird für die Rechnungserkennung und das Ergänzen der Kundendaten verwendet.",
      }),
      el(
        "p",
        { class: "oj-small oj-muted" },
        "Nur beim Import, erneuten Verarbeiten oder Ergänzen der Kundendaten wird der bereinigte Rechnungstext an OpenAI gesendet. Rechnungen lassen sich jederzeit manuell bearbeiten.",
      ),
      el(
        "div",
        { class: "finance-actions" },
        button(
          "Schlüssel prüfen",
          async (event) => {
            const control = event.currentTarget;
            control.disabled = true;
            try {
              await actions.financeKeyTest(
                form.elements.namedItem("openai_api_key").value.trim(),
                form.elements.namedItem("model").value,
              );
            } finally {
              control.disabled = false;
            }
          },
          {
            iconName: "check",
            disabled:
              !row.openai_api_key_present &&
              !keyField.querySelector("input").value,
          },
        ),
        row.openai_api_key_present
          ? button("Schlüssel entfernen", () => actions.financeKeyRemove(), {
              danger: true,
              iconName: "trash",
            })
          : null,
      ),
    ),
    error,
    el("div", { class: "finance-actions" }, save),
  );
  keyField.querySelector("input").addEventListener("input", () => {
    const test = keyField.parentNode.querySelector("button");
    if (test)
      test.disabled =
        !row.openai_api_key_present &&
        !keyField.querySelector("input").value.trim();
  });
  const tools = row.tools || {},
    watcher = row.watcher || {};
  return [
    heading(
      "Einstellungen",
      "Rechnungsordner, Firmenangaben und automatische Erkennung.",
    ),
    form,
    panel(
      "Ordnerüberwachung",
      facts([
        ["Status", watcher.running ? "Aktiv" : "Keine Ordner aktiv"],
        [
          "Letzter Scan",
          watcher.last_scan ? datetime(watcher.last_scan) : "Noch kein Scan",
        ],
        ["PDF-Text", tools.text ? "Verfügbar" : "Nicht verfügbar"],
        ["OCR", tools.ocr ? "Verfügbar" : "Nicht verfügbar"],
        [
          "Erkennungsmodell",
          models.find(({ id }) => id === row.model)?.label || "GPT-4o Mini",
        ],
      ]),
      watcher.error
        ? el(
            "p",
            { class: "oj-alert oj-alert-warning", role: "status" },
            watcher.error,
          )
        : null,
      button("Ordner jetzt einlesen", () => actions.financeScan(), {
        iconName: "folder-open",
      }),
    ),
    el(
      "p",
      { class: "finance-app-version oj-small oj-muted" },
      "Version ",
      row.app_version || "–",
    ),
  ];
}
