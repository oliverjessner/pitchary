import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/server/app.js";
async function setup(t) {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  return app;
}
test("REST create, read, update, archive, restore and structured errors", async (t) => {
  const app = await setup(t);
  const create = await app.inject({
    method: "POST",
    url: "/api/customers",
    payload: { name: "O'Reilly <script>alert(1)</script>", note: "Test" },
  });
  assert.equal(create.statusCode, 201);
  const c = create.json();
  assert.equal((await app.inject("/api/customers")).json().length, 1);
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/customers/" + c.id,
        payload: { name: "Updated" },
      })
    ).json().name,
    "Updated",
  );
  assert.equal(
    (await app.inject({ method: "DELETE", url: "/api/customers/" + c.id }))
      .statusCode,
    200,
  );
  assert.equal((await app.inject("/api/customers")).json().length, 0);
  assert.equal(
    (await app.inject("/api/customers?archived=true")).json().length,
    1,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/customers/" + c.id + "/restore",
      })
    ).statusCode,
    200,
  );
  const bad = await app.inject({
    method: "POST",
    url: "/api/customers",
    payload: { name: "" },
  });
  assert.equal(bad.statusCode, 422);
  assert.equal(bad.json().error.code, "validation_error");
  assert.equal((await app.inject("/api/unknown")).statusCode, 404);
  assert.equal((await app.inject("/api/customers/not-a-uuid")).statusCode, 400);
});
test("local host, origin, cross-site requests and CSP protect the single-user API", async (t) => {
  const app = await setup(t);
  assert.equal(
    (
      await app.inject({
        url: "/api/customers",
        headers: { host: "evil.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/customers",
        headers: { host: "localhost:3000", origin: "https://evil.example" },
        payload: { name: "No" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/customers",
        headers: { "sec-fetch-site": "cross-site" },
        payload: { name: "No" },
      })
    ).statusCode,
    403,
  );
  const ok = await app.inject({
    url: "/",
    headers: { host: "127.0.0.1:3000" },
  });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers["content-security-policy"], /script-src 'self'/);
  assert.equal(
    (await app.inject("/vendor/oj-designsystem/index.js")).statusCode,
    200,
  );
  assert.equal((await app.inject("/api/customers")).json().length, 0);
});
test("relationship lifecycle is persisted across reopening the application", async (t) => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-persist-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, "db.sqlite");
  let app = await buildApp({ databasePath: filename });
  const crm = app.crm,
    c = crm.createEntity("customers", { name: "Persistence" }),
    s = crm.createEntity("services", { name: "Service" });
  const r = crm.createRelationship({
    customer_id: c.id,
    service_id: s.id,
    current_offered_price_minor: 12345,
  });
  let response = await app.inject({
    method: "POST",
    url: `/api/customer-services/${r.id}/status`,
    payload: { status: "pitched" },
  });
  assert.equal(response.statusCode, 200);
  response = await app.inject({
    method: "POST",
    url: `/api/customer-services/${r.id}/activities`,
    payload: { type: "follow_up", note: "Remember" },
  });
  assert.equal(response.statusCode, 201);
  response = await app.inject({
    method: "PATCH",
    url: `/api/customer-services/${r.id}`,
    payload: { pitch_channel: "phone" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().pitch_channel, "phone");
  response = await app.inject({
    method: "PATCH",
    url: `/api/customer-services/${r.id}`,
    payload: { pitch_channel: "not_registered" },
  });
  assert.equal(response.statusCode, 422);
  response = await app.inject({
    method: "PATCH",
    url: `/api/customer-services/${r.id}`,
    payload: { pitch_channel: "email", currency: "USD" },
  });
  assert.equal(response.statusCode, 409);
  await app.close();
  app = await buildApp({ databasePath: filename });
  t.after(() => app.close());
  const saved = (await app.inject(`/api/customer-services/${r.id}`)).json();
  assert.equal(saved.status, "pitched");
  assert.equal(saved.pitch_channel, "phone");
  assert.equal(saved.history.length, 2);
  assert.equal(saved.activities[0].note, "Remember");
  assert.equal((await app.inject("/api/analytics")).json().summary.pitched, 1);
  assert.equal(
    (await app.inject("/api/analytics?pitch_channel=phone")).json().summary
      .pitched,
    1,
  );
  assert.equal(
    (await app.inject("/api/analytics?pitch_channel=email")).json().summary
      .created,
    0,
  );
});
test("API rejects SQL injection, status mass assignment and arbitrary price fields", async (t) => {
  const app = await setup(t);
  const c = app.crm.createEntity("customers", { name: "Safe" }),
    s = app.crm.createEntity("services", { name: "Safe service" }),
    r = app.crm.createRelationship({
      customer_id: c.id,
      service_id: s.id,
      current_offered_price_minor: 10,
    });
  assert.equal(
    (
      await app.inject(
        "/api/customers?search=" +
          encodeURIComponent("'; DROP TABLE customers; --"),
      )
    ).json().length,
    0,
  );
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: `/api/customer-services/${r.id}`,
        payload: { status: "done" },
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/customer-services/${r.id}/prices`,
        payload: { field: "status", price_minor: 1 },
      })
    ).statusCode,
    422,
  );
  assert.equal((await app.inject("/api/customers")).json().length, 1);
});
