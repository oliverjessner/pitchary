import { t, getLocale, localizedMessage } from "./i18n.js";
import { api } from "./api.js";
import { formatDate } from "./calendar.js";
import {
  financeDashboard,
  customerFinanceSections,
  withFinanceRefresh,
} from "./finance.js";
import {
  customerIdentity,
  customerLogo,
  customerProfile,
} from "./customer-branding.js";
import { tagBadge, tagList, tagFilter } from "./service-tags.js";
import { readFilters, saveFilters, selectedTags } from "./filter-state.js";
import {
  el,
  icon,
  link,
  button,
  labels,
  options,
  field,
  selectField,
  table,
  sortableTable,
  panel,
  heading,
  metric,
  empty,
  facts,
  money,
  datetime,
  duration,
  age,
  percent,
  statusBadge,
  transitions,
} from "./dom.js";
const employeeLink = (name, id, fallback = "–") =>
  id && name ? link(name, "#/employees/" + id) : (name ?? fallback);
const tagNames = (tags = []) => tags.map((tag) => tag.name).join(", ");
const priceChangeText = (event, currency) =>
  t(
    event.price_field === "accepted_price_minor"
      ? "Vereinbart: {previous} → {next}"
      : "Angebot: {previous} → {next}",
    {
      previous: money(event.previous_price_minor, currency),
      next: money(event.new_price_minor, currency),
    },
  );
function offerTable(rows) {
  return table(
    t("Angebote"),
    [
      t("Dienstleistung / Kunde"),
      t("Status"),
      t("Angebotspreis"),
      t("Vereinbart"),
      t("Ansprechpartner"),
      t("Aktuelle Phase"),
    ],
    rows.map((r) => [
      el(
        "div",
        {},
        link(r.service_name, "#/relationships/" + r.id),
        el(
          "div",
          { class: "oj-small oj-muted" },
          r.customer_name,
          r.archived_at ? " · " + t("Archiviert") : "",
        ),
      ),
      statusBadge(r.status),
      el(
        "div",
        { class: "oj-mono" },
        money(r.current_offered_price_minor, r.currency),
        el(
          "div",
          { class: "oj-small oj-muted" },
          labels.billing[r.billing_type],
        ),
      ),
      el(
        "span",
        { class: "oj-mono" },
        money(r.accepted_price_minor, r.currency),
      ),
      employeeLink(r.employee_name, r.primary_employee_id),
      el(
        "div",
        { class: "phase-duration" },
        age(r.status_since),
        el("div", { class: "oj-small oj-muted" }, datetime(r.status_since)),
      ),
    ]),
  );
}
function timeline(row, { newestFirst = false, showService = false } = {}) {
  const events = [
    ...row.history.map((h, i) => ({ kind: "status", ...h, order: i })),
    ...row.activities.map((a, i) => ({ kind: "activity", ...a, order: -i })),
  ].sort(
    (a, b) =>
      (a.occurred_at.localeCompare(b.occurred_at) ||
        (a.recorded_at ?? a.created_at).localeCompare(
          b.recorded_at ?? b.created_at,
        ) ||
        a.order - b.order) * (newestFirst ? -1 : 1),
  );
  return el(
    "ol",
    { class: "timeline", role: "list" },
    events.map((event) => {
      let title, note;
      if (event.kind === "status") {
        title = event.from_status
          ? labels.status[event.from_status] +
            " → " +
            labels.status[event.to_status]
          : t("Angelegt · {status}", {
              status: labels.status[event.to_status],
            });
        note = event.reason;
        if (note?.startsWith("{")) {
          try {
            const reason = JSON.parse(note);
            note =
              labels.reason[reason.code] +
              (reason.note ? " · " + reason.note : "");
          } catch {}
        }
      } else {
        title = labels.activity[event.type];
        note = event.note;
        if (event.type === "price_change")
          title +=
            " · " + priceChangeText(event, event.currency ?? row.currency);
      }
      return el(
        "li",
        {},
        el(
          "div",
          { class: "timeline-meta oj-small oj-muted" },
          el(
            "time",
            { datetime: event.occurred_at },
            datetime(event.occurred_at),
          ),
          event.channel ? " · " + labels.channel[event.channel] : null,
          event.employee_name
            ? [" · ", employeeLink(event.employee_name, event.employee_id)]
            : null,
        ),
        showService
          ? el(
              "p",
              { class: "oj-small" },
              link(
                event.service_name,
                "#/relationships/" + event.customer_service_id,
              ),
              event.relationship_archived_at
                ? " · " + t("Archiviertes Angebot")
                : null,
            )
          : null,
        el("p", { class: "timeline-title" }, title),
        note ? el("p", { class: "note-text oj-small" }, note) : null,
      );
    }),
  );
}
function statusActions(row, actions, { card = false } = {}) {
  return (transitions[row.status] ?? []).map((to, index) => {
    const action = button(
      to === "pitched" && ["rejected", "ghosted"].includes(row.status)
        ? t("Wieder aufnehmen")
        : to === "pitched"
          ? t("Pitch erfassen")
          : to === "accepted"
            ? t("Zusage erfassen")
            : to === "ghosted"
              ? t("Als Ghosted markieren")
              : to === "done"
                ? t("Als erledigt markieren")
                : t("Ablehnen"),
      () => actions.status(row, to),
      {
        primary: card ? index === 0 : !["rejected", "ghosted"].includes(to),
        compact: !card || index > 0,
      },
    );
    if (card && index === 0) action.classList.add("offer-card-next");
    return action;
  });
}
function pipelineCard(row, actions) {
  const won = ["accepted", "done"].includes(row.status);
  const controls = row.archived_at
    ? [
        button(
          t("Wiederherstellen"),
          () => actions.archive("customer-services", row, true),
          { iconName: "rotate-left" },
        ),
      ]
    : statusActions(row, actions, { card: true });
  if (!row.archived_at && row.status === "rejected")
    controls.push(
      button(
        t("Archivieren"),
        () => actions.archive("customer-services", row),
        {
          compact: true,
          iconName: "box-archive",
        },
      ),
    );
  if (row.archived_at) controls[0].classList.add("offer-card-next");
  return el(
    "article",
    { class: "oj-panel offer-card" },
    el(
      "header",
      { class: "offer-card-heading" },
      el(
        "p",
        { class: "oj-small oj-muted offer-card-customer" },
        customerLogo({
          name: row.customer_name,
          logo_url: row.customer_logo_url,
        }),
        el("span", { class: "offer-card-customer-name" }, row.customer_name),
      ),
      el(
        "h3",
        { class: "offer-card-title" },
        link(row.service_name, "#/relationships/" + row.id),
      ),
    ),
    el(
      "div",
      { class: "offer-card-pricing" },
      el(
        "p",
        { class: "oj-mono offer-card-price" },
        money(
          won ? row.accepted_price_minor : row.current_offered_price_minor,
          row.currency,
        ),
      ),
      el(
        "p",
        { class: "oj-small oj-muted" },
        labels.billing[row.billing_type] +
          " · " +
          (won ? t("Vereinbart") : t("Angebotspreis")),
      ),
    ),
    el(
      "div",
      { class: "offer-card-details oj-small oj-muted" },
      el(
        "p",
        {},
        icon("user"),
        employeeLink(
          row.employee_name,
          row.primary_employee_id,
          t("Kein Ansprechpartner"),
        ),
      ),
      el(
        "p",
        {},
        icon("clock"),
        el(
          "span",
          {},
          t("{duration} im Status", { duration: age(row.status_since) }),
        ),
      ),
    ),
    controls.length
      ? el("footer", { class: "offer-card-actions" }, controls)
      : null,
  );
}
function activityList(items) {
  return el(
    "ul",
    { class: "small-list" },
    items.map((a) =>
      el(
        "li",
        {},
        link(
          labels.activity[a.type] + " · " + a.customer_name,
          "#/relationships/" + a.customer_service_id,
        ),
        el(
          "p",
          { class: "oj-small oj-muted" },
          a.service_name + " · " + datetime(a.occurred_at),
        ),
        el("p", { class: "oj-small note-text" }, a.note),
      ),
    ),
  );
}
function entityState(row, type, actions) {
  return row.archived_at
    ? [button(t("Wiederherstellen"), () => actions.archive(type, row, true))]
    : [
        button(t("Bearbeiten"), () => actions.entity(type, row), {
          iconName: "pen",
        }),
        button(t("Archivieren"), () => actions.archive(type, row), {
          iconName: "box-archive",
        }),
      ];
}
export async function dashboard(actions, params) {
  const [analytics, rows] = await Promise.all([
    api("/analytics"),
    api("/customer-services"),
  ]);
  const s = analytics.summary;
  const finances = await financeDashboard(actions, params);
  const content = [
    heading(t("Dashboard")),
    ...finances,
    el(
      "div",
      { class: "metrics-grid dashboard-metrics" },
      metric(
        t("Angebote gesamt"),
        s.created,
        t("Alle Vorgänge, einschließlich Archiv"),
      ),
      metric(t("Tatsächlich gepitcht"), s.pitched),
      metric(t("Gewonnene Angebote"), s.won, t("Angenommen und erledigt")),
      metric(
        t("Abschlussquote"),
        percent(s.win_rate),
        t("Unter entschiedenen Angeboten"),
      ),
    ),
    rows.length
      ? panel(t("Neueste Angebote"), offerTable(rows.slice(0, 6)))
      : empty(
          t("Dein CRM ist bereit"),
          t("Lege zuerst einen Kunden und eine Dienstleistung an."),
          button(t("Kunde anlegen"), () => actions.entity("customers"), {
            primary: true,
          }),
        ),
  ];
  content.dispose = () => finances.dispose?.();
  return content;
}
export async function entityList(type, actions) {
  const saved = readFilters(type);
  const isCustomer = type === "customers";
  const title = isCustomer ? t("Kunden") : t("Dienstleistungen");
  const sorting = { sort: "name", order: "asc" };
  let archiveMode = saved.archived === "true";
  const search = field(t("Suchen"), "search", {
      type: "search",
      value: typeof saved.search === "string" ? saved.search : "",
      placeholder: isCustomer
        ? t("Name, Website, E-Mail, Notiz oder Tag")
        : t("Dienstleistung, URL, Notiz oder Tag"),
    }),
    archived = selectField(t("Ansicht"), "archived", {
      value: String(archiveMode),
      options: [
        ["false", t("Aktiv")],
        ["true", t("Archiviert")],
      ],
    }),
    customerType = isCustomer
      ? selectField(t("Status"), "customer_type", {
          value: ["customer", "lead"].includes(saved.customer_type)
            ? saved.customer_type
            : "",
          options: [
            ["", t("Alle")],
            ["customer", t("Kunden")],
            ["lead", t("Leads")],
          ],
        })
      : null,
    content = el("div", {}),
    count = el("p", { class: "oj-small oj-muted", role: "status" });
  let [rows, tags] = await Promise.all([
    api("/" + type, { query: { archived: archiveMode } }),
    api("/service-tags"),
  ]);
  const tagSelection = tagFilter(
    tags,
    () => render(),
    selectedTags(tags, saved),
    {
      description: isCustomer
        ? t("Zeigt Unternehmen mit mindestens einem ausgewählten Tag.")
        : t("Zeigt Dienstleistungen mit mindestens einem ausgewählten Tag."),
    },
  );
  let generation = 0;
  function render() {
    const term = search
      .querySelector("input")
      .value.toLocaleLowerCase(getLocale());
    const selectedType = customerType?.querySelector("select").value;
    const selectedTags = tagSelection.value();
    saveSelection();
    const filtered = rows.filter(
      (r) =>
        (!selectedType || r.customer_type === selectedType) &&
        (!selectedTags.length ||
          (r.tags ?? []).some((tag) => selectedTags.includes(tag.id))) &&
        (
          r.name +
          " " +
          r.note +
          " " +
          (r.website ?? "") +
          " " +
          (r.url ?? "") +
          " " +
          (r.general_email ?? "") +
          " " +
          (r.tags ?? []).map((tag) => tag.name).join(" ")
        )
          .toLocaleLowerCase(getLocale())
          .includes(term),
    );
    count.textContent = t(
      isCustomer ? "{count} Kunden" : "{count} Dienstleistungen",
      {
        count: filtered.length,
      },
    );
    const renderRow = (r) => [
      isCustomer ? customerIdentity(r) : link(r.name, "#/" + type + "/" + r.id),
      ...(isCustomer
        ? [
            el(
              "span",
              {
                class:
                  "oj-badge customer-type oj-badge-" +
                  (r.customer_type === "customer" ? "success" : "neutral"),
                title:
                  r.customer_type === "customer"
                    ? t("Bereits eine Einnahmenrechnung gestellt")
                    : t("Noch keine Einnahmenrechnung gestellt"),
              },
              r.customer_type === "customer" ? t("Kunde") : t("Lead"),
            ),
          ]
        : []),
      tagList(r.tags) ?? "–",
      ...(!isCustomer ? [String(r.pitched_count ?? 0)] : []),
      el("span", { class: "note-text oj-small" }, r.note || "–"),
      datetime(r.created_at),
      archiveMode
        ? button(t("Wiederherstellen"), () => actions.archive(type, r, true), {
            compact: true,
          })
        : button(t("Bearbeiten"), () => actions.entity(type, r), {
            compact: true,
          }),
    ];
    const directory = sortableTable(
      title,
      [
        { label: t("Name"), key: "name" },
        ...(isCustomer
          ? [
              {
                label: t("Status"),
                key: "customer_type",
                value: (row) =>
                  row.customer_type === "customer" ? t("Kunde") : t("Lead"),
              },
            ]
          : []),
        { label: t("Tags"), key: "tags", value: (row) => tagNames(row.tags) },
        ...(!isCustomer
          ? [
              {
                label: t("Pitched"),
                key: "pitched_count",
                value: (row) => row.pitched_count ?? 0,
              },
            ]
          : []),
        { label: t("Notiz"), key: "note" },
        {
          label: t("Angelegt"),
          key: "created_at",
          value: (row) => Date.parse(row.created_at),
        },
        { label: t("Aktionen") },
      ],
      filtered,
      renderRow,
      sorting,
    );
    directory.classList.add(
      isCustomer ? "customer-directory-table" : "service-directory-table",
    );
    content.replaceChildren(directory);
  }
  search.querySelector("input").addEventListener("input", render);
  function saveSelection() {
    saveFilters(type, {
      search: search.querySelector("input").value,
      archived: archived.querySelector("select").value,
      customer_type: customerType?.querySelector("select").value || "",
      tagIds: tagSelection.value(),
    });
  }
  customerType?.querySelector("select").addEventListener("change", render);
  archived.querySelector("select").addEventListener("change", async () => {
    archiveMode = archived.querySelector("select").value === "true";
    saveSelection();
    const token = ++generation;
    try {
      const data = await api("/" + type, { query: { archived: archiveMode } });
      if (token === generation) {
        rows = data;
        render();
      }
    } catch (error) {
      content.replaceChildren(
        el(
          "p",
          { class: "oj-alert oj-alert-danger", role: "alert" },
          localizedMessage(error.message),
        ),
      );
    }
  });
  render();
  const result = [
    heading(
      title,
      isCustomer
        ? t("Kunden und ihre Ansprechpartner an einem Ort.")
        : t("Wiederverwendbare Leistungen mit eigenständigen Angeboten."),
      [
        button(t("Tags verwalten"), () => actions.manageTags(type), {
          iconName: "tags",
        }),
        button(
          isCustomer ? t("Kunde anlegen") : t("Dienstleistung anlegen"),
          () => actions.entity(type),
          { primary: true, iconName: "plus" },
        ),
      ],
    ),
    el(
      "div",
      { class: "filters" },
      search,
      customerType,
      tagSelection.node,
      archived,
    ),
    count,
    content,
  ];
  result.dispose = () => {
    generation++;
    tagSelection.dispose();
  };
  return result;
}
export async function customerDetail(id, actions) {
  const [row, finance] = await Promise.all([
    api("/customers/" + id),
    api("/finance/customers/" + id),
  ]);
  const profile = customerProfile(row);
  const controls = entityState(row, "customers", actions);
  if (profile.refetchButton) controls.splice(1, 0, profile.refetchButton);
  const employees = [...row.employees, ...row.archived_employees];
  const contactsTable = table(
    t("Mitarbeiter"),
    [t("Name"), t("E-Mail"), t("LinkedIn"), t("Position"), t("Aktionen")],
    employees.map((e) => [
      el(
        "div",
        {},
        employeeLink(e.name, e.id),
        e.archived_at
          ? el("span", { class: "oj-badge" }, t("Archiviert"))
          : null,
      ),
      e.email ? link(e.email, "mailto:" + e.email) : "–",
      e.linkedin
        ? el(
            "a",
            {
              class: "oj-link",
              href: e.linkedin,
              target: "_blank",
              rel: "noopener noreferrer",
            },
            t("LinkedIn"),
            icon("arrow-up-right-from-square"),
          )
        : "–",
      e.position || "–",
      el(
        "div",
        { class: "section-actions" },
        e.archived_at
          ? button(
              t("Wiederherstellen"),
              () => actions.archive("employees", e, true),
              { compact: true },
            )
          : [
              button(t("Bearbeiten"), () => actions.entity("employees", e), {
                compact: true,
              }),
              button(t("Archivieren"), () => actions.archive("employees", e), {
                compact: true,
              }),
            ],
      ),
    ]),
  );
  contactsTable.classList.add("customer-contacts-table");
  const content = [
    heading(
      row.name,
      row.archived_at ? t("Archivierter Kunde") : t("Kundendetails"),
      controls,
    ),
    profile.node,
    row.note
      ? panel(t("Notiz"), el("p", { class: "note-text" }, row.note))
      : null,
    panel(
      t("Tags"),
      !row.archived_at
        ? button(
            t("Tags bearbeiten"),
            () => actions.assignTags(row, "customers"),
            { iconName: "tags" },
          )
        : null,
      tagList(row.tags) ??
        el("p", { class: "oj-muted" }, t("Noch keine Tags zugewiesen.")),
    ),
    panel(
      t("Mitarbeiter"),
      !row.archived_at
        ? el(
            "div",
            { class: "section-actions" },
            button(
              t("Mitarbeiter anlegen"),
              () => actions.entity("employees", { customer_id: row.id }),
              { primary: true, iconName: "plus" },
            ),
          )
        : null,
      contactsTable,
    ),
    panel(
      t("Angebote & Beziehungshistorie"),
      !row.archived_at
        ? el(
            "div",
            { class: "section-actions" },
            button(t("Neues Angebot"), () => actions.offer({ customer: row }), {
              primary: true,
              iconName: "plus",
            }),
          )
        : null,
      el(
        "p",
        { class: "oj-small oj-muted" },
        t(
          "Jedes Angebot führt einen eigenen Verlauf. Öffne eine Dienstleistung für die vollständige Timeline.",
        ),
      ),
      offerTable(row.relationships),
    ),
    row.relationships.length
      ? panel(
          t("Bisheriger Beziehungsverlauf"),
          row.relationships.map((r) =>
            el(
              "details",
              { class: "oj-accordion" },
              el(
                "summary",
                {},
                r.service_name +
                  " · " +
                  labels.status[r.status] +
                  " · " +
                  r.id.slice(0, 8),
              ),
              el(
                "div",
                { class: "oj-accordion-body oj-stack" },
                link(t("Angebot öffnen"), "#/relationships/" + r.id),
                timeline(r),
              ),
            ),
          ),
        )
      : null,
    ...customerFinanceSections(finance, actions),
  ];
  return withFinanceRefresh(content, actions);
}
export async function employeeList() {
  const saved = readFilters("employees");
  const sorting = { sort: "name", order: "asc" };
  const search = field(t("Personen suchen"), "search", {
    type: "search",
    value: typeof saved.search === "string" ? saved.search : "",
    placeholder: t("Name, Unternehmen, Position, E-Mail oder Tag"),
  });
  const archived = selectField(t("Ansicht"), "archived", {
    value: saved.archived === "true" ? "true" : "false",
    options: [
      ["false", t("Aktiv")],
      ["true", t("Archiviert")],
    ],
  });
  const input = search.querySelector("input");
  const archiveSelect = archived.querySelector("select");
  const count = el("p", { class: "oj-small oj-muted", role: "status" });
  const content = el("div", {});
  let [rows, tags] = await Promise.all([
    api("/employees", { query: { archived: archiveSelect.value } }),
    api("/service-tags"),
  ]);
  const tagSelection = tagFilter(
    tags,
    () => render(),
    selectedTags(tags, saved),
    {
      description: t(
        "Zeigt Personen, deren Unternehmen mindestens einen ausgewählten Tag hat.",
      ),
    },
  );
  let generation = 0;
  let loading = false;
  function saveSelection() {
    saveFilters("employees", {
      search: input.value,
      archived: archiveSelect.value,
      tagIds: tagSelection.value(),
    });
  }
  function render() {
    saveSelection();
    if (loading) return;
    const term = input.value.trim().toLocaleLowerCase(getLocale());
    const selectedTags = tagSelection.value();
    const filtered = rows.filter(
      (row) =>
        (!selectedTags.length ||
          (row.customer_tags ?? []).some((tag) =>
            selectedTags.includes(tag.id),
          )) &&
        [
          row.name,
          row.customer_name,
          row.position,
          row.email,
          row.linkedin,
          ...(row.customer_tags ?? []).map((tag) => tag.name),
        ]
          .join(" ")
          .toLocaleLowerCase(getLocale())
          .includes(term),
    );
    count.textContent = t(
      filtered.length === 1 ? "{count} Person" : "{count} Personen",
      {
        count: filtered.length,
      },
    );
    const directory = filtered.length
      ? sortableTable(
          t("Personen"),
          [
            { label: t("Name"), key: "name" },
            { label: t("Unternehmen"), key: "customer_name" },
            {
              label: t("Tags"),
              key: "customer_tags",
              value: (row) => tagNames(row.customer_tags),
            },
            { label: t("Position"), key: "position" },
            { label: t("E-Mail"), key: "email" },
            {
              label: t("Angelegt"),
              key: "created_at",
              value: (row) => Date.parse(row.created_at),
            },
          ],
          filtered,
          (row) => [
            employeeLink(row.name, row.id),
            el(
              "div",
              {},
              link(row.customer_name, "#/customers/" + row.customer_id),
              row.customer_archived_at
                ? el(
                    "p",
                    { class: "oj-small oj-muted" },
                    t("Archiviertes Unternehmen"),
                  )
                : null,
            ),
            tagList(row.customer_tags) ?? "–",
            row.position || "–",
            row.email ? link(row.email, "mailto:" + row.email) : "–",
            datetime(row.created_at),
          ],
          sorting,
        )
      : empty(
          term || selectedTags.length
            ? t("Keine Personen gefunden")
            : archiveSelect.value === "true"
              ? t("Keine archivierten Personen")
              : t("Noch keine Personen"),
          term || selectedTags.length
            ? t(
                "Versuche einen anderen Suchbegriff oder ändere die Tag-Auswahl.",
              )
            : t("Ansprechpartner legst du beim jeweiligen Kunden an."),
          term || selectedTags.length
            ? null
            : link(t("Zu den Kunden"), "#/customers"),
        );
    if (filtered.length) directory.classList.add("employee-directory-table");
    content.replaceChildren(directory);
  }
  async function load() {
    saveSelection();
    const token = ++generation;
    loading = true;
    content.setAttribute("aria-busy", "true");
    count.textContent = t("Personen werden geladen…");
    content.replaceChildren();
    try {
      const data = await api("/employees", {
        query: { archived: archiveSelect.value },
      });
      if (token !== generation) return;
      rows = data;
      loading = false;
      render();
    } catch (error) {
      if (token !== generation) return;
      count.textContent = t("Personen konnten nicht geladen werden.");
      content.replaceChildren(
        el(
          "p",
          { class: "oj-alert oj-alert-danger", role: "alert" },
          localizedMessage(error.message),
        ),
        button(t("Erneut laden"), load),
      );
    } finally {
      if (token === generation) content.setAttribute("aria-busy", "false");
    }
  }
  input.addEventListener("input", render);
  archiveSelect.addEventListener("change", load);
  render();
  const result = [
    heading(
      t("Personen"),
      t(
        "Alle Ansprechpartner durchsuchen. Öffne eine Person für Kontaktdaten, Angebote und Aktivitäten.",
      ),
    ),
    el("div", { class: "filters" }, search, tagSelection.node, archived),
    count,
    content,
  ];
  result.dispose = () => {
    generation++;
    tagSelection.dispose();
  };
  return result;
}
export async function employeeDetail(id, actions) {
  const row = await api("/employees/" + id);
  const activityCounts = new Map();
  for (const activity of row.activities)
    activityCounts.set(
      activity.customer_service_id,
      (activityCounts.get(activity.customer_service_id) ?? 0) + 1,
    );
  const offers = table(
    t("Dienstleistungen & Angebote"),
    [
      t("Dienstleistung / Angebot"),
      t("Bezug zur Person"),
      t("Status"),
      t("Preis"),
      t("Aktivitäten"),
      t("Aktionen"),
    ],
    row.relationships.map((r) => [
      el(
        "div",
        { class: "oj-stack service-identity" },
        link(r.service_name, "#/services/" + r.service_id),
        tagList(r.service_tags),
        link(
          t("Angebot {id}", { id: r.id.slice(0, 8) }),
          "#/relationships/" + r.id,
        ),
        r.archived_at
          ? el("span", { class: "oj-small oj-muted" }, t("Archiviert"))
          : null,
      ),
      r.primary_employee_id === row.id
        ? t("Ansprechpartner")
        : t("Kontaktaktivitäten"),
      statusBadge(r.status),
      el(
        "div",
        {},
        el(
          "span",
          { class: "oj-mono" },
          money(
            r.accepted_price_minor ?? r.current_offered_price_minor,
            r.currency,
          ),
        ),
        el(
          "p",
          { class: "oj-small oj-muted" },
          labels.billing[r.billing_type] +
            " · " +
            (r.accepted_price_minor === null
              ? t("Angebotspreis")
              : t("Vereinbart")),
        ),
      ),
      activityCounts.get(r.id) ?? 0,
      !row.archived_at && !r.archived_at
        ? button(
            t("Aktivität hinzufügen"),
            () => actions.activity(r, { employeeId: row.id }),
            { compact: true, iconName: "plus" },
          )
        : "–",
    ]),
  );
  offers.classList.add("employee-offers-table");
  return [
    el(
      "nav",
      { class: "oj-breadcrumb", "aria-label": t("Brotkrumennavigation") },
      el(
        "ol",
        {},
        el("li", {}, link(t("Personen"), "#/employees")),
        el("li", {}, link(row.customer.name, "#/customers/" + row.customer_id)),
        el("li", {}, el("span", { "aria-current": "page" }, row.name)),
      ),
    ),
    heading(
      row.name,
      row.customer.name +
        " · " +
        (row.archived_at ? t("Archivierter Mitarbeiter") : t("Mitarbeiter")),
      entityState(row, "employees", actions),
    ),
    panel(
      t("Kontaktdaten"),
      facts([
        [
          t("Unternehmen"),
          link(row.customer.name, "#/customers/" + row.customer_id),
        ],
        [t("Unternehmenstags"), tagList(row.customer.tags) ?? "–"],
        [t("Position"), row.position || "–"],
        [t("E-Mail"), row.email ? link(row.email, "mailto:" + row.email) : "–"],
        [
          t("LinkedIn"),
          row.linkedin
            ? el(
                "a",
                {
                  class: "oj-link",
                  href: row.linkedin,
                  target: "_blank",
                  rel: "noopener noreferrer",
                },
                t("LinkedIn"),
                icon("arrow-up-right-from-square"),
              )
            : "–",
        ],
      ]),
    ),
    el(
      "div",
      { class: "metrics-grid" },
      metric(
        t("Dienstleistungen"),
        new Set(row.relationships.map((r) => r.service_id)).size,
      ),
      metric(
        t("Angebote"),
        row.relationships.length,
        t("Einschließlich archivierter Angebote"),
      ),
      metric(
        t("Erledigte Angebote"),
        row.relationships.filter((r) => r.status === "done").length,
      ),
      metric(
        t("Aktivitäten"),
        row.activities.length,
        t("Mit dieser Person erfasst"),
      ),
    ),
    panel(
      t("Dienstleistungen & Angebote"),
      el(
        "p",
        { class: "oj-small oj-muted" },
        t(
          "Angebote, bei denen diese Person Ansprechpartner ist oder an einer erfassten Aktivität beteiligt war. Öffne ein Angebot für seine vollständige Historie.",
        ),
      ),
      row.relationships.length
        ? offers
        : el(
            "p",
            { class: "oj-muted" },
            t(
              "Mit dieser Person sind noch keine Dienstleistungen oder Angebote verknüpft.",
            ),
          ),
    ),
    panel(
      t("Aktivitäten mit dieser Person"),
      el(
        "p",
        { class: "oj-small oj-muted" },
        t(
          "Persönlich zugeordnete Kontakte und Notizen, neueste zuerst. Allgemeine Angebotsereignisse findest du in der Angebotshistorie.",
        ),
      ),
      row.activities.length
        ? timeline(
            { history: [], activities: row.activities },
            { newestFirst: true, showService: true },
          )
        : el(
            "p",
            { class: "oj-muted" },
            t("Noch keine Aktivitäten mit dieser Person erfasst."),
          ),
    ),
  ];
}
export async function serviceDetail(id, actions) {
  const row = await api("/services/" + id);
  return [
    heading(
      row.name,
      row.archived_at ? t("Archivierte Dienstleistung") : t("Dienstleistung"),
      entityState(row, "services", actions),
    ),
    row.url
      ? panel(
          t("URL"),
          el(
            "a",
            {
              class: "oj-link note-text",
              href: row.url,
              target: "_blank",
              rel: "noopener noreferrer",
            },
            row.url,
            icon("arrow-up-right-from-square"),
            el("span", { class: "oj-sr-only" }, t(" (öffnet in neuem Tab)")),
          ),
        )
      : null,
    panel(
      t("Beschreibung"),
      el("p", { class: "note-text" }, row.note || t("Noch keine Notiz.")),
    ),
    panel(
      t("Tags"),
      !row.archived_at
        ? button(t("Tags bearbeiten"), () => actions.assignTags(row), {
            iconName: "tags",
          })
        : null,
      row.tags.length
        ? el(
            "ul",
            { class: "small-list" },
            row.tags.map((tag) =>
              el(
                "li",
                {},
                tagBadge(tag),
                tag.note
                  ? el("p", { class: "note-text oj-small oj-muted" }, tag.note)
                  : null,
              ),
            ),
          )
        : el("p", { class: "oj-muted" }, t("Noch keine Tags zugewiesen.")),
    ),
    panel(
      t("Kundenbeziehungen"),
      !row.archived_at
        ? el(
            "div",
            { class: "section-actions" },
            button(
              t("Angebot anlegen"),
              () => actions.offer({ service: row }),
              {
                primary: true,
                iconName: "plus",
              },
            ),
            button(t("Mehreren Kunden anbieten"), () =>
              actions.offer({ service: row, batch: true }),
            ),
          )
        : null,
      offerTable(row.relationships),
    ),
  ];
}
export async function serviceTagManagement(actions, type = "services") {
  const tags = await api("/service-tags");
  return [
    el(
      "nav",
      { class: "oj-breadcrumb", "aria-label": t("Brotkrumennavigation") },
      link(
        type === "customers" ? t("Kunden") : t("Dienstleistungen"),
        "#/" + type,
      ),
    ),
    heading(
      t("Tags"),
      t(
        "Gemeinsame Tags für Unternehmen und Dienstleistungen anlegen und bearbeiten.",
      ),
      [
        button(t("Tag anlegen"), () => actions.tag(), {
          primary: true,
          iconName: "plus",
        }),
      ],
    ),
    table(
      t("Tags"),
      [
        t("Tag"),
        t("Notiz"),
        t("Unternehmen"),
        t("Dienstleistungen"),
        t("Aktionen"),
      ],
      tags.map((tag) => [
        tagBadge(tag),
        el("span", { class: "note-text oj-small" }, tag.note || "–"),
        tag.customer_count,
        tag.service_count,
        el(
          "div",
          { class: "section-actions" },
          button(t("Bearbeiten"), () => actions.tag(tag), { compact: true }),
          button(t("Löschen"), () => actions.deleteTag(tag), {
            compact: true,
            danger: true,
          }),
        ),
      ]),
    ),
  ];
}
export async function pipeline(actions, params) {
  const savedFilters = readFilters("pipeline");
  const phaseIcons = {
    open: "inbox",
    pitched: "paper-plane",
    ghosted: "ghost",
    accepted: "handshake",
    done: "circle-check",
    rejected: "circle-xmark",
  };
  const [initialRows, tags] = await Promise.all([
    api("/customer-services", {
      query: { archived: savedFilters.archived === "true" },
    }),
    api("/service-tags"),
  ]);
  const requestedStatus = params.has("status")
    ? params.get("status")
    : savedFilters.status;
  let rows = initialRows;
  const tagSelection = tagFilter(
    tags,
    () => {
      saveSelection();
      render();
    },
    selectedTags(tags, savedFilters),
  );
  const search = field(t("Suchen"), "search", {
      type: "search",
      value: typeof savedFilters.search === "string" ? savedFilters.search : "",
      placeholder: t("Kunde oder Dienstleistung"),
    }),
    status = field(t("Status"), "status", {
      value:
        typeof requestedStatus === "string" &&
        Object.hasOwn(labels.status, requestedStatus)
          ? requestedStatus
          : "",
      options: options(labels.status, t("Alle Status")),
    }),
    archive = field(t("Ansicht"), "archived", {
      value: savedFilters.archived === "true" ? "true" : "false",
      options: [
        ["false", t("Aktive Angebote")],
        ["true", t("Archivierte Angebote")],
      ],
    }),
    board = el("div", {
      id: "pipeline-board",
      class: "pipeline-board",
      tabindex: 0,
      role: "region",
      "aria-label": t("Pipeline nach Status"),
    });
  const count = el("p", { class: "oj-small oj-muted" });
  const scrollPhase = (direction) => {
    const column = board.querySelector(".pipeline-column");
    if (!column) return;
    const distance =
      column.getBoundingClientRect().width +
      parseFloat(getComputedStyle(board).columnGap);
    board.scrollBy({
      left: direction * distance,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  };
  const scrollButton = (name, iconName, direction) =>
    el(
      "button",
      {
        class: "oj-icon-button",
        type: "button",
        "aria-label": name,
        "aria-controls": "pipeline-board",
        title: name,
        onclick: () => scrollPhase(direction),
      },
      icon(iconName),
    );
  const previous = scrollButton(
    t("Vorherige Phasen anzeigen"),
    "arrow-left",
    -1,
  );
  const next = scrollButton(t("Nächste Phasen anzeigen"), "arrow-right", 1);
  const scrollControls = el(
    "div",
    {
      class: "pipeline-scroll-controls",
      role: "group",
      "aria-label": t("Pipeline scrollen"),
    },
    previous,
    next,
  );
  const toolbar = el(
    "div",
    { class: "pipeline-toolbar" },
    count,
    scrollControls,
  );
  const updateScrollControls = () => {
    previous.disabled = board.scrollLeft <= 1;
    next.disabled =
      board.scrollLeft >= board.scrollWidth - board.clientWidth - 1;
  };
  const observer = new ResizeObserver(updateScrollControls);
  observer.observe(board);
  board.addEventListener("scroll", updateScrollControls, { passive: true });
  let frame, focusFrame;
  board.addEventListener("focusin", (event) => {
    if (event.target === board) return;
    const target = event.target;
    cancelAnimationFrame(focusFrame);
    focusFrame = requestAnimationFrame(() => {
      if (!board.isConnected || document.activeElement !== target) return;
      const bounds = board.getBoundingClientRect();
      const focused = target.getBoundingClientRect();
      const bottom = bounds.top + board.clientHeight;
      const right = bounds.left + board.clientWidth;
      const top =
        focused.top < bounds.top + 8
          ? focused.top - bounds.top - 8
          : Math.max(0, focused.bottom - bottom + 8);
      const left =
        focused.left < bounds.left + 8
          ? focused.left - bounds.left - 8
          : Math.max(0, focused.right - right + 8);
      board.scrollBy({ top, left, behavior: "instant" });
    });
  });
  const updateAfterRender = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(updateScrollControls);
  };
  let generation = 0;
  function render() {
    const term = search
        .querySelector("input")
        .value.toLocaleLowerCase(getLocale()),
      selected = status.querySelector("select").value,
      selectedTags = new Set(tagSelection.value());
    const phases = Object.entries(labels.status).filter(
      ([s]) => !selected || s === selected,
    );
    board.classList.toggle("is-filtered", Boolean(selected));
    const matches = rows.filter(
      (r) =>
        (!selected || r.status === selected) &&
        (!selectedTags.size ||
          r.service_tags.some((tag) => selectedTags.has(tag.id))) &&
        (r.customer_name + " " + r.service_name)
          .toLocaleLowerCase(getLocale())
          .includes(term),
    );
    count.textContent = t("{offers} · {phases}", {
      offers: t(matches.length === 1 ? "{count} Angebot" : "{count} Angebote", {
        count: matches.length,
      }),
      phases: t(phases.length === 1 ? "{count} Phase" : "{count} Phasen", {
        count: phases.length,
      }),
    });
    board.replaceChildren(
      ...phases.map(([s, label]) => {
        const list = matches.filter((r) => r.status === s);
        return el(
          "section",
          { class: "pipeline-column" },
          el(
            "h2",
            { class: "oj-heading-4" },
            el(
              "span",
              { class: "pipeline-column-label" },
              icon(phaseIcons[s]),
              el("span", {}, label),
            ),
            el("span", { class: "oj-badge" }, list.length),
          ),
          list.length
            ? el(
                "div",
                { class: "pipeline-cards" },
                list.map((r) => pipelineCard(r, actions)),
              )
            : el("p", { class: "oj-small oj-muted" }, t("Keine Angebote.")),
        );
      }),
    );
    if (selected) board.scrollLeft = 0;
    updateAfterRender();
  }
  search.querySelector("input").addEventListener("input", () => {
    saveSelection();
    render();
  });
  function saveSelection() {
    saveFilters("pipeline", {
      status: status.querySelector("select").value,
      tagIds: tagSelection.value(),
      search: search.querySelector("input").value,
      archived: archive.querySelector("select").value,
    });
  }
  status.querySelector("select").addEventListener("change", () => {
    if (params.has("status")) {
      params.set("status", status.querySelector("select").value);
      history.replaceState(null, "", "#/pipeline?" + params.toString());
    }
    saveSelection();
    render();
  });
  archive.querySelector("select").addEventListener("change", async () => {
    saveSelection();
    const token = ++generation;
    try {
      const data = await api("/customer-services", {
        query: { archived: archive.querySelector("select").value },
      });
      if (token === generation) {
        rows = data;
        render();
      }
    } catch (error) {
      board.replaceChildren(
        el("p", { role: "alert" }, localizedMessage(error.message)),
      );
      updateAfterRender();
    }
  });
  saveSelection();
  render();
  const content = [
    el(
      "div",
      {
        class: "pipeline-controls",
        role: "region",
        "aria-label": t("Pipeline-Steuerung"),
        tabindex: 0,
      },
      heading(
        t("Pipeline"),
        t(
          "Jeder Auftrag ist ein eigener Vorgang. Follow-ups gehören zum bestehenden Angebot.",
        ),
        [
          button(t("Neues Angebot"), () => actions.offer(), {
            primary: true,
            compact: true,
            iconName: "plus",
          }),
        ],
      ),
      el(
        "div",
        { class: "filters" },
        search,
        tagSelection.node,
        status,
        archive,
      ),
      toolbar,
    ),
    board,
  ];
  content.dispose = () => {
    tagSelection.dispose();
    observer.disconnect();
    cancelAnimationFrame(frame);
    cancelAnimationFrame(focusFrame);
  };
  return content;
}
export async function relationshipDetail(id, actions) {
  const r = await api("/customer-services/" + id);
  const phasesTable = table(
    t("Statusphasen"),
    [t("Status"), t("Kunde"), t("Beginn"), t("Dauer")],
    r.phases.map((p) => [
      statusBadge(p.status),
      el(
        "span",
        { class: "phase-customer-name", title: r.customer_name },
        r.customer_name,
      ),
      datetime(p.started_at),
      duration(p.duration_ms),
    ]),
  );
  phasesTable.classList.add("status-phases-table");
  return [
    el(
      "nav",
      { class: "oj-breadcrumb", "aria-label": t("Brotkrumennavigation") },
      el(
        "ol",
        {},
        el("li", {}, link(t("Kunden"), "#/customers")),
        el("li", {}, link(r.customer_name, "#/customers/" + r.customer_id)),
        el("li", {}, el("span", { "aria-current": "page" }, t("Angebot"))),
      ),
    ),
    heading(
      r.service_name,
      r.customer_name +
        " · " +
        (r.archived_at
          ? t("Archiviertes Angebot")
          : t("Angebot {id}", { id: r.id.slice(0, 8) })),
      [
        ...(r.archived_at
          ? [
              button(t("Wiederherstellen"), () =>
                actions.archive("customer-services", r, true),
              ),
            ]
          : [
              button(t("Bearbeiten"), () => actions.relationship(r)),
              button(t("Archivieren"), () =>
                actions.archive("customer-services", r),
              ),
            ]),
        button(t("Löschen"), () => actions.deleteRelationship(r), {
          danger: true,
          iconName: "trash",
        }),
        el(
          "a",
          {
            class: "oj-button oj-button-secondary",
            href: "#/invoices?customer_service_id=" + id,
          },
          icon("file-invoice"),
          t("Rechnungen"),
        ),
      ],
    ),
    el(
      "div",
      { class: "detail-grid" },
      el(
        "div",
        { class: "oj-stack" },
        panel(
          t("Angebotsdetails"),
          facts([
            [t("Status"), statusBadge(r.status)],
            [
              t("Angebotsdatum"),
              el("time", { datetime: r.offer_date }, formatDate(r.offer_date)),
            ],
            [t("Verweildauer"), age(r.status_since)],
            [
              t("Ursprünglicher Pitch-Preis"),
              money(r.first_pitched_price_minor, r.currency),
            ],
            [
              t("Aktueller Angebotspreis"),
              money(r.current_offered_price_minor, r.currency),
            ],
            [
              t("Vereinbarter Preis"),
              money(r.accepted_price_minor, r.currency),
            ],
            [t("Abrechnung"), labels.billing[r.billing_type]],
            [t("Ursprünglicher Pitch-Kanal"), labels.channel[r.pitch_channel]],
            [
              t("Ansprechpartner"),
              employeeLink(r.employee_name, r.primary_employee_id),
            ],
            [t("Kunde"), link(r.customer_name, "#/customers/" + r.customer_id)],
            [
              t("Dienstleistung"),
              link(r.service_name, "#/services/" + r.service_id),
            ],
            [t("Erster Pitch"), datetime(r.first_pitch_at)],
            [t("Erste Zusage"), datetime(r.first_acceptance_at)],
          ]),
          r.rejection_reason
            ? el(
                "p",
                { class: "oj-alert oj-alert-warning note-text" },
                t("Absage: {reason}", {
                  reason: labels.reason[JSON.parse(r.rejection_reason).code],
                }) +
                  (JSON.parse(r.rejection_reason).note
                    ? " · " + JSON.parse(r.rejection_reason).note
                    : ""),
              )
            : null,
          !r.archived_at
            ? el(
                "div",
                { class: "section-actions" },
                statusActions(r, actions),
                button(t("Preis ändern"), () => actions.prices(r)),
                button(t("Aktivität hinzufügen"), () => actions.activity(r), {
                  iconName: "plus",
                }),
              )
            : null,
        ),
        panel(t("Statusphasen"), phasesTable),
      ),
      panel(
        t("Timeline"),
        el(
          "p",
          { class: "oj-small oj-muted" },
          t(
            "Statuswechsel, Kontakte und Preisänderungen in zeitlicher Reihenfolge.",
          ),
        ),
        timeline(r),
      ),
    ),
  ];
}
async function filterBar(view, onApply, { dates = true } = {}) {
  const saved = readFilters(view);
  const [activeCustomers, activeServices, archivedCustomers, archivedServices] =
    await Promise.all([
      api("/customers"),
      api("/services"),
      api("/customers", { query: { archived: true } }),
      api("/services", { query: { archived: true } }),
    ]);
  const customers = [
    ...activeCustomers,
    ...archivedCustomers.map((r) => ({
      ...r,
      name: t("{name} (archiviert)", { name: r.name }),
    })),
  ];
  const services = [
    ...activeServices,
    ...archivedServices.map((r) => ({
      ...r,
      name: t("{name} (archiviert)", { name: r.name }),
    })),
  ];
  const fields = [
    ...(dates
      ? [
          field(t("Von"), "from", { type: "date" }),
          field(t("Bis"), "to", { type: "date" }),
        ]
      : []),
    field(t("Kunde"), "customer_id", {
      options: [
        ["", t("Alle Kunden")],
        ...customers.map((c) => [c.id, c.name]),
      ],
    }),
    field(t("Dienstleistung"), "service_id", {
      options: [
        ["", t("Alle Dienstleistungen")],
        ...services.map((s) => [s.id, s.name]),
      ],
    }),
    field(t("Pitch-Kanal"), "pitch_channel", {
      options: options(labels.channel, t("Alle Kanäle")),
    }),
  ];
  const submit = el(
      "button",
      { class: "oj-button oj-button-primary", type: "submit" },
      t("Filtern"),
    ),
    error = el("p", {
      class: "oj-helper oj-helper-error",
      role: "alert",
      hidden: true,
    });
  const form = el(
    "form",
    { class: "oj-panel oj-stack" },
    el("div", { class: "filters" }, fields, submit),
    error,
  );
  for (const control of form.querySelectorAll("input,select")) {
    const value = saved[control.name];
    if (
      typeof value === "string" &&
      (control.tagName !== "SELECT" ||
        [...control.options].some((option) => option.value === value))
    )
      control.value = value;
  }
  if (Object.keys(saved).length) {
    try {
      await onApply(Object.fromEntries(new FormData(form)));
    } catch (err) {
      error.textContent = localizedMessage(err.message);
      error.hidden = false;
    }
  }
  const remember = () =>
    saveFilters(view, Object.fromEntries(new FormData(form)));
  form.addEventListener("input", remember);
  form.addEventListener("change", remember);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.hidden = true;
    try {
      const query = Object.fromEntries(new FormData(form));
      await onApply(query);
      saveFilters(view, query);
    } catch (err) {
      error.textContent = localizedMessage(err.message);
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}
export async function activities(actions) {
  let items = await api("/activities"),
    rows = await api("/customer-services");
  const content = el("div", {});
  function render() {
    content.replaceChildren(
      table(
        t("Aktivitäten"),
        [
          t("Zeitpunkt"),
          t("Aktivität"),
          t("Kunde / Dienstleistung"),
          t("Kanal"),
          t("Mitarbeiter"),
          t("Notiz"),
        ],
        items.map((a) => [
          datetime(a.occurred_at),
          labels.activity[a.type],
          el(
            "div",
            {},
            link(a.customer_name, "#/relationships/" + a.customer_service_id),
            el("p", { class: "oj-small oj-muted" }, a.service_name),
          ),
          a.channel ? labels.channel[a.channel] : "–",
          employeeLink(a.employee_name, a.employee_id),
          el(
            "p",
            { class: "note-text" },
            a.type === "price_change"
              ? priceChangeText(a, a.currency) + (a.note ? " · " + a.note : "")
              : a.note,
          ),
        ]),
      ),
    );
  }
  render();
  const filters = await filterBar("activities", async (query) => {
    items = await api("/activities", { query });
    render();
  });
  return [
    heading(
      t("Aktivitäten"),
      t(
        "Alle Kontakt- und Preisereignisse. Datumsfilter beziehen sich auf den Aktivitätszeitpunkt.",
      ),
      [
        button(
          t("Aktivität hinzufügen"),
          () => {
            if (!rows.length) return;
            const choice = field(t("Angebot"), "relationship_id", {
              value: rows[0].id,
              options: rows.map((r) => [
                r.id,
                r.customer_name +
                  " · " +
                  r.service_name +
                  " · " +
                  r.id.slice(0, 8),
              ]),
            });
            import("./dialogs.js").then(({ showForm }) =>
              showForm(
                t("Angebot auswählen"),
                [choice],
                (data) => rows.find((r) => r.id === data.relationship_id),
                {
                  submitLabel: t("Weiter"),
                  onSaved: (r) => actions.activity(r),
                  successMessage: null,
                },
              ),
            );
          },
          { primary: true, iconName: "plus", disabled: !rows.length },
        ),
      ],
    ),
    filters,
    rows.length || items.length
      ? content
      : empty(
          t("Noch keine Aktivitäten"),
          t(
            "Erstelle ein Angebot, um Kontakte und Preisänderungen zu erfassen.",
          ),
        ),
  ];
}
function performance(title, rows, channel = false) {
  const content = panel(
    title,
    table(
      title,
      [
        channel ? t("Kanal") : t("Name"),
        t("Angelegt"),
        t("Gepitcht"),
        t("Ghosted"),
        t("Gewonnen"),
        t("Abgelehnt"),
        t("Abschlussquote"),
        t("Pitch → Zusage"),
      ],
      rows.map((r) => [
        channel ? labels.channel[r.name] : r.name,
        r.created,
        r.pitched,
        r.ghosted,
        r.won,
        r.rejected,
        percent(r.win_rate),
        duration(
          r.avg_pitch_to_accept_days === null
            ? null
            : r.avg_pitch_to_accept_days * 86400000,
        ),
      ]),
    ),
  );
  content.classList.add("performance-panel");
  return content;
}
function analyticsContent(a) {
  const s = a.summary;
  return [
    el(
      "div",
      { class: "metrics-grid" },
      metric(t("Angelegt"), s.created),
      metric(t("Gepitcht"), s.pitched),
      metric(t("Ghosted"), s.ghosted, t("Keine Rückmeldung")),
      metric(t("Gewonnen"), s.won, t("Angenommen + erledigt")),
      metric(t("Abgelehnt"), s.rejected),
      metric(t("Abschlussquote"), percent(s.win_rate)),
      metric(t("Noch unentschieden"), s.undecided),
      metric(
        t("Pitch → Zusage"),
        duration(
          s.avg_pitch_to_accept_days === null
            ? null
            : s.avg_pitch_to_accept_days * 86400000,
        ),
        t("Mittelwert · erste Zusage"),
      ),
    ),
    panel(
      t("Auftragswerte"),
      el(
        "p",
        { class: "oj-small oj-muted" },
        t(
          "Währungen und Abrechnungsmodelle werden getrennt ausgewertet. Wiederkehrende Beträge beziehen sich auf die jeweilige Periode; keine Hochrechnung auf einen Gesamtumsatz.",
        ),
      ),
      table(
        t("Auftragswerte"),
        [
          t("Währung"),
          t("Abrechnung"),
          t("Aktuell angeboten"),
          t("Ursprünglich gepitcht"),
          t("Vereinbart (gewonnen)"),
        ],
        a.values.map((v) => [
          v.currency,
          labels.billing[v.billing_type],
          money(v.offered_price_minor, v.currency),
          money(v.first_pitched_price_minor, v.currency),
          money(v.accepted_price_minor, v.currency),
        ]),
      ),
    ),
    performance(t("Performance je Dienstleistung"), a.by_service),
    performance(t("Performance je Kunde"), a.by_customer),
    performance(
      t("Performance je ursprünglichem Pitch-Kanal"),
      a.by_channel,
      true,
    ),
    panel(
      t("Ablehnungsgründe"),
      table(
        t("Ablehnungsgründe"),
        [t("Grund"), t("Angebote")],
        a.rejection_reasons.map((r) => [labels.reason[r.code], r.count]),
      ),
    ),
  ];
}
export async function analytics() {
  const content = el(
      "div",
      { class: "oj-stack" },
      analyticsContent(await api("/analytics")),
    ),
    filters = await filterBar("analytics", async (query) =>
      content.replaceChildren(
        ...analyticsContent(await api("/analytics", { query })),
      ),
    );
  return [
    heading(
      t("Analytics"),
      t(
        "Auswertungen nach Anlagedatum des Angebots (UTC). Jeder Vorgang zählt pro Kennzahl einmal.",
      ),
    ),
    filters,
    content,
  ];
}
