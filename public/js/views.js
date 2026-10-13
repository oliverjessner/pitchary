import { api } from "./api.js";
import {
  financeDashboard,
  customerFinanceSections,
  withFinanceRefresh,
} from "./finance.js";
import {
  customerIdentity,
  customerLogo,
  customerWebsite,
} from "./customer-branding.js";
import { tagBadge, tagList, tagFilter } from "./service-tags.js";
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
function statusActions(row, actions, { card = false } = {}) {
  return (transitions[row.status] ?? []).map((to, index) => {
    const action = button(
      to === "pitched" && ["rejected", "ghosted"].includes(row.status)
        ? "Wieder aufnehmen"
        : to === "pitched"
          ? "Pitch erfassen"
          : to === "accepted"
            ? "Zusage erfassen"
            : to === "ghosted"
              ? "Als Ghosted markieren"
              : to === "done"
                ? "Als erledigt markieren"
                : "Ablehnen",
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
          "Wiederherstellen",
          () => actions.archive("customer-services", row, true),
          { iconName: "rotate-left" },
        ),
      ]
    : statusActions(row, actions, { card: true });
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
          (won ? "Vereinbart" : "Angebotspreis"),
      ),
    ),
    el(
      "div",
      { class: "offer-card-details oj-small oj-muted" },
      el(
        "p",
        {},
        icon("user"),
        el("span", {}, row.employee_name ?? "Kein Ansprechpartner"),
      ),
      el(
        "p",
        {},
        icon("clock"),
        el("span", {}, age(row.status_since) + " im Status"),
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
export async function dashboard(actions, params) {
  const [analytics, rows, activities] = await Promise.all([
    api("/analytics"),
    api("/customer-services"),
    api("/activities"),
  ]);
  const s = analytics.summary;
  const contacts = activities
    .filter((a) => a.type !== "price_change")
    .slice(0, 4);
  const finances = await financeDashboard(actions, params);
  const content = [
    heading("Dashboard", "Ein Blick auf deine Kunden und laufenden Angebote."),
    el(
      "div",
      { class: "dashboard-grid" },
      el(
        "div",
        { class: "metrics-grid dashboard-metrics" },
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
      panel(
        "Letzte Kontakte",
        contacts.length
          ? activityList(contacts)
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
    ...finances,
  ];
  content.dispose = () => finances.dispose?.();
  return content;
}
export async function entityList(type, actions) {
  const isCustomer = type === "customers";
  const title = isCustomer ? "Kunden" : "Dienstleistungen";
  let archiveMode = false;
  const search = field("Suchen", "search", {
      type: "search",
      placeholder: isCustomer
        ? "Name, Website oder Notiz"
        : "Dienstleistung, Notiz oder Tag",
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
      (
        r.name +
        " " +
        r.note +
        " " +
        (r.website ?? "") +
        " " +
        (r.tags ?? []).map((tag) => tag.name).join(" ")
      )
        .toLocaleLowerCase()
        .includes(term),
    );
    count.textContent = `${filtered.length} ${title}`;
    content.replaceChildren(
      table(
        title,
        ["Name", "Notiz", "Angelegt", "Aktionen"],
        filtered.map((r) => [
          isCustomer
            ? customerIdentity(r)
            : el(
                "div",
                { class: "oj-stack service-identity" },
                link(r.name, "#/" + type + "/" + r.id),
                tagList(r.tags),
              ),
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
        !isCustomer
          ? button("Tags verwalten", () => actions.manageTags(), {
              iconName: "tags",
            })
          : null,
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
  const [row, finance] = await Promise.all([
    api("/customers/" + id),
    api("/finance/customers/" + id),
  ]);
  const employees = [...row.employees, ...row.archived_employees];
  const content = [
    heading(
      row.name,
      row.archived_at ? "Archivierter Kunde" : "Kundendetails",
      entityState(row, "customers", actions),
    ),
    row.website || row.has_logo
      ? el(
          "div",
          { class: "customer-profile oj-cluster" },
          customerLogo(row, { large: true }),
          customerWebsite(row),
        )
      : null,
    row.note ? panel("Notiz", el("p", { class: "note-text" }, row.note)) : null,
    panel(
      "Mitarbeiter",
      !row.archived_at
        ? el(
            "div",
            { class: "section-actions" },
            button(
              "Mitarbeiter anlegen",
              () => actions.entity("employees", { customer_id: row.id }),
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
    ...customerFinanceSections(finance, actions),
  ];
  return withFinanceRefresh(content, actions);
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
      "Tags",
      !row.archived_at
        ? button("Tags bearbeiten", () => actions.assignTags(row), {
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
        : el("p", { class: "oj-muted" }, "Noch keine Tags zugewiesen."),
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
export async function serviceTagManagement(actions) {
  const tags = await api("/service-tags");
  return [
    el(
      "nav",
      { class: "oj-breadcrumb", "aria-label": "Brotkrumennavigation" },
      link("Dienstleistungen", "#/services"),
    ),
    heading("Tags", "Tags für Dienstleistungen anlegen und bearbeiten.", [
      button("Tag anlegen", () => actions.tag(), {
        primary: true,
        iconName: "plus",
      }),
    ]),
    table(
      "Dienstleistungs-Tags",
      ["Tag", "Notiz", "Dienstleistungen", "Aktionen"],
      tags.map((tag) => [
        tagBadge(tag),
        el("span", { class: "note-text oj-small" }, tag.note || "–"),
        tag.service_count,
        el(
          "div",
          { class: "section-actions" },
          button("Bearbeiten", () => actions.tag(tag), { compact: true }),
          button("Löschen", () => actions.deleteTag(tag), {
            compact: true,
            danger: true,
          }),
        ),
      ]),
    ),
  ];
}
export async function pipeline(actions, params) {
  const phaseIcons = {
    open: "inbox",
    pitched: "paper-plane",
    ghosted: "ghost",
    accepted: "handshake",
    done: "circle-check",
    rejected: "circle-xmark",
  };
  const [initialRows, tags] = await Promise.all([
    api("/customer-services"),
    api("/service-tags"),
  ]);
  let rows = initialRows;
  const tagSelection = tagFilter(tags, () => render());
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
      id: "pipeline-board",
      class: "pipeline-board",
      tabindex: 0,
      role: "region",
      "aria-label": "Pipeline nach Status",
    });
  for (const control of [status, archive]) {
    const select = control.querySelector("select");
    const wrapper = el("div", { class: "pipeline-select-control" });
    select.replaceWith(wrapper);
    wrapper.append(select, icon("chevron-down"));
  }
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
  const previous = scrollButton("Vorherige Phasen anzeigen", "arrow-left", -1);
  const next = scrollButton("Nächste Phasen anzeigen", "arrow-right", 1);
  const scrollControls = el(
    "div",
    {
      class: "pipeline-scroll-controls",
      role: "group",
      "aria-label": "Pipeline scrollen",
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
    const term = search.querySelector("input").value.toLowerCase(),
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
        (r.customer_name + " " + r.service_name).toLowerCase().includes(term),
    );
    count.textContent = `${matches.length} ${matches.length === 1 ? "Angebot" : "Angebote"} · ${phases.length} ${phases.length === 1 ? "Phase" : "Phasen"}`;
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
            : el("p", { class: "oj-small oj-muted" }, "Keine Angebote."),
        );
      }),
    );
    if (selected) board.scrollLeft = 0;
    updateAfterRender();
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
      updateAfterRender();
    }
  });
  render();
  const content = [
    el(
      "div",
      {
        class: "pipeline-controls",
        role: "region",
        "aria-label": "Pipeline-Steuerung",
        tabindex: 0,
      },
      heading(
        "Pipeline",
        "Jeder Auftrag ist ein eigener Vorgang. Follow-ups gehören zum bestehenden Angebot.",
        [
          button("Neues Angebot", () => actions.offer(), {
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
    "Statusphasen",
    ["Status", "Kunde", "Beginn", "Dauer"],
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
      [
        ...(r.archived_at
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
            ]),
        button("Löschen", () => actions.deleteRelationship(r), {
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
          "Rechnungen",
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
        panel("Statusphasen", phasesTable),
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
  const content = panel(
    title,
    table(
      title,
      [
        channel ? "Kanal" : "Name",
        "Angelegt",
        "Gepitcht",
        "Ghosted",
        "Gewonnen",
        "Abgelehnt",
        "Abschlussquote",
        "Pitch → Zusage",
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
      metric("Angelegt", s.created),
      metric("Gepitcht", s.pitched),
      metric("Ghosted", s.ghosted, "Keine Rückmeldung"),
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
