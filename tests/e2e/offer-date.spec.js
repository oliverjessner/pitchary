import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

test("new, edited and batch offers accept historical business dates while preserving their audit trail", async ({
  page,
  request,
}, testInfo) => {
  const prefix = `Angebotsdatum ${testInfo.project.name} ${randomUUID()}`;
  async function create(resource, data) {
    const response = await request.post("/api/" + resource, { data });
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  }
  const customer = await create("customers", { name: prefix + " Alpha" });
  const second = await create("customers", { name: prefix + " Beta" });
  const service = await create("services", { name: prefix });
  await page.clock.setFixedTime(new Date("2026-11-08T23:30:00.000Z"));
  mkdirSync("artifacts/screenshots", { recursive: true });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/#/services/" + service.id);
    await page
      .getByRole("button", { name: "Angebot anlegen", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Neues Angebot",
      exact: true,
    });
    const date = dialog.getByLabel("Angebotsdatum", { exact: true });
    await expect(date).toHaveValue("2026-11-09");
    await expect(date).toHaveJSProperty("min", "");
    await expect(date).toHaveJSProperty("max", "");
    await dialog.getByLabel("Kunde", { exact: true }).selectOption(customer.id);
    await dialog.getByLabel("Angebotspreis", { exact: true }).fill("100");
    await date.fill("2024-02-29");
    await dialog
      .getByRole("button", { name: "Angebot anlegen", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Angebotsdetails", exact: true }),
    ).toBeVisible();
    const id = page.url().split("/relationships/")[1];
    const before = await (
      await request.get("/api/customer-services/" + id)
    ).json();
    expect(before.offer_date).toBe("2024-02-29");
    await expect(page.locator('.facts time[datetime="2024-02-29"]')).toHaveText(
      "29.02.2024",
    );
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    const edit = page.getByRole("dialog", {
      name: "Angebot bearbeiten",
      exact: true,
    });
    await expect(edit.getByLabel("Angebotsdatum", { exact: true })).toHaveValue(
      "2024-02-29",
    );
    await edit.getByLabel("Angebotsdatum", { exact: true }).fill("2000-01-01");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await edit.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-offer-date-edit.png`,
    });
    await edit.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(page.locator('.facts time[datetime="2000-01-01"]')).toHaveText(
      "01.01.2000",
    );
    const after = await (
      await request.get("/api/customer-services/" + id)
    ).json();
    expect(after.offer_date).toBe("2000-01-01");
    expect(after.created_at).toBe(before.created_at);
    expect(after.status_since).toBe(before.status_since);
    expect(after.history).toEqual(before.history);
    expect(after.activities).toEqual(before.activities);
    await page.reload();
    await expect(page.locator('.facts time[datetime="2000-01-01"]')).toHaveText(
      "01.01.2000",
    );
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await expect(edit.getByLabel("Angebotsdatum", { exact: true })).toHaveValue(
      "2000-01-01",
    );
    await edit.getByRole("button", { name: "Abbrechen", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.goto("/#/services/" + service.id);
  await page
    .getByRole("button", { name: "Mehreren Kunden anbieten", exact: true })
    .click();
  const batch = page.getByRole("dialog", {
    name: "Angebote anlegen",
    exact: true,
  });
  await expect(batch).toBeVisible();
  const customerSearch = batch.getByLabel("Kunden suchen", { exact: true });
  if (await customerSearch.count()) await customerSearch.fill(prefix);
  await batch.getByLabel(customer.name, { exact: true }).check();
  await batch.getByLabel(second.name, { exact: true }).check();
  await batch.getByLabel("Angebotspreis", { exact: true }).fill("200");
  await batch.getByLabel("Angebotsdatum", { exact: true }).fill("2020-02-29");
  await batch
    .getByRole("button", { name: "2 Angebote anlegen", exact: true })
    .click();
  await expect(batch).toHaveCount(0);
  const offers = await (
    await request.get("/api/customer-services?service_id=" + service.id)
  ).json();
  expect(
    offers.filter((offer) => offer.offer_date === "2020-02-29"),
  ).toHaveLength(2);
});
