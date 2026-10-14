import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { demoCustomerLogo } from "../../scripts/demo-assets.js";
import { logoFormats } from "../fixtures/logo-formats.js";
test("a customer email automatically supplies a persistent logo from the company HTML", async ({
  page,
  request,
}, testInfo) => {
  for (const width of [1440, 320]) {
    const name = `Automatisches Logo ${testInfo.project.name} ${width}`;
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/#/customers");
    await page
      .getByRole("button", { name: "Kunde anlegen", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Kunde anlegen",
      exact: true,
    });
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog
      .getByLabel("Haupt-E-Mail", { exact: true })
      .fill("hello@auto-logo.example");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await dialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    const logo = page.getByAltText("Logo von " + name);
    await expect(logo).toBeVisible();
    await expect
      .poll(() => logo.evaluate((node) => node.naturalWidth))
      .toBe(64);
    const id = page.url().split("/customers/")[1];
    const stored = await (await request.get("/api/customers/" + id)).json();
    expect(stored.general_email).toBe("hello@auto-logo.example");
    expect(stored.has_logo).toBe(true);
    expect(stored.website).toBe("");
    await page.reload();
    await expect(logo).toBeVisible();
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await expect(
      page.getByRole("dialog").getByLabel("Haupt-E-Mail", { exact: true }),
    ).toHaveValue("hello@auto-logo.example");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Abbrechen", exact: true })
      .click();
    mkdirSync("artifacts/screenshots", { recursive: true });
    await page.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-customer-auto-logo.png`,
      fullPage: true,
    });
    await page.goto("/#/customers");
    await page
      .getByLabel("Suchen", { exact: true })
      .fill("hello@auto-logo.example");
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(logo).toBeVisible();
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
});
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

test("pipeline places current customer logos beside names with a stable fallback", async ({
  page,
  request,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const customer = await (
    await request.post("/api/customers", {
      data: {
        name:
          "Logotest Studio für digitale Kommunikation und internationale Markenentwicklung " +
          testInfo.project.name,
      },
    })
  ).json();
  const service = await (
    await request.post("/api/services", {
      data: { name: "Pipeline Logo " + testInfo.project.name },
    })
  ).json();
  const offer = await (
    await request.post("/api/customer-services", {
      data: {
        customer_id: customer.id,
        service_id: service.id,
        current_offered_price_minor: 40000,
      },
    })
  ).json();
  let imageRequests = 0;
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === `/api/customers/${customer.id}/logo`)
      imageRequests++;
  });
  const card = page.locator(".offer-card");
  const image = card.getByAltText("Logo von " + customer.name);
  const load = async ({ archived = false } = {}) => {
    await page.goto("/#/pipeline?status=open");
    await page.reload();
    await page.getByLabel("Suchen", { exact: true }).fill(service.name);
    if (archived)
      await page.getByLabel("Ansicht", { exact: true }).selectOption("true");
    await expect(card).toHaveCount(1);
  };
  await load();
  await expect(card.locator(".customer-logo img")).toHaveCount(0);
  await expect(card.locator(".customer-logo i")).toBeVisible();
  expect(imageRequests).toBe(0);
  const upload = await request.patch(`/api/customers/${customer.id}`, {
    data: { logo: demoCustomerLogo },
  });
  expect(upload.ok()).toBe(true);
  let logoUrl = (await upload.json()).logo_url;
  mkdirSync("artifacts/screenshots", { recursive: true });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await load();
    await expect(image).toHaveAttribute("src", logoUrl);
    await expect.poll(() => image.evaluate((img) => img.naturalWidth)).toBe(64);
    await expect(card.locator(".customer-logo i")).toHaveCount(0);
    const logoBounds = await image.boundingBox();
    const frameBounds = await card.locator(".customer-logo").boundingBox();
    const nameBounds = await card
      .locator(".offer-card-customer-name")
      .boundingBox();
    expect(logoBounds.x + logoBounds.width).toBeLessThan(nameBounds.x);
    expect(frameBounds.width).toBe(28);
    expect(frameBounds.height).toBe(28);
    expect(
      await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-${width}-pipeline-customer-logo.png`,
    });
  }
  const replacement = await request.patch(`/api/customers/${customer.id}`, {
    data: { logo: logoFormats.jpeg },
  });
  expect(replacement.ok()).toBe(true);
  const updatedUrl = (await replacement.json()).logo_url;
  expect(updatedUrl).not.toBe(logoUrl);
  logoUrl = updatedUrl;
  await load();
  await expect(image).toHaveAttribute("src", logoUrl);
  await expect.poll(() => image.evaluate((img) => img.naturalWidth)).toBe(64);
  const imageRoute = `**/api/customers/${customer.id}/logo?*`;
  await page.route(imageRoute, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: "Undecodable image",
    }),
  );
  await load();
  await expect(image).toHaveCount(0);
  await expect(card.locator(".customer-logo i")).toBeVisible();
  await page.unroute(imageRoute);
  expect(
    (await request.delete(`/api/customer-services/${offer.id}`)).ok(),
  ).toBe(true);
  expect((await request.delete(`/api/customers/${customer.id}`)).ok()).toBe(
    true,
  );
  await load({ archived: true });
  await expect.poll(() => image.evaluate((img) => img.naturalWidth)).toBe(64);
  expect(
    (await request.post(`/api/customers/${customer.id}/restore`)).ok(),
  ).toBe(true);
  expect(
    (
      await request.patch(`/api/customers/${customer.id}`, {
        data: { logo: null },
      })
    ).ok(),
  ).toBe(true);
  const beforeRemoval = imageRequests;
  await load({ archived: true });
  await expect(image).toHaveCount(0);
  await expect(card.locator(".customer-logo i")).toBeVisible();
  expect(imageRequests).toBe(beforeRemoval);
  expect(errors).toEqual([]);
});
