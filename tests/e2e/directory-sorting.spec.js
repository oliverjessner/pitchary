import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

const customers = [
  {
    id: "zebra10",
    name: "Zebra 10",
    customer_type: "lead",
    note: "Notiz 10",
    created_at: "2026-01-02T10:00:00.000Z",
  },
  {
    id: "aehre",
    name: "Ähre",
    customer_type: "customer",
    note: "",
    created_at: "2025-12-15T10:00:00.000Z",
  },
  {
    id: "zebra2",
    name: "Zebra 2",
    customer_type: "customer",
    note: "Notiz 2",
    created_at: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "beta",
    name: "beta",
    customer_type: "lead",
    note: "Änderung",
    created_at: "2026-02-01T10:00:00.000Z",
  },
];
const employees = [
  {
    id: "zebra10",
    name: "Zebra 10",
    customer_id: "company-a",
    customer_name: "Ähre GmbH",
    position: "Vertrieb 10",
    email: "z@example.test",
    linkedin: "https://www.linkedin.com/in/z/",
  },
  {
    id: "aenne",
    name: "Änne",
    customer_id: "company-b",
    customer_name: "Zebra 10",
    position: "",
    email: "",
    linkedin: "",
  },
  {
    id: "zebra2",
    name: "Zebra 2",
    customer_id: "company-c",
    customer_name: "Zebra 2",
    position: "Vertrieb 2",
    email: "anna2@example.test",
    linkedin: "https://www.linkedin.com/in/anna2/",
  },
  {
    id: "beta",
    name: "beta",
    customer_id: "company-d",
    customer_name: "beta GmbH",
    position: "Änderungsmanagement",
    email: "anna10@example.test",
    linkedin: "https://www.linkedin.com/in/anna10/",
  },
];

const rowNames = (table) => table.locator("tbody tr td:first-child .oj-link");

async function verifySorting(table, cases) {
  for (const [label, ascending, descending] of cases) {
    const header = table.getByRole("columnheader", {
      name: label,
      exact: true,
    });
    const button = header.getByRole("button", { name: label, exact: true });
    if ((await header.getAttribute("aria-sort")) !== "ascending")
      await button.click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(rowNames(table)).toHaveText(ascending);
    await expect(button.locator("i")).toHaveClass(/fa-arrow-up/);
    await expect(button).toHaveAttribute("title", "Absteigend sortieren");
    await button.click();
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await expect(rowNames(table)).toHaveText(descending);
    await expect(button.locator("i")).toHaveClass(/fa-arrow-down/);
    await expect(button).toBeFocused();
    await button.press("Enter");
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(rowNames(table)).toHaveText(ascending);
    await expect(button).toBeFocused();
    await expect(table.locator("th[aria-sort]")).toHaveCount(1);
  }
}

async function verifyLayout(page, name, testInfo) {
  mkdirSync("artifacts/screenshots", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (width <= 390) {
      expect(
        await page
          .locator(".oj-table-container")
          .evaluate((node) => node.scrollWidth > node.clientWidth),
      ).toBe(true);
      expect(
        await page
          .locator("tbody tr:first-child td:first-child .oj-link")
          .evaluate((node) => node.getClientRects().length),
      ).toBe(1);
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-${name}-sorting.png`,
      fullPage: true,
    });
  }
}

test("customers sort every data column in both directions and retain sorting across filters", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/\/api\/customers(?:\?.*)?$/, (route) => {
    const archived =
      new URL(route.request().url()).searchParams.get("archived") === "true";
    return route.fulfill({
      json: customers.map((row) => ({
        ...row,
        archived_at: archived ? "2026-10-01T10:00:00.000Z" : null,
      })),
    });
  });
  await page.goto("/#/customers");
  const table = page.getByRole("table", { name: "Kunden", exact: true });
  await verifySorting(table, [
    [
      "Name",
      ["Ähre", "beta", "Zebra 2", "Zebra 10"],
      ["Zebra 10", "Zebra 2", "beta", "Ähre"],
    ],
    [
      "Status",
      ["Ähre", "Zebra 2", "beta", "Zebra 10"],
      ["beta", "Zebra 10", "Ähre", "Zebra 2"],
    ],
    [
      "Notiz",
      ["beta", "Zebra 2", "Zebra 10", "Ähre"],
      ["Zebra 10", "Zebra 2", "beta", "Ähre"],
    ],
    [
      "Angelegt",
      ["Ähre", "Zebra 10", "beta", "Zebra 2"],
      ["Zebra 2", "beta", "Zebra 10", "Ähre"],
    ],
  ]);
  await expect(
    table
      .getByRole("columnheader", { name: "Aktionen", exact: true })
      .getByRole("button"),
  ).toHaveCount(0);
  const date = table.getByRole("columnheader", {
    name: "Angelegt",
    exact: true,
  });
  await date.getByRole("button").focus();
  await page.keyboard.press("Space");
  await expect(date).toHaveAttribute("aria-sort", "descending");
  const search = page.getByRole("searchbox", { name: "Suchen", exact: true });
  await search.fill("Zebra");
  await expect(rowNames(table)).toHaveText(["Zebra 2", "Zebra 10"]);
  await expect(date).toHaveAttribute("aria-sort", "descending");
  await page.getByLabel("Status", { exact: true }).selectOption("lead");
  await expect(rowNames(table)).toHaveText(["Zebra 10"]);
  await page.getByLabel("Status", { exact: true }).selectOption("");
  await search.fill("Keine Treffer");
  await expect(
    table.getByRole("cell", { name: "Keine Einträge.", exact: true }),
  ).toBeVisible();
  await search.fill("");
  await page.getByLabel("Ansicht", { exact: true }).selectOption("true");
  await expect(
    table.getByRole("button", { name: "Wiederherstellen", exact: true }),
  ).toHaveCount(4);
  await expect(date).toHaveAttribute("aria-sort", "descending");
  await expect(rowNames(table)).toHaveText([
    "Zebra 2",
    "beta",
    "Zebra 10",
    "Ähre",
  ]);
  await page.getByLabel("Ansicht", { exact: true }).selectOption("false");
  await expect(
    table.getByRole("button", { name: "Bearbeiten", exact: true }),
  ).toHaveCount(4);
  await verifyLayout(page, "customers", testInfo);
  expect(errors).toEqual([]);
});

test("people sort all contact columns with missing values last and preserve links and filters", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let archiveLoads = 0;
  await page.route(/\/api\/employees(?:\?.*)?$/, (route) => {
    const archived =
      new URL(route.request().url()).searchParams.get("archived") === "true";
    if (archived) archiveLoads++;
    return route.fulfill({
      json: employees.map((row) => ({
        ...row,
        archived_at: archived ? "2026-10-01T10:00:00.000Z" : null,
      })),
    });
  });
  await page.goto("/#/employees");
  const table = page.getByRole("table", { name: "Personen", exact: true });
  await verifySorting(table, [
    [
      "Name",
      ["Änne", "beta", "Zebra 2", "Zebra 10"],
      ["Zebra 10", "Zebra 2", "beta", "Änne"],
    ],
    [
      "Unternehmen",
      ["Zebra 10", "beta", "Zebra 2", "Änne"],
      ["Änne", "Zebra 2", "beta", "Zebra 10"],
    ],
    [
      "Position",
      ["beta", "Zebra 2", "Zebra 10", "Änne"],
      ["Zebra 10", "Zebra 2", "beta", "Änne"],
    ],
    [
      "E-Mail",
      ["Zebra 2", "beta", "Zebra 10", "Änne"],
      ["Zebra 10", "beta", "Zebra 2", "Änne"],
    ],
    [
      "LinkedIn",
      ["Zebra 2", "beta", "Zebra 10", "Änne"],
      ["Zebra 10", "beta", "Zebra 2", "Änne"],
    ],
  ]);
  await table.getByRole("button", { name: "LinkedIn", exact: true }).click();
  const search = page.getByRole("searchbox", {
    name: "Personen suchen",
    exact: true,
  });
  await search.fill("Zebra");
  await expect(rowNames(table)).toHaveText(["Zebra 10", "Zebra 2", "Änne"]);
  await search.fill("Keine Treffer");
  await expect(table).toHaveCount(0);
  await search.fill("");
  await page.getByLabel("Ansicht", { exact: true }).selectOption("true");
  await expect.poll(() => archiveLoads).toBe(1);
  await expect(
    table.getByRole("columnheader", { name: "LinkedIn", exact: true }),
  ).toHaveAttribute("aria-sort", "descending");
  await expect(rowNames(table)).toHaveText([
    "Zebra 10",
    "beta",
    "Zebra 2",
    "Änne",
  ]);
  const row = table.getByRole("row").filter({ hasText: "Ähre GmbH" });
  await expect(
    row.getByRole("link", { name: "Zebra 10", exact: true }),
  ).toHaveAttribute("href", "#/employees/zebra10");
  await expect(
    row.getByRole("link", { name: "Ähre GmbH", exact: true }),
  ).toHaveAttribute("href", "#/customers/company-a");
  await expect(
    row.getByRole("link", { name: "z@example.test", exact: true }),
  ).toHaveAttribute("href", "mailto:z@example.test");
  await expect(
    row.getByRole("link", { name: "LinkedIn", exact: true }),
  ).toHaveAttribute("href", "https://www.linkedin.com/in/z/");
  await verifyLayout(page, "employees", testInfo);
  expect(errors).toEqual([]);
});
