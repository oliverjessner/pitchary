import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, projectRoot } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
import { createFinance } from "../src/business/finance.js";
import { createCustomerMerge } from "../src/business/customer-merge.js";
import { buildApp } from "../src/server/app.js";
import { seedLegacyDemo } from "./fixtures/legacy-database.js";
import {
  loadPitchChannels,
  syncPitchChannels,
} from "../src/config/pitch-channels.js";

const clock = () => "2026-10-13T10:00:00.000Z";
function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const crm = createCRM(db, { clock }),
    finance = createFinance(db, { clock });
  const customers = ["Lead A", "Lead B", "Lead C", "Cost-only customer"].map(
    (name) => crm.createEntity("customers", { name }),
  );
  return { db, crm, finance, customers };
}
const types = (crm, customers) =>
  customers.map((row) => crm.entity("customers", row.id).customer_type);

test("customer classification defaults to lead, follows effective revenue links and remains sticky after deletion or reclassification", (t) => {
  const { db, crm, finance, customers } = fixture(t);
  const [a, b, c, cost] = customers;
  assert.deepEqual(types(crm, customers), ["lead", "lead", "lead", "lead"]);
  const payable = finance.record({
    category: "payable",
    customer_id: cost.id,
    counterparty_name: cost.name,
    total_amount_minor: 100,
  });
  assert.equal(crm.entity("customers", cost.id).customer_type, "lead");
  const revenue = finance.record({
    category: "revenue",
    customer_id: a.id,
    counterparty_name: a.name,
    total_amount_minor: 100,
  });
  assert.equal(crm.entity("customers", a.id).customer_type, "customer");
  finance.update(revenue.id, { customer_id: b.id });
  assert.equal(crm.entity("customers", b.id).customer_type, "customer");
  finance.update(revenue.id, { category: "payable", customer_id: c.id });
  assert.equal(crm.entity("customers", c.id).customer_type, "lead");
  finance.update(revenue.id, { category: "revenue" });
  assert.equal(crm.entity("customers", c.id).customer_type, "customer");
  finance.update(revenue.id, { category: "payable" });
  finance.remove(revenue.id);
  finance.remove(payable.id);
  assert.deepEqual(types(crm, customers), [
    "customer",
    "customer",
    "customer",
    "lead",
  ]);
  assert.throws(
    () =>
      db
        .prepare("UPDATE customers SET customer_type='lead' WHERE id=?")
        .run(a.id),
    /permanent/,
  );
  assert.throws(
    () =>
      db
        .prepare("UPDATE customers SET customer_type='other' WHERE id=?")
        .run(cost.id),
    /CHECK/,
  );
});

test("multi-field corrections classify only their final effective customer in either property order", (t) => {
  const { crm, finance, customers } = fixture(t);
  const [a, b, c, cost] = customers;
  const first = finance.record({
    category: "payable",
    customer_id: a.id,
    counterparty_name: a.name,
  });
  finance.update(first.id, { category: "revenue", customer_id: b.id });
  assert.deepEqual(types(crm, customers), ["lead", "customer", "lead", "lead"]);
  const second = finance.record({
    category: "payable",
    customer_id: c.id,
    counterparty_name: c.name,
  });
  finance.update(second.id, { customer_id: cost.id, category: "revenue" });
  assert.deepEqual(types(crm, customers), [
    "lead",
    "customer",
    "lead",
    "customer",
  ]);
});

test("atomic initial import and nested corrections never promote transient extraction customers", (t) => {
  const { crm, finance, customers } = fixture(t);
  const [a, b, c] = customers;
  let invoice;
  finance.importTransaction(() => {
    invoice = finance.record({
      category: "revenue",
      customer_id: a.id,
      counterparty_name: a.name,
    });
    finance.update(invoice.id, { customer_id: b.id }, { legacyImport: true });
    finance.record({ id: invoice.id, updated_at: clock() });
    assert.equal(crm.entity("customers", a.id).customer_type, "lead");
    assert.equal(crm.entity("customers", b.id).customer_type, "lead");
  });
  assert.deepEqual(types(crm, customers).slice(0, 3), [
    "lead",
    "customer",
    "lead",
  ]);
  finance.importTransaction(() => {
    const pending = finance.record({
      category: "revenue",
      customer_id: c.id,
      counterparty_name: c.name,
    });
    finance.update(pending.id, { category: "payable" });
  });
  assert.equal(crm.entity("customers", c.id).customer_type, "lead");
  assert.equal(finance.get(invoice.id).customer_id, b.id);
});

test("failed transactions and failed nested savepoints preserve classification and clear pending promotion work", (t) => {
  const { db, crm, finance, customers } = fixture(t);
  const [a, b] = customers;
  assert.throws(
    () =>
      finance.importTransaction(() => {
        finance.record({
          category: "revenue",
          customer_id: a.id,
          counterparty_name: a.name,
        });
        throw new Error("outer rollback");
      }),
    /outer rollback/,
  );
  assert.equal(crm.entity("customers", a.id).customer_type, "lead");
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM finance_invoices").get().n,
    0,
  );
  finance.importTransaction(() => {
    finance.record({
      category: "revenue",
      customer_id: b.id,
      counterparty_name: b.name,
    });
    assert.throws(
      () =>
        finance.importTransaction(() => {
          finance.record({
            category: "revenue",
            customer_id: a.id,
            counterparty_name: a.name,
          });
          throw new Error("nested rollback");
        }),
      /nested rollback/,
    );
  });
  assert.deepEqual(types(crm, customers).slice(0, 2), ["lead", "customer"]);
  const payable = finance.record({
    category: "payable",
    customer_id: a.id,
    counterparty_name: a.name,
  });
  db.exec(
    "CREATE TRIGGER fail_customer_promotion BEFORE UPDATE OF customer_type ON customers WHEN NEW.customer_type='customer' BEGIN SELECT RAISE(ABORT,'promotion rollback'); END",
  );
  assert.throws(
    () => finance.update(payable.id, { category: "revenue" }),
    /promotion rollback/,
  );
  assert.equal(finance.get(payable.id).category, "payable");
  assert.equal(crm.entity("customers", a.id).customer_type, "lead");
  db.exec("DROP TRIGGER fail_customer_promotion");
  finance.update(payable.id, { category: "revenue" });
  assert.equal(crm.entity("customers", a.id).customer_type, "customer");
});

test("late revenue matching, effective nullable overrides, reset and reimport classify the correct customer", (t) => {
  const { crm, finance, customers } = fixture(t);
  const [a, b] = customers;
  const invoice = finance.record({
    category: "revenue",
    customer_id: null,
    counterparty_name: null,
    source_legacy_id: "late-source",
  });
  assert.equal(crm.entity("customers", a.id).customer_type, "lead");
  finance.record({ id: invoice.id, counterparty_name: a.name });
  assert.equal(crm.entity("customers", a.id).customer_type, "customer");
  finance.update(invoice.id, { category: "payable", customer_id: b.id });
  finance.record({ source_legacy_id: "late-source", total_amount_minor: 1000 });
  assert.equal(crm.entity("customers", b.id).customer_type, "lead");
  finance.reset(invoice.id, "category");
  assert.equal(crm.entity("customers", b.id).customer_type, "lead");
  finance.update(invoice.id, { customer_id: b.id });
  assert.equal(crm.entity("customers", b.id).customer_type, "customer");
  const unassigned = finance.record({
    category: "payable",
    customer_id: null,
    counterparty_name: "Other supplier",
  });
  finance.update(unassigned.id, { category: "revenue", customer_id: null });
  assert.equal(finance.get(unassigned.id).customer_id, null);
});

test("CRM and finance customer APIs expose classification but reject manual type overrides", async (t) => {
  const app = await buildApp({
    databasePath: ":memory:",
    clock,
    financeOptions: { watchEnabled: false },
  });
  t.after(() => app.close());
  const customer = app.crm.createEntity("customers", { name: "API lead" });
  assert.equal(
    (await app.inject(`/api/customers/${customer.id}`)).json().customer_type,
    "lead",
  );
  app.finance.record({
    customer_id: customer.id,
    category: "revenue",
    counterparty_name: customer.name,
  });
  assert.equal(
    (await app.inject("/api/customers")).json()[0].customer_type,
    "customer",
  );
  assert.equal(
    (await app.inject(`/api/finance/customers/${customer.id}`)).json()
      .customer_type,
    "customer",
  );
  assert.equal(
    (await app.inject("/api/finance/customers")).json().items[0].customer_type,
    "customer",
  );
  for (const url of [
    `/api/customers/${customer.id}`,
    `/api/finance/customers/${customer.id}`,
  ])
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url,
          payload: { customer_type: "lead" },
        })
      ).statusCode,
      422,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/customers",
        payload: { name: "Manual type", customer_type: "customer" },
      })
    ).statusCode,
    422,
  );
});

test("customer merge transfers the strongest persistent status even after all revenue invoices are deleted", (t) => {
  const { db, crm, finance, customers } = fixture(t);
  const [source, target] = customers;
  const invoice = finance.record({
    customer_id: source.id,
    category: "revenue",
    counterparty_name: source.name,
  });
  finance.remove(invoice.id);
  assert.equal(crm.entity("customers", source.id).customer_type, "customer");
  assert.equal(crm.entity("customers", target.id).customer_type, "lead");
  createCustomerMerge(db).merge(source.id, target.id);
  assert.equal(crm.entity("customers", target.id).customer_type, "customer");
});

test("migration 009 backfills effective revenue assignments and preserves every existing business value", (t) => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "pitchary-customer-type-migration-"),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "schema8.sqlite");
  let db = new DatabaseSync(filename);
  const migrations = path.join(projectRoot, "src/database/migrations");
  for (const file of readdirSync(migrations)
    .filter((name) => /^00[1-8]_/.test(name))
    .sort()) {
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec(readFileSync(path.join(migrations, file), "utf8"));
    if (file.startsWith("003_")) seedLegacyDemo(db);
  }
  db.exec("PRAGMA foreign_keys=ON; PRAGMA user_version=8");
  syncPitchChannels(db, loadPitchChannels());
  const customers = db.prepare("SELECT id FROM customers ORDER BY id").all();
  const addCustomer = db.prepare(
    "INSERT INTO customers(id,name,note,website,created_at,updated_at) VALUES(?,?,'','',?,?)",
  );
  const c = randomUUID(),
    d = randomUUID(),
    e = randomUUID();
  for (const [id, name] of [
    [c, "Expense becomes revenue"],
    [d, "Income becomes expense"],
    [e, "Unlinked income"],
  ])
    addCustomer.run(id, name, clock(), clock());
  const addInvoice = db.prepare(
    "INSERT INTO finance_invoices(id,category,customer_id,created_at,updated_at,total_amount_minor,currency) VALUES(?,?,?,?,?,12345,'EUR')",
  );
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  addInvoice.run(ids[0], "revenue", customers[0].id, clock(), clock());
  addInvoice.run(ids[1], "payable", c, clock(), clock());
  addInvoice.run(ids[2], "revenue", d, clock(), clock());
  addInvoice.run(ids[3], "revenue", e, clock(), clock());
  const override = db.prepare(
    "INSERT INTO finance_invoice_overrides(invoice_id,field_name,override_value,created_at,updated_at) VALUES(?,?,?,?,?)",
  );
  override.run(
    ids[0],
    "customer_id",
    JSON.stringify(customers[1].id),
    clock(),
    clock(),
  );
  override.run(ids[1], "category", JSON.stringify("revenue"), clock(), clock());
  override.run(ids[2], "category", JSON.stringify("payable"), clock(), clock());
  override.run(ids[3], "customer_id", "null", clock(), clock());
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map(({ name }) => name);
  const before = new Map(
    tables.map((table) => [
      table,
      db
        .prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`)
        .all()
        .map((row) => ({ ...row })),
    ]),
  );
  db.close();
  db = openDatabase(filename);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 11);
    for (const table of tables) {
      const actual = db
        .prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`)
        .all()
        .map((row) => {
          const value = { ...row };
          if (table === "customers") delete value.customer_type;
          if (table === "services") delete value.url;
          if (table === "finance_invoices") {
            value.source_import_id = value.source_legacy_id;
            delete value.source_legacy_id;
          }
          return value;
        });
      assert.deepEqual(actual, before.get(table));
    }
    const type = (id) =>
      db.prepare("SELECT customer_type FROM customers WHERE id=?").get(id)
        .customer_type;
    assert.equal(type(customers[0].id), "lead");
    assert.equal(type(customers[1].id), "customer");
    assert.equal(type(c), "customer");
    assert.equal(type(d), "lead");
    assert.equal(type(e), "lead");
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    db.close();
  }
});
