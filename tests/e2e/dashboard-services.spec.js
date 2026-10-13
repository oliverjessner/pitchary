import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

const checkA11y = async (page) => {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
};
const color = (page, value) =>
  page.getByLabel("Farbe", { exact: true }).evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
const services = (page) =>
  page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("link", { name: "Dienstleistungen", exact: true })
    .click();

test("dashboard metrics use a two-by-two block beside recent contacts", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const NativeDate = Date,
      time = NativeDate.parse("2026-10-12T10:00:00.000Z");
    window.Date = class extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [time]));
      }
      static now() {
        return time;
      }
    };
  });
  mkdirSync("artifacts/screenshots", { recursive: true });
  for (const width of [2560, 1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("http://127.0.0.1:3218/#/dashboard");
    await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("#main")).toHaveClass(/view-dashboard/);
    const layout = await page.locator("#main").evaluate((main) => ({
      main: main.getBoundingClientRect().width,
      container: main.parentElement.getBoundingClientRect().width,
    }));
    expect(Math.abs(layout.main - layout.container)).toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("heading", { name: "Finanzen", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Aktuelle Pipeline", exact: true }),
    ).toHaveCount(0);
    const metrics = page.locator(".dashboard-metrics .oj-metric-card");
    await expect(metrics).toHaveCount(4);
    await expect(metrics.locator(".oj-metric-value")).toHaveText([
      "7",
      "5",
      "2",
      "66,7 %",
    ]);
    const boxes = await metrics.evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y } = node.getBoundingClientRect();
        return { x, y };
      }),
    );
    expect(boxes[0].y).toBe(boxes[1].y);
    expect(boxes[2].y).toBe(boxes[3].y);
    expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
    expect(boxes[0].x).toBe(boxes[2].x);
    const contacts = await page
      .locator(".dashboard-grid > section")
      .boundingBox();
    if (width >= 1440) {
      expect(contacts.x).toBeGreaterThan(boxes[1].x);
      expect(contacts.y).toBe(boxes[0].y);
    } else expect(contacts.y).toBeGreaterThan(boxes[2].y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await checkA11y(page);
    await page.evaluate(() => document.fonts.ready);
    await page
      .getByRole("heading", { level: 1 })
      .evaluate((node) => node.blur());
    await page.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-dashboard.png`,
      fullPage: true,
    });
  }
});

test("internal software is available for offers, activities and analytics filters", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const customer = await (
    await request.post("/api/customers", {
      data: { name: "Software Kunde " + testInfo.project.name },
    })
  ).json();
  const service = await (
    await request.post("/api/services", {
      data: { name: "Interne Leistung " + testInfo.project.name },
    })
  ).json();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/pipeline");
  await page
    .locator("#main")
    .getByRole("button", { name: "Neues Angebot", exact: true })
    .click();
  await page.getByLabel("Kunde", { exact: true }).selectOption(customer.id);
  await page
    .getByLabel("Dienstleistung", { exact: true })
    .selectOption(service.id);
  await page
    .getByLabel("Pitch-Kanal", { exact: true })
    .selectOption("internal_software");
  await page.getByLabel("Angebotspreis", { exact: true }).fill("400");
  await checkA11y(page);
  mkdirSync("artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-1440-internal-software-dialog.png`,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Angebot anlegen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Angebotsdetails", exact: true }),
  ).toBeVisible();
  const id = page.url().split("/relationships/")[1];
  await expect(
    page.getByText("Interne Software", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pitch erfassen", exact: true })
    .click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Zusage erfassen", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Aktivität hinzufügen", exact: true })
    .click();
  await page
    .getByLabel("Kanal", { exact: true })
    .selectOption("internal_software");
  await page.getByLabel("Notiz", { exact: true }).fill("Interne Nachfrage");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByText("Interne Nachfrage", { exact: true }),
  ).toBeVisible();
  const saved = await (
    await request.get("/api/customer-services/" + id)
  ).json();
  expect(saved.pitch_channel).toBe("internal_software");
  expect(saved.activities[0].channel).toBe("internal_software");
  await page.goto("/#/analytics");
  await page.getByLabel("Kunde", { exact: true }).selectOption(customer.id);
  await page
    .getByLabel("Pitch-Kanal", { exact: true })
    .selectOption("internal_software");
  await page.getByRole("button", { name: "Filtern", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Interne Software", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("service tags can be created, assigned, edited, searched and removed", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const first = "Web " + testInfo.project.name,
    second = "Wartung " + testInfo.project.name;
  const serviceName = "Tag Leistung " + testInfo.project.name;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/services");
  await page
    .getByRole("button", { name: "Tags verwalten", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tags", exact: true }),
  ).toBeVisible();
  for (const [name, note, hex] of [
    [first, "Für Website-Projekte", "#ff6b35"],
    [second, "<img src=x onerror=alert(1)>", "#4d8dff"],
  ]) {
    await page
      .getByRole("button", { name: "Tag anlegen", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Notiz", { exact: true }).fill(note);
    await color(page, hex);
    await checkA11y(page);
    if (name === first) {
      mkdirSync("artifacts/screenshots", { recursive: true });
      await page.screenshot({
        path: `artifacts/screenshots/${testInfo.project.name}-1440-service-tag-dialog.png`,
      });
    }
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.locator(".service-tag").filter({ hasText: name }),
    ).toBeVisible();
  }
  const all = await (await request.get("/api/service-tags")).json();
  const a = all.find((tag) => tag.name === first),
    b = all.find((tag) => tag.name === second);
  await services(page);
  await page
    .getByRole("button", { name: "Dienstleistung anlegen", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(serviceName);
  await page
    .getByLabel("Notiz", { exact: true })
    .fill("Dienstleistung mit zwei Tags");
  await page.getByRole("checkbox", { name: first, exact: true }).check();
  await page.getByRole("checkbox", { name: second, exact: true }).check();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await checkA11y(page);
    await page.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-service-tag-picker.png`,
    });
  }
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: serviceName, exact: true }),
  ).toBeVisible();
  const serviceId = page.url().split("/services/")[1];
  await expect(page.locator("#main .service-tag")).toHaveCount(2);
  await expect(page.locator("#main img")).toHaveCount(0);
  expect(
    await page
      .locator(`[data-tag-id="${a.id}"] .service-tag-dot`)
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgb(255, 107, 53)");
  await page.reload();
  await expect(page.locator("#main .service-tag")).toHaveCount(2);
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-390-service-tags-detail.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Tags bearbeiten", exact: true })
    .click();
  await page.getByRole("checkbox", { name: second, exact: true }).uncheck();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  expect(
    (await (await request.get("/api/services/" + serviceId)).json()).tags,
  ).toHaveLength(2);
  await page
    .getByRole("button", { name: "Tags bearbeiten", exact: true })
    .click();
  await page.getByRole("checkbox", { name: second, exact: true }).uncheck();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator("#main .service-tag")).toHaveCount(1);
  await services(page);
  await page
    .getByRole("button", { name: "Tags verwalten", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: first })
    .getByRole("button", { name: "Bearbeiten", exact: true })
    .click();
  const renamed = "Webdesign " + testInfo.project.name;
  await page.getByLabel("Name", { exact: true }).fill(renamed);
  await page.getByLabel("Notiz", { exact: true }).fill("Website-Leistungen");
  await color(page, "#22c55e");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/#/services/" + serviceId);
  await expect(
    page.getByText("Website-Leistungen", { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator(`[data-tag-id="${a.id}"]`)
      .evaluate((node) => node.style.getPropertyValue("--tag-color")),
  ).toBe("#22c55e");
  await services(page);
  await page.getByLabel("Suchen", { exact: true }).fill(renamed);
  await expect(
    page.getByRole("link", { name: serviceName, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: renamed, exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page
    .getByRole("button", { name: "Tags verwalten", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: renamed });
  await row.getByRole("button", { name: "Löschen", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Abbrechen", exact: true })
    .click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Löschen", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Löschen", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(
    (await (await request.get("/api/services/" + serviceId)).json()).tags,
  ).toEqual([]);
  await page
    .getByRole("row")
    .filter({ hasText: second })
    .getByRole("button", { name: "Löschen", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Löschen", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
