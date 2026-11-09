import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { invoicePDF } from "../fixtures/finance-pdf.js";

async function create(request, resource, data) {
  const response = await request.post("/api/" + resource, { data });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function setLanguage(request, language) {
  const response = await request.patch("/api/settings", { data: { language } });
  expect(response.ok(), await response.text()).toBe(true);
}

async function saveLanguage(page, language, label, button) {
  const general = page.locator("#settings-panel-general");
  await expect(general).toBeVisible();
  await general.getByLabel(label, { exact: true }).selectOption(language);
  await Promise.all([
    page.waitForEvent("load"),
    general.getByRole("button", { name: button, exact: true }).click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("lang", language);
}

async function closeDialog(page) {
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: "Cancel",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("language selection persists and translates every screen and form without changing authored data", async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let freshContext;
  try {
    await setLanguage(request, "de");
    await page.setViewportSize({ width: 1440, height: 1000 });
    mkdirSync("artifacts/screenshots", { recursive: true });
    const tag = await create(request, "service-tags", {
      name: "Offen " + randomUUID(),
    });
    const customer = await create(request, "customers", {
      name: "Kunden " + testInfo.project.name + " " + randomUUID(),
      note: "Offen",
      tag_ids: [tag.id],
    });
    const employee = await create(request, "employees", {
      customer_id: customer.id,
      name: "Personen",
      position: "Dienstleistungen",
      email: "localization@example.test",
      linkedin: "https://www.linkedin.com/in/localization/",
    });
    const service = await create(request, "services", {
      name: "Notiz",
      note: "Gespeichert.",
      tag_ids: [tag.id],
    });
    const offer = await create(request, "customer-services", {
      customer_id: customer.id,
      service_id: service.id,
      primary_employee_id: employee.id,
      current_offered_price_minor: 123456,
      currency: "EUR",
      billing_type: "one_time",
      pitch_channel: "email",
      offer_date: "2026-01-02",
    });
    await create(request, `customer-services/${offer.id}/activities`, {
      type: "note",
      employee_id: employee.id,
      note: "Abgelehnt",
    });
    const imported = await request.post("/api/finance/import", {
      data: {
        category: "revenue",
        file_name: "Lokalisierung-" + randomUUID() + ".pdf",
        data: invoicePDF("LOCALIZATION-" + randomUUID()).toString("base64"),
      },
    });
    expect(imported.ok(), await imported.text()).toBe(true);
    const invoice = (await imported.json()).invoice;
    const corrected = await request.patch(
      "/api/finance/invoices/" + invoice.id,
      {
        data: {
          invoice_number: "Gespeichert.",
          invoice_date: "2026-01-02",
          counterparty_name: customer.name,
          customer_id: customer.id,
          customer_service_id: offer.id,
          total_amount_minor: 123456,
          currency: "EUR",
        },
      },
    );
    expect(corrected.ok(), await corrected.text()).toBe(true);

    await page.goto("/#/customers");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kunden");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    const customerDate = (language) =>
      page.evaluate(
        ([language, value]) =>
          new Intl.DateTimeFormat(language, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Europe/Vienna",
          }).format(new Date(value)),
        [language, customer.created_at],
      );
    const customerRow = () =>
      page
        .getByRole("table", { name: "Customers", exact: true })
        .getByRole("row")
        .filter({
          has: page.getByRole("link", { name: customer.name, exact: true }),
        });
    await page.goto("/#/finance-settings");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Einstellungen",
    );
    await expect(
      page.getByRole("tab", { name: "Allgemein", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page
        .getByRole("tabpanel", { name: "Allgemein", exact: true })
        .getByLabel("Sprache der Oberfläche", { exact: true }),
    ).toHaveValue("de");
    await expect(page.locator("form form")).toHaveCount(0);
    expect(
      await page
        .getByLabel("Sprache der Oberfläche", { exact: true })
        .evaluate(
          (control) =>
            control.form !== null &&
            control.form !== document.querySelector(".finance-settings-form"),
        ),
    ).toBe(true);
    for (const id of ["company", "recognition", "watcher"])
      await expect(
        page.locator(`#settings-panel-${id} [name="language"]`),
      ).toHaveCount(0);
    await saveLanguage(
      page,
      "en",
      "Sprache der Oberfläche",
      "Sprache speichern",
    );
    await expect(page).toHaveURL(/#\/finance-settings$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Settings",
    );
    await expect(
      page.getByRole("tab", { name: "General", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page
        .getByRole("tabpanel", { name: "General", exact: true })
        .getByLabel("Interface language", { exact: true }),
    ).toHaveValue("en");
    expect(await (await request.get("/api/settings")).json()).toEqual({
      language: "en",
    });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Settings",
    );
    await page.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-1440-settings-english.png`,
      fullPage: true,
    });

    freshContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      timezoneId: "Europe/Vienna",
      locale: "de-AT",
    });
    const freshPage = await freshContext.newPage();
    await freshPage.goto("/#/customers");
    await expect(freshPage.locator("html")).toHaveAttribute("lang", "en");
    await expect(freshPage.getByRole("heading", { level: 1 })).toHaveText(
      "Customers",
    );
    await freshContext.close();
    freshContext = null;

    const nav = page.getByRole("navigation", {
      name: "Main navigation",
      exact: true,
    });
    await expect(nav.getByRole("link")).toHaveText([
      "Dashboard",
      "Customers",
      "People",
      "Services",
      "Pipeline",
      "Analytics",
      "Invoices",
      "Revenue",
      "Settings",
    ]);
    await expect(
      page.getByRole("link", { name: "Skip to content", exact: true }),
    ).toHaveAttribute("href", "#main");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Pitchary – manage customers, offers and finances locally.",
    );
    const routes = [
      ["/dashboard", "Dashboard"],
      ["/customers", "Customers"],
      ["/customers/" + customer.id, customer.name],
      ["/customers/tags", "Tags"],
      ["/employees", "People"],
      ["/employees/" + employee.id, employee.name],
      ["/services", "Services"],
      ["/services/" + service.id, service.name],
      ["/services/tags", "Tags"],
      ["/pipeline", "Pipeline"],
      ["/relationships/" + offer.id, service.name],
      ["/activities", "Activities"],
      ["/analytics", "Analytics"],
      ["/invoices", "Invoices"],
      ["/invoices/" + invoice.id, "Gespeichert."],
      ["/finance-customers", "Revenue"],
      ["/finance-settings", "Settings"],
    ];
    for (const [route, heading] of routes) {
      await page.goto("/#" + route);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(page).toHaveTitle(heading + " · Pitchary");
      await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    }

    await page.goto("/#/customers");
    await page.getByLabel("Search", { exact: true }).fill(customer.name);
    await expect(customerRow().locator("td").nth(4)).toHaveText(
      await customerDate("en-GB"),
    );
    await expect(customerRow()).toContainText("Offen");
    await expect(customerRow()).toContainText(tag.name);
    await page
      .getByRole("button", { name: "Create customer", exact: true })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Create customer",
      exact: true,
    });
    for (const label of [
      "Name",
      "Main email",
      "Website",
      "Upload logo",
      "Note",
    ]) {
      await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(
      dialog.getByText(
        "The logo is found automatically using the website or email domain.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Save", exact: true }),
    ).toBeVisible();
    await closeDialog(page);

    await page.goto("/#/services/" + service.id);
    await expect(
      page.getByRole("heading", { name: "Description", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".note-text").filter({ hasText: /^Gespeichert\.$/ }),
    ).toBeVisible();
    await page.goto("/#/services");
    await page
      .getByRole("button", { name: "Create service", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Create service", exact: true });
    for (const label of ["Name", "URL (optional)", "Note"]) {
      await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
    }
    await closeDialog(page);

    await page.goto("/#/employees/" + employee.id);
    await expect(
      page.getByRole("heading", { name: "Contact details", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#main")).toContainText("Dienstleistungen");
    await expect(
      page.getByRole("link", { name: "LinkedIn", exact: true }),
    ).toHaveAttribute("href", employee.linkedin);
    await expect(page.locator(".timeline")).toContainText("Abgelehnt");

    await page.getByRole("link", { name: "New offer", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "New offer", exact: true });
    for (const label of [
      "Service",
      "Customer",
      "Contact",
      "Offer date",
      "Offer price",
      "Currency",
      "Billing",
      "Pitch channel",
    ]) {
      await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
    }
    await dialog
      .getByLabel("Customer", { exact: true })
      .selectOption(customer.id);
    await expect(dialog.getByLabel("Contact", { exact: true })).toBeEnabled();
    await expect(
      dialog
        .getByLabel("Contact", { exact: true })
        .getByRole("option", { name: "Personen", exact: true }),
    ).toHaveCount(1);
    await dialog
      .getByLabel("Service", { exact: true })
      .selectOption(service.id);
    await dialog.getByLabel("Offer price", { exact: true }).fill("1234.56");
    await expect(dialog.getByRole("status")).toContainText("1,234.56");
    await expect(
      dialog.getByRole("button", { name: "Create offer", exact: true }),
    ).toBeEnabled();
    await closeDialog(page);

    await page.goto("/#/relationships/" + offer.id);
    await expect(
      page.getByRole("heading", { name: "Offer details", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#main")).toContainText("1,234.56");
    await page
      .getByRole("button", { name: "Add activity", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Add activity", exact: true });
    for (const label of ["Activity", "Channel", "Employee", "Time", "Note"]) {
      await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
    }
    await closeDialog(page);

    const invalid = await request.patch("/api/employees/" + employee.id, {
      headers: { "Accept-Language": "en" },
      data: { email: "keine-email" },
    });
    expect(invalid.status()).toBe(422);
    expect((await invalid.json()).error).toMatchObject({
      message: "Invalid email address.",
      fields: { email: "Invalid email address." },
    });

    await page.setViewportSize({ width: 320, height: 900 });
    for (const route of [
      "/customers",
      "/employees",
      "/services",
      "/pipeline",
      "/finance-settings",
    ]) {
      await page.goto("/#" + route);
      await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false");
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
    await page.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-320-settings-english.png`,
      fullPage: true,
    });
    await saveLanguage(page, "de", "Interface language", "Save language");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Einstellungen",
    );
    await expect(
      page.getByRole("navigation", { name: "Hauptnavigation", exact: true }),
    ).toBeVisible();
    await page.goto("/#/customers");
    await page.getByLabel("Suchen", { exact: true }).fill(customer.name);
    await expect(
      page
        .getByRole("table", { name: "Kunden", exact: true })
        .getByRole("row")
        .filter({
          has: page.getByRole("link", { name: customer.name, exact: true }),
        })
        .locator("td")
        .nth(4),
    ).toHaveText(await customerDate("de-AT"));
    expect(errors).toEqual([]);
  } finally {
    try {
      await freshContext?.close();
    } finally {
      await setLanguage(request, "de");
    }
  }
});
