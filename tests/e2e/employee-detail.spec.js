import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

async function create(request, resource, data) {
  const response = await request.post("/api/" + resource, { data });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
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
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

test("employee links open personal services and history, including archives, with editable contact activities", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const customer = await create(request, "customers", {
    name: "Personenansicht " + testInfo.project.name,
  });
  const employee = await create(request, "employees", {
    customer_id: customer.id,
    name: "Anna Persönlich",
    email: "anna@example.test",
    position: "Geschäftsführung",
    linkedin: "https://www.linkedin.com/in/anna-person/",
  });
  const colleague = await create(request, "employees", {
    customer_id: customer.id,
    name: "Kollege",
  });
  const consulting = await create(request, "services", {
    name: "Persönliche Beratung " + testInfo.project.name,
  });
  const maintenance = await create(request, "services", {
    name: "Persönliche Wartung " + testInfo.project.name,
  });
  const otherService = await create(request, "services", {
    name: "Fremde Dienstleistung " + testInfo.project.name,
  });
  const offer = (service, primary_employee_id, currency = "EUR") =>
    create(request, "customer-services", {
      customer_id: customer.id,
      service_id: service.id,
      primary_employee_id,
      current_offered_price_minor: 120000,
      currency,
      billing_type: "one_time",
      pitch_channel: "email",
    });
  const assigned = await offer(consulting, employee.id);
  const contacted = await offer(maintenance, colleague.id, "USD");
  const archived = await offer(consulting, employee.id);
  const unrelated = await offer(otherService, colleague.id);
  await create(request, `customer-services/${assigned.id}/activities`, {
    type: "meeting",
    employee_id: employee.id,
    channel: "meeting",
    note: "Strategie persönlich besprochen",
  });
  await create(request, `customer-services/${assigned.id}/activities`, {
    type: "note",
    employee_id: colleague.id,
    note: "Vertraulicher Kontakt nur mit Kollegen",
  });
  await create(request, `customer-services/${assigned.id}/activities`, {
    type: "note",
    note: "Allgemeine Angebotsnotiz",
  });
  await create(request, `customer-services/${contacted.id}/activities`, {
    type: "call",
    employee_id: employee.id,
    channel: "phone",
    note: "Wartung telefonisch vereinbart",
  });
  await create(request, `customer-services/${unrelated.id}/activities`, {
    type: "note",
    employee_id: colleague.id,
    note: "Unbeteiligte Person",
  });
  for (const status of ["pitched", "accepted", "done"])
    expect(
      (
        await request.post(`/api/customer-services/${assigned.id}/status`, {
          data: { status },
        })
      ).ok(),
    ).toBe(true);
  expect(
    (await request.delete("/api/customer-services/" + archived.id)).ok(),
  ).toBe(true);
  expect((await request.delete("/api/services/" + consulting.id)).ok()).toBe(
    true,
  );

  await page.goto("/#/customers/" + customer.id);
  const contacts = page.getByRole("table", {
    name: "Mitarbeiter",
    exact: true,
  });
  await contacts
    .getByRole("link", { name: employee.name, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp("#/employees/" + employee.id + "$"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    employee.name,
  );
  await expect(
    page
      .getByRole("navigation", { name: "Hauptnavigation" })
      .getByRole("link", { name: "Kunden", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const profile = section(page, "Kontaktdaten");
  await expect(profile).toContainText(employee.position);
  await expect(
    profile.getByRole("link", { name: employee.email }),
  ).toHaveAttribute("href", "mailto:" + employee.email);
  await expect(
    profile.getByRole("link", { name: "LinkedIn", exact: true }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  const offers = page.getByRole("table", {
    name: "Dienstleistungen & Angebote",
    exact: true,
  });
  await expect(offers.locator("tbody tr")).toHaveCount(3);
  await expect(offers).not.toContainText(otherService.name);
  await expect(offers).toContainText("Archiviert");
  const maintenanceRow = offers.getByRole("row").filter({
    has: page.getByRole("link", { name: maintenance.name, exact: true }),
  });
  await expect(maintenanceRow).toContainText("Kontaktaktivitäten");
  await expect(maintenanceRow).toContainText("$");
  const archivedRow = offers.getByRole("row").filter({
    has: page.getByRole("link", {
      name: "Angebot " + archived.id.slice(0, 8),
      exact: true,
    }),
  });
  await expect(archivedRow.getByRole("button")).toHaveCount(0);
  for (const [label, value] of [
    ["Dienstleistungen", "2"],
    ["Angebote", "3"],
    ["Erledigte Angebote", "1"],
    ["Aktivitäten", "2"],
  ])
    await expect(
      page
        .locator(".oj-metric")
        .filter({
          has: page.locator(".oj-metric-label", {
            hasText: new RegExp("^" + label + "$"),
          }),
        })
        .locator(".oj-metric-value"),
    ).toHaveText(value);
  const history = section(page, "Aktivitäten mit dieser Person");
  await expect(history.locator(".timeline li")).toHaveCount(2);
  await expect(history.locator(".timeline li").first()).toContainText(
    "Wartung telefonisch vereinbart",
  );
  await expect(history).not.toContainText(
    "Vertraulicher Kontakt nur mit Kollegen",
  );
  await expect(history).not.toContainText("Allgemeine Angebotsnotiz");
  await expect(history).not.toContainText("Preisänderung");

  await maintenanceRow
    .getByRole("button", { name: "Aktivität hinzufügen", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Aktivität hinzufügen",
    exact: true,
  });
  await expect(dialog.getByLabel("Mitarbeiter", { exact: true })).toHaveValue(
    employee.id,
  );
  await dialog
    .getByLabel("Notiz", { exact: true })
    .fill("Persönliches Follow-up aus der Mitarbeiteransicht");
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(history.locator(".timeline li")).toHaveCount(3);
  await expect(history.locator(".timeline li").first()).toContainText(
    "Persönliches Follow-up aus der Mitarbeiteransicht",
  );
  const newActivity = (
    await (await request.get("/api/employees/" + employee.id)).json()
  ).activities[0];
  expect(newActivity.employee_id).toBe(employee.id);
  expect(newActivity.customer_service_id).toBe(contacted.id);

  await request.patch("/api/customer-services/" + assigned.id, {
    data: { primary_employee_id: colleague.id },
  });
  await page.reload();
  await expect(offers.locator("tbody tr")).toHaveCount(3);
  await expect(history).toContainText("Strategie persönlich besprochen");
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Position", { exact: true })
    .fill("Beratung");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Speichern", exact: true })
    .click();
  await expect(profile).toContainText("Beratung");
  for (const close of await page
    .getByRole("button", { name: "Schließen", exact: true })
    .all())
    await close.click();

  mkdirSync("artifacts/screenshots", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await check(page);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-employee-detail.png`,
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "Archivieren", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Archivieren?", exact: true })
    .getByRole("button", { name: "Archivieren", exact: true })
    .click();
  await expect(page.locator(".page-subtitle")).toContainText(
    "Archivierter Mitarbeiter",
  );
  await expect(offers.getByRole("button")).toHaveCount(0);
  await expect(history.locator(".timeline li")).toHaveCount(3);
  await page.reload();
  await expect(history.locator(".timeline li")).toHaveCount(3);
  await page
    .getByRole("navigation", { name: "Brotkrumennavigation" })
    .getByRole("link", { name: customer.name, exact: true })
    .click();
  await contacts
    .getByRole("link", { name: employee.name, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Wiederherstellen", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Bearbeiten", exact: true }),
  ).toBeVisible();
  await expect(
    offers.getByRole("button", { name: "Aktivität hinzufügen", exact: true }),
  ).toHaveCount(2);

  await offers
    .getByRole("link", {
      name: "Angebot " + assigned.id.slice(0, 8),
      exact: true,
    })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    consulting.name,
  );
  await page
    .locator(".facts")
    .getByRole("link", { name: colleague.name, exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    colleague.name,
  );
  await page.goto("/#/activities");
  const activityRow = page
    .getByRole("table", { name: "Aktivitäten", exact: true })
    .getByRole("row")
    .filter({ hasText: "Strategie persönlich besprochen" })
    .filter({ has: page.locator(`a[href="#/employees/${employee.id}"]`) });
  await activityRow
    .getByRole("link", { name: employee.name, exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    employee.name,
  );
  await check(page);
  expect(errors).toEqual([]);
});

test("employee detail has clear empty states and recoverable errors for unknown contacts", async ({
  page,
  request,
}, testInfo) => {
  const customer = await create(request, "customers", {
    name: "Leere Kontaktansicht " + testInfo.project.name,
  });
  const employee = await create(request, "employees", {
    customer_id: customer.id,
    name: "Neuer Mitarbeiter",
  });
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto("/#/employees/" + employee.id);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    employee.name,
  );
  await expect(section(page, "Dienstleistungen & Angebote")).toContainText(
    "noch keine Dienstleistungen oder Angebote verknüpft",
  );
  await expect(section(page, "Aktivitäten mit dieser Person")).toContainText(
    "Noch keine Aktivitäten",
  );
  await check(page);
  await page.goto("/#/employees/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Ansicht konnte nicht geladen werden",
  );
  await expect(page.getByRole("alert")).toHaveText("Datensatz nicht gefunden.");
  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("link", { name: "Kunden", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kunden");
});
