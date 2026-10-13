import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

test("original pitch channel can be corrected after a pitch with cancel, failure, reload and completed offers", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const create = async (resource, data) => {
    const response = await request.post(`/api/${resource}`, { data });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const customer = await create("customers", {
    name: "Kanalkorrektur " + testInfo.project.name,
  });
  const service = await create("services", {
    name: "Kanal Leistung " + testInfo.project.name,
  });
  const offer = await create("customer-services", {
    customer_id: customer.id,
    service_id: service.id,
    current_offered_price_minor: 12345,
    pitch_channel: "email",
  });
  const endpoint = `/api/customer-services/${offer.id}`;
  expect(
    (
      await request.post(endpoint + "/status", { data: { status: "pitched" } })
    ).ok(),
  ).toBe(true);
  await create(`customer-services/${offer.id}/activities`, {
    type: "pitch",
    channel: "email",
    note: "Ursprünglicher Kontakt per E-Mail",
  });
  const before = await (await request.get(endpoint)).json();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/relationships/" + offer.id);
  const edit = page.getByRole("button", { name: "Bearbeiten", exact: true });
  const dialog = page.getByRole("dialog", {
    name: "Angebot bearbeiten",
    exact: true,
  });
  const channel = dialog.getByLabel("Ursprünglicher Pitch-Kanal", {
    exact: true,
  });
  const displayed = page
    .locator(".facts > div")
    .filter({ hasText: "Ursprünglicher Pitch-Kanal" })
    .locator("dd");
  const save = dialog.getByRole("button", { name: "Speichern", exact: true });
  await edit.click();
  await expect(channel).toHaveValue("email");
  await expect(dialog.getByLabel("Währung", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Abrechnung", { exact: true })).toHaveCount(0);
  await channel.selectOption("internal_software");
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  mkdirSync("artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-1440-relationship-channel-dialog.png`,
  });
  await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  expect((await (await request.get(endpoint)).json()).pitch_channel).toBe(
    "email",
  );
  await edit.click();
  await channel.selectOption("internal_software");
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(displayed).toHaveText("Interne Software");
  await page.reload();
  await expect(displayed).toHaveText("Interne Software");
  const analytics = await (
    await request.get("/api/analytics", {
      params: { customer_id: customer.id, pitch_channel: "internal_software" },
    })
  ).json();
  expect(analytics.summary.pitched).toBe(1);
  expect(
    (
      await (
        await request.get("/api/analytics", {
          params: { customer_id: customer.id, pitch_channel: "email" },
        })
      ).json()
    ).summary.created,
  ).toBe(0);

  const routePattern = "**" + endpoint;
  await page.route(routePattern, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: { message: "Kanal konnte nicht gespeichert werden." },
          }),
        })
      : route.continue(),
  );
  await edit.click();
  await channel.selectOption("phone");
  await save.click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Kanal konnte nicht gespeichert werden.",
  );
  await expect(channel).toHaveValue("phone");
  expect((await (await request.get(endpoint)).json()).pitch_channel).toBe(
    "internal_software",
  );
  await page.unroute(routePattern);
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(displayed).toHaveText("Telefon");
  const updated = await (await request.get(endpoint)).json();
  expect(updated.status).toBe(before.status);
  expect(updated.first_pitched_price_minor).toBe(
    before.first_pitched_price_minor,
  );
  expect(updated.history).toEqual(before.history);
  expect(updated.activities).toEqual(before.activities);
  expect(updated.activities[0].channel).toBe("email");

  expect(
    (
      await request.post(endpoint + "/status", { data: { status: "ghosted" } })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await edit.click();
  await expect(channel).toHaveValue("phone");
  await channel.selectOption("linkedin");
  await save.click();
  await expect(displayed).toHaveText("LinkedIn");
  expect(
    (
      await request.post(endpoint + "/status", { data: { status: "accepted" } })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(endpoint + "/status", { data: { status: "done" } })
    ).ok(),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.reload();
  await edit.click();
  await expect(channel).toHaveValue("linkedin");
  await channel.selectOption("meeting");
  const mobileAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(mobileAxe.violations).toEqual([]);
  await expect(save).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-390-relationship-channel-dialog.png`,
  });
  await save.click();
  await expect(displayed).toHaveText("Meeting");
  await page.reload();
  await expect(displayed).toHaveText("Meeting");
  expect((await (await request.get(endpoint)).json()).status).toBe("done");
  expect(errors).toEqual([]);
});
