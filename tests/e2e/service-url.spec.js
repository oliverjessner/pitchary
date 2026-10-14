import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("optional service URL can be created, edited, searched and cleared on desktop and mobile", async ({
  page,
  request,
}, testInfo) => {
  for (const width of [1440, 320]) {
    const name = `Service URL ${testInfo.project.name} ${width}`;
    const url =
      `https://${testInfo.project.name}.services.example/` +
      "service-page/".repeat(20);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/#/services");
    await page
      .getByRole("button", { name: "Dienstleistung anlegen", exact: true })
      .click();
    const input = page.getByLabel("URL (optional)", { exact: true });
    await expect(input).toHaveJSProperty("required", false);
    await page.getByLabel("Name", { exact: true }).fill(name);
    await input.fill(url);
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    const id = page.url().split("/services/")[1];
    const external = page.locator('#main a[target="_blank"]');
    await expect(external).toHaveAttribute("href", url);
    await expect(external).toHaveAttribute("rel", "noopener noreferrer");
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
    await page.reload();
    await expect(external).toHaveAttribute("href", url);
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await expect(input).toHaveValue(url);
    await input.fill("https://changed.example/new");
    await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(external).toHaveAttribute("href", url);
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await input.fill("https://changed.example/new");
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(external).toHaveAttribute(
      "href",
      "https://changed.example/new",
    );
    await page
      .getByRole("navigation", { name: "Hauptnavigation" })
      .getByRole("link", { name: "Dienstleistungen", exact: true })
      .click();
    await page.getByLabel("Suchen", { exact: true }).fill("changed.example");
    await page.getByRole("link", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await input.fill("");
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(external).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(external).toHaveCount(0);
    expect((await (await request.get("/api/services/" + id)).json()).url).toBe(
      "",
    );
    await page
      .getByRole("navigation", { name: "Hauptnavigation" })
      .getByRole("link", { name: "Dienstleistungen", exact: true })
      .click();
    await page.getByLabel("Suchen", { exact: true }).fill(name);
    const row = page.getByRole("row").filter({
      has: page.getByRole("link", { name, exact: true }),
    });
    await row.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await expect(input).toHaveValue("");
    await input.fill("https://added-later.example/service");
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("link", { name, exact: true }).click();
    await expect(external).toHaveAttribute(
      "href",
      "https://added-later.example/service",
    );
    expect((await (await request.get("/api/services/" + id)).json()).url).toBe(
      "https://added-later.example/service",
    );
  }
});
