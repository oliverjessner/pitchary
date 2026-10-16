import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
import { buildApp } from "../src/server/app.js";

function testClock() {
  let time = "2026-09-01T10:00:00.000Z";
  const clock = () => time;
  clock.advance = () => {
    time = "2026-10-16T10:00:00.000Z";
  };
  return clock;
}

function seed(crm, clock) {
  const customer = crm.createEntity("customers", { name: "Unternehmen" });
  const service = crm.createEntity("services", { name: "Beratung" });
  const employee = crm.createEntity("employees", {
    customer_id: customer.id,
    name: "Anna",
    email: "anna@example.test",
    position: "Geschäftsführung",
  });
  const colleague = crm.createEntity("employees", {
    customer_id: customer.id,
    name: "Anna",
  });
  const create = (primary_employee_id) =>
    crm.createRelationship({
      customer_id: customer.id,
      service_id: service.id,
      primary_employee_id,
      current_offered_price_minor: 12000,
    });
  const assigned = create(employee.id);
  const contacted = create(colleague.id);
  const unrelated = create(colleague.id);
  clock.advance();
  const add = (id, employee_id, note, occurred_at) =>
    crm.addActivity(id, { type: "meeting", employee_id, note, occurred_at });
  const latest = add(
    assigned.id,
    employee.id,
    "Strategie besprochen",
    "2026-10-15T09:00:00.000Z",
  );
  const earlier = add(
    contacted.id,
    employee.id,
    "Erstes Treffen",
    "2026-10-01T09:00:00.000Z",
  );
  add(
    contacted.id,
    employee.id,
    "Weitere Rückfrage",
    "2026-10-02T09:00:00.000Z",
  );
  add(
    assigned.id,
    colleague.id,
    "Nur mit Kollegin",
    "2026-10-14T09:00:00.000Z",
  );
  add(assigned.id, null, "Allgemeine Notiz", "2026-10-14T09:00:00.000Z");
  add(
    unrelated.id,
    colleague.id,
    "Anderes Angebot",
    "2026-10-14T09:00:00.000Z",
  );
  crm.changePrice(assigned.id, {
    field: "current_offered_price_minor",
    price_minor: 11000,
  });
  const otherCustomer = crm.createEntity("customers", {
    name: "Anderes Unternehmen",
  });
  const otherEmployee = crm.createEntity("employees", {
    customer_id: otherCustomer.id,
    name: employee.name,
  });
  crm.createRelationship({
    customer_id: otherCustomer.id,
    service_id: service.id,
    primary_employee_id: otherEmployee.id,
    current_offered_price_minor: 100,
  });
  return {
    customer,
    service,
    employee,
    colleague,
    assigned,
    contacted,
    unrelated,
    latest,
    earlier,
  };
}

test("employee detail combines assigned and personally contacted offers without duplicate or unrelated events", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const clock = testClock();
  const crm = createCRM(db, { clock });
  const f = seed(crm, clock);
  const tag = crm.createTag({ name: "Strategie" });
  crm.updateEntity("services", f.service.id, { tag_ids: [tag.id] });
  const result = crm.entity("employees", f.employee.id);
  assert.equal(result.customer.id, f.customer.id);
  assert.equal(result.email, f.employee.email);
  assert.deepEqual(
    new Set(result.relationships.map((r) => r.id)),
    new Set([f.assigned.id, f.contacted.id]),
  );
  assert.equal(result.relationships.length, 2);
  assert.ok(result.relationships.every((r) => r.service_tags[0].id === tag.id));
  assert.equal(result.activities.length, 3);
  assert.ok(result.activities.every((a) => a.employee_id === f.employee.id));
  assert.equal(result.activities[0].id, f.latest.id);
  assert.equal(result.activities.at(-1).id, f.earlier.id);
  assert.equal(result.activities[0].service_name, f.service.name);
  assert.equal(result.activities[0].currency, "EUR");
  assert.equal(result.activities[0].relationship_archived_at, null);

  crm.updateRelationship(f.assigned.id, {
    primary_employee_id: f.colleague.id,
  });
  assert.equal(crm.entity("employees", f.employee.id).relationships.length, 2);
  assert.equal(
    crm.entity("employees", f.employee.id).activities[0].id,
    f.latest.id,
  );
  const noEvents = crm.createRelationship({
    customer_id: f.customer.id,
    service_id: f.service.id,
    primary_employee_id: f.employee.id,
    current_offered_price_minor: 100,
  });
  assert.equal(crm.entity("employees", f.employee.id).relationships.length, 3);
  crm.updateRelationship(noEvents.id, { primary_employee_id: f.colleague.id });
  assert.equal(crm.entity("employees", f.employee.id).relationships.length, 2);
  crm.deleteRelationship(f.contacted.id);
  assert.equal(crm.entity("employees", f.employee.id).relationships.length, 1);
  assert.equal(crm.entity("employees", f.employee.id).activities.length, 1);
});

test("employees without offers have empty detail collections and validate missing IDs", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const clock = testClock();
  const crm = createCRM(db, { clock });
  const customer = crm.createEntity("customers", { name: "Neuer Kunde" });
  const employee = crm.createEntity("employees", {
    name: "Neuer Kontakt",
    customer_id: customer.id,
  });
  const row = crm.entity("employees", employee.id);
  assert.deepEqual(row.relationships, []);
  assert.deepEqual(row.activities, []);
  assert.throws(
    () => crm.entity("employees", randomUUID()),
    (error) => error.status === 404,
  );
  assert.throws(
    () => crm.entity("employees", "invalid"),
    (error) => error.status === 422,
  );
  assert.equal("relationships" in crm.listEntities("employees")[0], false);
});

test("employee API keeps archived histories readable after reopening and supports edit and restore", async (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-employee-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const databasePath = path.join(folder, "db.sqlite");
  const clock = testClock();
  let app = await buildApp({ databasePath, clock });
  t.after(() => app.close());
  const f = seed(app.crm, clock);
  const url = "/api/employees/" + f.employee.id;
  for (const [table, id] of [
    ["customer_services", f.contacted.id],
    ["services", f.service.id],
    ["customers", f.customer.id],
    ["employees", f.employee.id],
  ])
    app.crm.archive(table, id);
  let response = await app.inject(url);
  assert.equal(response.statusCode, 200);
  const before = response.json();
  assert.ok(before.archived_at);
  assert.ok(before.customer.archived_at);
  assert.equal(before.relationships.length, 2);
  assert.ok(before.relationships.every((r) => r.service_archived_at));
  assert.ok(
    before.activities.find((a) => a.id === f.earlier.id)
      .relationship_archived_at,
  );
  assert.equal(
    (await app.inject({ method: "PATCH", url, payload: { name: "Änderung" } }))
      .statusCode,
    409,
  );
  await app.close();
  app = await buildApp({ databasePath, clock });
  response = await app.inject(url);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), before);
  assert.equal(
    (await app.inject("/api/employees/" + randomUUID())).statusCode,
    404,
  );
  assert.equal((await app.inject("/api/employees/invalid")).statusCode, 400);
  assert.equal(
    (await app.inject({ method: "POST", url: url + "/restore", payload: {} }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url,
        payload: { position: "Leitung" },
      })
    ).statusCode,
    200,
  );
  const restored = (await app.inject(url)).json();
  assert.equal(restored.archived_at, null);
  assert.equal(restored.position, "Leitung");
  assert.equal(restored.activities.length, 3);
});
