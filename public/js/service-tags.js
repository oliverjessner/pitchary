import { el, icon, field, button } from "./dom.js";
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
export function tagFilter(tags, onChange, selected = []) {
  const prefix = "tag-filter-" + ++pickerNumber;
  const picker = tagPicker(tags, selected);
  picker.node.querySelector("legend").className = "oj-sr-only";
  const selection = el(
    "span",
    {
      id: prefix + "-value",
      class: "tag-filter-value",
    },
    "Alle Tags",
  );
  const summary = el(
    "summary",
    {
      class: "oj-select tag-filter-trigger",
      "aria-labelledby": prefix + "-label " + prefix + "-value",
    },
    selection,
    icon("chevron-down"),
  );
  const search = field("Tags suchen", prefix + "-search", {
    type: "search",
    placeholder: "Tag finden",
    disabled: !tags.length,
  });
  const noMatches = el(
    "p",
    {
      class: "oj-small oj-muted",
      role: "status",
      hidden: true,
    },
    "Keine Tags gefunden.",
  );
  const reset = button(
    "Auswahl zurücksetzen",
    () => {
      for (const input of picker.node.querySelectorAll("input"))
        input.checked = false;
      update();
    },
    { compact: true, iconName: "xmark" },
  );
  reset.disabled = true;
  const panel = el(
    "div",
    { class: "tag-filter-panel oj-stack" },
    search,
    el(
      "p",
      { class: "oj-small oj-muted" },
      "Zeigt Angebote mit mindestens einem ausgewählten Tag.",
    ),
    picker.node,
    noMatches,
    reset,
  );
  const details = el("details", { class: "tag-filter" }, summary, panel);
  const node = el(
    "div",
    { class: "oj-field pipeline-tag-filter" },
    el("span", { id: prefix + "-label", class: "oj-label" }, "Tags"),
    details,
  );
  function positionPanel() {
    if (!details.open || !details.isConnected) return;
    const gap = 8;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth;
    const height = viewport?.height ?? innerHeight;
    const anchor = summary.getBoundingClientRect();
    const panelWidth = Math.min(Math.max(anchor.width, 288), width - 2 * gap);
    panel.style.width = panelWidth + "px";
    panel.style.left =
      Math.max(
        left + gap,
        Math.min(anchor.left, left + width - panelWidth - gap),
      ) + "px";
    const below = top + height - anchor.bottom - gap;
    const above = anchor.top - top - gap;
    const useBelow =
      below >= Math.min(panel.scrollHeight, 320) || below >= above;
    panel.style.maxHeight = Math.max(1, useBelow ? below : above) + "px";
    const panelHeight = panel.getBoundingClientRect().height;
    panel.style.top =
      (useBelow
        ? anchor.bottom + gap
        : Math.max(top + gap, anchor.top - panelHeight - gap)) + "px";
  }
  summary.addEventListener("click", (event) => {
    event.preventDefault();
    details.open = !details.open;
    positionPanel();
  });
  details.addEventListener("toggle", positionPanel);
  function update(notify = true) {
    const ids = picker.value();
    const names = tags
      .filter((tag) => ids.includes(tag.id))
      .map((tag) => tag.name);
    selection.textContent =
      ids.length === 0
        ? "Alle Tags"
        : ids.length === 1
          ? names[0]
          : `${ids.length} Tags ausgewählt`;
    summary.title = names.join(", ");
    reset.disabled = !ids.length;
    if (notify) onChange(ids);
    positionPanel();
  }
  picker.node.addEventListener("change", () => update());
  update(false);
  search.querySelector("input").addEventListener("input", (event) => {
    const term = event.target.value.trim().normalize("NFC").toLocaleLowerCase();
    const choices = [...picker.node.querySelectorAll(".service-tag-choice")];
    choices.forEach((choice, index) => {
      choice.hidden = !tags[index].name.toLocaleLowerCase().includes(term);
    });
    noMatches.hidden = !tags.length || choices.some((choice) => !choice.hidden);
    positionPanel();
  });
  let focusFrame;
  const listeners = new AbortController();
  window.addEventListener("resize", positionPanel, {
    signal: listeners.signal,
  });
  window.addEventListener("scroll", positionPanel, {
    capture: true,
    passive: true,
    signal: listeners.signal,
  });
  window.visualViewport?.addEventListener("resize", positionPanel, {
    signal: listeners.signal,
  });
  window.visualViewport?.addEventListener("scroll", positionPanel, {
    signal: listeners.signal,
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && details.open) {
        event.preventDefault();
        event.stopPropagation();
        details.open = false;
        summary.focus({ preventScroll: true });
      } else if (event.key === "Tab" && details.contains(event.target)) {
        cancelAnimationFrame(focusFrame);
        focusFrame = requestAnimationFrame(() => {
          if (!details.contains(document.activeElement)) details.open = false;
        });
      }
    },
    { signal: listeners.signal },
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!details.contains(event.target)) details.open = false;
    },
    { signal: listeners.signal },
  );
  return {
    node,
    value: picker.value,
    dispose() {
      listeners.abort();
      cancelAnimationFrame(focusFrame);
    },
  };
}
