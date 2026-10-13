import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { invoicePDF } from "../fixtures/finance-pdf.js";

test("customer list persists invoice-based lead/customer classification after invoice deletion", async ({
  page,
  request,
}, testInfo) => {
  const prefix = "Kundentyp " + testInfo.project.name;
  async function customer(suffix) {
    const response = await request.post("/api/customers", {
      data: { name: prefix + suffix },
    });
    expect(response.status()).toBe(201);
    const row = await response.json();
    expect(row.customer_type).toBe("lead");
    return row;
  }
  const billed = await customer(" Rechnung"),
    lead = await customer(" Lead");
  async function invoice(category, row, number) {
    const imported = await request.post("/api/finance/import", {
      data: {
        category,
        file_name: number + ".pdf",
        data: invoicePDF(number).toString("base64"),
      },
    });
    expect(imported.ok()).toBe(true);
    const { invoice: record } = await imported.json();
    const assigned = await request.patch("/api/finance/invoices/" + record.id, {
      data: {
        customer_id: row.id,
        counterparty_name: row.name,
      },
    });
    expect(assigned.ok()).toBe(true);
    return record;
  }
  const revenue = await invoice(
    "revenue",
    billed,
    "TYPE-REVENUE-" + testInfo.project.name,
  );
  const payable = await invoice(
    "payable",
    lead,
    "TYPE-PAYABLE-" + testInfo.project.name,
  );
  try {
    expect(
      (await (await request.get("/api/customers/" + billed.id)).json())
        .customer_type,
    ).toBe("customer");
    expect(
      (await (await request.get("/api/customers/" + lead.id)).json())
        .customer_type,
    ).toBe("lead");
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/#/customers");
      await page.getByLabel("Suchen", { exact: true }).fill(prefix);
      const table = page.getByRole("table", { name: "Kunden", exact: true });
      await expect(
        table.getByRole("columnheader", { name: "Status", exact: true }),
      ).toBeVisible();
      await expect(
        table
          .getByRole("row")
          .filter({ hasText: billed.name })
          .locator(".customer-type"),
      ).toHaveText("Kunde");
      await expect(
        table
          .getByRole("row")
          .filter({ hasText: lead.name })
          .locator(".customer-type"),
      ).toHaveText("Lead");
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
    expect(
      (await request.delete("/api/finance/invoices/" + revenue.id)).ok(),
    ).toBe(true);
    await page.reload();
    await page.getByLabel("Suchen", { exact: true }).fill(prefix);
    await expect(
      page
        .getByRole("table", { name: "Kunden", exact: true })
        .getByRole("row")
        .filter({ hasText: billed.name })
        .locator(".customer-type"),
    ).toHaveText("Kunde");
    expect(
      (await (await request.get("/api/customers/" + billed.id)).json())
        .customer_type,
    ).toBe("customer");
  } finally {
    await request.delete("/api/finance/invoices/" + revenue.id);
    await request.delete("/api/finance/invoices/" + payable.id);
  }
});
