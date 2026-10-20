import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
import { createCustomerMerge } from "../src/business/customer-merge.js";
import { buildApp } from "../src/server/app.js";

function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  return { db, crm: createCRM(db) };
}
const ids = (tags) => tags.map((tag) => tag.id).sort();

test("customer tags share the catalog while company and service assignments remain independent", (t) => {
  const { crm } = fixture(t);
  const tag = crm.createTag({
    name: "Strategisch",
    note: "Langfristig",
    color: "#aabbcc",
  });
  const second = crm.createTag({ name: "Partner" });
  const customer = crm.createEntity("customers", {
    name: "Unternehmen",
    tag_ids: [tag.id, tag.id, second.id],
  });
  const employee = crm.createEntity("employees", {
    name: "Kontakt",
    customer_id: customer.id,
  });
  const service = crm.createEntity("services", {
    name: "Dienstleistung",
    tag_ids: [tag.id],
  });
  assert.deepEqual(ids(customer.tags), [tag.id, second.id].sort());
  assert.equal(
    crm.listTags().find((row) => row.id === tag.id).customer_count,
    1,
  );
  assert.equal(
    crm.listTags().find((row) => row.id === tag.id).service_count,
    1,
  );
  assert.deepEqual(
    ids(crm.entity("employees", employee.id).customer_tags),
    ids(customer.tags),
  );
  assert.deepEqual(
    ids(crm.entity("employees", employee.id).customer.tags),
    ids(customer.tags),
  );
  crm.updateEntity("customers", customer.id, { name: "Neuer Name" });
  assert.deepEqual(
    ids(crm.entity("customers", customer.id).tags),
    ids(customer.tags),
  );
  crm.updateTag(tag.id, { name: "Premium", color: "#123456" });
  assert.equal(
    crm
      .listEntities("employees", { search: "Premium" })[0]
      .customer_tags.find((row) => row.id === tag.id).color,
    "#123456",
  );
  crm.updateEntity("customers", customer.id, { tag_ids: [] });
  assert.deepEqual(crm.entity("customers", customer.id).tags, []);
  assert.deepEqual(crm.listEntities("employees")[0].customer_tags, []);
  assert.deepEqual(ids(crm.entity("services", service.id).tags), [tag.id]);
});

test("company tag filters use OR, combine with search and archives, and include archived employers", (t) => {
  const { crm } = fixture(t);
  const a = crm.createTag({ name: "Gruppe A" });
  const b = crm.createTag({ name: "Gruppe B" });
  const customers = [
    crm.createEntity("customers", { name: "Alpha", tag_ids: [a.id] }),
    crm.createEntity("customers", { name: "Beta", tag_ids: [b.id] }),
    crm.createEntity("customers", { name: "Gamma", tag_ids: [a.id, b.id] }),
    crm.createEntity("customers", { name: "Ohne" }),
  ];
  const employees = customers.map((row) =>
    crm.createEntity("employees", {
      name: row.name + " Kontakt",
      customer_id: row.id,
    }),
  );
  assert.equal(
    crm.listEntities("customers", { tag_ids: `${a.id},${b.id}` }).length,
    3,
  );
  assert.equal(
    crm.listEntities("customers", { tag_ids: [a.id], search: "Gamma" })[0].id,
    customers[2].id,
  );
  assert.equal(
    crm.listEntities("customers", { tag_ids: b.id, search: "Alpha" }).length,
    0,
  );
  assert.equal(crm.listEntities("employees", { tag_ids: a.id }).length, 2);
  assert.equal(crm.listEntities("customers", { search: "Gruppe B" }).length, 2);
  assert.equal(
    crm.listEntities("employees", {
      search: "Gruppe B",
      customer_id: customers[1].id,
    }).length,
    1,
  );
  crm.archive("customers", customers[2].id);
  assert.equal(
    crm.listEntities("customers", { archived: true, tag_ids: a.id })[0].id,
    customers[2].id,
  );
  assert.equal(crm.listEntities("employees", { tag_ids: a.id }).length, 2);
  crm.archive("employees", employees[2].id);
  assert.equal(
    crm.listEntities("employees", { archived: true, tag_ids: b.id })[0].id,
    employees[2].id,
  );
  assert.equal(crm.listTags().find((row) => row.id === a.id).customer_count, 2);
  assert.equal(crm.archive("customers", customers[2].id, false).tags.length, 2);
});

test("invalid tags and failing assignments roll back company edits, branding profiles and creation", (t) => {
  const { crm, db } = fixture(t);
  const tag = crm.createTag({ name: "Wichtig" });
  const customer = crm.createEntity("customers", {
    name: "Original",
    general_email: "before@example.test",
    tag_ids: [tag.id],
  });
  for (const tag_ids of [
    null,
    "bad",
    ["bad"],
    [randomUUID()],
    Array(101).fill(tag.id),
  ])
    assert.throws(
      () =>
        crm.updateEntity("customers", customer.id, {
          name: "Changed",
          tag_ids,
        }),
      (error) => error.status === 422,
    );
  assert.equal(crm.entity("customers", customer.id).name, "Original");
  db.exec(
    "CREATE TRIGGER reject_company_tag BEFORE INSERT ON customer_tag_assignments BEGIN SELECT RAISE(ABORT,'assignment failed'); END",
  );
  assert.throws(
    () =>
      crm.updateEntity("customers", customer.id, {
        name: "Changed",
        general_email: "after@example.test",
        tag_ids: [tag.id],
      }),
    /assignment failed/,
  );
  assert.equal(crm.entity("customers", customer.id).name, "Original");
  assert.equal(
    crm.entity("customers", customer.id).general_email,
    "before@example.test",
  );
  assert.deepEqual(ids(crm.entity("customers", customer.id).tags), [tag.id]);
  assert.throws(
    () => crm.createEntity("customers", { name: "Failed", tag_ids: [tag.id] }),
    /assignment failed/,
  );
  assert.equal(crm.listEntities("customers").length, 1);
  const employee = crm.createEntity("employees", {
    name: "Kontakt",
    customer_id: customer.id,
  });
  assert.throws(
    () => crm.updateEntity("employees", employee.id, { tag_ids: [tag.id] }),
    (error) => error.status === 422,
  );
});

test("shared tag deletion clears both assignment types without changing companies, people or services", (t) => {
  const { crm, db } = fixture(t);
  const tag = crm.createTag({ name: "Gemeinsam" });
  const customer = crm.createEntity("customers", {
    name: "Unternehmen",
    tag_ids: [tag.id],
  });
  crm.createEntity("employees", { name: "Kontakt", customer_id: customer.id });
  const service = crm.createEntity("services", {
    name: "Service",
    tag_ids: [tag.id],
  });
  crm.deleteTag(tag.id);
  assert.deepEqual(crm.entity("customers", customer.id).tags, []);
  assert.deepEqual(crm.entity("services", service.id).tags, []);
  assert.deepEqual(crm.listEntities("employees")[0].customer_tags, []);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("customer merging preserves the union of tags and rolls back assignments on failure", (t) => {
  const { crm, db } = fixture(t);
  const a = crm.createTag({ name: "A" }),
    b = crm.createTag({ name: "B" });
  const source = crm.createEntity("customers", {
    name: "Source",
    tag_ids: [a.id, b.id],
  });
  const target = crm.createEntity("customers", {
    name: "Target",
    tag_ids: [a.id],
  });
  const employee = crm.createEntity("employees", {
    name: "Kontakt",
    customer_id: source.id,
  });
  const merge = createCustomerMerge(db);
  db.exec(
    "CREATE TRIGGER stop_company_delete BEFORE DELETE ON customers BEGIN SELECT RAISE(ABORT,'stop merge'); END",
  );
  assert.throws(() => merge.merge(source.id, target.id), /stop merge/);
  assert.deepEqual(ids(crm.entity("customers", target.id).tags), [a.id]);
  assert.deepEqual(
    ids(crm.entity("customers", source.id).tags),
    [a.id, b.id].sort(),
  );
  db.exec("DROP TRIGGER stop_company_delete");
  merge.merge(source.id, target.id);
  assert.deepEqual(
    ids(crm.entity("customers", target.id).tags),
    [a.id, b.id].sort(),
  );
  assert.deepEqual(
    ids(crm.entity("employees", employee.id).customer_tags),
    [a.id, b.id].sort(),
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM customer_tag_assignments WHERE customer_id=?",
      )
      .get(source.id).n,
    0,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("schema 12 preserves existing service tags and customer assignments persist after reopening", (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-customer-tags-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "test.sqlite");
  let db = openDatabase(filename);
  let crm = createCRM(db);
  const tag = crm.createTag({ name: "Bestehend" });
  const customer = crm.createEntity("customers", {
    name: "Bestehendes Unternehmen",
  });
  const service = crm.createEntity("services", {
    name: "Bestehende Leistung",
    tag_ids: [tag.id],
  });
  db.exec("DROP TABLE customer_tag_assignments; PRAGMA user_version=11");
  db.close();
  db = openDatabase(filename);
  crm = createCRM(db);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 12);
  assert.deepEqual(ids(crm.entity("services", service.id).tags), [tag.id]);
  crm.updateEntity("customers", customer.id, { tag_ids: [tag.id] });
  db.close();
  db = openDatabase(filename);
  t.after(() => db.close());
  assert.deepEqual(ids(createCRM(db).entity("customers", customer.id).tags), [
    tag.id,
  ]);
  assert.deepEqual(
    db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
});

test("customer tags and inherited person tags are available through REST with validated filters", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  const tag = (
    await app.inject({
      method: "POST",
      url: "/api/service-tags",
      payload: { name: "REST Tag" },
    })
  ).json();
  const customerResponse = await app.inject({
    method: "POST",
    url: "/api/customers",
    payload: { name: "REST Kunde", tag_ids: [tag.id] },
  });
  assert.equal(customerResponse.statusCode, 201);
  const customer = customerResponse.json();
  const employee = (
    await app.inject({
      method: "POST",
      url: "/api/employees",
      payload: { customer_id: customer.id, name: "REST Person" },
    })
  ).json();
  assert.equal(
    (await app.inject(`/api/employees?tag_ids=${tag.id}`)).json()[0].id,
    employee.id,
  );
  assert.equal(
    (await app.inject(`/api/customers?tag_ids=${tag.id}&search=REST`)).json()[0]
      .id,
    customer.id,
  );
  assert.equal(
    (await app.inject(`/api/customers?tag_ids=invalid`)).statusCode,
    422,
  );
  assert.equal(
    (await app.inject(`/api/employees?tag_ids=${randomUUID()}`)).statusCode,
    422,
  );
  assert.equal(
    (await app.inject(`/api/employees/${employee.id}`)).json().customer.tags[0]
      .id,
    tag.id,
  );
  const edited = await app.inject({
    method: "PATCH",
    url: `/api/customers/${customer.id}`,
    payload: { tag_ids: [] },
  });
  assert.equal(edited.statusCode, 200);
  assert.deepEqual(edited.json().tags, []);
  assert.deepEqual(
    (await app.inject(`/api/employees?tag_ids=${tag.id}`)).json(),
    [],
  );
});
