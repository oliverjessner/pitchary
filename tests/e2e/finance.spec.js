import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, readFileSync } from "node:fs";

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

test("dashboard combines CRM and finance, keeps EUR metrics and shows open invoices in every currency and period", async ({
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
  const dollarExpense = await invoice(
    request,
    "USD-Cost-" + testInfo.project.name,
    {
      category: "payable",
      currency: "USD",
      total_amount_minor: 10482,
      invoice_date: "2025-09-17",
      due_date: "2025-09-17",
    },
  );
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
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Neueste Angebote", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".finance-currency-group")).toHaveCount(1);
    await expect(page.locator(".finance-kpis .oj-metric")).toHaveCount(6);
    const overview = page.getByRole("region", {
      name: "Finanzübersicht",
      exact: true,
    });
    const financeBox = await overview.boundingBox();
    const crmBox = await page.locator(".dashboard-metrics").boundingBox();
    expect(crmBox.y).toBeGreaterThan(financeBox.y + financeBox.height);
    await expect(overview.locator("header")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Finanzen", exact: true }),
    ).toHaveCount(0);
    await expect(overview).not.toContainText(
      "Einnahmen, Ausgaben und Kundenumsatz aus deinen Rechnungen.",
    );
    await expect(
      overview.getByRole("button", { name: "PDF importieren", exact: true }),
    ).toHaveCount(0);
    await expect(
      overview.getByRole("button", { name: "Aktualisieren", exact: true }),
    ).toHaveCount(0);
    await expect(overview.locator(".finance-ranking")).toHaveCount(0);
    await expect(
      overview.getByRole("heading", { name: /^Beste Kunden|^Höchste Kosten/ }),
    ).toHaveCount(0);
    await expect(
      overview.getByRole("region", { name: "Kennzahlen in USD", exact: true }),
    ).toHaveCount(0);
    const openIncome = overview
      .locator(".finance-open-invoices > section")
      .filter({
        has: page.getByRole("heading", {
          name: "Offene Einnahmen",
          exact: true,
        }),
      });
    const openExpenses = overview
      .locator(".finance-open-invoices > section")
      .filter({
        has: page.getByRole("heading", {
          name: "Offene Ausgaben",
          exact: true,
        }),
      });
    await expect(
      openIncome.getByRole("link", {
        name: dollar.invoice_number,
        exact: true,
      }),
    ).toBeVisible();
    const dollarExpenseRow = openExpenses.getByRole("row").filter({
      has: page.getByRole("link", {
        name: dollarExpense.invoice_number,
        exact: true,
      }),
    });
    await expect(dollarExpenseRow).toBeVisible();
    await expect(dollarExpenseRow).toContainText("104,82");
    await expect(
      page.getByLabel("Diagramm-Währung", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".finance-tabs")).toHaveCount(0);
    await expect(page.getByLabel("Jahr", { exact: true })).toHaveValue("2026");
    await expect(page.getByLabel("Monat", { exact: true })).toHaveValue("10");
    await expect(page.getByLabel("Jahr", { exact: true })).toHaveJSProperty(
      "tagName",
      "SELECT",
    );
    await expect(page.getByLabel("Monat", { exact: true })).toHaveJSProperty(
      "tagName",
      "SELECT",
    );
    const boxes = await overview.evaluate((node) => {
      const rect = (element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        filters: rect(node.querySelector(".finance-filters")),
        kpis: [...node.querySelectorAll(".finance-kpis > .oj-metric")].map(
          rect,
        ),
        chart: rect(node.querySelector(".finance-chart-overdue > section")),
        overdue: [
          ...node.querySelectorAll(".finance-overdue > .oj-metric"),
        ].map(rect),
        open: [
          ...node.querySelectorAll(".finance-open-invoices > section"),
        ].map(rect),
      };
    });
    expect(boxes.kpis[0].y).toBeGreaterThan(
      boxes.filters.y + boxes.filters.height,
    );
    expect(boxes.chart.y).toBeGreaterThan(
      boxes.kpis.at(-1).y + boxes.kpis.at(-1).height,
    );
    expect(
      Math.abs(boxes.overdue[0].x - boxes.overdue[1].x),
    ).toBeLessThanOrEqual(1);
    expect(boxes.overdue[1].y).toBeGreaterThan(
      boxes.overdue[0].y + boxes.overdue[0].height,
    );
    if (width >= 1440) {
      expect(
        Math.max(...boxes.kpis.map((box) => box.y)) -
          Math.min(...boxes.kpis.map((box) => box.y)),
      ).toBeLessThanOrEqual(1);
      for (let index = 1; index < boxes.kpis.length; index++)
        expect(boxes.kpis[index].x).toBeGreaterThan(boxes.kpis[index - 1].x);
      expect(boxes.overdue[0].x).toBeGreaterThan(
        boxes.chart.x + boxes.chart.width,
      );
      expect(Math.abs(boxes.overdue[0].y - boxes.chart.y)).toBeLessThanOrEqual(
        1,
      );
      expect(boxes.chart.width).toBeGreaterThan(boxes.overdue[0].width);
      expect(Math.abs(boxes.open[0].y - boxes.open[1].y)).toBeLessThanOrEqual(
        1,
      );
      expect(boxes.open[1].x).toBeGreaterThan(
        boxes.open[0].x + boxes.open[0].width,
      );
    } else {
      expect(boxes.kpis[1].y).toBeGreaterThan(boxes.kpis[0].y);
      expect(boxes.overdue[0].y).toBeGreaterThan(
        boxes.chart.y + boxes.chart.height,
      );
      expect(boxes.open[1].y).toBeGreaterThan(
        boxes.open[0].y + boxes.open[0].height,
      );
    }
    const layout = await page.locator("#main").evaluate((main) => ({
      main: main.getBoundingClientRect().width,
      container: main.parentElement.getBoundingClientRect().width,
    }));
    expect(Math.abs(layout.main - layout.container)).toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("img", { name: /Einnahmen, Ausgaben und Gewinn/ }),
    ).toBeVisible();
    await screenshot(page, testInfo, "overview", width);
    await page.getByText("Monatswerte anzeigen", { exact: true }).click();
    await expect(
      page
        .getByRole("table", { name: "Monatliche Finanzwerte", exact: true })
        .locator("tbody tr"),
    ).toHaveCount(12);
    await check(page);
    const storedDollar = await (
      await request.get("/api/finance/invoices/" + dollar.id)
    ).json();
    expect(storedDollar.currency).toBe("USD");
    expect(storedDollar.total_amount_minor).toBe(90000);
    await page.goto(
      "/#/invoices?category=revenue&sort=total_amount_minor&order=desc",
    );
    await expect(
      page.getByRole("button", { name: "PDF importieren", exact: true }),
    ).toBeVisible();
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
  await expect(page).toHaveURL(new RegExp("#/customers/" + customer.id + "$"));
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
    .getByRole("button", { name: "Mitarbeiter anlegen", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Mitarbeiter anlegen",
    exact: true,
  });
  await dialog.getByLabel("Name", { exact: true }).fill("Rechnungskontakt");
  await dialog
    .getByLabel("E-Mail", { exact: true })
    .fill("billing@example.test");
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Rechnungskontakt", exact: true }),
  ).toBeVisible();
  await check(page);
  await screenshot(page, testInfo, "customer", 320);
  const contactRow = page
    .getByRole("table", { name: "Mitarbeiter", exact: true })
    .getByRole("row")
    .filter({ hasText: "Rechnungskontakt" });
  await contactRow
    .getByRole("button", { name: "Archivieren", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Archivieren?", exact: true })
    .getByRole("button", { name: "Archivieren", exact: true })
    .click();
  await expect(
    contactRow.getByText("Archiviert", { exact: true }),
  ).toBeVisible();
  await contactRow
    .getByRole("button", { name: "Wiederherstellen", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Rechnungskontakt", exact: true }),
  ).toBeVisible();
  await page.goto("/#/finance-customers");
  await expect(
    page.getByRole("heading", { name: "Umsatz", level: 1, exact: true }),
  ).toBeVisible();
  await page.getByLabel("Kunden suchen", { exact: true }).fill(customer.name);
  await expect(
    page.getByRole("link", { name: customer.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Kunden suchen", { exact: true })).toBeFocused();
  await check(page);
  const storedDollarExpense = await (
    await request.get("/api/finance/invoices/" + dollarExpense.id)
  ).json();
  expect(storedDollarExpense.currency).toBe("USD");
  expect(storedDollarExpense.total_amount_minor).toBe(10482);
  expect(storedDollarExpense.invoice_date).toBe("2025-09-17");
  for (const row of [revenue, expense, dollar, dollarExpense])
    await request.delete("/api/finance/invoices/" + row.id);
});

test("Umsatz combines nominal yearly rankings and overall revenue while preserving original currencies", async ({
  page,
  request,
}, testInfo) => {
  const baseline = await (
    await request.get("/api/finance/revenue-overview?year=2024")
  ).json();
  const totalBefore = baseline.overall_revenue.total_amount_minor;
  const customer = await (
    await request.post("/api/customers", {
      data: { name: "Jahresumsatz Kunde " + testInfo.project.name },
    })
  ).json();
  const rows = [];
  try {
    rows.push(
      await invoice(request, "Revenue-2024-" + testInfo.project.name, {
        customer_id: customer.id,
        counterparty_name: customer.name,
        invoice_date: "2024-04-01",
        total_amount_minor: 10000,
      }),
    );
    rows.push(
      await invoice(request, "Revenue-2025-" + testInfo.project.name, {
        customer_id: customer.id,
        counterparty_name: customer.name,
        invoice_date: "2025-04-01",
        total_amount_minor: 90000,
      }),
    );
    rows.push(
      await invoice(request, "Cost-2024-" + testInfo.project.name, {
        category: "payable",
        invoice_date: "2024-05-01",
        total_amount_minor: 1500,
      }),
    );
    rows.push(
      await invoice(request, "Cost-2025-" + testInfo.project.name, {
        category: "payable",
        invoice_date: "2025-05-01",
        total_amount_minor: 2500,
      }),
    );
    rows.push(
      await invoice(request, "USD-2024-" + testInfo.project.name, {
        customer_id: customer.id,
        counterparty_name: customer.name,
        invoice_date: "2024-06-01",
        currency: "USD",
        total_amount_minor: 5000,
      }),
    );
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/#/finance-customers?year=2024");
      await expect(
        page.getByRole("heading", { name: "Umsatz", level: 1, exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("navigation", { name: "Hauptnavigation" })
          .getByRole("link", { name: "Umsatz", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      const rankings = page.getByRole("region", {
        name: "Jahresranglisten",
        exact: true,
      });
      const best = rankings.locator("section").filter({
        has: page.getByRole("heading", {
          name: "Beste Kunden · 2024",
          exact: true,
        }),
      });
      const costs = rankings.locator("section").filter({
        has: page.getByRole("heading", {
          name: "Höchste Kosten · 2024",
          exact: true,
        }),
      });
      await expect(best).toContainText(customer.name);
      await expect(best).toContainText("150,00");
      await expect(best.locator(".finance-ranking")).toHaveCount(1);
      await expect(
        best.locator(".finance-ranking li").filter({ hasText: customer.name }),
      ).toHaveCount(1);
      expect(
        await best.locator(".finance-ranking li").count(),
      ).toBeLessThanOrEqual(4);
      expect(
        await costs.locator(".finance-ranking li").count(),
      ).toBeLessThanOrEqual(4);
      await expect(
        best.getByRole("heading", { name: /^(EUR|USD)$/, exact: true }),
      ).toHaveCount(0);
      await expect(best).not.toContainText("900,00");
      const overall = page.locator(".finance-overall-revenue");
      const expectedOverall = await page.evaluate(
        (value) =>
          new Intl.NumberFormat("de-AT", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(value),
        (totalBefore + 105000) / 100,
      );
      await expect(overall.locator(".oj-metric-value")).toHaveText(
        expectedOverall,
      );
      await expect(overall).toContainText("ohne Währungsumrechnung");
      await expect(
        page.getByText(
          "Gesamter Rechnungsumsatz über alle Jahre, je Währung.",
          { exact: true },
        ),
      ).toHaveCount(0);
      await expect(costs).toContainText(rows[2].counterparty_name);
      await expect(costs).toContainText("15,00");
      await expect(costs).not.toContainText(rows[3].counterparty_name);
      const cards = await rankings
        .locator(".finance-summary-grid > *")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height };
          }),
        );
      expect(cards).toHaveLength(3);
      for (let index = 1; index < cards.length; index++) {
        if (width === 1440) {
          expect(Math.abs(cards[0].y - cards[index].y)).toBeLessThanOrEqual(1);
          expect(cards[index].x).toBeGreaterThan(
            cards[index - 1].x + cards[index - 1].width,
          );
          expect(
            Math.abs(cards[0].height - cards[index].height),
          ).toBeLessThanOrEqual(1);
        } else
          expect(cards[index].y).toBeGreaterThan(
            cards[index - 1].y + cards[index - 1].height,
          );
      }
      const customersTable = await page
        .getByRole("table", { name: "Umsatz", exact: true })
        .boundingBox();
      expect(customersTable.y).toBeGreaterThan(
        Math.max(...cards.map((card) => card.y + card.height)),
      );
      await check(page);
      await screenshot(page, testInfo, "rankings", width);
      await page.getByLabel("Jahr", { exact: true }).selectOption("2025");
      await expect(page).toHaveURL(/#\/finance-customers\?year=2025$/);
      await expect(
        rankings.getByRole("heading", {
          name: "Beste Kunden · 2025",
          exact: true,
        }),
      ).toBeVisible();
      await expect(rankings).toContainText("900,00");
      await expect(rankings).toContainText(rows[3].counterparty_name);
      await expect(rankings).not.toContainText(rows[2].counterparty_name);
      await expect(overall.locator(".oj-metric-value")).toHaveText(
        expectedOverall,
      );
      const lifetime = page
        .getByRole("table", { name: "Umsatz", exact: true })
        .getByRole("row")
        .filter({
          has: page.getByRole("link", { name: customer.name, exact: true }),
        });
      await expect(lifetime).toContainText("1.000,00");
      await expect(lifetime).toContainText("50,00");
      await expect(
        lifetime.getByRole("link", { name: customer.name, exact: true }),
      ).toHaveAttribute("href", "#/customers/" + customer.id);
      await check(page);
    }
    const stored = await (
      await request.get("/api/finance/invoices/" + rows[4].id)
    ).json();
    expect(stored.currency).toBe("USD");
    expect(stored.total_amount_minor).toBe(5000);
    expect(stored.invoice_date).toBe("2024-06-01");
  } finally {
    for (const row of rows)
      await request.delete("/api/finance/invoices/" + row.id);
  }
});

test("finance settings preserve company data and mask keys without a migration card", async ({
  page,
  request,
}, testInfo) => {
  const initial = await (await request.get("/api/finance/settings")).json();
  const version = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url)),
  ).version;
  expect(initial.app_version).toBe(version);
  const originalAddress = "Originalgasse 7\n1010 Wien";
  expect(
    (
      await request.patch("/api/finance/settings", {
        data: { company_address: originalAddress },
      })
    ).ok(),
  ).toBe(true);
  let sentKey = null;
  let scans = 0;
  await page.route("**/api/finance/scan", async (route) => {
    scans++;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        imported: 0,
        skipped: 0,
        failed: 0,
        missing: 0,
        pending: 0,
      }),
    });
  });
  await page.route("**/api/finance/settings/test-key", async (route) => {
    sentKey = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/#/finance-settings");
    await expect(
      page.getByRole("heading", { name: "Einstellungen", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".finance-tabs")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/billly/i);
    await expect(page.locator(".finance-app-version")).toHaveText(
      "Version " + version,
    );
    const address = page.getByLabel("Firmenadresse", { exact: true });
    await expect(address).toHaveJSProperty("tagName", "INPUT");
    await expect(address).toHaveAttribute("type", "text");
    await expect(address).toHaveValue("Originalgasse 7, 1010 Wien");
    const companyTab = page.getByRole("tab", { name: "Firma", exact: true });
    const recognitionTab = page.getByRole("tab", {
      name: "Erkennung",
      exact: true,
    });
    const watcherTab = page.getByRole("tab", {
      name: "Ordnerüberwachung",
      exact: true,
    });
    await expect(page.getByRole("tab")).toHaveCount(3);
    await expect(companyTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Ordnerüberwachung", exact: true }),
    ).toBeHidden();
    await companyTab.focus();
    await companyTab.press("ArrowRight");
    await expect(recognitionTab).toBeFocused();
    await expect(recognitionTab).toHaveAttribute("aria-selected", "true");
    await recognitionTab.press("Home");
    await expect(companyTab).toBeFocused();
    const companyEmail = page.getByLabel("Firmen-E-Mail", { exact: true });
    await companyEmail.fill("not-an-email");
    await companyTab.focus();
    await companyTab.press("End");
    await expect(watcherTab).toBeFocused();
    await expect(watcherTab).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/tab=watcher$/);
    await expect(
      page.getByRole("heading", { name: "Ordnerüberwachung", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Einstellungen speichern", exact: true })
      .click();
    await expect(companyTab).toHaveAttribute("aria-selected", "true");
    await expect(companyEmail).toBeFocused();
    await companyEmail.fill(initial.company_email || "");
    await watcherTab.click();
    await page
      .getByRole("button", { name: "Ordner jetzt einlesen", exact: true })
      .click();
    await expect.poll(() => scans).toBe(1);
    await expect(watcherTab).toHaveAttribute("aria-selected", "true");
    await check(page);
    await screenshot(page, testInfo, "settings-watcher", 1440);
    const revenueFolder = page.getByLabel("Einnahmen-Ordner", { exact: true });
    await revenueFolder.fill("/pitchary-missing-fixture-folder");
    await recognitionTab.click();
    await page
      .getByRole("button", { name: "Einstellungen speichern", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Dieser Ordner ist nicht erreichbar." }),
    ).toBeVisible();
    await expect(watcherTab).toHaveAttribute("aria-selected", "true");
    await expect(revenueFolder).toHaveValue("/pitchary-missing-fixture-folder");
    await revenueFolder.fill(initial.revenue_folder || "");
    await expect(
      page.getByRole("heading", {
        name: "Daten in Pitchary übernehmen",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Quelldatenbank", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Quelle prüfen und übernehmen",
        exact: true,
      }),
    ).toHaveCount(0);
    const model = page.getByLabel("Erkennungsmodell", { exact: true });
    await recognitionTab.click();
    await expect(model).toHaveValue(initial.model);
    await expect(model.locator("option")).toHaveCount(initial.models.length);
    expect(
      await model
        .locator("option")
        .evaluateAll((options) => options.map((option) => option.value)),
    ).toEqual(initial.models.map((model) => model.id));
    await model.selectOption("gpt-4.1-mini");
    await page
      .getByRole("button", { name: "Einstellungen speichern", exact: true })
      .click();
    await expect(model).toHaveValue("gpt-4.1-mini");
    await expect(recognitionTab).toHaveAttribute("aria-selected", "true");
    expect(
      (await (await request.get("/api/finance/settings")).json())
        .company_address,
    ).toBe(originalAddress);
    await check(page);
    await screenshot(page, testInfo, "settings", 1440);
    await page.setViewportSize({ width: 320, height: 900 });
    await companyTab.click();
    await page
      .getByLabel("Firmenname", { exact: true })
      .fill("Finance Test " + testInfo.project.name);
    await page
      .getByLabel("Firmen-E-Mail", { exact: true })
      .fill("me@example.test");
    await page
      .getByLabel("Firmenadresse", { exact: true })
      .fill("Testgasse 42, 1010 Wien");
    const key = "sk-local-fixture-1234";
    await recognitionTab.click();
    await expect(page.getByLabel("Firmenname", { exact: true })).toHaveValue(
      "Finance Test " + testInfo.project.name,
    );
    await page.getByLabel("Neuer OpenAI-Schlüssel", { exact: true }).fill(key);
    await expect(
      page.getByRole("button", { name: "Schlüssel prüfen", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Schlüssel prüfen", exact: true })
      .click();
    expect(sentKey).toEqual({ api_key: key, model: "gpt-4.1-mini" });
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
    expect(settings.model).toBe("gpt-4.1-mini");
    expect(settings.company_address).toBe("Testgasse 42, 1010 Wien");
    await expect(model).toHaveValue("gpt-4.1-mini");
    await page.reload();
    await expect(recognitionTab).toHaveAttribute("aria-selected", "true");
    await expect(model).toHaveValue("gpt-4.1-mini");
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
    await check(page);
    await screenshot(page, testInfo, "settings", 320);
    await watcherTab.click();
    await check(page);
    await screenshot(page, testInfo, "settings-watcher", 320);
    await expect(
      page.getByRole("heading", {
        name: "Daten in Pitchary übernehmen",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/billly/i);
  } finally {
    await request.delete("/api/finance/settings/key");
    await request.patch("/api/finance/settings", {
      data: {
        company_name: initial.company_name,
        company_email: initial.company_email,
        company_address: initial.company_address,
        model: initial.model,
      },
    });
  }
});
