import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/server/app.js";
import { openDatabase } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";

const recordedAt = "2026-11-08T23:30:00.000Z";

async function fixture(t) {
  const app = await buildApp({
    databasePath: ":memory:",
    clock: () => recordedAt,
  });
  t.after(() => app.close());
  const customer = app.crm.createEntity("customers", { name: "Offer dates" });
  const second = app.crm.createEntity("customers", { name: "Second customer" });
  const service = app.crm.createEntity("services", {
    name: "Historical offer",
  });
  const payload = {
    customer_id: customer.id,
    service_id: service.id,
    current_offered_price_minor: 15000,
  };
  return { app, customer, second, service, payload };
}

async function create(app, payload, batch = false) {
  const response = await app.inject({
    method: "POST",
    url: "/api/customer-services" + (batch ? "/batch" : ""),
    payload,
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}

test("new and batch offers default to today's Vienna business date and accept past or future dates", async (t) => {
  const { app, payload, customer, second, service } = await fixture(t);
  const today = await create(app, payload);
  assert.equal(today.offer_date, "2026-11-09");
  assert.equal(today.created_at, recordedAt);
  assert.equal(today.status_since, recordedAt);
  assert.equal(today.history[0].occurred_at, recordedAt);
  for (const offer_date of ["1990-01-01", "2024-02-29", "2030-12-31"]) {
    const row = await create(app, { ...payload, offer_date });
    assert.equal(row.offer_date, offer_date);
    assert.equal(row.created_at, recordedAt);
  }
  const batchPayload = {
    customer_ids: [customer.id, second.id],
    service_id: service.id,
    current_offered_price_minor: 17000,
  };
  const defaults = await create(app, batchPayload, true);
  assert.deepEqual(
    defaults.map((row) => row.offer_date),
    ["2026-11-09", "2026-11-09"],
  );
  const historical = await create(
    app,
    { ...batchPayload, offer_date: "2020-02-29" },
    true,
  );
  assert.deepEqual(
    historical.map((row) => row.offer_date),
    ["2020-02-29", "2020-02-29"],
  );
  assert.notEqual(historical[0].id, historical[1].id);
  assert.ok(
    historical.every(
      (row) =>
        row.created_at === recordedAt &&
        row.history[0].occurred_at === recordedAt,
    ),
  );
});

test("invalid calendar dates leave single/batch creation and combined edits atomic", async (t) => {
  const { app, payload, customer, second, service } = await fixture(t);
  const existing = await create(app, payload);
  const before = app.crm.relationship(existing.id);
  const counts = app.crm.repo.counts();
  const historyCount = app.database
    .prepare("SELECT count(*) AS n FROM customer_service_status_history")
    .get().n;
  for (const offer_date of [
    "",
    null,
    20261109,
    "2025-02-29",
    "2024-04-31",
    "2026-13-01",
    "2026-00-01",
    "0000-01-01",
    "2026-11-09T00:00:00Z",
    " 2026-11-09 ",
  ]) {
    for (const [method, url, data] of [
      ["POST", "/api/customer-services", { ...payload, offer_date }],
      [
        "POST",
        "/api/customer-services/batch",
        {
          customer_ids: [customer.id, second.id],
          service_id: service.id,
          current_offered_price_minor: 18000,
          offer_date,
        },
      ],
      [
        "PATCH",
        "/api/customer-services/" + existing.id,
        { pitch_channel: "phone", offer_date },
      ],
    ]) {
      const response = await app.inject({ method, url, payload: data });
      assert.equal(response.statusCode, 422, response.body);
      assert.ok(response.json().error.fields.offer_date);
      assert.deepEqual(app.crm.repo.counts(), counts);
      assert.deepEqual(app.crm.relationship(existing.id), before);
      assert.equal(
        app.database
          .prepare("SELECT count(*) AS n FROM customer_service_status_history")
          .get().n,
        historyCount,
      );
    }
  }
});

test("editing dates after a pitch preserves the audit trail and omitted dates, including after reopening", async (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-offer-date-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "crm.sqlite");
  let db = openDatabase(filename);
  let time = recordedAt;
  let crm = createCRM(db, { clock: () => time });
  const customer = crm.createEntity("customers", { name: "Persistent dates" });
  const service = crm.createEntity("services", { name: "Service" });
  const row = crm.createRelationship({
    customer_id: customer.id,
    service_id: service.id,
    current_offered_price_minor: 10000,
    offer_date: "2024-02-29",
  });
  crm.changeStatus(row.id, { status: "pitched" });
  crm.addActivity(row.id, { type: "note", note: "Keep original time" });
  const before = crm.relationship(row.id);
  time = "2026-11-09T10:00:00.000Z";
  const changed = crm.updateRelationship(row.id, { offer_date: "2020-01-01" });
  assert.equal(changed.offer_date, "2020-01-01");
  assert.equal(changed.created_at, before.created_at);
  assert.equal(changed.status_since, before.status_since);
  assert.equal(changed.updated_at, time);
  assert.deepEqual(changed.history, before.history);
  assert.deepEqual(changed.activities, before.activities);
  assert.equal(
    crm.updateRelationship(row.id, { pitch_channel: "phone" }).offer_date,
    "2020-01-01",
  );
  crm.archive("customer_services", row.id);
  assert.throws(
    () => crm.updateRelationship(row.id, { offer_date: "2010-01-01" }),
    /Archivierte/,
  );
  db.close();
  db = openDatabase(filename);
  t.after(() => db.close());
  crm = createCRM(db);
  const saved = crm.relationship(row.id);
  assert.equal(saved.offer_date, "2020-01-01");
  assert.equal(saved.created_at, before.created_at);
  assert.equal(saved.status_since, before.status_since);
  assert.deepEqual(saved.history, before.history);
  assert.deepEqual(
    saved.activities,
    before.activities.map((activity) =>
      Object.assign(Object.create(null), activity, {
        relationship_archived_at: saved.archived_at,
      }),
    ),
  );
  assert.ok(saved.archived_at);
});

test("migration 013 backfills all existing offer dates without changing archived records or immutable history", (t) => {
  const folder = mkdtempSync(
    path.join(os.tmpdir(), "pitchary-offer-date-migration-"),
  );
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "schema12.sqlite");
  let db = openDatabase(filename);
  const crm = createCRM(db, { clock: () => recordedAt });
  const customer = crm.createEntity("customers", {
    name: "Historical customer",
  });
  const service = crm.createEntity("services", { name: "Historical service" });
  const payload = {
    customer_id: customer.id,
    service_id: service.id,
    current_offered_price_minor: 10000,
  };
  const active = crm.createRelationship(payload);
  const archived = crm.createRelationship(payload);
  crm.changeStatus(archived.id, { status: "pitched" });
  crm.addActivity(archived.id, { type: "note", note: "Keep me" });
  crm.archive("customer_services", archived.id);
  db.exec(
    "ALTER TABLE customer_services DROP COLUMN offer_date; DROP TABLE app_settings; PRAGMA user_version=12;",
  );
  const tables = [
    "customers",
    "services",
    "customer_services",
    "customer_service_status_history",
    "activities",
  ];
  const before = new Map(
    tables.map((table) => [
      table,
      db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
  db.close();
  db = openDatabase(filename);
  t.after(() => db.close());
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 14);
  for (const [table, rows] of before) {
    const actual = db
      .prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`)
      .all();
    assert.deepEqual(
      actual,
      table === "customer_services"
        ? rows.map((row) =>
            Object.assign(Object.create(null), row, {
              offer_date: row.created_at.slice(0, 10),
            }),
          )
        : rows,
    );
  }
  assert.equal(createCRM(db).relationship(active.id).offer_date, "2026-11-08");
  assert.ok(createCRM(db).relationship(archived.id).archived_at);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.throws(
    () =>
      db.exec("UPDATE customer_service_status_history SET reason='changed'"),
    /immutable/,
  );
  assert.throws(
    () => db.exec("UPDATE activities SET note='changed'"),
    /immutable/,
  );
});
