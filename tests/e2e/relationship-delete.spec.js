import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

test("relationship delete confirms, cancels, handles failure and removes active or archived offers", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const customer = await (
    await request.post("/api/customers", {
      data: { name: "Löschtest Kunde " + testInfo.project.name },
    })
  ).json();
  const service = await (
    await request.post("/api/services", {
      data: { name: "Löschtest Leistung " + testInfo.project.name },
    })
  ).json();
  const create = async () =>
    (
      await request.post("/api/customer-services", {
        data: {
          customer_id: customer.id,
          service_id: service.id,
          current_offered_price_minor: 12345,
        },
      })
    ).json();
  const target = await create(),
    keep = await create();
  await request.post(`/api/customer-services/${target.id}/status`, {
    data: { status: "pitched" },
  });
  await request.post(`/api/customer-services/${target.id}/activities`, {
    data: { type: "follow_up", note: "Diese Aktivität gehört zum Löschtest." },
  });
  const before = await (
    await request.get(`/api/customer-services/${target.id}`)
  ).json();
  const permanent = `/api/customer-services/${target.id}/permanent`;
  let deleteRequests = 0;
  page.on("request", (req) => {
    if (req.url().endsWith(permanent) && req.method() === "DELETE")
      deleteRequests++;
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/relationships/" + target.id);
  const remove = page.getByRole("button", { name: "Löschen", exact: true });
  await remove.click();
  let dialog = page.getByRole("dialog", {
    name: "Angebot endgültig löschen?",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(customer.name);
  await expect(dialog).toContainText(service.name);
  await expect(dialog).toContainText("Statushistorie und allen Aktivitäten");
  await expect(
    dialog.getByRole("button", { name: "Abbrechen", exact: true }),
  ).toBeFocused();
  let result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  mkdirSync("artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-1440-relationship-delete-dialog.png`,
  });
  await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  expect(deleteRequests).toBe(0);
  await remove.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(deleteRequests).toBe(0);
  const unchanged = await (
    await request.get(`/api/customer-services/${target.id}`)
  ).json();
  expect(unchanged.history).toEqual(before.history);
  expect(unchanged.activities).toEqual(before.activities);
  await page.route("**" + permanent, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "Löschen fehlgeschlagen. Bitte erneut versuchen." },
      }),
    }),
  );
  await remove.click();
  await dialog
    .getByRole("button", { name: "Endgültig löschen", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Löschen fehlgeschlagen.",
  );
  await expect(remove).toBeVisible();
  expect(page.url()).toContain("/relationships/" + target.id);
  expect((await request.get(`/api/customer-services/${target.id}`)).ok()).toBe(
    true,
  );
  await page.unroute("**" + permanent);
  await page.setViewportSize({ width: 390, height: 800 });
  await remove.click();
  result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await expect(
    dialog.getByRole("button", { name: "Endgültig löschen", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-390-relationship-delete-dialog.png`,
  });
  await dialog
    .getByRole("button", { name: "Endgültig löschen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pipeline", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Angebot gelöscht.", { exact: true }),
  ).toBeVisible();
  expect(
    (await request.get(`/api/customer-services/${target.id}`)).status(),
  ).toBe(404);
  expect((await request.get(`/api/customer-services/${keep.id}`)).ok()).toBe(
    true,
  );
  const activities = await (
    await request.get("/api/activities", {
      params: { customer_id: customer.id },
    })
  ).json();
  expect(activities).toEqual([]);
  await page.reload();
  await expect(
    page.locator(`a[href="#/relationships/${target.id}"]`),
  ).toHaveCount(0);
  await expect(
    page.locator(`a[href="#/relationships/${keep.id}"]`),
  ).toBeVisible();
  await request.delete(`/api/customer-services/${keep.id}`);
  await page.goto("/#/relationships/" + keep.id);
  await expect(
    page.getByRole("button", { name: "Wiederherstellen", exact: true }),
  ).toBeVisible();
  await remove.click();
  await dialog
    .getByRole("button", { name: "Endgültig löschen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pipeline", exact: true }),
  ).toBeVisible();
  expect(
    (await request.get(`/api/customer-services/${keep.id}`)).status(),
  ).toBe(404);
  expect((await request.get(`/api/customers/${customer.id}`)).ok()).toBe(true);
  expect((await request.get(`/api/services/${service.id}`)).ok()).toBe(true);
  expect(errors).toEqual([]);
});
