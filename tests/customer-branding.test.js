import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { openDatabase, projectRoot } from "../src/database/database.js";
import { createCRM } from "../src/business/crm.js";
import { buildApp } from "../src/server/app.js";
import { demoCustomerLogo } from "../scripts/demo-assets.js";
import { logoFormats } from "./fixtures/logo-formats.js";
test("website and logo are validated and persisted together, replaced, retained and removed", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const crm = createCRM(db);
  const row = crm.createEntity("customers", {
    name: "Logo customer",
    website: " https://example.com ",
    logo: demoCustomerLogo,
  });
  assert.equal(row.website, "https://example.com/");
  assert.equal(row.has_logo, true);
  assert.match(row.logo_url, /\/api\/customers\//);
  assert.equal(row.logo_data, undefined);
  assert.deepEqual(
    crm.customerLogo(row.id).data,
    Buffer.from(demoCustomerLogo.data_base64, "base64"),
  );
  crm.updateEntity("customers", row.id, { note: "Keep logo" });
  assert.equal(crm.entity("customers", row.id).has_logo, true);
  assert.equal(
    crm.listEntities("customers", { search: "example.com" }).length,
    1,
  );
  assert.throws(
    () =>
      crm.updateEntity("customers", row.id, {
        name: "Must not be saved",
        logo: {
          mime_type: "image/png",
          data_base64: Buffer.from("<script>alert(1)</script>").toString(
            "base64",
          ),
        },
      }),
    /Dateiinhalt/,
  );
  assert.equal(crm.entity("customers", row.id).name, "Logo customer");
  assert.equal(crm.entity("customers", row.id).has_logo, true);
  for (const website of [
    "javascript:alert(1)",
    "data:text/html,x",
    "ftp://example.com",
    "file:///etc/passwd",
    "https://name:password@example.com",
    "not a URL",
  ])
    assert.throws(
      () => crm.updateEntity("customers", row.id, { website }),
      /Website|Websites/,
    );
  crm.archive("customers", row.id);
  assert.deepEqual(
    crm.customerLogo(row.id).data,
    Buffer.from(demoCustomerLogo.data_base64, "base64"),
  );
  assert.throws(
    () => crm.updateEntity("customers", row.id, { logo: null }),
    /Archivierte/,
  );
  crm.archive("customers", row.id, false);
  const cleared = crm.updateEntity("customers", row.id, {
    website: "",
    logo: null,
  });
  assert.equal(cleared.website, "");
  assert.equal(cleared.has_logo, false);
  assert.equal(cleared.logo_url, null);
  assert.throws(() => crm.customerLogo(row.id), /kein Logo/);
});
test("logo bytes remain out of JSON; binary route has correct MIME and size checks", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  let response = await app.inject({
    method: "POST",
    url: "/api/customers",
    payload: {
      name: "API logo",
      website: "https://example.com",
      logo: demoCustomerLogo,
    },
  });
  assert.equal(response.statusCode, 201);
  const row = response.json();
  assert.equal(row.has_logo, true);
  assert.equal(row.logo_data, undefined);
  response = await app.inject(row.logo_url);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "image/png");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(
    response.rawPayload,
    Buffer.from(demoCustomerLogo.data_base64, "base64"),
  );
  const list = (await app.inject("/api/customers")).json();
  assert.equal(list[0].logo_data, undefined);
  assert.equal(list[0].has_logo, true);
  for (const image of Object.values(logoFormats)) {
    const update = await app.inject({
      method: "PATCH",
      url: "/api/customers/" + row.id,
      payload: { logo: image },
    });
    assert.equal(update.statusCode, 200);
    const rendered = await app.inject("/api/customers/" + row.id + "/logo");
    assert.equal(rendered.headers["content-type"], image.mime_type);
    assert.deepEqual(
      rendered.rawPayload,
      Buffer.from(image.data_base64, "base64"),
    );
  }
  for (const logo of [
    { ...demoCustomerLogo, mime_type: "image/jpeg" },
    { mime_type: "image/svg+xml", data_base64: "PHN2Zy8+" },
    { ...demoCustomerLogo, data_base64: "invalid" },
    {
      ...demoCustomerLogo,
      data_base64: Buffer.alloc(1048577).toString("base64"),
    },
  ]) {
    response = await app.inject({
      method: "PATCH",
      url: "/api/customers/" + row.id,
      payload: { logo },
    });
    assert.equal(response.statusCode, 422);
  }
  response = await app.inject({
    method: "PATCH",
    url: "/api/customers/" + row.id,
    payload: {
      logo: {
        ...demoCustomerLogo,
        data_base64: Buffer.alloc(2000000).toString("base64"),
      },
    },
  });
  assert.equal(response.statusCode, 413);
  await app.inject({
    method: "PATCH",
    url: "/api/customers/" + row.id,
    payload: { logo: null },
  });
  assert.equal(
    (await app.inject("/api/customers/" + row.id + "/logo")).statusCode,
    404,
  );
  assert.equal(
    (await app.inject("/api/customers/" + randomUUID() + "/logo")).statusCode,
    404,
  );
});
test("migration 003 preserves an existing schema 2 customer and persists logos across reopening", (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-branding-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "old.sqlite"),
    id = randomUUID();
  let db = new DatabaseSync(filename);
  for (const migration of ["001_initial.sql", "002_relationship_archive.sql"])
    db.exec(
      readFileSync(
        path.join(projectRoot, "src/database/migrations", migration),
        "utf8",
      ),
    );
  db.exec("PRAGMA user_version=2");
  db.prepare(
    "INSERT INTO customers(id,name,note,created_at,updated_at) VALUES(?,?,?,?,?)",
  ).run(
    id,
    "Existing customer",
    "Keep note",
    "2026-09-01T09:00:00.000Z",
    "2026-09-01T09:00:00.000Z",
  );
  db.close();
  db = openDatabase(filename);
  let crm = createCRM(db);
  let row = crm.entity("customers", id);
  assert.equal(row.name, "Existing customer");
  assert.equal(row.note, "Keep note");
  assert.equal(row.website, "");
  assert.equal(row.has_logo, false);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 5);
  crm.updateEntity("customers", id, {
    website: "https://example.com",
    logo: demoCustomerLogo,
  });
  db.close();
  db = openDatabase(filename);
  t.after(() => db.close());
  crm = createCRM(db);
  row = crm.entity("customers", id);
  assert.equal(row.has_logo, true);
  assert.equal(row.website, "https://example.com/");
  assert.deepEqual(
    crm.customerLogo(id).data,
    Buffer.from(demoCustomerLogo.data_base64, "base64"),
  );
});
