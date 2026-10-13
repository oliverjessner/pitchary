import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { invoicePDF } from "../fixtures/finance-pdf.js";
import { demoCustomerLogo } from "../../scripts/demo-assets.js";

async function create(request, resource, data) {
  const response = await request.post("/api/" + resource, { data });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function invoice(request, customer, number, currency, amount) {
  const response = await request.post("/api/finance/import", {
    data: {
      category: "revenue",
      file_name: number + ".pdf",
      data: invoicePDF(number).toString("base64"),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const { invoice: row } = await response.json();
  const update = await request.patch("/api/finance/invoices/" + row.id, {
    data: {
      invoice_number: number,
      customer_id: customer.id,
      counterparty_name: customer.name,
      invoice_date: "2026-10-01",
      due_date: "2026-10-15",
      currency,
      total_amount_minor: amount,
      status: "open",
    },
  });
  expect(update.ok(), await update.text()).toBe(true);
  return update.json();
}

const section = (page, name) =>
  page.locator("#main > section").filter({
    has: page.getByRole("heading", { name, exact: true }),
  });

async function check(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

test("customer overview combines branding, contacts, offer history and editable invoice finances", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const customer = await create(request, "customers", {
    name: "Gemeinsame Kundensicht " + testInfo.project.name,
    website: "https://customer.example.test/",
    note: "Stammdaten und Rechnungen gehören zu derselben Kundenbeziehung.",
    logo: demoCustomerLogo,
  });
  const contact = await create(request, "employees", {
    customer_id: customer.id,
    name: "CRM Kontakt " + testInfo.project.name,
    email: "crm@example.test",
    position: "Projektleitung",
  });
  const service = await create(request, "services", {
    name: "Gemeinsames Angebot " + testInfo.project.name,
  });
  const offer = await create(request, "customer-services", {
    customer_id: customer.id,
    service_id: service.id,
    primary_employee_id: contact.id,
    current_offered_price_minor: 25000,
  });
  const pitch = await request.post(
    "/api/customer-services/" + offer.id + "/status",
    { data: { status: "pitched" } },
  );
  expect(pitch.ok(), await pitch.text()).toBe(true);
  const activity = await request.post(
    "/api/customer-services/" + offer.id + "/activities",
    {
      data: {
        type: "follow_up",
        note: "Historische Rückfrage bleibt sichtbar.",
      },
    },
  );
  expect(activity.status(), await activity.text()).toBe(201);
  const profile = await request.patch("/api/finance/customers/" + customer.id, {
    data: {
      general_email: "office@example.test",
      billing_address: "Beispielgasse 7\n1010 Wien",
    },
  });
  expect(profile.ok(), await profile.text()).toBe(true);
  const euro = await invoice(
    request,
    customer,
    "Customer-EUR-" + testInfo.project.name,
    "EUR",
    123456,
  );
  const dollar = await invoice(
    request,
    customer,
    "Customer-USD-" + testInfo.project.name,
    "USD",
    90000,
  );
  const navigation = page.getByRole("navigation", { name: "Hauptnavigation" });
  try {
    mkdirSync("artifacts/screenshots", { recursive: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/#/customers/" + customer.id);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        customer.name,
      );
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(navigation.getByRole("link")).toHaveCount(8);
      await expect(
        navigation.getByRole("link", { name: "Kunden", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect(
        navigation.getByRole("link", { name: "Umsatz", exact: true }),
      ).not.toHaveAttribute("aria-current", "page");
      await expect(page.locator(".finance-tabs")).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Rechnungen & Umsatz", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByAltText("Logo von " + customer.name),
      ).toBeVisible();
      await expect(page.locator("a.customer-website")).toHaveAttribute(
        "href",
        customer.website,
      );
      await expect(section(page, "Notiz")).toContainText(customer.note);
      await expect(
        page.getByRole("table", { name: "Mitarbeiter", exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("heading", { name: "Ansprechpartner", exact: true }),
      ).toHaveCount(0);
      await expect(
        page
          .getByRole("table", { name: "Mitarbeiter", exact: true })
          .getByRole("cell", { name: contact.name, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: service.name, exact: true }),
      ).toHaveAttribute("href", "#/relationships/" + offer.id);
      const history = section(page, "Bisheriger Beziehungsverlauf").locator(
        "details",
      );
      if (!(await history.evaluate((node) => node.open)))
        await history.locator("summary").click();
      await expect(history).toHaveAttribute("open", "");
      await expect(
        page.getByText("Historische Rückfrage bleibt sichtbar.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(section(page, "Rechnungsprofil")).toContainText(
        "office@example.test",
      );
      await expect(section(page, "Rechnungsprofil")).toContainText(
        "Beispielgasse 7",
      );
      await expect(section(page, "Umsatz · EUR")).toContainText("1.234,56");
      await expect(section(page, "Umsatz · USD")).toContainText("900,00");
      const invoices = page.getByRole("table", {
        name: "Rechnungen",
        exact: true,
      });
      await expect(invoices.locator("tbody tr")).toHaveCount(2);
      await expect(
        invoices.getByRole("link", { name: euro.invoice_number, exact: true }),
      ).toHaveAttribute("href", "#/invoices/" + euro.id);
      await expect(
        invoices.getByRole("link", {
          name: dollar.invoice_number,
          exact: true,
        }),
      ).toBeVisible();
      await check(page);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      await page.screenshot({
        path: `artifacts/screenshots/${testInfo.project.name}-${width}-customer-overview.png`,
        fullPage: true,
      });
    }

    await page
      .getByRole("button", { name: "Rechnungsdaten bearbeiten", exact: true })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Rechnungsdaten des Kunden",
      exact: true,
    });
    await dialog
      .getByLabel("Haupt-E-Mail", { exact: true })
      .fill("billing@example.test");
    await dialog
      .getByLabel("Rechnungsadresse", { exact: true })
      .fill("Neue Gasse 9\n1020 Wien");
    await dialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(section(page, "Rechnungsprofil")).toContainText(
      "billing@example.test",
    );
    await expect(section(page, "Rechnungsprofil")).toContainText(
      "Neue Gasse 9",
    );
    expect(
      (
        await (
          await request.get("/api/finance/customers/" + customer.id)
        ).json()
      ).general_email,
    ).toBe("billing@example.test");

    await page
      .getByRole("button", { name: "Mitarbeiter anlegen", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Mitarbeiter anlegen",
      exact: true,
    });
    await dialog
      .getByLabel("Name", { exact: true })
      .fill("Gemeinsamer Rechnungskontakt");
    await dialog
      .getByLabel("E-Mail", { exact: true })
      .fill("contact@example.test");
    await dialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    const employee = page
      .getByRole("table", { name: "Mitarbeiter", exact: true })
      .getByRole("row")
      .filter({ hasText: "Gemeinsamer Rechnungskontakt" });
    await expect(employee).toHaveCount(1);
    await employee
      .getByRole("button", { name: "Bearbeiten", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Bearbeiten", exact: true });
    await dialog.getByLabel("Position", { exact: true }).fill("Buchhaltung");
    await dialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(employee).toContainText("Buchhaltung");
    await employee
      .getByRole("button", { name: "Archivieren", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Archivieren?", exact: true })
      .getByRole("button", { name: "Archivieren", exact: true })
      .click();
    await expect(employee).toContainText("Archiviert");
    await employee
      .getByRole("button", { name: "Wiederherstellen", exact: true })
      .click();
    await expect(
      employee.getByRole("button", { name: "Archivieren", exact: true }),
    ).toBeVisible();
    const financeRow = await (
      await request.get("/api/finance/customers/" + customer.id)
    ).json();
    expect(
      financeRow.employees.filter(
        (row) => row.name === "Gemeinsamer Rechnungskontakt",
      ),
    ).toHaveLength(1);

    const invoiceRow = page
      .getByRole("table", { name: "Rechnungen", exact: true })
      .getByRole("row")
      .filter({
        has: page.getByRole("link", { name: euro.invoice_number, exact: true }),
      });
    await invoiceRow
      .getByRole("radio", { name: "Bezahlt", exact: true })
      .check();
    await expect(
      invoiceRow.getByRole("radio", { name: "Bezahlt", exact: true }),
    ).toBeChecked();
    const open = section(page, "Umsatz · EUR")
      .locator(".oj-metric")
      .filter({ hasText: "Noch offen" });
    await expect(open.locator(".oj-metric-value")).toContainText("0,00");
    expect(
      (await (await request.get("/api/finance/invoices/" + euro.id)).json())
        .status,
    ).toBe("paid");

    await page.goto("/#/finance-customers/" + customer.id + "?from=legacy");
    await expect(page).toHaveURL(
      new RegExp("#/customers/" + customer.id + "\\?from=legacy$"),
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      customer.name,
    );
    await expect(
      navigation.getByRole("link", { name: "Kunden", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await navigation.getByRole("link", { name: "Umsatz", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Umsatz");
    await expect(
      navigation.getByRole("link", { name: "Umsatz", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByLabel("Kunden suchen", { exact: true }).fill(customer.name);
    await page
      .getByRole("table", { name: "Umsatz", exact: true })
      .getByRole("link", { name: customer.name, exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp("#/customers/" + customer.id + "$"),
    );
    await expect(section(page, "Rechnungsprofil")).toContainText(
      "billing@example.test",
    );
    await check(page);
    expect(errors).toEqual([]);
  } finally {
    for (const row of [euro, dollar])
      await request.delete("/api/finance/invoices/" + row.id);
  }
});

test("customers without invoices and archived customer history remain accessible in the combined view", async ({
  page,
  request,
}, testInfo) => {
  const customer = await create(request, "customers", {
    name: "Kunde ohne Rechnung " + testInfo.project.name,
    note: "Auch ohne Rechnungsprofil vollständig erreichbar.",
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/#/customers/" + customer.id);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    customer.name,
  );
  await expect(section(page, "Rechnungsprofil")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Rechnungen", exact: true }),
  ).toContainText("Keine Einträge.");
  await expect(page.getByRole("heading", { name: /^Umsatz ·/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Angaben aus Rechnung ergänzen",
      exact: true,
    }),
  ).toBeDisabled();
  await check(page);
  await page
    .locator("#main > header")
    .getByRole("button", { name: "Archivieren", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Archivieren?", exact: true })
    .getByRole("button", { name: "Archivieren", exact: true })
    .click();
  await expect(
    page.getByText("Archivierter Kunde", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mitarbeiter anlegen", exact: true }),
  ).toHaveCount(0);
  await expect(section(page, "Rechnungsprofil")).toBeVisible();
  await expect(section(page, "Notiz")).toContainText(customer.note);
  await page
    .locator("#main > header")
    .getByRole("button", { name: "Wiederherstellen", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mitarbeiter anlegen", exact: true }),
  ).toBeVisible();
  await check(page);
});
