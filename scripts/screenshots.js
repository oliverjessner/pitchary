import { lstat, mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createScreenshotApp, screenshotTime } from "./screenshot-demo.js";

export const screenshotDirectory = fileURLToPath(
  new URL("../src-tauri/screenshots/", import.meta.url),
);

export async function clearScreenshotImages(directory) {
  await mkdir(directory, { recursive: true });
  if (!(await lstat(directory)).isDirectory())
    throw new Error(`Screenshot directory must not be a symlink: ${directory}`);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await clearScreenshotImages(filename);
    else if (
      /\.(png|jpe?g|webp|avif|gif|svg|bmp|tiff?|ico|heic|heif|jxl)$/i.test(
        entry.name,
      )
    )
      await unlink(filename);
  }
}

export async function generateScreenshots() {
  await clearScreenshotImages(screenshotDirectory);
  let app, browser;
  const files = [];
  try {
    app = await createScreenshotApp();
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      browser = await chromium.launch();
    } catch (error) {
      throw new Error(
        "Chromium konnte nicht gestartet werden. Bei fehlender Installation zuerst npx playwright install chromium ausführen.",
        { cause: error },
      );
    }
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      locale: "de-AT",
      timezoneId: "Europe/Vienna",
      serviceWorkers: "block",
    });
    const errors = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.origin !== origin ||
        !["GET", "HEAD"].includes(request.method()) ||
        url.pathname.startsWith("/api/finance/legacy")
      ) {
        errors.push(
          `Unerlaubte Screenshot-Anfrage: ${request.method()} ${url.pathname}`,
        );
        await route.abort();
      } else await route.continue();
    });
    await context.addInitScript((iso) => {
      const NativeDate = Date;
      const time = NativeDate.parse(iso);
      window.Date = class extends NativeDate {
        constructor(...args) {
          super(...(args.length ? args : [time]));
        }
        static now() {
          return time;
        }
      };
    }, screenshotTime);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(
          `HTTP ${response.status()}: ${new URL(response.url()).pathname}`,
        );
    });
    page.on("requestfailed", (request) =>
      errors.push(`Anfrage fehlgeschlagen: ${new URL(request.url()).pathname}`),
    );
    const ready = async () => {
      await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false");
      await expect(page.locator("#main h1")).toBeVisible();
      await expect(page.locator("#main h1")).not.toHaveText(
        /Ansicht konnte nicht geladen werden|Seite nicht gefunden/,
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode()));
        document.activeElement?.blur();
        window.scrollTo(0, 0);
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      if (errors.length) throw new Error(errors.join("\n"));
    };
    const capture = async (name) => {
      if (!/^[a-z][a-z0-9-]*$/.test(name))
        throw new Error(`Ungültiger Screenshot-Name: ${name}`);
      await ready();
      const png = await page.screenshot({
        type: "png",
        fullPage: true,
        animations: "disabled",
        caret: "hide",
        scale: "css",
      });
      if (png.readUInt32BE(16) !== 1920)
        throw new Error(
          `${name}: Screenshot ist nicht genau 1920 Pixel breit.`,
        );
      await writeFile(path.join(screenshotDirectory, `${name}.png`), png);
      files.push(`${name}.png`);
      console.log(`${name}.png`);
    };
    await page.goto(origin);
    await ready();
    const menus = await page
      .locator('nav[aria-label="Hauptnavigation"] a')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    if (!menus.length) throw new Error("Keine Hauptmenüs gefunden.");
    for (const href of menus) {
      if (!href.startsWith("#/"))
        throw new Error(`Unerwarteter Menülink: ${href}`);
      const name = href.slice(2).split("?")[0].replaceAll("/", "-");
      await page.goto(origin + "/" + href);
      await capture(name);
      const tabs = await page
        .locator('#main [role="tab"]')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.getAttribute("aria-selected") !== "true")
            .map((node) => ({ id: node.id, name: node.dataset.settingsTab })),
        );
      for (const tab of tabs) {
        await page.locator(`[id="${tab.id}"]`).click();
        await expect(page.locator(`[id="${tab.id}"]`)).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await capture(`${name}-${tab.name || tab.id}`);
      }
      if (name === "invoices") {
        await page.goto(origin + "/#/invoices?category=payable");
        await capture("invoices-payable");
      }
    }
    console.log(
      `${files.length} PNGs mit 1920 Pixeln Breite: ${screenshotDirectory}`,
    );
    return files;
  } finally {
    try {
      await browser?.close();
    } finally {
      await app?.close();
    }
  }
}

if (import.meta.main)
  generateScreenshots().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
