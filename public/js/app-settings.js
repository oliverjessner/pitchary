import { api } from "./api.js";
import { el, field, panel } from "./dom.js";
import { t, getLanguage } from "./i18n.js";

export function languagePreferences() {
  const error = el("p", {
    role: "alert",
    class: "oj-alert oj-alert-danger",
    hidden: true,
  });
  const save = el(
    "button",
    { type: "submit", class: "oj-button oj-button-primary" },
    t("Sprache speichern"),
  );
  const form = el(
    "form",
    {
      class: "oj-stack",
      onsubmit: async (event) => {
        event.preventDefault();
        if (save.disabled) return;
        save.disabled = true;
        error.hidden = true;
        try {
          await api("/settings", {
            method: "PATCH",
            body: { language: new FormData(form).get("language") },
          });
          location.reload();
        } catch (failure) {
          error.textContent = failure.message;
          error.hidden = false;
          save.disabled = false;
        }
      },
    },
    field(t("Sprache der Oberfläche"), "language", {
      value: getLanguage(),
      options: [
        ["de", "Deutsch"],
        ["en", "English"],
      ],
      helper: t("Die Sprache bleibt nach einem Neustart erhalten."),
    }),
    error,
    el("div", { class: "form-actions" }, save),
  );
  return panel(t("Sprache"), form);
}
