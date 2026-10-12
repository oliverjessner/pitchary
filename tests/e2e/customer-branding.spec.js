import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { demoCustomerLogo } from "../../scripts/demo-assets.js";
import { logoFormats } from "../fixtures/logo-formats.js";
test("customer website and logo upload, replacement, removal and cancel", async ({
  page,
  request,
}, testInfo) => {
  const name = "Kunde mit Logo " + testInfo.project.name,
    website = `https://${testInfo.project.name}.kundenbeispiel.example/`;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/customers");
  await page
    .getByRole("button", { name: "Kunde anlegen", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Website", { exact: true }).fill(website);
  await page.getByLabel("Logo hochladen").setInputFiles({
    name: "customer.png",
    mimeType: "image/png",
    buffer: Buffer.from(demoCustomerLogo.data_base64, "base64"),
  });
  await expect(page.getByAltText("Vorschau des Kundenlogos")).toBeVisible();
  let results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  mkdirSync("artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-1440-customer-logo-dialog.png`,
  });
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const id = page.url().split("/customers/")[1];
  let logoImage = page.getByAltText("Logo von " + name);
  await expect(logoImage).toBeVisible();
  await expect
    .poll(() => logoImage.evaluate((img) => img.naturalWidth))
    .toBe(64);
  await expect(page.locator("a.customer-website")).toHaveAttribute(
    "href",
    website,
  );
  await expect(page.locator("a.customer-website")).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(page.locator("a.customer-website")).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await page.reload();
  await expect(page.getByAltText("Logo von " + name)).toBeVisible();
  await page.getByRole("link", { name: "Kunden", exact: true }).click();
  await page
    .getByLabel("Suchen", { exact: true })
    .fill(testInfo.project.name + ".kundenbeispiel.example");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(page.getByAltText("Logo von " + name)).toBeVisible();
  await expect(page.locator("table a.customer-website")).toHaveCount(0);
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await page
    .getByLabel("Notiz", { exact: true })
    .fill("Logo bleibt beim Bearbeiten erhalten.");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  expect(
    (await (await request.get("/api/customers/" + id)).json()).has_logo,
  ).toBe(true);
  await page.goto("/#/customers/" + id);
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await page.getByLabel("Logo hochladen").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("<script>bad image</script>"),
  });
  await expect(
    page.getByText("Die Datei lässt sich nicht als Bild öffnen.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    (await (await request.get("/api/customers/" + id)).json()).has_logo,
  ).toBe(true);
  for (const [format, image] of Object.entries(logoFormats)) {
    if (format === "webp")
      await page
        .getByRole("button", { name: "Bearbeiten", exact: true })
        .click();
    await page.getByLabel("Logo hochladen").setInputFiles({
      name: "replacement." + format,
      mimeType: image.mime_type,
      buffer: Buffer.from(image.data_base64, "base64"),
    });
    await expect(page.getByAltText("Vorschau des Kundenlogos")).toBeVisible();
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const response = await request.get("/api/customers/" + id + "/logo");
    expect(response.headers()["content-type"]).toBe(image.mime_type);
    expect(await response.body()).toEqual(
      Buffer.from(image.data_base64, "base64"),
    );
    await expect
      .poll(() =>
        page
          .getByAltText("Logo von " + name)
          .evaluate((img) => img.naturalWidth),
      )
      .toBe(64);
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-390-customer-logo-dialog.png`,
  });
  await page
    .getByRole("button", { name: "Logo entfernen", exact: true })
    .click();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page.reload();
  await expect(page.getByAltText("Logo von " + name)).toBeVisible();
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await page
    .getByRole("button", { name: "Logo entfernen", exact: true })
    .click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator("#main img")).toHaveCount(0);
  let row = await (await request.get("/api/customers/" + id)).json();
  expect(row.has_logo).toBe(false);
  expect(row.website).toBe(website);
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await page.getByLabel("Website", { exact: true }).fill("");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator("a.customer-website")).toHaveCount(0);
  row = await (await request.get("/api/customers/" + id)).json();
  expect(row.website).toBe("");
  expect(errors).toEqual([]);
});
