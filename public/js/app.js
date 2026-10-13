import { initOJ, toast } from "../vendor/oj-designsystem/index.js";
import { el, heading, button } from "./dom.js";
import { createActions } from "./dialogs.js";
import * as views from "./views.js";
import * as financeViews from "./finance.js";
const main = document.querySelector("#main");
let cleanup = () => {},
  generation = 0,
  navigationFrame = 0;
function revealPipelineNavigation(token) {
  if (
    !main.classList.contains("view-pipeline") ||
    !window.matchMedia("(max-width: 700px)").matches
  )
    return;
  document.fonts.ready.then(() => {
    if (token !== generation) return;
    cancelAnimationFrame(navigationFrame);
    navigationFrame = requestAnimationFrame(() => {
      navigationFrame = 0;
      if (
        token !== generation ||
        !main.classList.contains("view-pipeline") ||
        !window.matchMedia("(max-width: 700px)").matches
      )
        return;
      const current = document.querySelector(
        'nav[aria-label="Hauptnavigation"] a[aria-current="page"]',
      );
      if (!current) return;
      const nav = current.parentElement,
        target = current.getBoundingClientRect(),
        bounds = nav.getBoundingClientRect();
      const left =
        target.left < bounds.left
          ? target.left - bounds.left
          : target.right > bounds.right
            ? target.right - bounds.right
            : 0;
      if (left) nav.scrollBy({ left, behavior: "instant" });
    });
  });
}
const navigate = (path) => {
  location.hash = "#" + path;
};
const actions = {
  ...createActions(() => render(false), navigate),
  ...financeViews.createFinanceActions(() => render(false), navigate),
};
function safeActions(actions) {
  return Object.fromEntries(
    Object.entries(actions).map(([name, fn]) => [
      name,
      (...args) =>
        Promise.resolve()
          .then(() => fn(...args))
          .catch((error) =>
            toast(error.message, { type: "error", dismissLabel: "Schließen" }),
          ),
    ]),
  );
}
const guarded = safeActions(actions);
async function render(focus = true) {
  cancelAnimationFrame(navigationFrame);
  const token = ++generation;
  const [route, query = ""] = (location.hash.slice(1) || "/dashboard").split(
    "?",
  );
  const [section, id] = route.split("/").filter(Boolean);
  const params = new URLSearchParams(query);
  if (section === "finance") {
    location.replace("#/dashboard" + (query ? "?" + query : ""));
    return;
  }
  if (section === "new-offer") {
    navigate("/pipeline");
    await guarded.offer();
    return;
  }
  const focused = document.activeElement;
  const focusLabel = focused?.textContent;
  main.setAttribute("aria-busy", "true");
  try {
    let content;
    if (section === "dashboard")
      content = await views.dashboard(guarded, params);
    else if (section === "customers")
      content = id
        ? await views.customerDetail(id, guarded)
        : await views.entityList("customers", guarded);
    else if (section === "services")
      content =
        id === "tags"
          ? await views.serviceTagManagement(guarded)
          : id
            ? await views.serviceDetail(id, guarded)
            : await views.entityList("services", guarded);
    else if (section === "pipeline")
      content = await views.pipeline(guarded, params);
    else if (section === "relationships" && id)
      content = await views.relationshipDetail(id, guarded);
    else if (section === "activities")
      content = await views.activities(guarded);
    else if (section === "analytics") content = await views.analytics();
    else if (section === "invoices")
      content = id
        ? await financeViews.invoiceDetail(id, guarded)
        : await financeViews.invoiceList(guarded, params);
    else if (section === "finance-customers")
      content = id
        ? await financeViews.financeCustomer(id, guarded)
        : await financeViews.financeCustomers(guarded, params);
    else if (section === "finance-settings")
      content = await financeViews.financeSettings(guarded);
    else
      content = [
        heading("Seite nicht gefunden"),
        button("Zum Dashboard", () => navigate("/dashboard")),
      ];
    if (token !== generation) {
      content.dispose?.();
      return;
    }
    cleanup();
    main.replaceChildren(...content.filter(Boolean));
    const cleanupOJ = initOJ(main);
    cleanup = () => {
      content.dispose?.();
      cleanupOJ();
    };
    document
      .querySelectorAll('nav[aria-label="Hauptnavigation"] a')
      .forEach((a) => {
        if (
          a.hash ===
          "#/" +
            (section === "relationships"
              ? "pipeline"
              : section === "finance-customers"
                ? "customers"
                : section)
        )
          a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      });
    document.title =
      (main.querySelector("h1")?.textContent ?? "CRM") + " · Pitchary";
    if (focus) main.querySelector("h1")?.focus({ preventScroll: true });
    else if (focusLabel) {
      [...main.querySelectorAll("button,a")]
        .find((n) => n.textContent === focusLabel)
        ?.focus({ preventScroll: true });
    }
  } catch (error) {
    if (token !== generation) return;
    cleanup();
    main.replaceChildren(
      heading("Ansicht konnte nicht geladen werden"),
      el(
        "p",
        { class: "oj-alert oj-alert-danger", role: "alert" },
        error.message,
      ),
      button("Erneut laden", () => render()),
    );
    cleanup = initOJ(main);
  } finally {
    if (token === generation) {
      main.classList.toggle("view-pipeline", section === "pipeline");
      main.classList.toggle("view-dashboard", section === "dashboard");
      if (section === "pipeline") revealPipelineNavigation(token);
      main.setAttribute("aria-busy", "false");
    }
  }
}
window.addEventListener("hashchange", () => render());
window.addEventListener("resize", () => revealPipelineNavigation(generation));
await render();
