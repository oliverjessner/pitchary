import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
test("offer dialog reviews each customer, aligns prices and keeps actions visible on narrow screens", async ({
  page,
  request,
}, testInfo) => {
  const origin = "http://127.0.0.1:3218";
  const services = await (await request.get(origin + "/api/services")).json();
  const service = services.find((s) => s.name === "Technischer Audit");
  const rows = await (
    await request.get(origin + "/api/customer-services")
  ).json();
  mkdirSync("artifacts/screenshots", { recursive: true });
  for (const [width, height] of [
    [1440, 1000],
    [737, 705],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin + "/#/services/" + service.id);
    const opener = page.getByRole("button", {
      name: "Mehreren Kunden anbieten",
    });
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(service.name, { exact: true })).toBeVisible();
    await expect(dialog.locator('select[name="service_id"]')).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Angebote anlegen", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("checkbox", { name: "Atlas Digital", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Space");
    await expect(
      dialog.getByRole("checkbox", { name: "Atlas Digital", exact: true }),
    ).toBeChecked();
    await page.keyboard.press("Space");
    await expect(
      dialog.getByRole("checkbox", { name: "Atlas Digital", exact: true }),
    ).not.toBeChecked();
    await dialog.getByLabel("Studio Nord", { exact: true }).check();
    await dialog.getByLabel("Morgenwerk", { exact: true }).check();
    await dialog.getByLabel("Angebotspreis", { exact: true }).fill("400");
    await dialog.getByLabel("Währung", { exact: true }).focus();
    await dialog.getByLabel("Währung", { exact: true }).selectOption("GBP");
    await expect(
      dialog.getByLabel("Angebotspreis", { exact: true }),
    ).toHaveValue("400,00");
    await dialog
      .getByLabel("Abrechnung", { exact: true })
      .selectOption("monthly");
    await expect(dialog.getByRole("status")).toContainText(
      "2 eigenständige Angebote",
    );
    await expect(dialog.getByRole("status")).toContainText("400,00");
    await expect(dialog.getByRole("status")).toContainText("pro Kunde");
    await expect(dialog.getByRole("status")).toContainText("Monatlich");
    await dialog.getByLabel("Währung", { exact: true }).selectOption("EUR");
    await dialog
      .getByLabel("Abrechnung", { exact: true })
      .selectOption("one_time");
    const save = dialog.getByRole("button", {
      name: "2 Angebote anlegen",
      exact: true,
    });
    await expect(save).toBeEnabled();
    const bounds = await save.boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    const price = await dialog
        .getByLabel("Angebotspreis", { exact: true })
        .boundingBox(),
      currency = await dialog
        .getByLabel("Währung", { exact: true })
        .boundingBox();
    expect(Math.abs(price.y - currency.y)).toBeLessThan(2);
    expect(Math.abs(price.height - currency.height)).toBeLessThan(2);
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    await dialog.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-batch-offer-dialog.png`,
    });
    await dialog
      .getByRole("button", { name: "Auswahl aufheben", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Angebote anlegen", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  await page
    .getByRole("button", { name: "Angebot anlegen", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Ansprechpartner", { exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Angebot anlegen", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Kunde", { exact: true })
    .selectOption({ label: "Studio Nord" });
  await expect(
    dialog.getByLabel("Ansprechpartner", { exact: true }),
  ).toBeEnabled();
  await dialog.getByLabel("Angebotspreis", { exact: true }).fill("0");
  await expect(
    dialog.getByRole("button", { name: "Angebot anlegen", exact: true }),
  ).toBeEnabled();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await dialog.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-390-single-offer-dialog.png`,
  });
  await page.keyboard.press("Escape");
  expect(
    (await (await request.get(origin + "/api/customer-services")).json())
      .length,
  ).toBe(rows.length);
});
test("search keeps hidden selections, bulk actions work and invalid prices cannot be submitted", async ({
  page,
  request,
}, testInfo) => {
  // All browser specs share the API fixture; search terms must not match other specs.
  const prefix = `Angebotsauswahl ${testInfo.project.name} ${randomUUID()}`;
  const ids = [];
  for (const suffix of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"]) {
    const response = await request.post("/api/customers", {
      data: { name: prefix + " " + suffix },
    });
    expect(response.ok()).toBe(true);
    ids.push((await response.json()).id);
  }
  const service = (await (await request.get("/api/services")).json()).find(
    (s) => s.name === "Technischer Audit",
  );
  const before = await (await request.get("/api/customer-services")).json();
  await page.goto("/#/services/" + service.id);
  await page.getByRole("button", { name: "Mehreren Kunden anbieten" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Kunden suchen")).toBeFocused();
  await dialog.getByLabel("Kunden suchen").fill(prefix + " Alpha");
  await dialog.getByLabel(prefix + " Alpha", { exact: true }).check();
  await dialog.getByLabel("Kunden suchen").fill(prefix + " Beta");
  await expect(
    dialog.getByRole("checkbox", { name: prefix + " Beta", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.locator(".offer-customer-option:not([hidden])"),
  ).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "Treffer auswählen", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "2 eigenständige Angebote",
  );
  await expect(
    dialog.locator('input[name="customer_ids"]:checked'),
  ).toHaveCount(2);
  await dialog.getByLabel("Kunden suchen").fill("Kein Treffer");
  await expect(
    dialog.getByText("Keine passenden Kunden.", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Treffer auswählen", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Angebotspreis", { exact: true }).fill("12,345");
  await dialog.getByLabel("Abrechnung", { exact: true }).focus();
  await expect(
    dialog.getByRole("button", { name: "2 Angebote anlegen", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByText(
      "Preis mit maximal zwei Nachkommastellen eingeben, z. B. 1200,50.",
      { exact: true },
    ),
  ).toBeVisible();
  await dialog.getByLabel("Angebotspreis", { exact: true }).fill("1450,75");
  await dialog
    .getByLabel("Abrechnung", { exact: true })
    .selectOption("monthly");
  await dialog
    .getByRole("button", { name: "2 Angebote anlegen", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const after = await (await request.get("/api/customer-services")).json();
  expect(after.length).toBe(before.length + 2);
  const created = after.filter((r) => ids.slice(0, 2).includes(r.customer_id));
  expect(created).toHaveLength(2);
  expect(
    created.every(
      (r) =>
        r.current_offered_price_minor === 145075 &&
        r.billing_type === "monthly",
    ),
  ).toBe(true);
  expect(new Set(created.map((r) => r.id)).size).toBe(2);
});
test("one-customer dialog stays compact with an explicit offer count", async ({
  page,
  request,
}, testInfo) => {
  const origin = "http://127.0.0.1:3218";
  const customer = (
    await (await request.get(origin + "/api/customers")).json()
  ).find((c) => c.name === "Atlas Digital");
  const service = (
    await (await request.get(origin + "/api/services")).json()
  ).find((s) => s.name === "Technischer Audit");
  // Limit the read-only fixture collection to one real fixture record; never write customer data.
  await page.route("**/api/customers", (route) =>
    route.fulfill({ json: [customer] }),
  );
  for (const [width, height] of [
    [737, 705],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin + "/#/services/" + service.id);
    await page
      .getByRole("button", { name: "Mehreren Kunden anbieten" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("checkbox")).toHaveCount(1);
    await expect(
      dialog.getByRole("button", { name: "Alle auswählen", exact: true }),
    ).toHaveCount(0);
    await dialog.getByLabel(customer.name, { exact: true }).check();
    await dialog.getByLabel("Angebotspreis", { exact: true }).fill("400");
    await dialog.getByLabel("Währung", { exact: true }).focus();
    await expect(
      dialog.getByRole("button", { name: "1 Angebot anlegen", exact: true }),
    ).toBeEnabled();
    await expect(dialog.getByRole("status")).toContainText(
      "1 eigenständiges Angebot",
    );
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    await dialog.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-one-customer-offer-dialog.png`,
    });
    await page.keyboard.press("Escape");
  }
});
