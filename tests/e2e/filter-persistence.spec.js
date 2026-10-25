import { test, expect } from "@playwright/test";

for (const [route, title, searchLabel] of [
  ["customers", "Kunden", "Suchen"],
  ["services", "Dienstleistungen", "Suchen"],
  ["employees", "Personen", "Personen suchen"],
]) {
  test(`${title} retains search, tags and archive filters across navigation and reload`, async ({
    page,
    request,
  }, testInfo) => {
    async function create(resource, data) {
      const response = await request.post(`/api/${resource}`, { data });
      expect(response.status()).toBe(201);
      return response.json();
    }
    const name = `Filter ${route} ${testInfo.project.name}`;
    const tag = await create("service-tags", { name });
    const customer = await create("customers", {
      name,
      tag_ids: [tag.id],
    });
    const row =
      route === "customers"
        ? customer
        : await create(route, {
            name: route === "employees" ? name + " Person" : name,
            ...(route === "employees"
              ? { customer_id: customer.id }
              : { tag_ids: [tag.id] }),
          });
    expect((await request.delete(`/api/${route}/${row.id}`)).ok()).toBe(true);
    await page.goto(`/#/${route}`);
    await page.getByLabel(searchLabel, { exact: true }).fill(name);
    await page.locator(".oj-multiselect-trigger").click();
    await page.getByRole("checkbox", { name, exact: true }).check();
    await page.keyboard.press("Escape");
    if (route === "customers")
      await page.getByLabel("Status", { exact: true }).selectOption("lead");
    await page.getByLabel("Ansicht", { exact: true }).selectOption("true");
    const record = page.locator("#main").getByRole("link", {
      name: row.name,
      exact: true,
    });
    await expect(record).toBeVisible();
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Dashboard",
    );
    await page.getByRole("link", { name: title, exact: true }).click();
    for (let pass = 0; pass < 2; pass++) {
      if (pass) await page.reload();
      await expect(page.getByLabel(searchLabel, { exact: true })).toHaveValue(
        name,
      );
      await expect(page.getByLabel("Ansicht", { exact: true })).toHaveValue(
        "true",
      );
      await expect(
        page.locator(".oj-multiselect-trigger"),
      ).toHaveAccessibleName("Tags " + name);
      if (route === "customers")
        await expect(page.getByLabel("Status", { exact: true })).toHaveValue(
          "lead",
        );
      await expect(record).toBeVisible();
    }
  });
}

for (const [route, title, query, values] of [
  [
    "dashboard",
    "Dashboard",
    "year=2024&month=02",
    { Jahr: "2024", Monat: "02" },
  ],
  [
    "invoices",
    "Rechnungen",
    "category=payable&status=paid",
    { Status: "paid" },
  ],
  ["finance-customers", "Umsatz", "year=2024", { Jahr: "2024" }],
]) {
  test(`${title} retains finance filters when returning from another menu`, async ({
    page,
  }) => {
    await page.goto(`/#/${route}?${query}`);
    for (const [label, value] of Object.entries(values))
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
    if (route === "invoices")
      await page.getByLabel("Suchen", { exact: true }).fill("Immediate search");
    await page.getByRole("link", { name: "Kunden", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kunden");
    await page.getByRole("link", { name: title, exact: true }).click();
    for (const [label, value] of Object.entries(values))
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
    if (route === "invoices") {
      await expect(page.getByLabel("Suchen", { exact: true })).toHaveValue(
        "Immediate search",
      );
      await expect(
        page.getByRole("radio", { name: "Ausgaben", exact: true }),
      ).toBeChecked();
    }
  });
}

test("Analytics restores applied filters and the filtered results", async ({
  page,
  request,
}, testInfo) => {
  const response = await request.post("/api/customers", {
    data: { name: "Analytics Filter " + testInfo.project.name },
  });
  expect(response.status()).toBe(201);
  const customer = await response.json();
  await page.goto("/#/analytics");
  await page.getByLabel("Kunde", { exact: true }).selectOption(customer.id);
  const applied = page.waitForResponse((response) =>
    response.url().includes("/api/analytics?customer_id=" + customer.id),
  );
  await page.getByRole("button", { name: "Filtern", exact: true }).click();
  await applied;
  await page.getByRole("link", { name: "Kunden", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kunden");
  const restored = page.waitForResponse((response) =>
    response.url().includes("/api/analytics?customer_id=" + customer.id),
  );
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  expect((await restored).ok()).toBe(true);
  await expect(page.getByLabel("Kunde", { exact: true })).toHaveValue(
    customer.id,
  );
});
