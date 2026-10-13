import { test } from "node:test";
import assert from "node:assert/strict";
import metadata from "../package.json" with { type: "json" };
import { buildApp } from "../src/server/app.js";

test("settings GET and save responses expose the current package version", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  const get = await app.inject("/api/finance/settings");
  assert.equal(get.statusCode, 200);
  assert.equal(get.json().app_version, metadata.version);
  const saved = await app.inject({
    method: "PATCH",
    url: "/api/finance/settings",
    payload: { company_name: "Version fixture" },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().app_version, metadata.version);
});
