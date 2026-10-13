import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

function pdf(label) {
  const content = `BT /F1 12 Tf 40 750 Td (${label.replace(/[()\\]/g, " ")} Rechnung Testdokument fuer Import und manuelle Bearbeitung) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}
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
async function screenshot(page, testInfo, name, width) {
  mkdirSync("artifacts/screenshots", { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  const dialog = await page.getByRole("dialog").count();
  if (!dialog) await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-${width}-finance-${name}.png`,
    fullPage: !dialog,
  });
}
async function invoice(request, label, patch = {}) {
  const response = await request.post("/api/finance/import", {
    data: {
      category: patch.category || "revenue",
      file_name: label + ".pdf",
      data: pdf(label).toString("base64"),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const row = (await response.json()).invoice;
  const updated = await request.patch("/api/finance/invoices/" + row.id, {
    data: {
      invoice_number: label,
      invoice_date: "2026-10-01",
      due_date: "2026-10-02",
      counterparty_name: label,
      total_amount_minor: 10000,
      currency: "EUR",
      ...patch,
    },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
  return updated.json();
}

test("PDF import, corrections, payment status, category tags and deletion work in the UI", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/invoices");
  await page
    .getByRole("button", { name: "PDF importieren", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "PDF importieren",
    exact: true,
  });
  const name = "UI-Rechnung-" + testInfo.project.name;
  await dialog.getByLabel("PDF-Datei", { exact: true }).setInputFiles({
    name: name + ".pdf",
    mimeType: "application/pdf",
    buffer: pdf(name),
  });
  await dialog
    .getByRole("button", { name: "Importieren", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  const id = page.url().split("/invoices/")[1];
  const initial = await (
    await request.get("/api/finance/invoices/" + id)
  ).json();
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  dialog = page.getByRole("dialog", {
    name: "Rechnung bearbeiten",
    exact: true,
  });
  await dialog
    .getByLabel("Rechnungsnummer", { exact: true })
    .fill("2026-UX-" + testInfo.project.name);
  await dialog.getByLabel("Rechnungsdatum", { exact: true }).fill("2026-10-01");
  await dialog.getByLabel("Fällig am", { exact: true }).fill("2026-10-12");
  await dialog
    .getByLabel("Firma auf der Rechnung", { exact: true })
    .fill("Finanz-UI-Kunde " + testInfo.project.name);
  await dialog.getByLabel("Gesamtbetrag", { exact: true }).fill("1200,50");
  await dialog.getByLabel("Netto", { exact: true }).fill("1000");
  await dialog.getByLabel("Steuer", { exact: true }).fill("200,50");
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".finance-invoice-facts")).toContainText(
    "1.200,50",
  );
  await page.getByRole("radio", { name: "Bezahlt", exact: true }).check();
  await expect(
    page.getByRole("radio", { name: "Bezahlt", exact: true }),
  ).toBeChecked();
  const paid = await (await request.get("/api/finance/invoices/" + id)).json();
  expect(paid.status).toBe("paid");
  expect(paid.paid_at).toMatch(/^\d{4}-\d\d-\d\d$/);
  const pdfResponse = await request.get(`/api/finance/invoices/${id}/file`);
  expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
  expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  dialog = page.getByRole("dialog", {
    name: "Rechnung bearbeiten",
    exact: true,
  });
  await dialog.getByLabel("Art", { exact: true }).selectOption("payable");
  await dialog.getByLabel("SaaS", { exact: true }).check();
  await dialog.getByLabel("Domain", { exact: true }).check();
  await page.setViewportSize({ width: 320, height: 720 });
  await check(page);
  await screenshot(page, testInfo, "edit", 320);
  await expect(
    dialog.getByRole("button", { name: "Speichern", exact: true }),
  ).toBeInViewport();
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "SaaS", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Domain", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Domain", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  const amount = page
    .locator(".finance-invoice-facts > div")
    .filter({ has: page.getByText("Gesamtbetrag", { exact: true }) });
  await amount
    .getByRole("button", { name: "Korrektur zurücksetzen", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Korrektur zurücksetzen?",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Zurücksetzen", exact: true })
    .click();
  await expect(
    amount.getByRole("button", { name: "Korrektur zurücksetzen", exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await request.get("/api/finance/invoices/" + id)).json())
      .total_amount_minor,
  ).toBe(initial.original.total_amount_minor);
  await page.getByText("Ausgelesener Text", { exact: true }).click();
  await expect(page.locator(".finance-source-text").first()).toContainText(
    name,
  );
  await check(page);
  await screenshot(page, testInfo, "detail", 320);
  await page
    .getByRole("button", { name: "Rechnung löschen", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Rechnung löschen?", exact: true });
  await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  expect((await request.get("/api/finance/invoices/" + id)).ok()).toBe(true);
  await page
    .getByRole("button", { name: "Rechnung löschen", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Rechnung löschen?", exact: true })
    .getByRole("button", { name: "Löschen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Rechnungen", exact: true }),
  ).toBeVisible();
  expect((await request.get("/api/finance/invoices/" + id)).status()).toBe(404);
  expect(errors).toEqual([]);
});

test("dashboard combines CRM and finance, hides USD only in its overview and preserves financial customer data", async ({
  page,
  request,
}, testInfo) => {
  const customer = await (
    await request.post("/api/customers", {
      data: { name: "Finance Kunde " + testInfo.project.name },
    })
  ).json();
  const revenue = await invoice(request, "Revenue-" + testInfo.project.name, {
    customer_id: customer.id,
    counterparty_name: customer.name,
    total_amount_minor: 123456,
  });
  const expense = await invoice(request, "Cost-" + testInfo.project.name, {
    category: "payable",
    total_amount_minor: 40000,
    tags: ["SaaS"],
  });
  const dollar = await invoice(request, "USD-" + testInfo.project.name, {
    customer_id: customer.id,
    counterparty_name: customer.name,
    currency: "USD",
    total_amount_minor: 90000,
  });
  for (const width of [2560, 1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/#/finance?year=2026&month=10&currency=USD");
    await expect(page).toHaveURL(
      /#\/dashboard\?year=2026&month=10&currency=USD$/,
    );
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1, exact: true }),
    ).toBeVisible();
    await expect(page.locator("#main")).toHaveClass(/view-dashboard/);
    await expect(page.locator(".dashboard-metrics .oj-metric")).toHaveCount(4);
    await expect(
      page.getByRole("heading", { name: "Letzte Kontakte", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Neueste Angebote", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".finance-currency-group")).toHaveCount(1);
    await expect(page.locator(".finance-kpis .oj-metric")).toHaveCount(6);
    const overview = page.getByRole("region", {
      name: "Finanzen",
      exact: true,
    });
    await expect(overview.getByText("USD", { exact: true })).toHaveCount(0);
    await expect(
      overview.getByRole("link", { name: dollar.invoice_number, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Diagramm-Währung", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation", { name: "Finanzen" })
        .getByRole("link", { name: "Übersicht", exact: true }),
    ).toHaveAttribute("href", "#/dashboard");
    await expect(page.getByLabel("Jahr", { exact: true })).toHaveValue("2026");
    await expect(page.getByLabel("Monat", { exact: true })).toHaveValue("10");
    const layout = await page.locator("#main").evaluate((main) => ({
      main: main.getBoundingClientRect().width,
      container: main.parentElement.getBoundingClientRect().width,
    }));
    expect(Math.abs(layout.main - layout.container)).toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("img", { name: /Einnahmen, Ausgaben und Gewinn/ }),
    ).toBeVisible();
    await page.getByText("Monatswerte anzeigen", { exact: true }).click();
    await expect(
      page
        .getByRole("table", { name: "Monatliche Finanzwerte", exact: true })
        .locator("tbody tr"),
    ).toHaveCount(12);
    await check(page);
    await screenshot(page, testInfo, "overview", width);
    const storedDollar = await (
      await request.get("/api/finance/invoices/" + dollar.id)
    ).json();
    expect(storedDollar.currency).toBe("USD");
    expect(storedDollar.total_amount_minor).toBe(90000);
    await page.goto(
      "/#/invoices?category=revenue&sort=total_amount_minor&order=desc",
    );
    await page
      .getByLabel("Suchen", { exact: true })
      .fill("Revenue-" + testInfo.project.name);
    await expect(
      page.getByRole("link", { name: revenue.invoice_number, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: dollar.invoice_number, exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Suchen", { exact: true })).toBeFocused();
    await check(page);
    await screenshot(page, testInfo, "list", width);
  }
  await page.getByLabel("Suchen", { exact: true }).fill(dollar.invoice_number);
  await expect(
    page.getByRole("link", { name: dollar.invoice_number, exact: true }),
  ).toBeVisible();
  await page.goto("/#/finance-customers/" + customer.id);
  await expect(
    page.getByRole("heading", { name: customer.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Umsatz · EUR", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Umsatz · USD", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Rechnungsdaten bearbeiten", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Rechnungsdaten des Kunden",
    exact: true,
  });
  await dialog
    .getByLabel("Haupt-E-Mail", { exact: true })
    .fill("office@example.test");
  await dialog
    .getByLabel("Rechnungsadresse", { exact: true })
    .fill("Beispielgasse 1\n1010 Wien");
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator("#main")).toContainText("office@example.test");
  await page
    .getByRole("button", { name: "Ansprechpartner hinzufügen", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Ansprechpartner hinzufügen",
    exact: true,
  });
  await dialog.getByLabel("Name", { exact: true }).fill("Rechnungskontakt");
  await dialog
    .getByLabel("E-Mail", { exact: true })
    .fill("billing@example.test");
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Rechnungskontakt", exact: true }),
  ).toBeVisible();
  await check(page);
  await screenshot(page, testInfo, "customer", 320);
  await page.getByRole("button", { name: "Archivieren", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Ansprechpartner archivieren?", exact: true })
    .getByRole("button", { name: "Archivieren", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Rechnungskontakt", exact: true }),
  ).toHaveCount(0);
  await page.getByText("Archivierte Ansprechpartner", { exact: true }).click();
  await page
    .getByRole("button", { name: "Wiederherstellen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Rechnungskontakt", exact: true }),
  ).toBeVisible();
  await page.goto("/#/finance-customers");
  await page.getByLabel("Kunden suchen", { exact: true }).fill(customer.name);
  await expect(
    page.getByRole("link", { name: customer.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Kunden suchen", { exact: true })).toBeFocused();
  await check(page);
  for (const row of [revenue, expense, dollar])
    await request.delete("/api/finance/invoices/" + row.id);
});

test("finance settings preserve company data, mask keys and inspect legacy import before confirmation", async ({
  page,
  request,
}, testInfo) => {
  const initial = await (await request.get("/api/finance/settings")).json();
  let sentKey = null;
  await page.route("**/api/finance/settings/test-key", async (route) => {
    sentKey = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/api/finance/billly/inspect*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        invoices: 4,
        customers: 2,
        contacts: 3,
        files: { available: 4 },
      }),
    }),
  );
  let imports = 0;
  await page.route("**/api/finance/billly/import", async (route) => {
    imports++;
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/#/finance-settings");
    await page
      .getByLabel("Firmenname", { exact: true })
      .fill("Finance Test " + testInfo.project.name);
    await page
      .getByLabel("Firmen-E-Mail", { exact: true })
      .fill("me@example.test");
    await page
      .getByLabel("Firmenadresse", { exact: true })
      .fill("Testgasse 42\n1010 Wien");
    const key = "sk-local-fixture-1234";
    await page.getByLabel("Neuer OpenAI-Schlüssel", { exact: true }).fill(key);
    await expect(
      page.getByRole("button", { name: "Schlüssel prüfen", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Schlüssel prüfen", exact: true })
      .click();
    expect(sentKey).toEqual({ api_key: key });
    await page
      .getByRole("button", { name: "Einstellungen speichern", exact: true })
      .click();
    await expect(
      page.getByText("Gespeichert · •••• 1234", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Neuer OpenAI-Schlüssel", { exact: true }),
    ).toHaveValue("");
    const settings = await (await request.get("/api/finance/settings")).json();
    expect(settings.openai_api_key_last4).toBe("1234");
    expect(JSON.stringify(settings)).not.toContain(key);
    await page
      .getByRole("button", { name: "Schlüssel entfernen", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "OpenAI-Schlüssel entfernen?", exact: true })
      .getByRole("button", { name: "Entfernen", exact: true })
      .click();
    await expect(
      page.getByText("Nicht konfiguriert", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Billly-Datenbank", { exact: true })
      .fill("/tmp/fixture-billly.sqlite");
    await page
      .getByRole("button", {
        name: "Quelle prüfen und übernehmen",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Billly-Daten übernehmen?",
      exact: true,
    });
    await expect(dialog).toContainText(
      "4 Rechnungen, 2 Kunden und 3 Ansprechpartner",
    );
    await expect(dialog).toContainText("4 PDF-Dateien sind verfügbar");
    expect(imports).toBe(0);
    await check(page);
    await screenshot(page, testInfo, "billly-import", 320);
    await dialog
      .getByRole("button", { name: "Abbrechen", exact: true })
      .click();
    expect(imports).toBe(0);
    await check(page);
    await screenshot(page, testInfo, "settings", 320);
  } finally {
    await request.delete("/api/finance/settings/key");
    await request.patch("/api/finance/settings", {
      data: {
        company_name: initial.company_name,
        company_email: initial.company_email,
        company_address: initial.company_address,
      },
    });
  }
});
