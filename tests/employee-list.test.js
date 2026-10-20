import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/server/app.js";

test("person directory includes current company names and combines search, company and archive filters", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  const customer = app.crm.createEntity("customers", {
    name: "Studio 100%_Nord",
  });
  const other = app.crm.createEntity("customers", {
    name: "Anderes Unternehmen",
  });
  const employee = app.crm.createEntity("employees", {
    customer_id: customer.id,
    name: "Anna Berger",
    email: "anna@example.test",
    position: "Projektleitung",
    linkedin: "https://www.linkedin.com/in/anna-unique/",
  });
  app.crm.createEntity("employees", {
    customer_id: other.id,
    name: employee.name,
  });
  const archived = app.crm.createEntity("employees", {
    customer_id: customer.id,
    name: "Historischer Kontakt",
    position: "Frühere Leitung",
  });
  app.crm.archive("employees", archived.id);
  const list = async (query = {}) => {
    const response = await app.inject(
      "/api/employees?" + new URLSearchParams(query),
    );
    assert.equal(response.statusCode, 200);
    return response.json();
  };
  const rows = await list();
  assert.equal(rows.length, 2);
  const row = rows.find((row) => row.id === employee.id);
  assert.equal(row.customer_name, customer.name);
  assert.equal(row.customer_archived_at, null);
  for (const search of [
    "100%_Nord",
    "%_",
    "PROJEKTLEITUNG",
    "anna@example",
    "anna-unique",
  ])
    assert.deepEqual(
      (await list({ search })).map((row) => row.id),
      [employee.id],
    );
  assert.deepEqual(
    await list({ search: "100%_Nord", customer_id: other.id }),
    [],
  );
  assert.deepEqual(
    (await list({ customer_id: customer.id })).map((row) => row.id),
    [employee.id],
  );
  assert.deepEqual(
    (await list({ archived: true, search: "Frühere" })).map((row) => row.id),
    [archived.id],
  );
  assert.deepEqual(await list({ search: "Frühere" }), []);
  app.crm.updateEntity("customers", customer.id, { name: "Neuer Firmenname" });
  app.crm.archive("customers", customer.id);
  const [updated] = await list({ search: "Neuer Firmenname" });
  assert.equal(updated.id, employee.id);
  assert.equal(updated.customer_name, "Neuer Firmenname");
  assert.ok(updated.customer_archived_at);
});
