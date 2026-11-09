import { test, expect } from "@playwright/test";

test("service table displays zero, repeated and archived customer pitches on desktop and mobile", async ({
  page,
  request,
}, testInfo) => {
  const suffix = `${testInfo.project.name} ${Date.now()}`;
  async function create(resource, data) {
    const response = await request.post("/api/" + resource, { data });
    expect(response.status()).toBe(201);
    return response.json();
  }
  const customer = await create("customers", {
    name: "Pitch customer " + suffix,
  });
  const name = "Counted service " + suffix;
  const service = await create("services", { name });
  const empty = await create("services", {
    name: "Unpitched service " + suffix,
  });
  const offer = await create("customer-services", {
    customer_id: customer.id,
    service_id: service.id,
    current_offered_price_minor: 10000,
  });
  await create("customer-services", {
    customer_id: customer.id,
    service_id: service.id,
    current_offered_price_minor: 20000,
  });
  const status = async (data) =>
    expect(
      (
        await request.post(`/api/customer-services/${offer.id}/status`, {
          data,
        })
      ).status(),
    ).toBe(200);
  await status({ status: "pitched" });
  await status({ status: "ghosted" });
  await status({ status: "pitched", reason: "Second pitch" });
  expect(
    (
      await request.post(`/api/customer-services/${offer.id}/activities`, {
        data: { type: "pitch", note: "Third pitch" },
      })
    ).status(),
  ).toBe(201);
  expect(
    (await request.delete("/api/customer-services/" + offer.id)).status(),
  ).toBe(200);
  expect((await request.delete("/api/customers/" + customer.id)).status()).toBe(
    200,
  );
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/#/services");
    await page.getByLabel("Suchen", { exact: true }).fill(suffix);
    const table = page.getByRole("table", {
      name: "Dienstleistungen",
      exact: true,
    });
    await expect(
      table.getByRole("columnheader", { name: "Pitched", exact: true }),
    ).toBeVisible();
    const row = table.getByRole("row").filter({
      has: page.getByRole("link", { name, exact: true }),
    });
    await expect(row.getByRole("cell").nth(2)).toHaveText("3");
    const emptyRow = table.getByRole("row").filter({
      has: page.getByRole("link", { name: empty.name, exact: true }),
    });
    await expect(emptyRow.getByRole("cell").nth(2)).toHaveText("0");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  expect((await request.delete("/api/services/" + service.id)).status()).toBe(
    200,
  );
  await page.reload();
  await page.getByLabel("Ansicht", { exact: true }).selectOption("true");
  const archived = page.getByRole("row").filter({
    has: page.getByRole("link", { name, exact: true }),
  });
  await expect(archived.getByRole("cell").nth(2)).toHaveText("3");
});
