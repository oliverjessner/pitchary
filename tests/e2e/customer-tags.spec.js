import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

async function create(request, resource, data) {
  const response = await request.post("/api/" + resource, { data });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
const table = (page, name) => page.getByRole("table", { name, exact: true });
const tagPanel = (page) =>
  page
    .locator("#main > section")
    .filter({ has: page.getByRole("heading", { name: "Tags", exact: true }) });

async function layout(page, name, testInfo) {
  mkdirSync("artifacts/screenshots", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator(".tag-filter-trigger").click();
    const bounds = await page.locator(".tag-filter-panel").boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1001);
    expect(
      await page.evaluate(() => {
        const panel = document.querySelector(".tag-filter-panel");
        const popup = panel.getBoundingClientRect();
        const header = document
          .querySelector(".app-topbar")
          .getBoundingClientRect();
        const left = Math.max(popup.left, header.left);
        const right = Math.min(popup.right, header.right);
        const top = Math.max(popup.top, header.top);
        const bottom = Math.min(popup.bottom, header.bottom);
        return (
          right <= left ||
          bottom <= top ||
          panel.contains(
            document.elementFromPoint((left + right) / 2, (top + bottom) / 2),
          )
        );
      }),
    ).toBe(true);
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
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-${name}-tags.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(page.locator(".tag-filter-trigger")).toBeFocused();
  }
}

test("company tags can be created, assigned, edited, removed and shared with services", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const name = "Firmentag " + testInfo.project.name;
  const customerName = "Tag Unternehmen " + testInfo.project.name;
  await page.goto("/#/customers");
  await page
    .getByRole("button", { name: "Tags verwalten", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/customers\/tags$/);
  await page.getByRole("button", { name: "Tag anlegen", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(name);
  await page
    .getByRole("dialog")
    .getByLabel("Notiz", { exact: true })
    .fill("Unternehmen und Leistungen gruppieren");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    table(page, "Tags").getByText(name, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Brotkrumennavigation" })
    .getByRole("link", { name: "Kunden", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Kunde anlegen", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(customerName);
  await dialog.getByRole("checkbox", { name, exact: true }).check();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    customerName,
  );
  await expect(tagPanel(page).getByText(name, { exact: true })).toBeVisible();
  const id = page.url().split("/customers/")[1];
  await page.reload();
  await expect(tagPanel(page).getByText(name, { exact: true })).toBeVisible();
  const customer = await (await request.get("/api/customers/" + id)).json();
  const service = await create(request, "services", {
    name: "Gemeinsame Tags " + testInfo.project.name,
    tag_ids: [customer.tags[0].id],
  });
  await page
    .getByRole("button", { name: "Tags bearbeiten", exact: true })
    .click();
  await dialog.getByRole("checkbox", { name, exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(tagPanel(page).getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await expect(
    dialog.getByRole("checkbox", { name, exact: true }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.goto("/#/customers/tags");
  const row = table(page, "Tags").getByRole("row").filter({ hasText: name });
  await expect(row.locator("td").nth(2)).toHaveText("1");
  await expect(row.locator("td").nth(3)).toHaveText("1");
  await row.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  const renamed = name + " umbenannt";
  await dialog.getByLabel("Name", { exact: true }).fill(renamed);
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(
    table(page, "Tags").getByText(renamed, { exact: true }),
  ).toBeVisible();
  await page.goto("/#/customers/" + id);
  await expect(
    tagPanel(page).getByText(renamed, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Tags bearbeiten", exact: true })
    .click();
  await dialog.getByRole("checkbox", { name: renamed, exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(tagPanel(page)).toContainText("Noch keine Tags zugewiesen.");
  expect(
    (await (await request.get("/api/services/" + service.id)).json()).tags,
  ).toHaveLength(1);
  await page
    .getByRole("button", { name: "Tags bearbeiten", exact: true })
    .click();
  await dialog.getByRole("checkbox", { name: renamed, exact: true }).check();
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.goto("/#/customers/tags");
  await table(page, "Tags")
    .getByRole("row")
    .filter({ hasText: renamed })
    .getByRole("button", { name: "Löschen", exact: true })
    .click();
  await expect(dialog).toContainText("1 Dienstleistung und 1 Unternehmen");
  await dialog.getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(
    table(page, "Tags").getByText(renamed, { exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await request.get("/api/customers/" + id)).json()).tags,
  ).toEqual([]);
  expect(
    (await (await request.get("/api/services/" + service.id)).json()).tags,
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("company and person tag filters combine OR selection with search, sorting and archives", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const prefix = "Unternehmensfilter " + testInfo.project.name;
  const a = await create(request, "service-tags", { name: prefix + " A" });
  const b = await create(request, "service-tags", { name: prefix + " B" });
  const unused = await create(request, "service-tags", {
    name: prefix + " Unbenutzt",
  });
  const customers = [],
    employees = [];
  for (const [name, tag_ids] of [
    ["Alpha", [a.id]],
    ["Beta", [b.id]],
    ["Gamma", [a.id, b.id]],
    ["Ohne", []],
  ]) {
    const customer = await create(request, "customers", {
      name: prefix + " " + name,
      tag_ids,
    });
    customers.push(customer);
    employees.push(
      await create(request, "employees", {
        name: prefix + " Kontakt " + name,
        customer_id: customer.id,
      }),
    );
  }
  const archivedCustomer = await create(request, "customers", {
    name: prefix + " Archivfirma",
    tag_ids: [a.id],
  });
  const employeeAtArchive = await create(request, "employees", {
    name: prefix + " Aktive Person im Archivunternehmen",
    customer_id: archivedCustomer.id,
  });
  expect(
    (await request.delete("/api/customers/" + archivedCustomer.id)).ok(),
  ).toBe(true);
  const archivedEmployee = await create(request, "employees", {
    name: prefix + " Archivperson",
    customer_id: customers[0].id,
  });
  expect(
    (await request.delete("/api/employees/" + archivedEmployee.id)).ok(),
  ).toBe(true);
  await page.goto("/#/customers");
  await page.getByLabel("Suchen", { exact: true }).fill(prefix);
  const trigger = page.locator(".tag-filter-trigger");
  const aChoice = page.getByRole("checkbox", { name: a.name, exact: true });
  const bChoice = page.getByRole("checkbox", { name: b.name, exact: true });
  await expect(table(page, "Kunden").locator("tbody tr")).toHaveCount(4);
  await table(page, "Kunden")
    .getByRole("button", { name: "Name", exact: true })
    .click();
  await trigger.click();
  await aChoice.check();
  await expect(table(page, "Kunden").locator("tbody tr")).toHaveCount(2);
  await expect(
    table(page, "Kunden").locator("tbody td:first-child a"),
  ).toHaveText([customers[2].name, customers[0].name]);
  await bChoice.check();
  await expect(table(page, "Kunden").locator("tbody tr")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await page.getByLabel("Status", { exact: true }).selectOption("customer");
  await expect(table(page, "Kunden")).toContainText("Keine Einträge.");
  await page.getByLabel("Status", { exact: true }).selectOption("lead");
  await expect(table(page, "Kunden").locator("tbody tr")).toHaveCount(3);
  await page.getByLabel("Suchen", { exact: true }).fill(prefix + " Alpha");
  await expect(table(page, "Kunden").locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Suchen", { exact: true }).fill(prefix);
  await page.getByLabel("Ansicht", { exact: true }).selectOption("true");
  await expect(
    table(page, "Kunden").getByRole("link", {
      name: archivedCustomer.name,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    table(page, "Kunden").getByRole("columnheader", {
      name: "Name",
      exact: true,
    }),
  ).toHaveAttribute("aria-sort", "descending");
  await page.getByLabel("Ansicht", { exact: true }).selectOption("false");
  await layout(page, "customer-directory", testInfo);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/employees");
  const search = page.getByLabel("Personen suchen", { exact: true });
  await search.fill(prefix);
  await trigger.click();
  await aChoice.check();
  await expect(table(page, "Personen").locator("tbody tr")).toHaveCount(3);
  await expect(
    table(page, "Personen")
      .getByRole("row")
      .filter({ hasText: employeeAtArchive.name }),
  ).toContainText("Archiviertes Unternehmen");
  await bChoice.check();
  await expect(table(page, "Personen").locator("tbody tr")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Auswahl zurücksetzen", exact: true })
    .click();
  await page.getByRole("checkbox", { name: unused.name, exact: true }).check();
  await expect(
    page.getByRole("heading", { name: "Keine Personen gefunden", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Auswahl zurücksetzen", exact: true })
    .click();
  await aChoice.check();
  await page.keyboard.press("Escape");
  await search.fill(employees[0].name);
  await expect(table(page, "Personen").locator("tbody tr")).toHaveCount(1);
  await search.fill(prefix);
  await page.getByLabel("Ansicht", { exact: true }).selectOption("true");
  await expect(
    table(page, "Personen").getByRole("link", {
      name: archivedEmployee.name,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Ansicht", { exact: true }).selectOption("false");
  await layout(page, "employee-directory", testInfo);
  expect(errors).toEqual([]);
});
