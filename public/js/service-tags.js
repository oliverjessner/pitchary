import { el } from "./dom.js";
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
            "Noch keine Tags vorhanden. Lege sie über „Tags verwalten“ bei den Dienstleistungen an.",
          ),
    ),
    value: () =>
      inputs.filter((input) => input.checked).map((input) => input.value),
  };
}
