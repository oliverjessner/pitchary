import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

const tags = [
  { id: "tag10", name: "Tag 10", color: "#4d8dff" },
  { id: "tag2", name: "Tag 2", color: "#4d8dff" },
  { id: "tag-change", name: "Änderung", color: "#ff6b35" },
];
const services = [
  {
    id: "zebra10",
    name: "Zebra 10",
    note: "Notiz 10",
    tags: [tags[0]],
    pitched_count: 10,
    created_at: "2026-01-02T10:00:00.000Z",
  },
  {
    id: "aehre",
    name: "Ähre",
    note: "",
    pitched_count: 0,
    created_at: "2025-12-15T10:00:00.000Z",
  },
  {
    id: "zebra2",
    name: "Zebra 2",
    note: "Notiz 2",
    tags: [tags[1]],
    pitched_count: 2,
    created_at: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "beta",
    name: "beta",
    note: "Änderung",
    tags: [tags[2]],
    pitched_count: 12,
    created_at: "2026-02-01T10:00:00.000Z",
  },
];

const rowNames = (table) => table.locator("tbody tr td:first-child .oj-link");

test("services sort every data column numerically or chronologically and retain sorting through filters", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let archiveLoads = 0;
  await page.route(/\/api\/services(?:\?.*)?$/, (route) => {
    const archived =
      new URL(route.request().url()).searchParams.get("archived") === "true";
    if (archived) archiveLoads++;
    return route.fulfill({
      json: services.map((row) => ({
        ...row,
        archived_at: archived ? "2026-11-01T12:00:00.000Z" : null,
      })),
    });
  });
  await page.route(/\/api\/service-tags(?:\?.*)?$/, (route) =>
    route.fulfill({ json: tags }),
  );
  await page.goto("/#/services");
  const table = page.getByRole("table", {
    name: "Dienstleistungen",
    exact: true,
  });
  await expect(table.getByRole("columnheader")).toHaveText([
    "Name",
    "Tags",
    "Pitched",
    "Notiz",
    "Angelegt",
    "Aktionen",
  ]);
  for (const [label, ascending, descending] of [
    [
      "Name",
      ["Ähre", "beta", "Zebra 2", "Zebra 10"],
      ["Zebra 10", "Zebra 2", "beta", "Ähre"],
    ],
    [
      "Tags",
      ["beta", "Zebra 2", "Zebra 10", "Ähre"],
      ["Zebra 10", "Zebra 2", "beta", "Ähre"],
    ],
    [
      "Pitched",
      ["Ähre", "Zebra 2", "Zebra 10", "beta"],
      ["beta", "Zebra 10", "Zebra 2", "Ähre"],
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
  ]) {
    const header = table.getByRole("columnheader", {
      name: label,
      exact: true,
    });
    const sort = header.getByRole("button", { name: label, exact: true });
    if ((await header.getAttribute("aria-sort")) !== "ascending")
      await sort.click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(rowNames(table)).toHaveText(ascending);
    await expect(sort.locator("i")).toHaveClass(/fa-arrow-up/);
    await expect(sort).toHaveAttribute("title", "Absteigend sortieren");
    await sort.click();
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await expect(rowNames(table)).toHaveText(descending);
    await expect(sort.locator("i")).toHaveClass(/fa-arrow-down/);
    await expect(sort).toBeFocused();
    await sort.press("Enter");
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(rowNames(table)).toHaveText(ascending);
    await expect(sort).toBeFocused();
    await expect(table.locator("th[aria-sort]")).toHaveCount(1);
  }
  await expect(
    table
      .getByRole("columnheader", { name: "Aktionen", exact: true })
      .getByRole("button"),
  ).toHaveCount(0);
  const empty = table.getByRole("row").filter({
    has: page.getByRole("link", { name: "Ähre", exact: true }),
  });
  await expect(empty.getByRole("cell").nth(1)).toHaveText("–");
  await expect(empty.getByRole("cell").nth(2)).toHaveText("0");
  await expect(empty.getByRole("cell").nth(3)).toHaveText("–");

  const pitched = table.getByRole("columnheader", {
    name: "Pitched",
    exact: true,
  });
  const sort = pitched.getByRole("button");
  await sort.click();
  await sort.focus();
  await page.keyboard.press("Space");
  await expect(pitched).toHaveAttribute("aria-sort", "descending");
  await expect(sort).toBeFocused();
  await expect(rowNames(table)).toHaveText([
    "beta",
    "Zebra 10",
    "Zebra 2",
    "Ähre",
  ]);
  const search = page.getByRole("searchbox", { name: "Suchen", exact: true });
  await search.fill("Zebra");
  await expect(rowNames(table)).toHaveText(["Zebra 10", "Zebra 2"]);
  await expect(pitched).toHaveAttribute("aria-sort", "descending");
  const trigger = page.locator(".oj-multiselect-trigger");
  await trigger.click();
  await page.getByRole("checkbox", { name: "Tag 2", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(rowNames(table)).toHaveText(["Zebra 2"]);
  await expect(pitched).toHaveAttribute("aria-sort", "descending");
  await trigger.click();
  await page.getByRole("checkbox", { name: "Tag 10", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(rowNames(table)).toHaveText(["Zebra 10", "Zebra 2"]);
  await search.fill("Keine Treffer");
  await expect(
    table.getByRole("cell", { name: "Keine Einträge.", exact: true }),
  ).toBeVisible();
  await expect(pitched).toHaveAttribute("aria-sort", "descending");
  await search.fill("");
  await page.getByLabel("Ansicht", { exact: true }).selectOption("true");
  await expect.poll(() => archiveLoads).toBe(1);
  await expect(
    table.getByRole("button", { name: "Wiederherstellen", exact: true }),
  ).toHaveCount(2);
  await expect(rowNames(table)).toHaveText(["Zebra 10", "Zebra 2"]);
  await expect(pitched).toHaveAttribute("aria-sort", "descending");
  await expect(trigger).toHaveAccessibleName("Tags 2 Tags ausgewählt");
  await trigger.click();
  await page
    .getByRole("button", { name: "Auswahl zurücksetzen", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(rowNames(table)).toHaveText([
    "beta",
    "Zebra 10",
    "Zebra 2",
    "Ähre",
  ]);
  await page.getByLabel("Ansicht", { exact: true }).selectOption("false");
  await expect(
    table.getByRole("button", { name: "Bearbeiten", exact: true }),
  ).toHaveCount(4);
  await expect(pitched).toHaveAttribute("aria-sort", "descending");
  await expect(
    table.getByRole("link", { name: "Zebra 2", exact: true }),
  ).toHaveAttribute("href", "#/services/zebra2");

  mkdirSync("artifacts/screenshots", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const region = page.getByRole("region", {
      name: "Dienstleistungen",
      exact: true,
    });
    if (width <= 390)
      expect(
        await region.evaluate((node) => node.scrollWidth > node.clientWidth),
      ).toBe(true);
    await sort.click();
    await expect(pitched).toHaveAttribute("aria-sort", "ascending");
    await expect(rowNames(table)).toHaveText([
      "Ähre",
      "Zebra 2",
      "Zebra 10",
      "beta",
    ]);
    await sort.press("Enter");
    await expect(pitched).toHaveAttribute("aria-sort", "descending");
    await expect(sort).toBeFocused();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-services-sorting.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
