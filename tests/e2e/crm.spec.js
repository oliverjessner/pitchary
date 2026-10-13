import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
test("complete customer, contact and offer workflow with persistence", async ({
  page,
  request,
}, testInfo) => {
  const suffix = testInfo.project.name;
  const customer = "QA Kunde " + suffix,
    service = "QA Leistung " + suffix;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/customers");
  await page
    .getByRole("button", { name: "Kunde anlegen", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(customer);
  await page
    .getByLabel("Notiz", { exact: true })
    .fill("<img src=x onerror=alert(1)>");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: customer, exact: true }),
  ).toBeVisible();
  await expect(page.locator("#main img")).toHaveCount(0);
  await page.getByRole("button", { name: "Mitarbeiter anlegen" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Alex Kontakt");
  await page.getByLabel("E-Mail", { exact: true }).fill("alex@example.com");
  await page.getByLabel("Position").fill("Geschäftsführung");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Alex Kontakt", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Dienstleistungen", exact: true })
    .click();
  await page.getByRole("button", { name: "Dienstleistung anlegen" }).click();
  await page.getByLabel("Name", { exact: true }).fill(service);
  await page.getByLabel("Notiz", { exact: true }).fill("QA Leistung");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: service, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Angebot anlegen", exact: true })
    .click();
  await page
    .getByLabel("Kunde", { exact: true })
    .selectOption({ label: customer });
  await expect(
    page.getByLabel("Ansprechpartner", { exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByLabel("Ansprechpartner", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await page
    .getByLabel("Ansprechpartner", { exact: true })
    .selectOption({ label: "Alex Kontakt" });
  await page.getByLabel("Angebotspreis", { exact: true }).fill("1200,50");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Angebot anlegen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Angebotsdetails" }),
  ).toBeVisible();
  const id = page.url().split("/relationships/")[1];
  await page
    .getByRole("button", { name: "Pitch erfassen", exact: true })
    .click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Zusage erfassen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preis ändern", exact: true }).click();
  await page.getByLabel("Neuer Preis (EUR)").fill("1100,25");
  await page.getByLabel("Begründung").fill("Umfang angepasst");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByText("Umfang angepasst", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Aktivität hinzufügen", exact: true })
    .click();
  await page
    .getByLabel("Notiz", { exact: true })
    .fill("Follow-up ohne Statuswechsel");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByText("Follow-up ohne Statuswechsel", { exact: true }),
  ).toBeVisible();
  let data = await (await request.get("/api/customer-services/" + id)).json();
  expect(data.history).toHaveLength(2);
  expect(data.first_pitched_price_minor).toBe(120050);
  expect(data.current_offered_price_minor).toBe(110025);
  await page.getByRole("button", { name: "Ablehnen", exact: true }).click();
  await page.getByLabel("Absagegrund", { exact: true }).selectOption("budget");
  await page.getByLabel("Ergänzende Notiz").fill("Budget fehlt");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Wieder aufnehmen", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Wieder aufnehmen", exact: true })
    .click();
  await page
    .getByLabel("Grund für die Wiederaufnahme")
    .fill("Budget freigegeben");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Zusage erfassen", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Zusage erfassen", exact: true })
    .click();
  await page.getByLabel("Vereinbarter Preis (EUR)").fill("1050,00");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Als erledigt markieren" }),
  ).toBeVisible();
  const acceptedBadge = page
    .getByRole("table", { name: "Statusphasen", exact: true })
    .getByText("Angenommen", { exact: true });
  for (const width of [1440, 737, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(acceptedBadge).toBeVisible();
    const layout = await acceptedBadge.evaluate((badge) => {
      const range = document.createRange();
      range.selectNodeContents(badge);
      const bounds = badge.getBoundingClientRect(),
        cell = badge.closest("td").getBoundingClientRect();
      return {
        lines: range.getClientRects().length,
        right: bounds.right,
        cellRight: cell.right,
      };
    });
    expect(layout.lines).toBe(1);
    expect(layout.right).toBeLessThanOrEqual(layout.cellRight);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Als erledigt markieren" }).click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Als erledigt markieren" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Angebotsdetails" }),
  ).toBeVisible();
  data = await (await request.get("/api/customer-services/" + id)).json();
  expect(data.status).toBe("done");
  expect(data.accepted_price_minor).toBe(105000);
  expect(data.first_pitched_price_minor).toBe(120050);
  expect(data.history.map((h) => h.to_status)).toEqual([
    "open",
    "pitched",
    "rejected",
    "pitched",
    "accepted",
    "done",
  ]);
  await page.getByRole("button", { name: "Archivieren", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archivieren", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Wiederherstellen", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Wiederherstellen", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Bearbeiten", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("batch assignments, repeated offers, search and accessible dialogs", async ({
  page,
  request,
}, testInfo) => {
  const services = await (await request.get("/api/services")).json();
  const service = services.find((s) => s.name === "Technischer Audit");
  const before = await (await request.get("/api/customer-services")).json();
  await page.goto("/#/services/" + service.id);
  await page.getByRole("button", { name: "Mehreren Kunden anbieten" }).click();
  await page.getByLabel("Atlas Digital", { exact: true }).check();
  await page.getByLabel("Studio Nord", { exact: true }).check();
  await page.getByLabel("Angebotspreis", { exact: true }).fill("999,99");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "2 Angebote anlegen", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const after = await (await request.get("/api/customer-services")).json();
  expect(after.length).toBe(before.length + 2);
  expect(new Set(after.map((r) => r.id)).size).toBe(after.length);
  await page.getByRole("link", { name: "Kunden", exact: true }).click();
  await page.getByLabel("Suchen", { exact: true }).fill("Studio Nord");
  await expect(
    page.getByRole("link", { name: "Studio Nord", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Atlas Digital", exact: true }),
  ).toHaveCount(0);
  const opener = page.getByRole("button", {
    name: "Kunde anlegen",
    exact: true,
  });
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await page.getByLabel("Pitch-Kanal", { exact: true }).selectOption("phone");
  await page.getByRole("button", { name: "Filtern", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Performance je ursprünglichem Pitch-Kanal",
    }),
  ).toBeVisible();
});
test("seeded views: desktop/mobile screenshots, a11y, no runtime or asset errors", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(response.url() + " " + response.status());
  });
  const rows = await (
    await request.get("http://127.0.0.1:3218/api/customer-services")
  ).json();
  const relation = rows.find(
    (r) => r.customer_name === "Studio Nord" && r.status === "done",
  );
  const routes = [
    "dashboard",
    "customers",
    "services",
    "pipeline",
    "activities",
    "analytics",
    "customers/" + relation.customer_id,
    "services/" + relation.service_id,
    "relationships/" + relation.id,
  ];
  mkdirSync("artifacts/screenshots", { recursive: true });
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
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of routes) {
      await page.goto("http://127.0.0.1:3218/#/" + route);
      await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (route === "analytics") {
        await expect(
          page.getByText("Pitch → Entscheidung", { exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByText("Mittelwert · erste Entscheidung", { exact: true }),
        ).toHaveCount(0);
        await expect(
          page
            .locator(".oj-metric-label")
            .filter({ hasText: /^Pitch → Zusage$/ }),
        ).toBeVisible();
      }
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        results.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
      await page
        .getByRole("heading", { level: 1 })
        .evaluate((node) => node.blur());
      await page.screenshot({
        path: `artifacts/screenshots/${testInfo.project.name}-${width}-${route.replaceAll("/", "-")}.png`,
        fullPage: true,
      });
    }
  }
  await page
    .getByRole("button", { name: "Aktivität hinzufügen", exact: true })
    .click();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-390-activity-dialog.png`,
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
