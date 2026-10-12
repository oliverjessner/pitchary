import {
  initOJ,
  openDialog,
  closeDialog,
  confirmDialog,
  toast,
} from "../vendor/oj-designsystem/index.js";
import { api } from "./api.js";
import { el, button, field, options, labels, minor, decimal } from "./dom.js";
let modalNumber = 0;
export function showForm(
  title,
  fields,
  submit,
  {
    submitLabel = "Speichern",
    onSaved = () => {},
    onMount,
    description,
    successMessage = "Gespeichert.",
  } = {},
) {
  const trigger = document.activeElement;
  const id = "modal-" + ++modalNumber;
  const error = el("p", {
    class: "oj-inline-message",
    role: "alert",
    "data-oj-kind": "error",
    hidden: true,
  });
  const save = el(
    "button",
    { class: "oj-button oj-button-primary", type: "submit" },
    submitLabel,
  );
  const form = el(
    "form",
    { class: "oj-stack" },
    description ? el("p", { class: "oj-muted" }, description) : null,
    el("div", { class: "form-grid" }, fields),
    error,
    el(
      "div",
      { class: "form-actions" },
      el(
        "button",
        {
          type: "button",
          class: "oj-button oj-button-secondary",
          "data-oj-dialog-close": "",
        },
        "Abbrechen",
      ),
      save,
    ),
  );
  const dialog = el(
    "dialog",
    {
      id,
      class: "oj-dialog",
      "data-oj-dialog": "",
      "aria-labelledby": id + "-title",
    },
    el(
      "header",
      { class: "oj-dialog-header" },
      el("h2", { class: "oj-dialog-title", id: id + "-title" }, title),
    ),
    el("div", { class: "oj-dialog-body" }, form),
  );
  document.querySelector("#dialogs").append(dialog);
  const cleanup = initOJ(dialog);
  dialog.addEventListener(
    "close",
    () => {
      cleanup();
      dialog.remove();
    },
    { once: true },
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    save.setAttribute("aria-busy", "true");
    error.hidden = true;
    try {
      const result = await submit(Object.fromEntries(new FormData(form)), form);
      closeDialog(dialog, "saved");
      if (successMessage)
        toast(successMessage, { type: "success", dismissLabel: "Schließen" });
      await onSaved(result);
    } catch (err) {
      if (dialog.isConnected) {
        error.textContent = err.message;
        error.hidden = false;
        for (const input of form.querySelectorAll("[aria-invalid]"))
          input.removeAttribute("aria-invalid");
        for (const key of Object.keys(err.fields ?? {})) {
          const input = form.elements.namedItem(key);
          if (input?.setAttribute) {
            input.setAttribute("aria-invalid", "true");
            input.setAttribute("aria-describedby", id + "-error");
          }
        }
        error.id = id + "-error";
        error.tabIndex = -1;
        error.focus();
      } else toast(err.message, { type: "error", dismissLabel: "Schließen" });
    } finally {
      save.disabled = false;
      save.removeAttribute("aria-busy");
    }
  });
  onMount?.(form);
  openDialog(dialog, { trigger });
  return dialog;
}
export function createActions(refresh, navigate) {
  async function archive(type, row, restore = false) {
    if (
      !restore &&
      !(await confirmDialog({
        title: "Archivieren?",
        message: `„${row.name ?? row.service_name}“ bleibt mit allen historischen Beziehungen erhalten.`,
        confirmLabel: "Archivieren",
        cancelLabel: "Abbrechen",
      }))
    )
      return;
    try {
      await api(`/${type}/${row.id}${restore ? "/restore" : ""}`, {
        method: restore ? "POST" : "DELETE",
      });
      toast(restore ? "Wiederhergestellt." : "Archiviert.", {
        type: "success",
        dismissLabel: "Schließen",
      });
      await refresh();
    } catch (err) {
      toast(err.message, { type: "error", dismissLabel: "Schließen" });
    }
  }
  function entity(type, row) {
    const employee = type === "employees";
    const fields = [
      field(employee ? "Name" : "Name", "name", {
        value: row?.name ?? "",
        required: true,
        maxlength: 200,
        autofocus: true,
      }),
      ...(employee
        ? [
            field("E-Mail", "email", {
              value: row?.email ?? "",
              type: "email",
              maxlength: 500,
            }),
            field("Position", "position", {
              value: row?.position ?? "",
              maxlength: 500,
            }),
            field("LinkedIn", "linkedin", {
              value: row?.linkedin ?? "",
              type: "url",
              maxlength: 500,
            }),
          ]
        : [
            field("Notiz", "note", {
              type: "textarea",
              value: row?.note ?? "",
              wide: true,
              maxlength: 10000,
            }),
          ]),
    ];
    return showForm(
      row?.id
        ? "Bearbeiten"
        : employee
          ? "Mitarbeiter anlegen"
          : type === "customers"
            ? "Kunde anlegen"
            : "Dienstleistung anlegen",
      fields,
      (data) =>
        api(`/${type}${row?.id ? "/" + row.id : ""}`, {
          method: row?.id ? "PATCH" : "POST",
          body:
            employee && !row?.id
              ? { ...data, customer_id: row.customer_id }
              : data,
        }),
      {
        onSaved: async (result) => {
          if (!row?.id && !employee) navigate(`/${type}/${result.id}`);
          else await refresh();
        },
      },
    );
  }
  async function offer({ customer, service, batch = false } = {}) {
    const [customers, services] = await Promise.all([
      api("/customers"),
      api("/services"),
    ]);
    if (!customers.length || !services.length) {
      toast(
        "Bitte zuerst mindestens einen Kunden und eine Dienstleistung anlegen.",
        { type: "warning", dismissLabel: "Schließen" },
      );
      return;
    }
    let fields = [];
    if (batch) {
      fields.push(
        el(
          "fieldset",
          { class: "wide oj-stack" },
          el("legend", { class: "oj-label" }, "Kunden auswählen"),
          el(
            "div",
            { class: "form-checks" },
            customers.map((c) =>
              el(
                "label",
                { class: "oj-check" },
                el("input", {
                  class: "oj-checkbox",
                  type: "checkbox",
                  name: "customer_ids",
                  value: c.id,
                }),
                c.name,
              ),
            ),
          ),
        ),
      );
    } else
      fields.push(
        field("Kunde", "customer_id", {
          value: customer?.id ?? customers[0].id,
          options: customers.map((c) => [c.id, c.name]),
          required: true,
        }),
      );
    fields.push(
      field("Dienstleistung", "service_id", {
        value: service?.id ?? services[0].id,
        options: services.map((s) => [s.id, s.name]),
        required: true,
      }),
    );
    if (!batch)
      fields.push(
        field("Ansprechpartner", "primary_employee_id", {
          options: [["", "Kein Ansprechpartner"]],
        }),
      );
    fields.push(
      field("Angebotspreis", "price", {
        required: true,
        value: "",
        inputmode: "decimal",
        helper:
          "Ohne Tausendertrennzeichen, z. B. 1200,50. Maximal zwei Nachkommastellen.",
      }),
      field("Währung", "currency", {
        value: "EUR",
        options: [
          ["EUR", "EUR"],
          ["USD", "USD"],
          ["GBP", "GBP"],
        ],
      }),
      field("Abrechnung", "billing_type", {
        value: "one_time",
        options: options(labels.billing),
      }),
      field("Ursprünglicher Pitch-Kanal", "pitch_channel", {
        value: "email",
        options: options(labels.channel),
      }),
    );
    showForm(
      batch ? "Dienstleistung mehreren Kunden anbieten" : "Neues Angebot",
      fields,
      (data, form) => {
        const body = {
          service_id: data.service_id,
          current_offered_price_minor: minor(data.price),
          currency: data.currency,
          billing_type: data.billing_type,
          pitch_channel: data.pitch_channel,
        };
        if (batch)
          body.customer_ids = new FormData(form).getAll("customer_ids");
        else {
          body.customer_id = data.customer_id;
          body.primary_employee_id = data.primary_employee_id || null;
        }
        return api("/customer-services" + (batch ? "/batch" : ""), {
          method: "POST",
          body,
        });
      },
      {
        submitLabel: "Angebot anlegen",
        description:
          "Ein neuer Auftrag bekommt einen eigenen Vorgang. Follow-ups zu einem laufenden Angebot werden im bestehenden Vorgang erfasst.",
        onSaved: async (r) => {
          if (batch) await refresh();
          else navigate("/relationships/" + r.id);
        },
        onMount: (form) => {
          if (batch) return;
          const select = form.elements.namedItem("primary_employee_id");
          let generation = 0;
          const load = async () => {
            const token = ++generation;
            select.disabled = true;
            try {
              const items = await api("/employees", {
                query: {
                  customer_id: form.elements.namedItem("customer_id").value,
                },
              });
              if (token !== generation || !form.isConnected) return;
              select.replaceChildren(
                el("option", { value: "" }, "Kein Ansprechpartner"),
                ...items.map((e) => el("option", { value: e.id }, e.name)),
              );
            } catch (err) {
              toast(err.message, { type: "error", dismissLabel: "Schließen" });
            } finally {
              if (token === generation) select.disabled = false;
            }
          };
          form.elements
            .namedItem("customer_id")
            .addEventListener("change", load);
          load();
        },
      },
    );
  }
  function status(row, to) {
    const rejected = to === "rejected",
      resuming = row.status === "rejected";
    const fields = [
      field("Zeitpunkt", "occurred_at", {
        type: "datetime-local",
        step: "any",
        value: localTime(new Date()),
        required: true,
        wide: true,
        helper:
          "Beginn dieser Statusphase. Keine Zeitpunkte vor der aktuellen Phase oder in der Zukunft.",
      }),
    ];
    if (to === "accepted")
      fields.push(
        field("Vereinbarter Preis (" + row.currency + ")", "price", {
          value: decimal(row.current_offered_price_minor),
          required: true,
          inputmode: "decimal",
        }),
      );
    if (rejected)
      fields.push(
        field("Absagegrund", "code", {
          value: "budget",
          options: options(labels.reason),
          required: true,
        }),
      );
    fields.push(
      field(
        resuming ? "Grund für die Wiederaufnahme" : "Ergänzende Notiz",
        "note",
        { type: "textarea", required: resuming, wide: true, maxlength: 2000 },
      ),
    );
    showForm(
      resuming ? "Angebot wieder aufnehmen" : labels.status[to],
      fields,
      (data) =>
        api(`/customer-services/${row.id}/status`, {
          method: "POST",
          body: {
            status: to,
            expected_status: row.status,
            occurred_at: new Date(data.occurred_at).toISOString(),
            ...(to === "accepted"
              ? { accepted_price_minor: minor(data.price) }
              : {}),
            ...(rejected
              ? { reason: { code: data.code, note: data.note } }
              : data.note
                ? { reason: data.note }
                : {}),
          },
        }),
      { onSaved: refresh },
    );
  }
  function prices(row) {
    const fieldName = ["accepted", "done"].includes(row.status)
      ? "accepted_price_minor"
      : "current_offered_price_minor";
    showForm(
      "Preis ändern",
      [
        field("Preisfeld", "field", {
          value: fieldName,
          options: [
            [
              fieldName,
              fieldName === "accepted_price_minor"
                ? "Vereinbarter Preis"
                : "Aktueller Angebotspreis",
            ],
          ],
        }),
        field("Neuer Preis (" + row.currency + ")", "price", {
          value: decimal(row[fieldName]),
          required: true,
          inputmode: "decimal",
        }),
        field("Begründung", "note", {
          type: "textarea",
          wide: true,
          maxlength: 2000,
        }),
      ],
      (data) =>
        api(`/customer-services/${row.id}/prices`, {
          method: "POST",
          body: {
            field: data.field,
            price_minor: minor(data.price),
            note: data.note,
          },
        }),
      {
        description:
          "Der ursprüngliche Pitch-Preis bleibt erhalten. Jede Änderung wird in der Timeline protokolliert.",
        onSaved: refresh,
      },
    );
  }
  async function activity(row) {
    const employees = await api("/employees", {
      query: { customer_id: row.customer_id },
    });
    showForm(
      "Aktivität hinzufügen",
      [
        field("Aktivität", "type", {
          value: "follow_up",
          options: options(
            Object.fromEntries(
              Object.entries(labels.activity).filter(
                ([k]) =>
                  k !== "price_change" &&
                  (k !== "pitch" || row.status !== "open"),
              ),
            ),
          ),
        }),
        field("Kanal", "channel", {
          value: "email",
          options: options(labels.channel, "Kein Kanal"),
        }),
        field("Mitarbeiter", "employee_id", {
          value: row.primary_employee_id ?? "",
          options: [
            ["", "Kein Ansprechpartner"],
            ...employees.map((e) => [e.id, e.name]),
          ],
        }),
        field("Zeitpunkt", "occurred_at", {
          type: "datetime-local",
          step: "any",
          value: localTime(new Date()),
          required: true,
        }),
        field("Notiz", "note", {
          type: "textarea",
          wide: true,
          required: true,
          maxlength: 10000,
        }),
      ],
      (data) =>
        api(`/customer-services/${row.id}/activities`, {
          method: "POST",
          body: {
            ...data,
            employee_id: data.employee_id || null,
            channel: data.channel || null,
            occurred_at: new Date(data.occurred_at).toISOString(),
          },
        }),
      {
        description: "Eine Kontaktaktivität ändert den Angebotsstatus nicht.",
        onSaved: refresh,
      },
    );
  }
  async function relationship(row) {
    const employees = await api("/employees", {
      query: { customer_id: row.customer_id },
    });
    if (
      row.primary_employee_id &&
      !employees.some((e) => e.id === row.primary_employee_id)
    )
      employees.push({
        id: row.primary_employee_id,
        name: row.employee_name + " (archiviert)",
      });
    const fields = [
      field("Ansprechpartner", "primary_employee_id", {
        value: row.primary_employee_id ?? "",
        options: [
          ["", "Kein Ansprechpartner"],
          ...employees.map((e) => [e.id, e.name]),
        ],
      }),
    ];
    if (row.first_pitched_price_minor === null)
      fields.push(
        field("Pitch-Kanal", "pitch_channel", {
          value: row.pitch_channel,
          options: options(labels.channel),
        }),
        field("Währung", "currency", {
          value: row.currency,
          options: [
            ["EUR", "EUR"],
            ["USD", "USD"],
            ["GBP", "GBP"],
          ],
        }),
        field("Abrechnung", "billing_type", {
          value: row.billing_type,
          options: options(labels.billing),
        }),
      );
    showForm(
      "Angebot bearbeiten",
      fields,
      (data) =>
        api("/customer-services/" + row.id, {
          method: "PATCH",
          body: {
            ...data,
            primary_employee_id: data.primary_employee_id || null,
          },
        }),
      {
        onSaved: refresh,
        description:
          row.first_pitched_price_minor !== null
            ? "Der ursprüngliche Kanal und die Preiseinheit sind seit dem ersten Pitch festgehalten."
            : undefined,
      },
    );
  }
  return { archive, entity, offer, status, prices, activity, relationship };
}
function localTime(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 23);
}
