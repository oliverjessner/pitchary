import { el, icon, link, button } from "./dom.js";
import { api } from "./api.js";
import { t } from "./i18n.js";
let editorNumber = 0;
export function customerLogo(row, { large = false } = {}) {
  const frame = el(
    "span",
    { class: "customer-logo" + (large ? " customer-logo-large" : "") },
    icon("building"),
  );
  if (row.logo_url) {
    const image = el("img", {
      src: row.logo_url,
      alt: t("Logo von {name}", { name: row.name }),
      width: large ? 64 : 36,
      height: large ? 64 : 36,
      decoding: "async",
      onerror: () => image.remove(),
      onload: () => frame.querySelector("i")?.remove(),
    });
    frame.append(image);
  }
  return frame;
}
export function customerWebsite(row) {
  if (!row.website) return null;
  return el(
    "a",
    {
      class: "oj-link customer-website",
      href: row.website,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    new URL(row.website).host,
    icon("arrow-up-right-from-square"),
    el("span", { class: "oj-sr-only" }, t(" (öffnet in neuem Tab)")),
  );
}
export function customerIdentity(row) {
  return el(
    "div",
    { class: "customer-identity" },
    customerLogo(row),
    el("div", { class: "oj-stack" }, link(row.name, "#/customers/" + row.id)),
  );
}
export function customerProfile(row) {
  if (row.archived_at && !row.website && !row.has_logo) return null;
  let logo = customerLogo(row, { large: true });
  const website = el(
    "span",
    { class: "customer-profile-website", hidden: !row.website },
    customerWebsite(row),
  );
  const identity = el("div", { class: "oj-cluster" }, logo, website);
  if (row.archived_at)
    return el("div", { class: "customer-profile oj-stack" }, identity);
  const hint = t(
    "Füge eine Website oder Firmen-E-Mail hinzu, um das Icon neu zu laden.",
  );
  const hintId = "customer-icon-hint-" + row.id;
  const label = el("span", {}, t("Icon neu laden"));
  const message = el("p", {
    class: "oj-helper",
    role: "status",
    "aria-live": "polite",
    hidden: true,
  });
  const refetch = button(
    label,
    async () => {
      if (refetch.disabled) return;
      refetch.disabled = true;
      refetch.setAttribute("aria-busy", "true");
      label.textContent = t("Icon wird geladen …");
      message.hidden = true;
      message.classList.remove("oj-helper-error");
      try {
        const result = await api("/customers/" + row.id + "/logo/refetch", {
          method: "POST",
        });
        const previousLogo = row.logo_url;
        Object.assign(row, result.record);
        if (result.refreshed || row.logo_url !== previousLogo) {
          const next = customerLogo(row, { large: true });
          logo.replaceWith(next);
          logo = next;
        }
        website.replaceChildren(...[customerWebsite(row)].filter(Boolean));
        website.hidden = !row.website;
        message.textContent = result.refreshed
          ? t("Icon wurde neu geladen.")
          : row.has_logo
            ? t("Kein neues Icon gefunden. Das bisherige Icon bleibt erhalten.")
            : t("Kein Icon gefunden.");
      } catch {
        message.textContent = t(
          "Icon konnte nicht neu geladen werden. Bitte erneut versuchen.",
        );
        message.classList.add("oj-helper-error");
      } finally {
        message.hidden = false;
        refetch.disabled = Boolean(
          row.archived_at || (!row.website && !row.general_email),
        );
        refetch.setAttribute("aria-busy", "false");
        label.textContent = t("Icon neu laden");
      }
    },
    { iconName: "rotate-right", disabled: !row.website && !row.general_email },
  );
  if (refetch.disabled) {
    refetch.title = hint;
    refetch.setAttribute("aria-describedby", hintId);
  }
  identity.append(refetch);
  return el(
    "div",
    { class: "customer-profile oj-stack" },
    identity,
    refetch.disabled
      ? el("p", { class: "oj-helper", id: hintId }, hint)
      : null,
    message,
  );
}
export function logoEditor(row) {
  const id = "customer-logo-" + ++editorNumber;
  let pending;
  let error = null;
  let generation = 0;
  let ready = Promise.resolve();
  let previewUrl;
  const input = el("input", {
    type: "file",
    name: "logo",
    id,
    class: "oj-input",
    accept: "image/png,image/jpeg,image/webp",
    "aria-describedby": [
      id + "-help",
      id + "-error",
      !row?.id ? id + "-auto" : null,
    ]
      .filter(Boolean)
      .join(" "),
  });
  const preview = el(
    "div",
    { class: "customer-logo-preview" },
    row?.logo_url
      ? customerLogo(row, { large: true })
      : el("span", { class: "oj-small oj-muted" }, t("Noch kein Logo.")),
  );
  const message = el("p", {
    id: id + "-error",
    class: "oj-helper oj-helper-error",
    role: "alert",
    hidden: true,
  });
  const remove = el(
    "button",
    {
      class: "oj-button oj-button-secondary oj-button-compact",
      type: "button",
      disabled: !row?.has_logo,
      onclick: () => {
        generation++;
        pending = null;
        error = null;
        input.value = "";
        message.hidden = true;
        input.removeAttribute("aria-invalid");
        preview.replaceChildren(
          el(
            "span",
            { class: "oj-small oj-muted" },
            t("Logo wird beim Speichern entfernt."),
          ),
        );
        remove.disabled = true;
        revokePreview();
      },
    },
    t("Logo entfernen"),
  );
  function revokePreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = undefined;
    }
  }
  input.addEventListener("change", () => {
    const file = input.files[0];
    const token = ++generation;
    error = null;
    message.hidden = true;
    input.removeAttribute("aria-invalid");
    if (!file) return;
    pending = undefined;
    ready = (async () => {
      let url;
      try {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
          throw new Error(t("Bitte ein PNG-, JPEG- oder WebP-Logo auswählen."));
        if (!file.size || file.size > 1048576)
          throw new Error(t("Das Logo darf maximal 1 MiB groß sein."));
        url = URL.createObjectURL(file);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          if (
            !image.naturalWidth ||
            !image.naturalHeight ||
            image.naturalWidth > 4096 ||
            image.naturalHeight > 4096
          )
            throw new Error(
              t("Das Logo darf maximal 4096 × 4096 Pixel groß sein."),
            );
        } catch (err) {
          URL.revokeObjectURL(url);
          throw new Error(
            err.message.includes("4096")
              ? err.message
              : t("Die Datei lässt sich nicht als Bild öffnen."),
          );
        }
        if (token !== generation) {
          URL.revokeObjectURL(url);
          return;
        }
        const encoded = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = () =>
            reject(new Error(t("Die Logo-Datei konnte nicht gelesen werden.")));
          reader.readAsDataURL(file);
        });
        if (token !== generation) {
          URL.revokeObjectURL(url);
          return;
        }
        pending = { mime_type: file.type, data_base64: encoded };
        revokePreview();
        previewUrl = url;
        preview.replaceChildren(
          el("img", {
            class: "customer-logo customer-logo-large",
            src: url,
            alt: t("Vorschau des Kundenlogos"),
            width: 64,
            height: 64,
          }),
        );
        remove.disabled = false;
      } catch (err) {
        if (token !== generation) return;
        error = err;
        message.textContent = err.message;
        message.hidden = false;
        input.setAttribute("aria-invalid", "true");
      } finally {
        if (url && url !== previewUrl) URL.revokeObjectURL(url);
      }
    })();
  });
  const node = el(
    "div",
    { class: "oj-field wide" },
    el("label", { class: "oj-label", for: id }, t("Logo hochladen")),
    !row?.id
      ? el(
          "p",
          { class: "oj-helper", id: id + "-auto" },
          t(
            "Das Logo wird anhand der Website oder E-Mail-Domain automatisch gesucht.",
          ),
        )
      : null,
    input,
    el(
      "p",
      { class: "oj-helper", id: id + "-help" },
      t("PNG, JPEG oder WebP · maximal 1 MiB und 4096 × 4096 Pixel."),
    ),
    message,
    el("div", { class: "oj-cluster" }, preview, remove),
  );
  return {
    node,
    async value() {
      let current;
      do {
        current = ready;
        await current;
      } while (current !== ready);
      if (error) {
        error.fields = { logo: error.message };
        throw error;
      }
      return pending;
    },
    cleanup() {
      generation++;
      revokePreview();
    },
  };
}
