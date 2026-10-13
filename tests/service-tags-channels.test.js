import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, projectRoot } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
import { createAnalytics } from "../src/business/analytics.js";
import { buildApp } from "../src/server/app.js";
import {
  pitchChannels,
  validatePitchChannels,
} from "../src/config/pitch-channels.js";
import { seedLegacyDemo } from "./fixtures/legacy-database.js";

function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const crm = createCRM(db, { clock: () => "2026-10-13T07:00:00.000Z" });
  return { db, crm };
}

test("service tags validate names, notes and colors and enforce normalized unique names", (t) => {
  const { db, crm } = fixture(t);
  const tag = crm.createTag({
    name: "  Äudit  ",
    note: "Notiz",
    color: "#FF6B35",
  });
  assert.equal(tag.name, "Äudit");
  assert.equal(tag.color, "#ff6b35");
  assert.equal(tag.note, "Notiz");
  assert.throws(() => crm.createTag({ name: "äudit" }), /existiert bereits/);
  assert.throws(
    () => crm.createTag({ name: "A\u0308udit" }),
    /existiert bereits/,
  );
  for (const data of [
    { name: "" },
    { name: "x".repeat(81) },
    { name: "Tag", color: "red" },
    { name: "Tag", color: "#123456;display:none" },
    { name: "Tag", note: "x".repeat(2001) },
    { name: "Tag", archived_at: "now" },
  ])
    assert.throws(
      () => crm.createTag(data),
      (error) => error.status === 422,
    );
  assert.equal(crm.listTags().length, 1);
  assert.throws(
    () =>
      db
        .prepare("UPDATE service_tags SET color=? WHERE id=?")
        .run("#gggggg", tag.id),
    /CHECK/,
  );
});

test("tags can be shared, edited and cleared without affecting offers or other services", (t) => {
  const { crm } = fixture(t);
  const tag = crm.createTag({
    name: "Technik",
    note: "Details",
    color: "#4d8dff",
  });
  const second = crm.createTag({ name: "Wiederkehrend", color: "#ffffff" });
  const a = crm.createEntity("services", {
    name: "A",
    tag_ids: [tag.id, tag.id, second.id],
  });
  const b = crm.createEntity("services", { name: "B", tag_ids: [tag.id] });
  assert.equal(a.tags.length, 2);
  assert.equal(
    crm.listTags().find((row) => row.id === tag.id).service_count,
    2,
  );
  crm.updateEntity("services", a.id, { note: "Neue Beschreibung" });
  assert.equal(crm.entity("services", a.id).tags.length, 2);
  crm.updateTag(tag.id, {
    name: "Engineering",
    note: "Neue Notiz",
    color: "#000000",
  });
  assert.equal(
    crm.entity("services", a.id).tags.find((row) => row.id === tag.id).name,
    "Engineering",
  );
  assert.equal(crm.entity("services", b.id).tags[0].color, "#000000");
  crm.archive("services", b.id);
  assert.equal(
    crm.listEntities("services", { search: "Engineering" })[0].id,
    a.id,
  );
  assert.equal(
    crm.listEntities("services", { archived: true })[0].tags[0].note,
    "Neue Notiz",
  );
  crm.updateEntity("services", a.id, { tag_ids: [] });
  assert.deepEqual(crm.entity("services", a.id).tags, []);
  assert.equal(crm.entity("services", b.id).tags.length, 1);
  crm.deleteTag(tag.id);
  assert.deepEqual(crm.entity("services", b.id).tags, []);
  assert.equal(crm.entity("services", a.id).note, "Neue Beschreibung");
});

test("invalid or failed tag assignments roll back the complete service change", (t) => {
  const { db, crm } = fixture(t);
  const tag = crm.createTag({ name: "Valid" });
  const service = crm.createEntity("services", {
    name: "Original",
    tag_ids: [tag.id],
  });
  for (const tag_ids of ["wrong", [randomUUID()], Array(101).fill(tag.id)]) {
    assert.throws(
      () => crm.updateEntity("services", service.id, { name: "No", tag_ids }),
      (error) => error.status === 422,
    );
    assert.equal(crm.entity("services", service.id).name, "Original");
    assert.equal(crm.entity("services", service.id).tags[0].id, tag.id);
  }
  db.exec(
    "CREATE TRIGGER fail_assign BEFORE INSERT ON service_tag_assignments BEGIN SELECT RAISE(ABORT,'forced assignment failure'); END",
  );
  assert.throws(
    () =>
      crm.updateEntity("services", service.id, {
        name: "No",
        tag_ids: [tag.id],
      }),
    /forced assignment/,
  );
  assert.throws(
    () => crm.createEntity("services", { name: "No", tag_ids: [tag.id] }),
    /forced assignment/,
  );
  assert.equal(crm.listEntities("services").length, 1);
  assert.equal(crm.entity("services", service.id).name, "Original");
  assert.equal(crm.entity("services", service.id).tags[0].id, tag.id);
});

test("tag REST endpoints persist assignments and report errors without changing unrelated records", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  const created = await app.inject({
    method: "POST",
    url: "/api/service-tags",
    payload: { name: "CRM", note: "Kontext", color: "#12abcd" },
  });
  assert.equal(created.statusCode, 201);
  const tag = created.json();
  const service = app.crm.createEntity("services", {
    name: "Beratung",
    tag_ids: [tag.id],
  });
  assert.equal(
    (await app.inject("/api/service-tags")).json()[0].service_count,
    1,
  );
  assert.equal(
    (await app.inject(`/api/services/${service.id}`)).json().tags[0].name,
    "CRM",
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/service-tags/" + tag.id,
        payload: { color: "#123456" },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/service-tags",
        payload: { name: "crm" },
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (await app.inject({ method: "DELETE", url: "/api/service-tags/" + tag.id }))
      .statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: "DELETE", url: "/api/service-tags/" + tag.id }))
      .statusCode,
    404,
  );
  assert.equal(
    (await app.inject(`/api/services/${service.id}`)).json().tags.length,
    0,
  );
});

test("offer projections include current service tags without duplicates, including archived services and offers", async (t) => {
  const { db, crm } = fixture(t);
  const app = await buildApp({ db });
  t.after(() => app.close());
  const first = crm.createTag({ name: "Web", color: "#4d8dff" });
  const second = crm.createTag({ name: "Support", note: "Monatlich" });
  const customer = crm.createEntity("customers", { name: "Tagfilter Kunde" });
  const service = crm.createEntity("services", {
    name: "Mehrere Tags",
    tag_ids: [first.id, second.id],
  });
  const untagged = crm.createEntity("services", { name: "Ohne Tags" });
  const create = (service_id) =>
    crm.createRelationship({
      customer_id: customer.id,
      service_id,
      current_offered_price_minor: 10000,
    });
  const offer = create(service.id);
  const other = create(untagged.id);
  const before = crm.relationship(offer.id);
  const check = async (expectedIds, archived = false) => {
    const list = (
      await app.inject(`/api/customer-services?archived=${archived}`)
    ).json();
    assert.equal(list.filter((row) => row.id === offer.id).length, 1);
    const detail = (
      await app.inject(`/api/customer-services/${offer.id}`)
    ).json();
    const customerDetail = (
      await app.inject(`/api/customers/${customer.id}`)
    ).json();
    const serviceDetail = (
      await app.inject(`/api/services/${service.id}`)
    ).json();
    for (const row of [
      list.find((row) => row.id === offer.id),
      detail,
      customerDetail.relationships.find((row) => row.id === offer.id),
      serviceDetail.relationships[0],
    ])
      assert.deepEqual(
        row.service_tags.map((tag) => tag.id).sort(),
        [...expectedIds].sort(),
      );
    assert.deepEqual(
      detail.history,
      before.history.map((row) => ({ ...row })),
    );
  };
  await check([first.id, second.id]);
  assert.deepEqual(crm.relationship(other.id).service_tags, []);
  assert.equal(crm.relationships().length, 2);
  crm.updateTag(first.id, { name: "Website", color: "#123456" });
  assert.equal(
    crm
      .relationships()
      .find((row) => row.id === offer.id)
      .service_tags.find((tag) => tag.id === first.id).name,
    "Website",
  );
  assert.equal(crm.relationship(offer.id).updated_at, before.updated_at);
  crm.updateEntity("services", service.id, { tag_ids: [second.id] });
  await check([second.id]);
  crm.archive("services", service.id);
  await check([second.id]);
  crm.archive("customer_services", offer.id);
  await check([second.id], true);
  crm.deleteTag(second.id);
  await check([], true);
  assert.deepEqual(crm.relationship(other.id).service_tags, []);
});

test("tag metadata and assignments survive database reopening", (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-tags-persist-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "db.sqlite");
  let db = openDatabase(filename);
  let crm = createCRM(db);
  const tag = crm.createTag({
    name: "Wartung",
    note: "Monatlich",
    color: "#bada55",
  });
  const service = crm.createEntity("services", {
    name: "Support",
    tag_ids: [tag.id],
  });
  db.close();
  db = openDatabase(filename);
  t.after(() => db.close());
  crm = createCRM(db);
  const saved = crm.entity("services", service.id).tags[0];
  assert.equal(saved.id, tag.id);
  assert.equal(saved.note, "Monatlich");
  assert.equal(saved.color, "#bada55");
  assert.equal(crm.listTags()[0].service_count, 1);
});

test("JSON channel additions work without schema changes across offers, activities, API and analytics", async (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-channels-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "db.sqlite"),
    config = path.join(folder, "channels.json");
  let db = openDatabase(filename);
  db.close();
  writeFileSync(
    config,
    JSON.stringify([...pitchChannels, { id: "referral", label: "Empfehlung" }]),
  );
  db = openDatabase(filename, { channelConfigPath: config });
  const crm = createCRM(db);
  const customer = crm.createEntity("customers", { name: "Kunde" });
  const service = crm.createEntity("services", { name: "Leistung" });
  const row = crm.createRelationship({
    customer_id: customer.id,
    service_id: service.id,
    current_offered_price_minor: 100,
    pitch_channel: "referral",
  });
  crm.changeStatus(row.id, { status: "pitched" });
  crm.addActivity(row.id, {
    type: "follow_up",
    channel: "referral",
    note: "Referral",
  });
  assert.equal(crm.activities({ pitch_channel: "referral" }).length, 1);
  assert.equal(
    createAnalytics(crm.repo)({ pitch_channel: "referral" }).summary.pitched,
    1,
  );
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 7);
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE customer_services SET pitch_channel='unknown' WHERE id=?",
        )
        .run(row.id),
    /FOREIGN KEY/,
  );
  const app = await buildApp({ db });
  assert.equal(
    (await app.inject("/api/pitch-channels")).json().at(-1).label,
    "Empfehlung",
  );
  assert.equal(
    (
      await app.inject("/api/customer-services?pitch_channel=referral")
    ).json()[0].id,
    row.id,
  );
  await app.close();
  db.close();
  db = openDatabase(filename);
  t.after(() => db.close());
  assert.equal(createCRM(db).relationship(row.id).pitch_channel, "referral");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("malformed channel definitions are rejected before opening a database", (t) => {
  for (const value of [
    [],
    {},
    [{ id: "x", label: "" }],
    [{ id: "X", label: "Bad" }],
    [
      { id: "x", label: "X" },
      { id: "x", label: "Again" },
    ],
  ])
    assert.throws(() => validatePitchChannels(value), /Pitch-Kanäle/);
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-bad-config-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const config = path.join(folder, "bad.json");
  writeFileSync(config, "{}");
  assert.throws(
    () => openDatabase(":memory:", { channelConfigPath: config }),
    /Pitch-Kanäle/,
  );
});

test("migrations 006 and 007 preserve every schema 5 business row and database guard", (t) => {
  const folder = mkdtempSync(
    path.join(os.tmpdir(), "pitchary-channel-migration-"),
  );
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "schema5.sqlite");
  let db = new DatabaseSync(filename);
  const migrationFolder = path.join(projectRoot, "src/database/migrations");
  for (const name of readdirSync(migrationFolder)
    .filter((name) => /^00[1-5]_/.test(name))
    .sort())
    db.exec(readFileSync(path.join(migrationFolder, name), "utf8"));
  db.exec("PRAGMA foreign_keys=ON; PRAGMA user_version=5");
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
    tables.forEach((table, index) =>
      assert.deepEqual(
        db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all(),
        before[index],
      ),
    );
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    for (const table of ["activities", "customer_service_status_history"]) {
      assert.throws(() => db.exec(`UPDATE ${table} SET id=id`), /immutable/);
      assert.throws(() => db.exec(`DELETE FROM ${table}`), /immutable/);
    }
    const crm = createCRM(db),
      old = crm.relationships()[0];
    const row = crm.createRelationship({
      customer_id: old.customer_id,
      service_id: old.service_id,
      current_offered_price_minor: 100,
      pitch_channel: "internal_software",
    });
    crm.changeStatus(row.id, { status: "pitched" });
    crm.addActivity(row.id, {
      type: "follow_up",
      channel: "internal_software",
      note: "Software",
    });
    assert.equal(
      crm.relationship(row.id).activities[0].channel,
      "internal_software",
    );
    crm.deleteRelationship(row.id);
    assert.equal(crm.repo.history(row.id).length, 0);
    assert.equal(crm.repo.activities(row.id).length, 0);
  } finally {
    db.close();
  }
});
