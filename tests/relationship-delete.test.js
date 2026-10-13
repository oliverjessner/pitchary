import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, projectRoot } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
import { createAnalytics } from "../src/business/analytics.js";
import { buildApp } from "../src/server/app.js";
import { seedLegacyDemo } from "./fixtures/legacy-database.js";

function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const crm = createCRM(db, { clock: () => "2026-10-12T10:00:00.000Z" });
  const customer = crm.createEntity("customers", { name: "Kunde" });
  const service = crm.createEntity("services", { name: "Leistung" });
  const employee = crm.createEntity("employees", {
    customer_id: customer.id,
    name: "Kontakt",
  });
  const create = () =>
    crm.createRelationship({
      customer_id: customer.id,
      service_id: service.id,
      primary_employee_id: employee.id,
      current_offered_price_minor: 10000,
    });
  return { db, crm, customer, service, employee, create };
}

test("permanent relationship deletion removes only its own history and activities, including archives", (t) => {
  for (const archived of [false, true]) {
    const { db, crm, create, customer, service, employee } = fixture(t);
    const target = create(),
      other = create();
    crm.changeStatus(target.id, { status: "pitched" });
    crm.changePrice(target.id, {
      field: "current_offered_price_minor",
      price_minor: 9000,
    });
    crm.addActivity(target.id, {
      type: "follow_up",
      note: "Nachgefragt",
      employee_id: employee.id,
    });
    crm.changeStatus(target.id, { status: "accepted" });
    crm.changeStatus(target.id, { status: "done" });
    crm.addActivity(other.id, { type: "note", note: "Behalten" });
    if (archived) crm.archive("customer_services", target.id);
    const keep = crm.relationship(other.id);
    assert.deepEqual(crm.deleteRelationship(target.id), {
      id: target.id,
      deleted: true,
    });
    assert.throws(
      () => crm.relationship(target.id),
      (error) => error.status === 404,
    );
    assert.deepEqual(crm.repo.history(target.id), []);
    assert.deepEqual(crm.repo.activities(target.id), []);
    assert.deepEqual(crm.relationship(other.id), keep);
    assert.equal(crm.entity("customers", customer.id).relationships.length, 1);
    assert.equal(crm.entity("services", service.id).relationships.length, 1);
    assert.equal(crm.entity("employees", employee.id).name, "Kontakt");
    const analytics = createAnalytics(crm.repo)({});
    assert.equal(analytics.summary.created, 1);
    assert.equal(analytics.summary.won, 0);
    assert.equal(analytics.values[0].offered_price_minor, 10000);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
  }
});

test("relationship deletion rolls back parent, activities and history together when cleanup fails", (t) => {
  const { db, crm, create } = fixture(t);
  const row = create();
  crm.changeStatus(row.id, { status: "pitched" });
  crm.addActivity(row.id, { type: "note", note: "Keep after failure" });
  const before = crm.relationship(row.id);
  db.exec(
    "CREATE TRIGGER fail_delete_history BEFORE DELETE ON customer_service_status_history BEGIN SELECT RAISE(ABORT,'forced cleanup failure'); END",
  );
  assert.throws(() => crm.deleteRelationship(row.id), /forced cleanup failure/);
  assert.deepEqual(crm.relationship(row.id), before);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.exec("DROP TRIGGER fail_delete_history");
  crm.deleteRelationship(row.id);
  assert.equal(crm.relationships().length, 0);
});

test("unknown relationship deletion does not change existing records", (t) => {
  const { crm, create } = fixture(t);
  const row = create();
  const before = crm.relationship(row.id);
  assert.throws(
    () => crm.deleteRelationship(randomUUID()),
    (error) => error.status === 404,
  );
  assert.throws(
    () => crm.deleteRelationship("invalid"),
    (error) => error.status === 422,
  );
  assert.deepEqual(crm.relationship(row.id), before);
});

test("permanent-delete API is distinct from archiving and deletion persists after reopening", async (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-delete-api-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "db.sqlite");
  let app = await buildApp({ databasePath: filename });
  const customer = app.crm.createEntity("customers", { name: "API Kunde" });
  const service = app.crm.createEntity("services", { name: "API Service" });
  const create = () =>
    app.crm.createRelationship({
      customer_id: customer.id,
      service_id: service.id,
      current_offered_price_minor: 100,
    });
  const target = create(),
    other = create();
  app.crm.addActivity(target.id, { type: "note", note: "Delete with offer" });
  const url = `/api/customer-services/${target.id}/permanent`;
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url,
        headers: { "sec-fetch-site": "cross-site" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: "/api/customer-services/invalid/permanent",
      })
    ).statusCode,
    400,
  );
  const deleted = await app.inject({ method: "DELETE", url });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.json(), { id: target.id, deleted: true });
  assert.equal((await app.inject({ method: "DELETE", url })).statusCode, 404);
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/customer-services/${other.id}`,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await app.inject(`/api/customer-services/${other.id}`)).json().history
      .length,
    1,
  );
  await app.close();
  app = await buildApp({ databasePath: filename });
  t.after(() => app.close());
  assert.equal(
    (await app.inject(`/api/customer-services/${target.id}`)).statusCode,
    404,
  );
  assert.equal((await app.inject("/api/activities")).json().length, 0);
  assert.equal(
    (await app.inject("/api/customer-services?archived=true")).json()[0].id,
    other.id,
  );
  assert.equal(
    (await app.inject(`/api/customers/${customer.id}`)).statusCode,
    200,
  );
  assert.equal(
    (await app.inject(`/api/services/${service.id}`)).statusCode,
    200,
  );
});

test("migration 005 preserves a populated schema 4 database and keeps individual events immutable", (t) => {
  const folder = mkdtempSync(
    path.join(os.tmpdir(), "pitchary-delete-migration-"),
  );
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "schema4.sqlite");
  let db = new DatabaseSync(filename);
  for (const name of [
    "001_initial.sql",
    "002_relationship_archive.sql",
    "003_customer_branding.sql",
    "004_ghosted_status.sql",
  ])
    db.exec(
      readFileSync(
        path.join(projectRoot, "src/database/migrations", name),
        "utf8",
      ),
    );
  db.exec("PRAGMA foreign_keys=ON; PRAGMA user_version=4");
  seedLegacyDemo(db);
  const tables = [
    "customers",
    "employees",
    "services",
    "customer_services",
    "customer_service_status_history",
    "activities",
  ];
  const before = tables.map((table) =>
    db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all(),
  );
  db.close();
  db = openDatabase(filename);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 7);
    tables.forEach((table, index) =>
      assert.deepEqual(
        db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all(),
        before[index],
      ),
    );
    for (const table of ["customer_service_status_history", "activities"]) {
      assert.throws(() => db.exec(`UPDATE ${table} SET id=id`), /immutable/);
      assert.throws(() => db.exec(`DELETE FROM ${table}`), /immutable/);
    }
    const target = db
      .prepare("SELECT id FROM customer_services WHERE status='done'")
      .get();
    db.prepare("DELETE FROM customer_services WHERE id=?").run(target.id);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM customer_service_status_history WHERE customer_service_id=?",
        )
        .get(target.id).n,
      0,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM activities WHERE customer_service_id=?",
        )
        .get(target.id).n,
      0,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});
