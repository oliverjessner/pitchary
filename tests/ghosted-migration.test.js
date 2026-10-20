import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase, projectRoot } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
import { seedLegacyDemo } from "./fixtures/legacy-database.js";

function previousDatabase(t) {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-ghosted-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "schema3.sqlite");
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of [
    "001_initial.sql",
    "002_relationship_archive.sql",
    "003_customer_branding.sql",
  ])
    db.exec(
      readFileSync(
        path.join(projectRoot, "src/database/migrations", name),
        "utf8",
      ),
    );
  db.exec("PRAGMA user_version=3");
  seedLegacyDemo(db);
  return { db, filename };
}

test("migration 004 preserves schema 3 rows, logos, archives, history and database guards", (t) => {
  let { db, filename } = previousDatabase(t);
  const tables = [
    "customers",
    "employees",
    "services",
    "customer_services",
    "customer_service_status_history",
    "activities",
  ];
  const row = db
    .prepare("SELECT * FROM customer_services WHERE status='pitched' LIMIT 1")
    .get();
  const archived = db
    .prepare("SELECT id FROM customer_services WHERE id!=? LIMIT 1")
    .get(row.id);
  db.prepare("UPDATE customer_services SET archived_at=? WHERE id=?").run(
    "2026-10-01T09:00:00.000Z",
    archived.id,
  );
  const before = tables.map((table) =>
    db.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all(),
  );
  db.close();
  db = openDatabase(filename);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 12);
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    tables.forEach((table, index) =>
      assert.deepEqual(
        db.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all(),
        table === "customers"
          ? before[index].map((row) =>
              Object.assign(Object.create(null), row, {
                customer_type: "lead",
              }),
            )
          : table === "services"
            ? before[index].map((row) =>
                Object.assign(Object.create(null), row, { url: "" }),
              )
            : before[index],
      ),
    );
    for (const table of ["customer_service_status_history", "activities"]) {
      assert.throws(() => db.exec(`UPDATE ${table} SET id=id`), /immutable/);
      assert.throws(() => db.exec(`DELETE FROM ${table}`), /immutable/);
    }
    const wrong = db
      .prepare("SELECT id FROM employees WHERE customer_id!=? LIMIT 1")
      .get(row.customer_id);
    assert.throws(
      () =>
        db
          .prepare(
            "UPDATE customer_services SET primary_employee_id=? WHERE id=?",
          )
          .run(wrong.id, row.id),
      /FOREIGN KEY/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO activities(id,customer_service_id,employee_id,type,note,occurred_at,created_at) VALUES(?,?,?,'note','',?,?)",
          )
          .run(
            randomUUID(),
            row.id,
            wrong.id,
            row.status_since,
            row.status_since,
          ),
      /another customer/,
    );
    const crm = createCRM(db);
    crm.changeStatus(row.id, { status: "ghosted", reason: "Keine Antwort" });
    assert.equal(crm.relationship(row.id).history.at(-1).to_status, "ghosted");
  } finally {
    db.close();
  }
  db = openDatabase(filename);
  try {
    const crm = createCRM(db);
    assert.equal(crm.relationship(row.id).status, "ghosted");
    crm.changeStatus(row.id, {
      status: "pitched",
      reason: "Kontakt wieder da",
    });
    assert.equal(
      crm.relationship(row.id).history.at(-1).from_status,
      "ghosted",
    );
    assert.equal(
      crm.relationship(row.id).first_pitched_price_minor,
      row.first_pitched_price_minor,
    );
  } finally {
    db.close();
  }
});

test("failed migration 004 rolls back the table rebuild and schema version", (t) => {
  const { db, filename } = previousDatabase(t);
  db.exec("PRAGMA foreign_keys=OFF");
  const row = db.prepare("SELECT id FROM customer_services LIMIT 1").get();
  db.prepare(
    "UPDATE customer_services SET customer_id=?,primary_employee_id=NULL WHERE id=?",
  ).run(randomUUID(), row.id);
  const before = db
    .prepare("SELECT rowid,* FROM customer_services ORDER BY rowid")
    .all();
  db.close();
  assert.throws(
    () => openDatabase(filename),
    /Foreign key violation after migration/,
  );
  const unchanged = new DatabaseSync(filename);
  try {
    assert.equal(
      unchanged.prepare("PRAGMA user_version").get().user_version,
      3,
    );
    assert.deepEqual(
      unchanged
        .prepare("SELECT rowid,* FROM customer_services ORDER BY rowid")
        .all(),
      before,
    );
    assert.equal(
      unchanged
        .prepare(
          "SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE '%_next'",
        )
        .get().n,
      0,
    );
    assert.throws(
      () => unchanged.exec("DELETE FROM customer_service_status_history"),
      /immutable/,
    );
  } finally {
    unchanged.close();
  }
});
