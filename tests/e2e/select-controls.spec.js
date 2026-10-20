import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

async function checkSelectSizes(root) {
  const sizes = await root.locator("select:visible").evaluateAll((nodes) =>
    nodes.map((node) => ({
      name: node.name,
      height: node.getBoundingClientRect().height,
      appearance: getComputedStyle(node).appearance,
    })),
  );
  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) {
    expect(size.height, size.name).toBe(36);
    expect(size.appearance, size.name).toBe("none");
  }
}

test("OJ selects use full control height in all filters, settings and contact dialogs", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const routes = [
    "dashboard",
    "customers",
    "employees",
    "services",
    "pipeline",
    "activities",
    "analytics",
    "invoices",
    "finance-customers",
    "finance-settings?tab=recognition",
  ];
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of routes) {
      await page.goto("/#/" + route);
      await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false");
      await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
        /nicht gefunden|nicht geladen/,
      );
      await checkSelectSizes(page.locator("#main"));
    }
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  const offers = await (await request.get("/api/customer-services")).json();
  const offer = offers.find((row) => row.status === "open");
  await page.goto("/#/relationships/" + offer.id);
  const dialog = page.getByRole("dialog");
  for (const name of ["Bearbeiten", "Aktivität hinzufügen", "Preis ändern"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(dialog).toBeVisible();
    await checkSelectSizes(dialog);
    if (name === "Aktivität hinzufügen") {
      await dialog
        .getByLabel("Aktivität", { exact: true })
        .selectOption("meeting");
      await expect(dialog.getByLabel("Aktivität", { exact: true })).toHaveValue(
        "meeting",
      );
      mkdirSync("artifacts/screenshots", { recursive: true });
      await page.screenshot({
        path: `artifacts/screenshots/${testInfo.project.name}-oj-selects-dialog.png`,
      });
    }
    await dialog
      .getByRole("button", { name: "Abbrechen", exact: true })
      .click();
  }
  await page.goto("/#/invoices");
  await page
    .getByRole("button", { name: "PDF importieren", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await checkSelectSizes(dialog);
  await dialog.getByLabel("Art", { exact: true }).selectOption("payable");
  await expect(dialog.getByLabel("Art", { exact: true })).toHaveValue(
    "payable",
  );
  expect(errors).toEqual([]);
});
