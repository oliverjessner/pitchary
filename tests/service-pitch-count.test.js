import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/server/app.js";

async function mutate(app, method, url, payload, expected = 200) {
  const response = await app.inject({ method, url: "/api" + url, payload });
  assert.equal(response.statusCode, expected, response.body);
  return response.json();
}

async function assertCount(app, id, expected, archived = false) {
  const detail = await app.inject("/api/services/" + id);
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().pitched_count, expected);
  const list = await app.inject("/api/services?archived=" + archived);
  assert.equal(list.statusCode, 200);
  assert.equal(
    list.json().find((row) => row.id === id)?.pitched_count,
    expected,
  );
}

test("service pitch counts follow actual pitch events across customers and repeated offers", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  const first = await mutate(app, "POST", "/customers", { name: "First" }, 201);
  const second = await mutate(
    app,
    "POST",
    "/customers",
    { name: "Second" },
    201,
  );
  const service = await mutate(
    app,
    "POST",
    "/services",
    { name: "Pitches" },
    201,
  );
  const other = await mutate(app, "POST", "/services", { name: "Other" }, 201);
  assert.equal(service.pitched_count, 0);
  const create = (customer, selected = service) =>
    mutate(
      app,
      "POST",
      "/customer-services",
      {
        customer_id: customer.id,
        service_id: selected.id,
        current_offered_price_minor: 10000,
      },
      201,
    );
  const status = (offer, data) =>
    mutate(app, "POST", `/customer-services/${offer.id}/status`, data);
  const a = await create(first);
  const b = await create(second);
  const duplicate = await create(first);
  const unrelated = await create(second, other);
  await assertCount(app, service.id, 0);
  await status(a, { status: "pitched" });
  await assertCount(app, service.id, 1);
  await mutate(
    app,
    "POST",
    `/customer-services/${a.id}/activities`,
    {
      type: "pitch",
      note: "Another pitch to the customer",
    },
    201,
  );
  await mutate(
    app,
    "POST",
    `/customer-services/${a.id}/activities`,
    {
      type: "follow_up",
      note: "Follow-up without a pitch",
    },
    201,
  );
  await assertCount(app, service.id, 2);
  await status(a, { status: "ghosted" });
  await assertCount(app, service.id, 2);
  await status(a, { status: "pitched", reason: "Follow-up" });
  await assertCount(app, service.id, 3);
  await status(a, { status: "rejected", reason: { code: "budget" } });
  await status(a, { status: "pitched", reason: "New budget" });
  await assertCount(app, service.id, 4);
  await status(a, { status: "accepted" });
  await status(a, { status: "done" });
  await status(b, { status: "pitched" });
  await status(duplicate, { status: "pitched" });
  await status(unrelated, { status: "pitched" });
  await assertCount(app, service.id, 6);
  await assertCount(app, other.id, 1);
  const analytics = (await app.inject("/api/analytics")).json();
  assert.equal(analytics.summary.pitched, 4);
  const invalid = await app.inject({
    method: "PATCH",
    url: "/api/services/" + service.id,
    payload: { pitched_count: 99 },
  });
  assert.equal(invalid.statusCode, 422);
  await assertCount(app, service.id, 6);
});

test("archived historical pitches survive reopening and disappear only with their deleted offer", async (t) => {
  const folder = mkdtempSync(
    path.join(os.tmpdir(), "pitchary-service-pitches-"),
  );
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const databasePath = path.join(folder, "crm.sqlite");
  let app = await buildApp({ databasePath });
  t.after(() => app.close());
  const customer = app.crm.createEntity("customers", { name: "Historical" });
  const service = app.crm.createEntity("services", {
    name: "Archived service",
  });
  const pitched = app.crm.createRelationship({
    customer_id: customer.id,
    service_id: service.id,
    current_offered_price_minor: 10000,
  });
  app.crm.createRelationship({
    customer_id: customer.id,
    service_id: service.id,
    current_offered_price_minor: 20000,
  });
  app.crm.changeStatus(pitched.id, { status: "pitched" });
  app.crm.addActivity(pitched.id, { type: "pitch", note: "Historical pitch" });
  await mutate(app, "DELETE", "/customer-services/" + pitched.id);
  await mutate(app, "DELETE", "/customers/" + customer.id);
  await assertCount(app, service.id, 2);
  const saved = await mutate(app, "PATCH", "/services/" + service.id, {
    note: "Keep historical pitches",
  });
  assert.equal(saved.pitched_count, 2);
  const archived = await mutate(app, "DELETE", "/services/" + service.id);
  assert.equal(archived.pitched_count, 2);
  await assertCount(app, service.id, 2, true);
  await app.close();
  app = await buildApp({ databasePath });
  await assertCount(app, service.id, 2, true);
  await mutate(app, "POST", "/services/" + service.id + "/restore");
  await assertCount(app, service.id, 2);
  await mutate(
    app,
    "DELETE",
    "/customer-services/" + pitched.id + "/permanent",
  );
  await assertCount(app, service.id, 0);
});
