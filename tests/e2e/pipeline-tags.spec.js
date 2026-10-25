import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

test("pipeline tag multiselect combines tags, search, status and archives with keyboard and mobile support", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:3218/#/pipeline");
  const trigger = page.locator(".oj-multiselect-trigger");
  const dropdown = page.locator("[data-oj-multiselect]");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Tags suchen", { exact: true })).toBeDisabled();
  await expect(dropdown).toContainText("Noch keine Tags vorhanden.");
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();

  const create = async (resource, data) => {
    const response = await request.post(`/api/${resource}`, { data });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const suffix = testInfo.project.name;
  const web = await create("service-tags", {
    name: "Web Filter " + suffix,
    color: "#4d8dff",
  });
  const support = await create("service-tags", {
    name: "Support Filter " + suffix,
    color: "#ff6b35",
  });
  const unused = await create("service-tags", {
    name: "Unbenutzt Filter " + suffix,
  });
  for (let i = 0; i < 12; i++)
    await create("service-tags", {
      name: `Zusätzlicher sehr langer Tag für Dienstleistungen ${i} ${suffix}`,
    });
  const prefix = "Tagfilter " + suffix;
  const customer = await create("customers", { name: prefix });
  const services = [];
  const offers = [];
  for (const [name, tag_ids] of [
    ["Alpha", [web.id]],
    ["Beta", [support.id]],
    ["Gamma", [web.id, support.id]],
    ["Ohne", []],
  ]) {
    const service = await create("services", {
      name: prefix + " " + name,
      tag_ids,
    });
    services.push(service);
    offers.push(
      await create("customer-services", {
        customer_id: customer.id,
        service_id: service.id,
        current_offered_price_minor: 40000,
      }),
    );
  }
  expect(
    (
      await request.post(`/api/customer-services/${offers[1].id}/status`, {
        data: { status: "pitched" },
      })
    ).ok(),
  ).toBe(true);
  const archived = await create("customer-services", {
    customer_id: customer.id,
    service_id: services[2].id,
    current_offered_price_minor: 40000,
  });
  expect(
    (await request.delete(`/api/customer-services/${archived.id}`)).ok(),
  ).toBe(true);
  expect((await request.delete(`/api/services/${services[2].id}`)).ok()).toBe(
    true,
  );
  await page.goto("http://127.0.0.1:3217/#/pipeline");
  const search = page.getByLabel("Suchen", { exact: true });
  const tagSearch = page.getByLabel("Tags suchen", { exact: true });
  const webChoice = page.getByRole("checkbox", { name: web.name, exact: true });
  const supportChoice = page.getByRole("checkbox", {
    name: support.name,
    exact: true,
  });
  const count = page.locator(".pipeline-toolbar");
  const cards = page.locator(".offer-card");
  await search.fill(prefix);
  await expect(cards).toHaveCount(4);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(tagSearch).toBeFocused();
  await webChoice.focus();
  await page.keyboard.press("Space");
  await expect(webChoice).toBeChecked();
  await expect(cards).toHaveCount(2);
  await expect(trigger).toHaveAccessibleName("Tags " + web.name);
  await tagSearch.fill(support.name);
  await expect(webChoice).toBeHidden();
  await supportChoice.check();
  await expect(cards).toHaveCount(3);
  await expect(count).toContainText("3 Angebote · 6 Phasen");
  await expect(trigger).toHaveAccessibleName("Tags 2 Tags ausgewählt");
  await tagSearch.fill("Kein Tag passt dazu");
  await expect(
    page.getByText("Keine Tags gefunden.", { exact: true }),
  ).toBeVisible();
  await expect(cards).toHaveCount(3);
  await tagSearch.fill("");
  await expect(webChoice).toBeChecked();
  await expect(supportChoice).toBeChecked();
  await supportChoice.uncheck();
  await expect(cards).toHaveCount(2);
  await supportChoice.check();
  await expect(cards).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  await search.fill(prefix + " Alpha");
  await expect(cards).toHaveCount(1);
  await page.getByLabel("Status", { exact: true }).selectOption("pitched");
  await expect(cards).toHaveCount(0);
  await expect(count).toContainText("0 Angebote · 1 Phase");
  await search.fill(prefix);
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText(services[1].name);
  await page.getByRole("link", { name: "Kunden", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Kunden", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Pipeline", exact: true }).click();
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue(
    "pitched",
  );
  await expect(trigger).toHaveAccessibleName("Tags 2 Tags ausgewählt");
  await expect(search).toHaveValue(prefix);
  await expect(cards).toHaveCount(1);
  await trigger.click();
  await expect(webChoice).toBeChecked();
  await expect(supportChoice).toBeChecked();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue(
    "pitched",
  );
  await expect(trigger).toHaveAccessibleName("Tags 2 Tags ausgewählt");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText(services[1].name);
  await page.goto("/#/pipeline?status=open");
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("open");
  await expect(trigger).toHaveAccessibleName("Tags 2 Tags ausgewählt");
  await expect(cards).toHaveCount(2);
  await page.getByLabel("Status", { exact: true }).selectOption("");
  await expect(page).toHaveURL(/status=$/);
  await page.reload();
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("");
  await search.fill(prefix);
  await page.getByLabel("Ansicht", { exact: true }).selectOption("true");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText(services[2].name);
  await expect(trigger).toHaveAccessibleName("Tags 2 Tags ausgewählt");
  await page.getByRole("link", { name: "Kunden", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Kunden", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Pipeline", exact: true }).click();
  await expect(page.getByLabel("Ansicht", { exact: true })).toHaveValue("true");
  await expect(search).toHaveValue(prefix);
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText(services[2].name);
  await page.getByLabel("Ansicht", { exact: true }).selectOption("false");
  await expect(cards).toHaveCount(3);
  mkdirSync("artifacts/screenshots", { recursive: true });
  for (const width of [1440, 737, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const heights = await page
      .locator(
        '.filters input[name="search"], .filters .oj-multiselect-trigger, .filters select',
      )
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().height),
      );
    expect(heights).toHaveLength(4);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    await trigger.click();
    const panel = page.locator(".oj-multiselect-panel");
    const bounds = await panel.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      await panel.evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({
      path: `artifacts/screenshots/${suffix}-${width}-pipeline-tag-filter.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(cards).toHaveCount(3);
  }
  await trigger.click();
  await page
    .getByRole("button", { name: "Auswahl zurücksetzen", exact: true })
    .click();
  await expect(cards).toHaveCount(4);
  await expect(trigger).toHaveAccessibleName("Tags Alle Tags");
  await page.getByRole("checkbox", { name: unused.name, exact: true }).check();
  await expect(cards).toHaveCount(0);
  await expect(count).toContainText("0 Angebote · 6 Phasen");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(
    page.getByRole("checkbox", { name: unused.name, exact: true }),
  ).toBeChecked();
  await search.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page
    .getByRole("button", { name: "Auswahl zurücksetzen", exact: true })
    .click();
  await expect(cards).toHaveCount(4);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Kunden", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Kunden", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Pipeline", exact: true }).click();
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("");
  await expect(trigger).toHaveAccessibleName("Tags Alle Tags");
  await trigger.click();
  await page.getByRole("checkbox", { name: unused.name, exact: true }).check();
  await expect(cards).toHaveCount(0);
  expect((await request.delete("/api/service-tags/" + unused.id)).ok()).toBe(
    true,
  );
  await page.reload();
  await expect(trigger).toHaveAccessibleName("Tags Alle Tags");
  await trigger.click();
  await expect(
    page.getByRole("checkbox", { name: unused.name, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Auswahl zurücksetzen", exact: true }),
  ).toBeDisabled();
  const previousPicker = await dropdown.elementHandle();
  await page
    .getByRole("link", { name: "Dienstleistungen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dienstleistungen", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".oj-multiselect-panel:visible")).toHaveCount(0);
  expect(await previousPicker.evaluate((node) => node.isConnected)).toBe(false);
  expect(
    await previousPicker.evaluate((node) => node.getAttribute("data-oj-state")),
  ).toBe("closed");
  await previousPicker.dispose();
  expect(errors).toEqual([]);
});

test("pipeline stays usable with malformed or unavailable browser storage", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/pipeline");
  const status = page.getByLabel("Status", { exact: true });
  await expect(page.locator(".pipeline-column")).toHaveCount(6);
  await page.evaluate(() => {
    localStorage.setItem("pitchary.pipeline.filters", "invalid JSON");
  });
  await page.reload();
  await expect(status).toHaveValue("");
  await expect(page.locator(".pipeline-column")).toHaveCount(6);
  await page.evaluate(() => {
    localStorage.setItem(
      "pitchary.pipeline.filters",
      JSON.stringify({ status: "unknown", tagIds: [42, "deleted-tag"] }),
    );
  });
  await page.reload();
  await expect(status).toHaveValue("");
  await expect(page.locator(".oj-multiselect-trigger")).toHaveAccessibleName(
    "Tags Alle Tags",
  );
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"])
      Object.defineProperty(Storage.prototype, method, {
        value() {
          throw new DOMException("Storage is unavailable", "SecurityError");
        },
      });
  });
  await page.reload();
  await expect(status).toHaveValue("");
  await status.selectOption("ghosted");
  await expect(page.locator(".pipeline-column")).toHaveCount(1);
  await expect(page.locator(".pipeline-column h2")).toContainText("Ghosted");
  await page.getByRole("link", { name: "Kunden", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Kunden", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Pipeline", exact: true }).click();
  await expect(status).toHaveValue("");
  await expect(page.locator(".pipeline-column")).toHaveCount(6);
  expect(errors).toEqual([]);
});
