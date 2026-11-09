import { test, expect } from "@playwright/test";

test("rejected pipeline cards can be archived, cancelled and restored with history intact", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const create = async (resource, data) => {
    const response = await request.post("/api/" + resource, { data });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const customer = await create("customers", {
    name: "Rejected archive " + testInfo.project.name,
  });
  const service = await create("services", {
    name: "Archive service " + testInfo.project.name,
  });
  const offer = await create("customer-services", {
    customer_id: customer.id,
    service_id: service.id,
    current_offered_price_minor: 10000,
  });
  expect(
    (
      await request.post(`/api/customer-services/${offer.id}/status`, {
        data: { status: "pitched" },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/#/pipeline");
  await page.getByLabel("Suchen", { exact: true }).fill(customer.name);
  const card = page
    .locator(".offer-card")
    .filter({ has: page.locator(`a[href="#/relationships/${offer.id}"]`) });
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Archivieren", exact: true }),
  ).toHaveCount(0);
  await card.getByRole("button", { name: "Ablehnen", exact: true }).click();
  await page.getByLabel("Absagegrund", { exact: true }).selectOption("budget");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  const archive = card.getByRole("button", {
    name: "Archivieren",
    exact: true,
  });
  await expect(archive).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Wieder aufnehmen", exact: true }),
  ).toBeVisible();
  const before = await (
    await request.get(`/api/customer-services/${offer.id}`)
  ).json();
  await archive.click();
  const dialog = page.getByRole("dialog", {
    name: "Archivieren?",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(archive).toBeVisible();
  expect(
    (await (await request.get(`/api/customer-services/${offer.id}`)).json())
      .archived_at,
  ).toBeNull();
  await page.setViewportSize({ width: 320, height: 800 });
  await archive.click();
  await dialog
    .getByRole("button", { name: "Archivieren", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await page.getByLabel("Ansicht", { exact: true }).selectOption("true");
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Archivieren", exact: true }),
  ).toHaveCount(0);
  await card
    .getByRole("button", { name: "Wiederherstellen", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await page.getByLabel("Ansicht", { exact: true }).selectOption("false");
  await expect(archive).toBeVisible();
  const after = await (
    await request.get(`/api/customer-services/${offer.id}`)
  ).json();
  expect(after.archived_at).toBeNull();
  expect(after.history).toEqual(before.history);
  expect(after.activities).toEqual(before.activities);
  expect(errors).toEqual([]);
});
