import { api } from "./api.js";
import {
  el,
  icon,
  link,
  button,
  labels,
  options,
  field,
  table,
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
function offerTable(rows) {
  return table(
    "Angebote",
    [
      "Dienstleistung / Kunde",
      "Status",
      "Angebotspreis",
      "Vereinbart",
      "Ansprechpartner",
      "Aktuelle Phase",
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
          r.archived_at ? " · Archiviert" : "",
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
      r.employee_name ?? "–",
      el(
        "div",
        { class: "phase-duration" },
        age(r.status_since),
        el("div", { class: "oj-small oj-muted" }, datetime(r.status_since)),
      ),
    ]),
  );
}
function timeline(row) {
  const events = [
    ...row.history.map((h, i) => ({ kind: "status", ...h, order: i })),
    ...row.activities.map((a, i) => ({ kind: "activity", ...a, order: -i })),
  ].sort(
    (a, b) =>
      a.occurred_at.localeCompare(b.occurred_at) ||
      (a.recorded_at ?? a.created_at).localeCompare(
        b.recorded_at ?? b.created_at,
      ) ||
      a.order - b.order,
  );
  return el(
    "ol",
    { class: "timeline" },
    events.map((event) => {
      let title, note;
      if (event.kind === "status") {
        title =
          (event.from_status
            ? labels.status[event.from_status] + " → "
            : "Angelegt · ") + labels.status[event.to_status];
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
            (event.price_field === "accepted_price_minor"
              ? " · Vereinbart: "
              : " · Angebot: ") +
            money(event.previous_price_minor, row.currency) +
            " → " +
            money(event.new_price_minor, row.currency);
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
          event.employee_name ? " · " + event.employee_name : null,
        ),
        el("p", { class: "timeline-title" }, title),
        note ? el("p", { class: "note-text oj-small" }, note) : null,
      );
    }),
  );
}
function statusActions(row, actions) {
  return (transitions[row.status] ?? []).map((to) =>
    button(
      row.status === "rejected"
        ? "Wieder aufnehmen"
        : to === "pitched"
          ? "Pitch erfassen"
          : to === "accepted"
            ? "Zusage erfassen"
            : to === "done"
              ? "Als erledigt markieren"
              : "Ablehnen",
      () => actions.status(row, to),
      { primary: to !== "rejected", compact: true },
    ),
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
    ? [button("Wiederherstellen", () => actions.archive(type, row, true))]
    : [
        button("Bearbeiten", () => actions.entity(type, row), {
          iconName: "pen",
        }),
        button("Archivieren", () => actions.archive(type, row), {
          iconName: "box-archive",
        }),
      ];
}
export async function dashboard(actions) {
  const [analytics, rows, activities] = await Promise.all([
    api("/analytics"),
    api("/customer-services"),
    api("/activities"),
  ]);
  const s = analytics.summary;
  return [
    heading("Dashboard", "Ein Blick auf deine Kunden und laufenden Angebote."),
    el(
      "div",
      { class: "metrics-grid" },
      metric(
        "Angebote gesamt",
        s.created,
        "Alle Vorgänge, einschließlich Archiv",
      ),
      metric("Tatsächlich gepitcht", s.pitched),
      metric("Gewonnene Angebote", s.won, "Angenommen und erledigt"),
      metric(
        "Abschlussquote",
        percent(s.win_rate),
        "Unter entschiedenen Angeboten",
      ),
    ),
    el(
      "div",
      { class: "dashboard-grid" },
      panel(
        "Aktuelle Pipeline",
        el(
          "div",
          { class: "status-overview" },
          Object.entries(labels.status).map(([status, label]) =>
            link(
              el(
                "span",
                {},
                label,
                el(
                  "span",
                  { class: "oj-badge" },
                  rows.filter((r) => r.status === status).length,
                ),
              ),
              "#/pipeline?status=" + status,
            ),
          ),
        ),
        el(
          "p",
          { class: "oj-small oj-muted" },
          "Aktive Angebote. Archivierte Vorgänge bleiben in Analytics erhalten.",
        ),
      ),
      panel(
        "Letzte Kontakte",
        activities.length
          ? activityList(
              activities.filter((a) => a.type !== "price_change").slice(0, 4),
            )
          : el("p", { class: "oj-muted" }, "Noch keine Kontaktaktivitäten."),
      ),
    ),
    rows.length
      ? panel("Neueste Angebote", offerTable(rows.slice(0, 6)))
      : empty(
          "Dein CRM ist bereit",
          "Lege zuerst einen Kunden und eine Dienstleistung an.",
          button("Kunde anlegen", () => actions.entity("customers"), {
            primary: true,
          }),
        ),
  ];
}
export async function entityList(type, actions) {
  const isCustomer = type === "customers";
  const title = isCustomer ? "Kunden" : "Dienstleistungen";
  let archiveMode = false;
  const search = field("Suchen", "search", {
      type: "search",
      placeholder: isCustomer ? "Name oder Notiz" : "Dienstleistung oder Notiz",
    }),
    archived = field("Ansicht", "archived", {
      value: "false",
      options: [
        ["false", "Aktiv"],
        ["true", "Archiviert"],
      ],
    }),
    content = el("div", {}),
    count = el("p", { class: "oj-small oj-muted", role: "status" });
  let rows = await api("/" + type);
  let generation = 0;
  function render() {
    const term = search.querySelector("input").value.toLocaleLowerCase();
    const filtered = rows.filter((r) =>
      (r.name + " " + r.note).toLocaleLowerCase().includes(term),
    );
    count.textContent = `${filtered.length} ${title}`;
    content.replaceChildren(
      table(
        title,
        ["Name", "Notiz", "Angelegt", "Aktionen"],
        filtered.map((r) => [
          link(r.name, "#/" + type + "/" + r.id),
          el("span", { class: "note-text oj-small" }, r.note || "–"),
          datetime(r.created_at),
          archiveMode
            ? button("Wiederherstellen", () => actions.archive(type, r, true), {
                compact: true,
              })
            : button("Bearbeiten", () => actions.entity(type, r), {
                compact: true,
              }),
        ]),
      ),
    );
  }
  search.querySelector("input").addEventListener("input", render);
  archived.querySelector("select").addEventListener("change", async () => {
    archiveMode = archived.querySelector("select").value === "true";
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
          error.message,
        ),
      );
    }
  });
  render();
  return [
    heading(
      title,
      isCustomer
        ? "Kunden und ihre Ansprechpartner an einem Ort."
        : "Wiederverwendbare Leistungen mit eigenständigen Angeboten.",
      [
        button(
          isCustomer ? "Kunde anlegen" : "Dienstleistung anlegen",
          () => actions.entity(type),
          { primary: true, iconName: "plus" },
        ),
      ],
    ),
    el("div", { class: "filters" }, search, archived),
    count,
    content,
  ];
}
export async function customerDetail(id, actions) {
  const row = await api("/customers/" + id);
  const employees = [...row.employees, ...row.archived_employees];
  return [
    heading(
      row.name,
      row.archived_at ? "Archivierter Kunde" : "Kundendetails",
      entityState(row, "customers", actions),
    ),
    row.note ? panel("Notiz", el("p", { class: "note-text" }, row.note)) : null,
    panel(
      "Mitarbeiter",
      !row.archived_at
        ? el(
            "div",
            { class: "section-actions" },
            button(
              "Mitarbeiter anlegen",
              () => actions.entity("employees", { customer_id: id }),
              { primary: true, iconName: "plus" },
            ),
          )
        : null,
      table(
        "Mitarbeiter",
        ["Name", "Kontakt", "Position", "Aktionen"],
        employees.map((e) => [
          el(
            "div",
            {},
            e.name,
            e.archived_at
              ? el("span", { class: "oj-badge" }, "Archiviert")
              : null,
          ),
          el(
            "div",
            {},
            e.email ? link(e.email, "mailto:" + e.email) : "–",
            e.linkedin
              ? el(
                  "div",
                  {},
                  el(
                    "a",
                    {
                      class: "oj-link",
                      href: e.linkedin,
                      target: "_blank",
                      rel: "noopener noreferrer",
                    },
                    "LinkedIn",
                    icon("arrow-up-right-from-square"),
                  ),
                )
              : null,
          ),
          e.position || "–",
          el(
            "div",
            { class: "section-actions" },
            e.archived_at
              ? button(
                  "Wiederherstellen",
                  () => actions.archive("employees", e, true),
                  { compact: true },
                )
              : [
                  button("Bearbeiten", () => actions.entity("employees", e), {
                    compact: true,
                  }),
                  button("Archivieren", () => actions.archive("employees", e), {
                    compact: true,
                  }),
                ],
          ),
        ]),
      ),
    ),
    panel(
      "Angebote & Beziehungshistorie",
      !row.archived_at
        ? el(
            "div",
            { class: "section-actions" },
            button("Neues Angebot", () => actions.offer({ customer: row }), {
              primary: true,
              iconName: "plus",
            }),
          )
        : null,
      el(
        "p",
        { class: "oj-small oj-muted" },
        "Jedes Angebot führt einen eigenen Verlauf. Öffne eine Dienstleistung für die vollständige Timeline.",
      ),
      offerTable(row.relationships),
    ),
    row.relationships.length
      ? panel(
          "Bisheriger Beziehungsverlauf",
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
                link("Angebot öffnen", "#/relationships/" + r.id),
                timeline(r),
              ),
            ),
          ),
        )
      : null,
  ];
}
export async function serviceDetail(id, actions) {
  const row = await api("/services/" + id);
  return [
    heading(
      row.name,
      row.archived_at ? "Archivierte Dienstleistung" : "Dienstleistung",
      entityState(row, "services", actions),
    ),
    panel(
      "Beschreibung",
      el("p", { class: "note-text" }, row.note || "Noch keine Notiz."),
    ),
    panel(
      "Kundenbeziehungen",
      !row.archived_at
        ? el(
            "div",
            { class: "section-actions" },
            button("Angebot anlegen", () => actions.offer({ service: row }), {
              primary: true,
              iconName: "plus",
            }),
            button("Mehreren Kunden anbieten", () =>
              actions.offer({ service: row, batch: true }),
            ),
          )
        : null,
      offerTable(row.relationships),
    ),
  ];
}
export async function pipeline(actions, params) {
  let rows = await api("/customer-services");
  const search = field("Suchen", "search", {
      type: "search",
      placeholder: "Kunde oder Dienstleistung",
    }),
    status = field("Status", "status", {
      value: params.get("status") ?? "",
      options: options(labels.status, "Alle Status"),
    }),
    archive = field("Ansicht", "archived", {
      value: "false",
      options: [
        ["false", "Aktive Angebote"],
        ["true", "Archivierte Angebote"],
      ],
    }),
    board = el("div", {
      class: "pipeline-board",
      tabindex: 0,
      role: "region",
      "aria-label": "Pipeline nach Status",
    });
  let generation = 0;
  function render() {
    const term = search.querySelector("input").value.toLowerCase(),
      selected = status.querySelector("select").value;
    board.replaceChildren(
      ...Object.entries(labels.status)
        .filter(([s]) => !selected || s === selected)
        .map(([s, label]) => {
          const list = rows.filter(
            (r) =>
              r.status === s &&
              (r.customer_name + " " + r.service_name)
                .toLowerCase()
                .includes(term),
          );
          return el(
            "section",
            { class: "pipeline-column" },
            el(
              "h2",
              { class: "oj-heading-4" },
              label,
              el("span", { class: "oj-badge" }, list.length),
            ),
            list.length
              ? list.map((r) =>
                  el(
                    "article",
                    { class: "oj-panel oj-panel-compact offer-card" },
                    el("p", { class: "oj-small oj-muted" }, r.customer_name),
                    el(
                      "a",
                      {
                        class: "oj-link offer-card-title",
                        href: "#/relationships/" + r.id,
                      },
                      r.service_name,
                    ),
                    el(
                      "div",
                      { class: "offer-card-meta" },
                      el(
                        "span",
                        { class: "oj-mono" },
                        money(
                          ["accepted", "done"].includes(s)
                            ? r.accepted_price_minor
                            : r.current_offered_price_minor,
                          r.currency,
                        ),
                      ),
                      el(
                        "span",
                        { class: "oj-small oj-muted" },
                        labels.billing[r.billing_type],
                      ),
                    ),
                    el(
                      "p",
                      { class: "oj-small" },
                      r.employee_name ?? "Kein Ansprechpartner",
                    ),
                    el(
                      "p",
                      { class: "oj-small oj-muted" },
                      age(r.status_since) + " im Status",
                    ),
                    !r.archived_at
                      ? el(
                          "div",
                          { class: "section-actions" },
                          statusActions(r, actions),
                        )
                      : button(
                          "Wiederherstellen",
                          () => actions.archive("customer-services", r, true),
                          { compact: true },
                        ),
                  ),
                )
              : el("p", { class: "oj-small oj-muted" }, "Keine Angebote."),
          );
        }),
    );
  }
  search.querySelector("input").addEventListener("input", render);
  status.querySelector("select").addEventListener("change", render);
  archive.querySelector("select").addEventListener("change", async () => {
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
      board.replaceChildren(el("p", { role: "alert" }, error.message));
    }
  });
  render();
  return [
    heading(
      "Pipeline",
      "Jeder Auftrag ist ein eigener Vorgang. Follow-ups gehören zum bestehenden Angebot.",
      [
        button("Neues Angebot", () => actions.offer(), {
          primary: true,
          iconName: "plus",
        }),
      ],
    ),
    el("div", { class: "filters" }, search, status, archive),
    board,
  ];
}
export async function relationshipDetail(id, actions) {
  const r = await api("/customer-services/" + id);
  return [
    el(
      "nav",
      { class: "oj-breadcrumb", "aria-label": "Brotkrumennavigation" },
      el(
        "ol",
        {},
        el("li", {}, link("Kunden", "#/customers")),
        el("li", {}, link(r.customer_name, "#/customers/" + r.customer_id)),
        el("li", {}, el("span", { "aria-current": "page" }, "Angebot")),
      ),
    ),
    heading(
      r.service_name,
      r.customer_name +
        " · " +
        (r.archived_at
          ? "Archiviertes Angebot"
          : "Angebot " + r.id.slice(0, 8)),
      r.archived_at
        ? [
            button("Wiederherstellen", () =>
              actions.archive("customer-services", r, true),
            ),
          ]
        : [
            button("Bearbeiten", () => actions.relationship(r)),
            button("Archivieren", () =>
              actions.archive("customer-services", r),
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
          "Angebotsdetails",
          facts([
            ["Status", statusBadge(r.status)],
            ["Verweildauer", age(r.status_since)],
            [
              "Ursprünglicher Pitch-Preis",
              money(r.first_pitched_price_minor, r.currency),
            ],
            [
              "Aktueller Angebotspreis",
              money(r.current_offered_price_minor, r.currency),
            ],
            ["Vereinbarter Preis", money(r.accepted_price_minor, r.currency)],
            ["Abrechnung", labels.billing[r.billing_type]],
            ["Ursprünglicher Pitch-Kanal", labels.channel[r.pitch_channel]],
            ["Ansprechpartner", r.employee_name ?? "–"],
            ["Kunde", link(r.customer_name, "#/customers/" + r.customer_id)],
            [
              "Dienstleistung",
              link(r.service_name, "#/services/" + r.service_id),
            ],
            ["Erster Pitch", datetime(r.first_pitch_at)],
            ["Erste Zusage", datetime(r.first_acceptance_at)],
          ]),
          r.rejection_reason
            ? el(
                "p",
                { class: "oj-alert oj-alert-warning note-text" },
                "Absage: " +
                  labels.reason[JSON.parse(r.rejection_reason).code] +
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
                button("Preis ändern", () => actions.prices(r)),
                button("Aktivität hinzufügen", () => actions.activity(r), {
                  iconName: "plus",
                }),
              )
            : null,
        ),
        panel(
          "Statusphasen",
          table(
            "Statusphasen",
            ["Status", "Beginn", "Dauer"],
            r.phases.map((p) => [
              statusBadge(p.status),
              datetime(p.started_at),
              duration(p.duration_ms),
            ]),
          ),
        ),
      ),
      panel(
        "Timeline",
        el(
          "p",
          { class: "oj-small oj-muted" },
          "Statuswechsel, Kontakte und Preisänderungen in zeitlicher Reihenfolge.",
        ),
        timeline(r),
      ),
    ),
  ];
}
async function filterBar(onApply, { dates = true } = {}) {
  const [activeCustomers, activeServices, archivedCustomers, archivedServices] =
    await Promise.all([
      api("/customers"),
      api("/services"),
      api("/customers", { query: { archived: true } }),
      api("/services", { query: { archived: true } }),
    ]);
  const customers = [
    ...activeCustomers,
    ...archivedCustomers.map((r) => ({ ...r, name: r.name + " (archiviert)" })),
  ];
  const services = [
    ...activeServices,
    ...archivedServices.map((r) => ({ ...r, name: r.name + " (archiviert)" })),
  ];
  const fields = [
    ...(dates
      ? [
          field("Von", "from", { type: "date" }),
          field("Bis", "to", { type: "date" }),
        ]
      : []),
    field("Kunde", "customer_id", {
      options: [["", "Alle Kunden"], ...customers.map((c) => [c.id, c.name])],
    }),
    field("Dienstleistung", "service_id", {
      options: [
        ["", "Alle Dienstleistungen"],
        ...services.map((s) => [s.id, s.name]),
      ],
    }),
    field("Pitch-Kanal", "pitch_channel", {
      options: options(labels.channel, "Alle Kanäle"),
    }),
  ];
  const submit = el(
      "button",
      { class: "oj-button oj-button-primary", type: "submit" },
      "Filtern",
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
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.hidden = true;
    try {
      await onApply(Object.fromEntries(new FormData(form)));
    } catch (err) {
      error.textContent = err.message;
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
        "Aktivitäten",
        [
          "Zeitpunkt",
          "Aktivität",
          "Kunde / Dienstleistung",
          "Kanal",
          "Mitarbeiter",
          "Notiz",
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
          a.employee_name ?? "–",
          el(
            "p",
            { class: "note-text" },
            a.type === "price_change"
              ? (a.price_field === "accepted_price_minor"
                  ? "Vereinbart: "
                  : "Angebot: ") +
                  money(a.previous_price_minor, a.currency) +
                  " → " +
                  money(a.new_price_minor, a.currency) +
                  (a.note ? " · " + a.note : "")
              : a.note,
          ),
        ]),
      ),
    );
  }
  render();
  const filters = await filterBar(async (query) => {
    items = await api("/activities", { query });
    render();
  });
  return [
    heading(
      "Aktivitäten",
      "Alle Kontakt- und Preisereignisse. Datumsfilter beziehen sich auf den Aktivitätszeitpunkt.",
      [
        button(
          "Aktivität hinzufügen",
          () => {
            if (!rows.length) return;
            const choice = field("Angebot", "relationship_id", {
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
                "Angebot auswählen",
                [choice],
                (data) => rows.find((r) => r.id === data.relationship_id),
                {
                  submitLabel: "Weiter",
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
          "Noch keine Aktivitäten",
          "Erstelle ein Angebot, um Kontakte und Preisänderungen zu erfassen.",
        ),
  ];
}
function performance(title, rows, channel = false) {
  return panel(
    title,
    table(
      title,
      [
        channel ? "Kanal" : "Name",
        "Angelegt",
        "Gepitcht",
        "Gewonnen",
        "Abgelehnt",
        "Abschlussquote",
        "Pitch → Zusage",
      ],
      rows.map((r) => [
        channel ? labels.channel[r.name] : r.name,
        r.created,
        r.pitched,
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
}
function analyticsContent(a) {
  const s = a.summary;
  return [
    el(
      "div",
      { class: "metrics-grid" },
      metric("Angelegt", s.created),
      metric("Gepitcht", s.pitched),
      metric("Gewonnen", s.won, "Angenommen + erledigt"),
      metric("Abgelehnt", s.rejected),
      metric("Abschlussquote", percent(s.win_rate)),
      metric("Noch unentschieden", s.undecided),
      metric(
        "Pitch → Zusage",
        duration(
          s.avg_pitch_to_accept_days === null
            ? null
            : s.avg_pitch_to_accept_days * 86400000,
        ),
        "Mittelwert · erste Zusage",
      ),
      metric(
        "Pitch → Entscheidung",
        duration(
          s.avg_pitch_to_decision_days === null
            ? null
            : s.avg_pitch_to_decision_days * 86400000,
        ),
        "Mittelwert · erste Entscheidung",
      ),
    ),
    panel(
      "Auftragswerte",
      el(
        "p",
        { class: "oj-small oj-muted" },
        "Währungen und Abrechnungsmodelle werden getrennt ausgewertet. Wiederkehrende Beträge beziehen sich auf die jeweilige Periode; keine Hochrechnung auf einen Gesamtumsatz.",
      ),
      table(
        "Auftragswerte",
        [
          "Währung",
          "Abrechnung",
          "Aktuell angeboten",
          "Ursprünglich gepitcht",
          "Vereinbart (gewonnen)",
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
    performance("Performance je Dienstleistung", a.by_service),
    performance("Performance je Kunde", a.by_customer),
    performance(
      "Performance je ursprünglichem Pitch-Kanal",
      a.by_channel,
      true,
    ),
    panel(
      "Ablehnungsgründe",
      table(
        "Ablehnungsgründe",
        ["Grund", "Angebote"],
        a.rejection_reasons.map((r) => [labels.reason[r.code], r.count]),
      ),
    ),
    el(
      "details",
      { class: "oj-accordion" },
      el("summary", {}, "Kennzahlen und Filter: Definitionen"),
      el(
        "div",
        { class: "oj-accordion-body oj-stack" },
        Object.values(a.definitions).map((t) =>
          el("p", { class: "oj-small" }, t),
        ),
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
    filters = await filterBar(async (query) =>
      content.replaceChildren(
        ...analyticsContent(await api("/analytics", { query })),
      ),
    );
  return [
    heading(
      "Analytics",
      "Auswertungen nach Anlagedatum des Angebots (UTC). Jeder Vorgang zählt pro Kennzahl einmal.",
    ),
    filters,
    content,
  ];
}
