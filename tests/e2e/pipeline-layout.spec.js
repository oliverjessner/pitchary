import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

test("pipeline cards stay readable and all phases remain reachable in narrow windows", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeDate = Date;
    const time = NativeDate.parse("2026-10-12T10:00:00.000Z");
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
  for (const width of [1440, 737, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("http://127.0.0.1:3218/#/pipeline");
    await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false");
    await page.getByLabel("Status", { exact: true }).selectOption("");
    await page.getByLabel("Suchen", { exact: true }).fill("");
    await page.evaluate(() => document.fonts.ready);
    const board = page.getByRole("region", {
      name: "Pipeline nach Status",
      exact: true,
    });
    const previous = page.getByRole("button", {
      name: "Vorherige Phasen anzeigen",
      exact: true,
    });
    const next = page.getByRole("button", {
      name: "Nächste Phasen anzeigen",
      exact: true,
    });
    await expect(page.locator(".pipeline-column")).toHaveCount(6);
    await expect(page.locator(".pipeline-toolbar")).toContainText(
      "7 Angebote · 6 Phasen",
    );
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();
    const columnWidth = await page
      .locator(".pipeline-column")
      .first()
      .evaluate((node) => node.getBoundingClientRect().width);
    expect(columnWidth).toBeCloseTo(
      Math.min(336, width <= 700 ? width - 32 : 336),
      0,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".offer-card")
        .evaluateAll((cards) =>
          cards.every((card) => card.scrollWidth <= card.clientWidth + 1),
        ),
    ).toBe(true);
    expect(
      await page
        .locator(".offer-card-actions button")
        .evaluateAll((buttons) =>
          buttons.every(
            (button) => button.scrollWidth <= button.clientWidth + 1,
          ),
        ),
    ).toBe(true);
    const pitched = page
      .locator(".pipeline-column")
      .filter({ has: page.getByRole("heading", { name: /^Gepitcht/ }) });
    await expect(
      pitched.locator(".offer-card-actions .oj-button-primary"),
    ).toHaveCount(2);
    await expect(
      pitched.locator(".offer-card-actions .oj-button-secondary"),
    ).toHaveCount(4);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page
      .getByRole("heading", { level: 1 })
      .evaluate((node) => node.blur());
    await page.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-pipeline.png`,
      fullPage: true,
    });
    // The arrows support keyboard activation and move by one phase.
    await next.focus();
    await page.keyboard.press("Enter");
    const advance = async (position) =>
      expect
        .poll(async () =>
          Math.abs(
            (await board.evaluate((node) => node.scrollLeft)) - position,
          ),
        )
        .toBeLessThan(2);
    const max = await board.evaluate(
      (node) => node.scrollWidth - node.clientWidth,
    );
    await advance(Math.min(columnWidth + 16, max));
    await expect(previous).toBeEnabled();
    await previous.click();
    await advance(0);
    for (let i = 0; i < 6 && (await next.isEnabled()); i++) {
      const position = await board.evaluate((node) => node.scrollLeft);
      await next.click();
      await advance(Math.min(position + columnWidth + 16, max));
    }
    await expect(next).toBeDisabled();
    const last = await page.locator(".pipeline-column").last().boundingBox();
    const visible = await board.boundingBox();
    expect(last.x).toBeGreaterThanOrEqual(visible.x - 1);
    expect(last.x + last.width).toBeLessThanOrEqual(
      visible.x + visible.width + 1,
    );
    if (width === 1440)
      await page.screenshot({
        path: `artifacts/screenshots/${testInfo.project.name}-1440-pipeline-last-phases.png`,
      });
    // A filtered phase keeps the same useful card width and resets scrolling.
    await page.getByLabel("Status", { exact: true }).selectOption("pitched");
    await expect(page.locator(".pipeline-column")).toHaveCount(1);
    await expect(previous).toBeDisabled();
    await expect(next).toBeDisabled();
    await expect(page.locator(".offer-card")).toHaveCount(2);
    expect(await board.evaluate((node) => node.scrollLeft)).toBe(0);
    await page
      .getByLabel("Suchen", { exact: true })
      .fill("Kein Kunde passt dazu");
    await expect(page.locator(".pipeline-toolbar")).toContainText(
      "0 Angebote · 1 Phase",
    );
    await expect(
      page.getByText("Keine Angebote.", { exact: true }),
    ).toBeVisible();
  }
  // Realistic long labels and the supported maximum amount must also fit.
  const customer = await (
    await request.post("/api/customers", {
      data: {
        name:
          "Studio für digitale Kommunikation und internationale Markenentwicklung " +
          testInfo.project.name,
      },
    })
  ).json();
  const service = await (
    await request.post("/api/services", {
      data: {
        name: "Konzeption und Umsetzung einer barrierefreien Unternehmenswebsite mit laufender technischer Betreuung",
      },
    })
  ).json();
  const offer = await (
    await request.post("/api/customer-services", {
      data: {
        customer_id: customer.id,
        service_id: service.id,
        current_offered_price_minor: 1000000000000,
        billing_type: "monthly",
      },
    })
  ).json();
  await request.post(`/api/customer-services/${offer.id}/status`, {
    data: { status: "pitched" },
  });
  await page.goto("http://127.0.0.1:3217/#/pipeline?status=pitched");
  await page.getByLabel("Suchen", { exact: true }).fill(customer.name);
  const card = page.locator(".offer-card");
  await expect(card).toHaveCount(1);
  await expect(
    card.getByRole("link", { name: service.name, exact: true }),
  ).toBeVisible();
  await expect(card.locator(".offer-card-price")).toContainText(
    "10.000.000.000,00",
  );
  await expect(card.locator(".offer-card-pricing")).toContainText(
    "Monatlich · Angebotspreis",
  );
  expect(
    await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("pipeline fills the available width on large screens", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const NativeDate = Date;
    const time = NativeDate.parse("2026-10-12T10:00:00.000Z");
    window.Date = class extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [time]));
      }
      static now() {
        return time;
      }
    };
  });
  await page.setViewportSize({ width: 2560, height: 1000 });
  await page.goto("http://127.0.0.1:3218/#/pipeline");
  await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false");
  await page.evaluate(() => document.fonts.ready);
  const main = page.locator("#main");
  const content = await page.locator(".app-content").boundingBox();
  const view = await main.boundingBox();
  const board = page.locator(".pipeline-board");
  const bounds = await board.boundingBox();
  expect(view.x).toBe(content.x);
  expect(view.width).toBe(content.width);
  expect(bounds.width).toBeGreaterThan(2000);
  expect(bounds.width).toBeCloseTo(content.width - 48, 0);
  await expect(page.locator(".pipeline-column")).toHaveCount(6);
  expect(
    await page
      .locator(".pipeline-column")
      .evaluateAll((columns) =>
        columns.every((column) => column.getBoundingClientRect().width >= 336),
      ),
  ).toBe(true);
  const last = await page.locator(".pipeline-column").last().boundingBox();
  expect(last.x + last.width).toBeCloseTo(bounds.x + bounds.width, 0);
  expect(
    await board.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  await expect(
    page.getByRole("button", {
      name: "Vorherige Phasen anzeigen",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Nächste Phasen anzeigen", exact: true }),
  ).toBeDisabled();
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("heading", { level: 1 }).evaluate((node) => node.blur());
  mkdirSync("artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-2560-pipeline.png`,
  });
  // Filtering keeps an individual card readable on the same wide container.
  await page.getByLabel("Status", { exact: true }).selectOption("pitched");
  expect((await page.locator(".pipeline-column").boundingBox()).width).toBe(
    336,
  );
  await page.getByRole("link", { name: "Kunden", exact: true }).click();
  await expect(main).not.toHaveClass(/view-pipeline/);
  expect((await main.boundingBox()).width).toBeLessThan(content.width);
});
