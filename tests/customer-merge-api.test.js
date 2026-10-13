import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/server/app.js";
import { demoCustomerLogo } from "../scripts/demo-assets.js";

test("merged customer URLs, logos, finance pages and filters retain their destination", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  const source = app.crm.createEntity("customers", {
    name: "Brand",
    website: "https://example.com/",
    logo: demoCustomerLogo,
  });
  const target = app.crm.createEntity("customers", { name: "Legal GmbH" });
  const employee = app.crm.createEntity("employees", {
    customer_id: source.id,
    name: "Contact",
  });
  const service = app.crm.createEntity("services", { name: "Consulting" });
  const offer = app.crm.createRelationship({
    customer_id: source.id,
    service_id: service.id,
    primary_employee_id: employee.id,
    current_offered_price_minor: 10000,
    currency: "EUR",
    billing_type: "one_time",
    pitch_channel: "email",
  });
  const invoice = app.finance.record({
    category: "revenue",
    counterparty_name: source.name,
    total_amount_minor: 10000,
    currency: "EUR",
    customer_id: source.id,
    customer_service_id: offer.id,
  });
  app.customerMerge.merge(source.id, target.id);

  const customer = await app.inject("/api/customers/" + source.id);
  assert.equal(customer.statusCode, 200);
  assert.equal(customer.json().id, target.id);
  assert.equal(customer.json().employees[0].id, employee.id);
  assert.equal(customer.json().relationships[0].id, offer.id);
  const logo = await app.inject("/api/customers/" + source.id + "/logo");
  assert.equal(logo.statusCode, 200);
  assert.equal(logo.headers["content-type"], demoCustomerLogo.mime_type);
  const financial = await app.inject("/api/finance/customers/" + source.id);
  assert.equal(financial.statusCode, 200);
  assert.equal(financial.json().id, target.id);
  assert.equal(financial.json().invoice_count, 1);
  assert.equal(
    (await app.inject("/api/employees?customer_id=" + source.id)).json()[0].id,
    employee.id,
  );
  assert.equal(
    (
      await app.inject("/api/customer-services?customer_id=" + source.id)
    ).json()[0].id,
    offer.id,
  );
  assert.equal(
    (await app.inject("/api/finance/invoices?customer_id=" + source.id)).json()
      .items[0].id,
    invoice.id,
  );
  const update = await app.inject({
    method: "PATCH",
    url: "/api/customers/" + source.id,
    payload: { note: "New note via old link" },
  });
  assert.equal(update.statusCode, 200);
  assert.equal(update.json().id, target.id);
  assert.equal(
    app.crm.entity("customers", target.id).note,
    "New note via old link",
  );
});

test("merged-ID resolution preserves normal invalid and missing customer errors", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  assert.equal((await app.inject("/api/customers/not-a-uuid")).statusCode, 400);
  assert.equal(
    (await app.inject("/api/customers/00000000-0000-4000-8000-000000000001"))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject(
        "/api/finance/customers/00000000-0000-4000-8000-000000000001",
      )
    ).statusCode,
    404,
  );
});
