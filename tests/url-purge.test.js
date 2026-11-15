import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/database/database.js";
import { buildApp } from "../src/server/app.js";
import { restrictMCPDatabase } from "../src/mcp/database.js";
import { createMCPTools } from "../src/mcp/tools.js";

test("customer API purges websites before persistence and logo discovery on creation and refresh", async (t) => {
  const lookups = [];
  const app = await buildApp({
    databasePath: ":memory:",
    customerLogoOptions: {
      async discover(input) {
        lookups.push(input.website);
        return null;
      },
    },
  });
  t.after(() => app.close());
  const created = await app.inject({
    method: "POST",
    url: "/api/customers",
    payload: {
      name: "Clean company",
      website: " https://EXAMPLE.com/company?id=7&utm_source=mail#contact ",
    },
  });
  assert.equal(created.statusCode, 201);
  const customer = created.json();
  assert.equal(customer.website, "https://example.com/company");
  assert.deepEqual(lookups, [customer.website]);
  assert.equal(
    app.database
      .prepare("SELECT website FROM customers WHERE id=?")
      .get(customer.id).website,
    customer.website,
  );

  const updated = await app.inject({
    method: "PATCH",
    url: `/api/customers/${customer.id}`,
    payload: {
      website: "http://www.example.com:8080/Company%20Page?source=news#about",
    },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(
    updated.json().website,
    "http://www.example.com:8080/Company%20Page",
  );
  const refreshed = await app.inject({
    method: "POST",
    url: `/api/customers/${customer.id}/logo/refetch`,
  });
  assert.equal(refreshed.statusCode, 200);
  assert.deepEqual(lookups, [
    customer.website,
    "http://www.example.com:8080/Company%20Page",
  ]);
  assert.equal(refreshed.json().record.website, updated.json().website);

  const retained = await app.inject({
    method: "PATCH",
    url: `/api/customers/${customer.id}`,
    payload: { note: "Keep the cleaned website" },
  });
  assert.equal(retained.statusCode, 200);
  assert.equal(retained.json().website, updated.json().website);
  const cleared = await app.inject({
    method: "PATCH",
    url: `/api/customers/${customer.id}`,
    payload: { website: " " },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().website, "");
});

test("person API purges LinkedIn profiles on create and edit and still validates the destination", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  const customer = app.crm.createEntity("customers", { name: "Company" });
  const created = await app.inject({
    method: "POST",
    url: "/api/employees",
    payload: {
      customer_id: customer.id,
      name: "Anna",
      linkedin: " https://WWW.LinkedIn.com/in/anna/?trk=public_profile#about ",
    },
  });
  assert.equal(created.statusCode, 201);
  const person = created.json();
  assert.equal(person.linkedin, "https://www.linkedin.com/in/anna/");
  assert.equal(
    app.database
      .prepare("SELECT linkedin FROM employees WHERE id=?")
      .get(person.id).linkedin,
    person.linkedin,
  );
  const updated = await app.inject({
    method: "PATCH",
    url: `/api/employees/${person.id}`,
    payload: { linkedin: "https://at.linkedin.com/in/Anna-New?foo=1&foo=2#" },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().linkedin, "https://at.linkedin.com/in/Anna-New");
  for (const linkedin of [
    "not a URL",
    "http://www.linkedin.com/in/anna?trk=mail#about",
    "https://linkedin.com.example.org/in/anna?trk=mail#about",
    "https://user:password@www.linkedin.com/in/anna?trk=mail#about",
  ]) {
    const rejected = await app.inject({
      method: "PATCH",
      url: `/api/employees/${person.id}`,
      payload: { name: "Must not change", linkedin },
    });
    assert.equal(rejected.statusCode, 422);
    assert.ok(rejected.json().error.fields.linkedin);
    const persisted = app.crm.entity("employees", person.id);
    assert.equal(persisted.name, person.name);
    assert.equal(persisted.linkedin, updated.json().linkedin);
  }
  const retained = await app.inject({
    method: "PATCH",
    url: `/api/employees/${person.id}`,
    payload: { position: "CEO" },
  });
  assert.equal(retained.statusCode, 200);
  assert.equal(retained.json().linkedin, updated.json().linkedin);
  const cleared = await app.inject({
    method: "PATCH",
    url: `/api/employees/${person.id}`,
    payload: { linkedin: "" },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().linkedin, "");
});

test("service URLs preserve their functional query and fragment on create and edit", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  const created = await app.inject({
    method: "POST",
    url: "/api/services",
    payload: {
      name: "Service with a query",
      url: "https://example.com/service?id=7&utm_source=mail#pricing",
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(
    created.json().url,
    "https://example.com/service?id=7&utm_source=mail#pricing",
  );
  const updated = await app.inject({
    method: "PATCH",
    url: `/api/services/${created.json().id}`,
    payload: { url: "https://example.com/service?id=8#details" },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().url, "https://example.com/service?id=8#details");
});

test("MCP purges customer websites before discovery and inserts clean customer and person URLs", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  restrictMCPDatabase(db);
  const lookups = [];
  const tools = createMCPTools(db, {
    logoDiscovery: {
      async discover(input) {
        lookups.push({
          website: input.website,
          count: db.prepare("SELECT COUNT(*) AS count FROM customers").get()
            .count,
        });
        return null;
      },
      close() {},
    },
  });
  t.after(() => tools.close());
  const created = await tools.call("pitchary_create_customer", {
    name: "MCP company",
    website: " https://BRAND.example/Company?utm_source=mcp&id=7#about ",
  });
  assert.equal(created.isError, false);
  assert.deepEqual(lookups, [
    { website: "https://brand.example/Company", count: 0 },
  ]);
  const customer = created.structuredContent.record;
  assert.equal(customer.website, "https://brand.example/Company");
  assert.equal(
    db.prepare("SELECT website FROM customers WHERE id=?").get(customer.id)
      .website,
    customer.website,
  );
  const person = await tools.call("pitchary_create_person", {
    customer_id: customer.id,
    name: "MCP person",
    linkedin: "https://www.linkedin.com/in/mcp-person?trk=mail#contact",
  });
  assert.equal(person.isError, false);
  assert.equal(
    person.structuredContent.record.linkedin,
    "https://www.linkedin.com/in/mcp-person",
  );
  assert.equal(
    db
      .prepare("SELECT linkedin FROM employees WHERE id=?")
      .get(person.structuredContent.record.id).linkedin,
    person.structuredContent.record.linkedin,
  );
});
