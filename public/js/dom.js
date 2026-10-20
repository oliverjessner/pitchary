import { api } from "./api.js";
const pitchChannels = await api("/pitch-channels");
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on"))
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (
      [
        "value",
        "checked",
        "disabled",
        "required",
        "hidden",
        "autofocus",
      ].includes(key)
    )
      node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== undefined && child !== null && child !== false)
      node.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  }
  return node;
}
export const icon = (name) =>
  el("i", { class: "fa-solid fa-" + name, "aria-hidden": "true" });
export const link = (label, href) => el("a", { class: "oj-link", href }, label);
export const button = (
  label,
  action,
  {
    primary = false,
    danger = false,
    compact = false,
    iconName,
    disabled = false,
  } = {},
) =>
  el(
    "button",
    {
      type: "button",
      class: `oj-button oj-button-${primary ? "primary" : danger ? "danger" : "secondary"}${compact ? " oj-button-compact" : ""}`,
      onclick: (event) => {
        event.currentTarget.focus({ preventScroll: true });
        action(event);
      },
      disabled,
    },
    iconName ? icon(iconName) : null,
    label,
  );
export const labels = {
  status: {
    open: "Offen",
    pitched: "Gepitcht",
    accepted: "Angenommen",
    done: "Erledigt",
    ghosted: "Ghosted",
    rejected: "Abgelehnt",
  },
  channel: Object.fromEntries(
    pitchChannels.map(({ id, label }) => [id, label]),
  ),
  billing: {
    one_time: "Einmalig",
    monthly: "Monatlich",
    yearly: "Jährlich",
    hourly: "Pro Stunde",
    daily: "Pro Tag",
  },
  activity: {
    pitch: "Pitch",
    follow_up: "Follow-up",
    call: "Telefonat",
    meeting: "Meeting",
    note: "Notiz",
    price_change: "Preisänderung",
  },
  reason: {
    budget: "Budget",
    timing: "Zeitpunkt",
    competitor: "Mitbewerber",
    no_need: "Kein Bedarf",
    no_response: "Keine Rückmeldung",
    other: "Sonstiges",
  },
};
export const transitions = {
  open: ["pitched"],
  pitched: ["accepted", "ghosted", "rejected"],
  ghosted: ["pitched", "accepted", "rejected"],
  accepted: ["done"],
  done: [],
  rejected: ["pitched"],
};
export const money = (value, currency = "EUR") =>
  value === null || value === undefined
    ? "–"
    : new Intl.NumberFormat("de-AT", { style: "currency", currency }).format(
        value / 100,
      );
export const decimal = (value) =>
  value === null || value === undefined
    ? ""
    : `${Math.trunc(value / 100)},${String(value % 100).padStart(2, "0")}`;
export function minor(value) {
  const normalized = String(value).trim().replace(",", ".");
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(normalized))
    throw new Error(
      "Preis mit maximal zwei Nachkommastellen eingeben, z. B. 1200,50.",
    );
  const [whole, fraction = ""] = normalized.split(".");
  const amount = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
  if (amount > 1000000000000) throw new Error("Preis ist zu groß.");
  return amount;
}
export const datetime = (value) =>
  value
    ? new Intl.DateTimeFormat("de-AT", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "–";
export const duration = (ms) =>
  ms === null
    ? "–"
    : new Intl.NumberFormat("de-AT", { maximumFractionDigits: 1 }).format(
        ms / 86400000,
      ) + " Tage";
export const age = (value) =>
  duration(Math.max(0, Date.now() - Date.parse(value)));
export const percent = (value) =>
  value === null
    ? "–"
    : new Intl.NumberFormat("de-AT", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
export const statusBadge = (value) =>
  el(
    "span",
    {
      class:
        "oj-badge oj-badge-" +
        {
          open: "neutral",
          pitched: "info",
          ghosted: "warning",
          accepted: "success",
          done: "success",
          rejected: "danger",
        }[value],
    },
    labels.status[value],
  );
let fieldNumber = 0;
export function field(
  label,
  name,
  {
    type = "text",
    value = "",
    required = false,
    options,
    wide = false,
    helper,
    ...extra
  } = {},
) {
  const id = "field-" + name + "-" + ++fieldNumber;
  const control = options
    ? el(
        "select",
        { id, name, class: "oj-select", required, ...extra },
        options.map(([v, l]) => el("option", { value: v }, l)),
      )
    : type === "textarea"
      ? el(
          "textarea",
          { id, name, class: "oj-textarea", rows: 3, required, ...extra },
          value,
        )
      : el("input", {
          id,
          name,
          type,
          class: "oj-input",
          value,
          required,
          ...extra,
        });
  if (options) control.value = value;
  if (helper) control.setAttribute("aria-describedby", id + "-help");
  return el(
    "div",
    { class: "oj-field" + (wide ? " wide" : "") },
    el("label", { class: "oj-label", for: id }, label),
    options
      ? el(
          "div",
          { class: "app-select-control" },
          control,
          icon("chevron-down"),
        )
      : control,
    helper ? el("p", { id: id + "-help", class: "oj-helper" }, helper) : null,
  );
}
export const options = (map, empty) => [
  ...(empty !== undefined ? [["", empty]] : []),
  ...Object.entries(map),
];
export function selectField(...args) {
  return field(...args);
}
export function table(caption, headers, rows) {
  return el(
    "div",
    {
      class: "oj-table-container",
      role: "region",
      "aria-label": caption,
      tabindex: 0,
    },
    el(
      "table",
      { class: "oj-table oj-table-hover oj-table-compact" },
      el("caption", { class: "oj-sr-only" }, caption),
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          headers.map((h) => el("th", { scope: "col" }, h)),
        ),
      ),
      el(
        "tbody",
        {},
        rows.length
          ? rows.map((row) =>
              el(
                "tr",
                {},
                row.map((c) => el("td", {}, c)),
              ),
            )
          : el(
              "tr",
              {},
              el(
                "td",
                { colspan: headers.length, class: "oj-muted" },
                "Keine Einträge.",
              ),
            ),
      ),
    ),
  );
}
export function panel(title, ...content) {
  return el(
    "section",
    { class: "oj-panel oj-stack" },
    el("h2", { class: "oj-heading-3" }, title),
    ...content,
  );
}
export function heading(title, subtitle, actions = []) {
  return el(
    "header",
    { class: "oj-section-header" },
    el(
      "div",
      {},
      el("h1", { class: "oj-heading-1 page-title", tabindex: -1 }, title),
      subtitle ? el("p", { class: "oj-muted page-subtitle" }, subtitle) : null,
    ),
    el("div", { class: "section-actions" }, actions),
  );
}
export function metric(label, value, helper) {
  return el(
    "div",
    { class: "oj-panel oj-metric oj-metric-card" },
    el("p", { class: "oj-metric-label" }, label),
    el("p", { class: "oj-metric-value" }, value),
    helper ? el("p", { class: "oj-metric-hint" }, helper) : null,
  );
}
export function empty(title, message, action) {
  return el(
    "section",
    { class: "oj-panel oj-empty-state empty-panel" },
    icon("folder-open"),
    el("h2", { class: "oj-heading-3" }, title),
    el("p", { class: "oj-muted" }, message),
    action,
  );
}
export const facts = (entries) =>
  el(
    "dl",
    { class: "facts" },
    entries.map(([label, value]) =>
      el("div", {}, el("dt", {}, label), el("dd", {}, value)),
    ),
  );
