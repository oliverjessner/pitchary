import { createMultiselect } from "../vendor/oj-designsystem/index.js";
import { el, icon } from "./dom.js";
let pickerNumber = 0;
export function tagBadge(tag) {
  const badge = el(
    "span",
    {
      class: "service-tag",
      "data-tag-id": tag.id,
      title: tag.note || undefined,
    },
    el("span", { class: "service-tag-dot", "aria-hidden": "true" }),
    tag.name,
  );
  badge.style.setProperty("--tag-color", tag.color);
  return badge;
}
export function tagList(tags = []) {
  return tags.length
    ? el("div", { class: "service-tag-list" }, tags.map(tagBadge))
    : null;
}
export function tagPicker(tags, selected = []) {
  const chosen = new Set(selected),
    inputs = [];
  const prefix = "tag-picker-" + ++pickerNumber;
  const choices = tags.map((tag) => {
    const id = prefix + "-" + tag.id;
    const input = el("input", {
      type: "checkbox",
      id,
      value: tag.id,
      checked: chosen.has(tag.id),
    });
    inputs.push(input);
    return el(
      "label",
      { class: "service-tag-choice", for: id },
      input,
      tagBadge(tag),
    );
  });
  return {
    node: el(
      "fieldset",
      { class: "tag-picker wide" },
      el("legend", { class: "oj-label" }, "Tags"),
      tags.length
        ? el("div", { class: "service-tag-options" }, choices)
        : el(
            "p",
            { class: "oj-small oj-muted" },
            "Noch keine Tags vorhanden. Lege sie über „Tags verwalten“ bei Kunden oder Dienstleistungen an.",
          ),
    ),
    value: () =>
      inputs.filter((input) => input.checked).map((input) => input.value),
  };
}
export function tagFilter(
  tags,
  onChange,
  selected = [],
  {
    description = "Zeigt Angebote mit mindestens einem ausgewählten Tag.",
  } = {},
) {
  const picker = createMultiselect({
    label: "Tags",
    options: tags.map((tag) => ({ value: tag.id, label: tag.name })),
    value: selected,
    description,
    labels: {
      placeholder: "Alle Tags",
      search: "Tags suchen",
      searchPlaceholder: "Tag finden",
      reset: "Auswahl zurücksetzen",
      empty: "Noch keine Tags vorhanden.",
      noResults: "Keine Tags gefunden.",
    },
    formatSelection: (options) =>
      options.length === 0
        ? "Alle Tags"
        : options.length === 1
          ? options[0].label
          : `${options.length} Tags ausgewählt`,
  });
  const change = (event) => onChange(event.detail.value);
  picker.node.addEventListener("oj:change", change);
  return {
    node: picker.node,
    value: picker.value,
    dispose() {
      picker.node.removeEventListener("oj:change", change);
      picker.dispose();
    },
  };
}
