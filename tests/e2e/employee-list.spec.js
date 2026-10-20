import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

async function create(request, resource, data) {
  const response = await request.post("/api/" + resource, { data });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

test("person menu searches all contact fields, opens profiles and companies, and includes archives", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const customer = await create(request, "customers", {
    name: "Personensuche " + testInfo.project.name,
  });
  const employee = await create(request, "employees", {
    customer_id: customer.id,
    name: "Alex Suchkontakt " + testInfo.project.name,
    email: `personensuche-${testInfo.project.name}@example.test`,
    position: "Vertriebsleitung " + testInfo.project.name,
  });
  const archived = await create(request, "employees", {
    customer_id: customer.id,
    name: "Archivkontakt " + testInfo.project.name,
  });
  expect((await request.delete("/api/employees/" + archived.id)).ok()).toBe(
    true,
  );
  await page.goto("/#/customers");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  const menu = nav.getByRole("link", { name: "Personen", exact: true });
  await menu.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Personen");
  await expect(menu).toHaveAttribute("aria-current", "page");
  const search = page.getByRole("searchbox", {
    name: "Personen suchen",
    exact: true,
  });
  const table = page.getByRole("table", { name: "Personen", exact: true });
  for (const term of [
    employee.name,
    customer.name,
    employee.position.toUpperCase(),
    employee.email,
  ]) {
    await search.fill(" " + term + " ");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(
      table.getByRole("link", { name: employee.name, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("1 Person");
  }
  await table.getByRole("link", { name: employee.name, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp("#/employees/" + employee.id + "$"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    employee.name,
  );
  await expect(menu).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("navigation", { name: "Brotkrumennavigation" })
    .getByRole("link", { name: "Personen", exact: true })
    .click();
  await search.fill(customer.name);
  await table.getByRole("link", { name: customer.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp("#/customers/" + customer.id + "$"));
  await menu.click();
  await search.fill("Nicht vorhandener Suchkontakt");
  await expect(
    page.getByRole("heading", { name: "Keine Personen gefunden", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("0 Personen");
  await search.fill(archived.name);
  await expect(table).toHaveCount(0);
  await page.getByLabel("Ansicht", { exact: true }).selectOption("true");
  await expect(
    table.getByRole("link", { name: archived.name, exact: true }),
  ).toBeVisible();
  await table.getByRole("link", { name: archived.name, exact: true }).click();
  await expect(page.locator(".page-subtitle")).toContainText(
    "Archivierter Mitarbeiter",
  );
  await menu.click();
  await search.fill(customer.name);
  mkdirSync("artifacts/screenshots", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
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
    await page.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-employee-list.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("person menu shows an empty directory and retries archive loading after an error", async ({
  page,
}) => {
  await page.route("**/api/employees*", (route) => route.fulfill({ json: [] }));
  await page.goto("/#/employees");
  await expect(
    page.getByRole("heading", { name: "Noch keine Personen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Zu den Kunden", exact: true }),
  ).toHaveAttribute("href", "#/customers");
  let failed = false;
  await page.route("**/api/employees?archived=true", (route) => {
    if (failed) return route.fulfill({ json: [] });
    failed = true;
    return route.fulfill({
      status: 503,
      json: { error: { message: "Vorübergehend nicht erreichbar." } },
    });
  });
  await page.getByLabel("Ansicht", { exact: true }).selectOption("true");
  await expect(page.getByRole("alert")).toHaveText(
    "Vorübergehend nicht erreichbar.",
  );
  await page.getByRole("button", { name: "Erneut laden", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Keine archivierten Personen",
      exact: true,
    }),
  ).toBeVisible();
});
