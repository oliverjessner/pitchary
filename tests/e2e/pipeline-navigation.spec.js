import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

test("ghosted pipeline status, filter, history, analytics and resumption", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const customer = await (
    await request.post("/api/customers", {
      data: { name: "Ghosted Kunde " + testInfo.project.name },
    })
  ).json();
  const service = await (
    await request.post("/api/services", {
      data: { name: "Ghosted Leistung " + testInfo.project.name },
    })
  ).json();
  const offer = await (
    await request.post("/api/customer-services", {
      data: {
        customer_id: customer.id,
        service_id: service.id,
        current_offered_price_minor: 150000,
        currency: "EUR",
        billing_type: "one_time",
        pitch_channel: "email",
      },
    })
  ).json();
  expect(
    (
      await request.post(`/api/customer-services/${offer.id}/status`, {
        data: { status: "pitched" },
      })
    ).ok(),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/pipeline");
  await expect(page.locator(".pipeline-column")).toHaveCount(6);
  await page.getByLabel("Suchen", { exact: true }).fill(customer.name);
  let card = page.locator(".offer-card").filter({ hasText: customer.name });
  await card
    .getByRole("button", { name: "Als Ghosted markieren", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Ghosted", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Ergänzende Notiz").fill("Keine Antwort auf den Pitch");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // A refresh recreates the board; filter again to isolate this offer.
  await page.getByLabel("Suchen", { exact: true }).fill(customer.name);
  await page.getByLabel("Status", { exact: true }).selectOption("ghosted");
  await expect(page.locator(".pipeline-column")).toHaveCount(1);
  await expect(page.locator(".pipeline-column h2")).toContainText("Ghosted");
  card = page.locator(".offer-card").filter({ hasText: customer.name });
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Wieder aufnehmen", exact: true }),
  ).toBeVisible();
  const saved = await (
    await request.get("/api/customer-services/" + offer.id)
  ).json();
  expect(saved.status).toBe("ghosted");
  expect(saved.history.at(-1).reason).toBe("Keine Antwort auf den Pitch");
  const analytics = await (
    await request.get("/api/analytics", {
      params: { customer_id: customer.id },
    })
  ).json();
  expect(analytics.summary.ghosted).toBe(1);
  expect(analytics.summary.undecided).toBe(1);
  expect(analytics.summary.rejected).toBe(0);
  expect(analytics.summary.win_rate).toBeNull();
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  mkdirSync("artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-1440-pipeline-ghosted.png`,
  });
  await card.getByRole("link", { name: service.name, exact: true }).click();
  await expect(
    page.getByText("Keine Antwort auf den Pitch", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Wieder aufnehmen", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Wieder aufnehmen", exact: true })
    .click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    (await (await request.get("/api/customer-services/" + offer.id)).json())
      .status,
  ).toBe("ghosted");
  await page
    .getByLabel("Grund für die Wiederaufnahme")
    .fill("Kunde hat wieder geantwortet");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Als Ghosted markieren", exact: true }),
  ).toBeVisible();
  const resumed = await (
    await request.get("/api/customer-services/" + offer.id)
  ).json();
  expect(resumed.history.map((entry) => entry.to_status)).toEqual([
    "open",
    "pitched",
    "ghosted",
    "pitched",
  ]);
  expect(resumed.first_pitched_price_minor).toBe(150000);
  expect(errors).toEqual([]);
});

test("desktop navigation and header stay visible while content scrolls", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("http://127.0.0.1:3218/#/analytics");
  await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false");
  const sidebar = page.locator(".app-sidebar");
  const header = page.locator(".app-topbar");
  const navigation = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(navigation.getByRole("link")).toHaveCount(5);
  await expect(
    navigation.getByRole("link", { name: "Aktivitäten", exact: true }),
  ).toHaveCount(0);
  let headerBounds = await header.boundingBox();
  expect(headerBounds.y).toBe(0);
  const headerHeight = headerBounds.height;
  let bounds = await sidebar.boundingBox();
  expect(bounds.y).toBe(0);
  expect(bounds.height).toBe(800);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  headerBounds = await header.boundingBox();
  expect(headerBounds.y).toBe(0);
  expect(headerBounds.height).toBe(headerHeight);
  await expect(
    header.getByRole("link", { name: "Neues Angebot", exact: true }),
  ).toBeInViewport();
  bounds = await sidebar.boundingBox();
  expect(bounds.y).toBe(0);
  expect(bounds.height).toBe(800);
  await expect(
    page.getByRole("navigation", { name: "Hauptnavigation" }),
  ).toBeInViewport();
  await expect(page.locator(".sidebar-footer")).toBeInViewport();
  mkdirSync("artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-1440-sidebar-scrolled.png`,
  });
  await page.setViewportSize({ width: 1000, height: 360 });
  bounds = await sidebar.boundingBox();
  expect(bounds.y).toBe(0);
  expect(bounds.height).toBe(360);
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  expect(
    await nav.evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  await nav.getByRole("link", { name: "Analytics", exact: true }).focus();
  await expect(
    nav.getByRole("link", { name: "Analytics", exact: true }),
  ).toBeInViewport();
  await expect(page.locator(".sidebar-footer")).toBeInViewport();
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-1000-sidebar-short.png`,
  });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole("link", { name: "Kunden", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Kunden", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect((await sidebar.boundingBox()).height).toBeLessThan(400);
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false");
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  expect((await header.boundingBox()).y).toBe(0);
  await expect(
    header.getByRole("link", { name: "Neues Angebot", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-390-header-scrolled.png`,
  });
});
