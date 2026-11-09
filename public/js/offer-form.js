import {
  el,
  field,
  options,
  labels,
  minor,
  money,
  decimal,
  icon,
} from "./dom.js";
import { customerLogo } from "./customer-branding.js";
import { today } from "./calendar.js";
import { t, getLocale } from "./i18n.js";
function setText(node, value) {
  if (node.textContent !== value) node.textContent = value;
}
function section(title, ...content) {
  return el(
    "fieldset",
    { class: "offer-section" },
    el("legend", { class: "oj-heading-4" }, title),
    el("div", { class: "oj-stack" }, content),
  );
}
export function createOfferForm({
  customers,
  services,
  customer,
  service,
  batch,
}) {
  const fields = [];
  if (service)
    fields.push(
      el(
        "div",
        { class: "offer-context" },
        icon("briefcase"),
        el(
          "div",
          {},
          el("p", { class: "oj-small oj-muted" }, t("Dienstleistung")),
          el("strong", {}, service.name),
        ),
        el("input", { type: "hidden", name: "service_id", value: service.id }),
      ),
    );
  else
    fields.push(
      field(t("Dienstleistung"), "service_id", {
        value: "",
        options: [
          ["", t("Dienstleistung auswählen")],
          ...services.map((s) => [s.id, s.name]),
        ],
        required: true,
        wide: true,
      }),
    );
  let customerSearch,
    customerRows = [],
    allButton,
    clearButton;
  const count = el("span", { class: "oj-small oj-muted" });
  if (batch) {
    const searchable = customers.length > 5;
    customerSearch = searchable
      ? field(t("Kunden suchen"), "customer_search", {
          type: "search",
          placeholder: t("Name oder Website"),
          autofocus: true,
        })
      : null;
    allButton = el(
      "button",
      { type: "button", class: "oj-button oj-button-ghost oj-button-compact" },
      t("Alle auswählen"),
    );
    clearButton = el(
      "button",
      {
        type: "button",
        class: "oj-button oj-button-ghost oj-button-compact",
        disabled: true,
      },
      t("Auswahl aufheben"),
    );
    customerRows = customers.map((c, i) => {
      const control = el("input", {
        class: "oj-checkbox",
        type: "checkbox",
        name: "customer_ids",
        value: c.id,
        "aria-label": c.name,
        autofocus: !searchable && i === 0,
      });
      const row = el(
        "label",
        { class: "oj-check offer-customer-option" },
        control,
        customerLogo(c),
        el(
          "span",
          { class: "offer-customer-name" },
          el("span", {}, c.name),
          c.website
            ? el(
                "span",
                { class: "oj-small oj-muted" },
                new URL(c.website).host,
              )
            : null,
        ),
      );
      return {
        row,
        control,
        term: (c.name + " " + c.website).toLocaleLowerCase(getLocale()),
      };
    });
    const noResults = el(
      "p",
      { class: "oj-small oj-muted", hidden: true },
      t("Keine passenden Kunden."),
    );
    fields.push(
      section(
        t("Kunden"),
        el(
          "div",
          { class: "offer-selection-header" },
          count,
          customers.length > 1
            ? el("div", { class: "oj-cluster" }, allButton, clearButton)
            : null,
        ),
        customerSearch,
        el(
          "div",
          {
            class: "offer-customer-list oj-scroll-area",
            "aria-label": t("Kundenauswahl"),
          },
          customerRows.map((c) => c.row),
          noResults,
        ),
      ),
    );
    if (customerSearch)
      customerSearch.querySelector("input").addEventListener("input", () => {
        const term = customerSearch
          .querySelector("input")
          .value.trim()
          .toLocaleLowerCase(getLocale());
        for (const entry of customerRows)
          entry.row.hidden = !entry.term.includes(term);
        noResults.hidden = customerRows.some((entry) => !entry.row.hidden);
        allButton.textContent = term
          ? t("Treffer auswählen")
          : t("Alle auswählen");
      });
  } else
    fields.push(
      section(
        t("Kunde & Ansprechpartner"),
        el(
          "div",
          { class: "form-grid" },
          field(t("Kunde"), "customer_id", {
            value: customer?.id ?? "",
            options: [
              ["", t("Kunde auswählen")],
              ...customers.map((c) => [c.id, c.name]),
            ],
            required: true,
            autofocus: true,
          }),
          field(t("Ansprechpartner"), "primary_employee_id", {
            options: [["", t("Zuerst Kunde auswählen")]],
            disabled: true,
          }),
        ),
      ),
    );
  const priceField = field(t("Angebotspreis"), "price", {
    value: "",
    required: true,
    inputmode: "decimal",
    placeholder: t("z. B. 400,00"),
    maxlength: 14,
  });
  const priceError = el("p", {
    class: "oj-helper oj-helper-error",
    hidden: true,
  });
  const priceHint = el(
    "p",
    { class: "oj-helper" },
    batch
      ? t(
          "Dieser Preis gilt pro Kunde. Ohne Tausendertrennzeichen, z. B. 400,00.",
        )
      : t("Ohne Tausendertrennzeichen, z. B. 400,00."),
  );
  fields.push(
    section(
      t("Angebotsdetails"),
      field(t("Angebotsdatum"), "offer_date", {
        type: "date",
        value: today(),
        required: true,
      }),
      el(
        "div",
        { class: "offer-money-row" },
        priceField,
        field(t("Währung"), "currency", {
          value: "EUR",
          options: [
            ["EUR", "EUR"],
            ["USD", "USD"],
            ["GBP", "GBP"],
          ],
        }),
      ),
      priceHint,
      priceError,
      el(
        "div",
        { class: "offer-terms-row" },
        field(t("Abrechnung"), "billing_type", {
          value: "one_time",
          options: options(labels.billing),
        }),
        field(t("Pitch-Kanal"), "pitch_channel", {
          value: "email",
          options: options(labels.channel),
        }),
      ),
    ),
  );
  const summaryTitle = el("strong", {}),
    summaryDetail = el("span", { class: "oj-small oj-muted" });
  const summary = el(
    "div",
    {
      class: "offer-summary",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
    },
    summaryTitle,
    summaryDetail,
  );
  function setup(form, { save }) {
    const price = form.elements.namedItem("price");
    let touched = false;
    priceHint.id = price.id + "-help";
    priceError.id = price.id + "-error";
    price.setAttribute("aria-describedby", priceHint.id + " " + priceError.id);
    function update() {
      const selected = batch
        ? customerRows.filter((c) => c.control.checked).length
        : form.elements.namedItem("customer_id").value
          ? 1
          : 0;
      let amount = null,
        priceMessage = "";
      try {
        if (price.value.trim()) amount = minor(price.value);
      } catch (error) {
        priceMessage = error.message;
      }
      price.setCustomValidity(priceMessage);
      setText(priceError, priceMessage);
      priceError.hidden = !touched || !priceMessage;
      if (touched && priceMessage) price.setAttribute("aria-invalid", "true");
      else price.removeAttribute("aria-invalid");
      if (batch) {
        setText(
          count,
          t("{selected} von {total} ausgewählt", {
            selected,
            total: customers.length,
          }),
        );
        clearButton.disabled = !selected;
        allButton.disabled = customerRows
          .filter((c) => !c.row.hidden)
          .every((c) => c.control.checked);
      }
      const currency = form.elements.namedItem("currency").value,
        billing = form.elements.namedItem("billing_type").value;
      setText(
        summaryTitle,
        selected === 0
          ? batch
            ? t("Kunden auswählen")
            : t("Kunde auswählen")
          : selected === 1
            ? t("1 eigenständiges Angebot")
            : t("{count} eigenständige Angebote", { count: selected }),
      );
      setText(
        summaryDetail,
        selected > 100
          ? t("Maximal 100 Kunden pro Durchgang.")
          : amount === null
            ? t("Angebotspreis eintragen.")
            : batch
              ? t("{amount} pro Kunde · {billing}", {
                  amount: money(amount, currency),
                  billing: labels.billing[billing],
                })
              : t("{amount} · {billing}", {
                  amount: money(amount, currency),
                  billing: labels.billing[billing],
                }),
      );
      if (!save.hasAttribute("aria-busy"))
        save.disabled =
          !selected ||
          selected > 100 ||
          amount === null ||
          !form.checkValidity();
      setText(
        save,
        batch
          ? selected
            ? selected === 1
              ? t("{count} Angebot anlegen", { count: selected })
              : t("{count} Angebote anlegen", { count: selected })
            : t("Angebote anlegen")
          : t("Angebot anlegen"),
      );
    }
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    price.addEventListener("blur", () => {
      touched = true;
      try {
        if (price.value.trim()) {
          const formatted = decimal(minor(price.value));
          if (formatted !== price.value) price.value = formatted;
        }
      } catch {}
      update();
    });
    if (batch) {
      allButton.addEventListener("click", () => {
        for (const entry of customerRows)
          if (!entry.row.hidden) entry.control.checked = true;
        update();
      });
      clearButton.addEventListener("click", () => {
        for (const entry of customerRows) entry.control.checked = false;
        update();
      });
    }
    update();
    return update;
  }
  return { fields, summary, setup };
}
