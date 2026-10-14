import { test } from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { createFetchary } from "fetchary";
import { encodeIco } from "icojs";
import sharp from "sharp";
import { buildApp } from "../src/server/app.js";
import {
  createPublicFetch,
  isPublicAddress,
} from "../src/business/public-web-fetch.js";
import { demoCustomerLogo } from "../scripts/demo-assets.js";
import {
  customerLogoWeb,
  publicLogoLookup,
} from "./fixtures/customer-logo-web.js";

async function setup(t, options = {}) {
  const requests = [];
  const app = await buildApp({
    databasePath: ":memory:",
    customerLogoOptions: {
      lookup: publicLogoLookup,
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return customerLogoWeb(url);
      },
      ...options,
    },
  });
  t.after(() => app.close());
  return { app, requests };
}

test("customer creation discovers an HTML icon through Fetchary and persists the shared email and local PNG", async (t) => {
  let archive;
  const { app, requests } = await setup(t, {
    fetcharyFactory: async (options) => {
      archive = options.dataDir;
      return createFetchary(options);
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/customers",
    payload: {
      name: "Automatic logo",
      general_email: " hello@AUTO-logo.example ",
    },
  });
  assert.equal(response.statusCode, 201);
  const row = response.json();
  assert.equal(row.general_email, "hello@AUTO-logo.example");
  assert.equal(row.has_logo, true);
  assert.equal(row.website, "");
  assert.equal(app.finance.customer(row.id).general_email, row.general_email);
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      "https://auto-logo.example/",
      "https://auto-logo.example/assets/brand.png",
    ],
  );
  assert.equal(requests[0].init.redirect, "manual");
  assert.equal(
    requests.some(({ url }) => url.includes("hello@")),
    false,
  );
  await assert.rejects(stat(archive), { code: "ENOENT" });
  const image = await app.inject({ url: row.logo_url });
  assert.equal(image.statusCode, 200);
  assert.match(image.headers["content-type"], /^image\/png/);
  assert.equal((await sharp(image.rawPayload).metadata()).width, 64);
  assert.equal(app.crm.entity("customers", row.id).has_logo, true);
  assert.equal(
    app.crm.listEntities("customers", { search: "hello@AUTO-logo.example" })[0]
      .id,
    row.id,
  );
});

test("customer email edits use the same finance profile and invalid emails roll back creation and updates", async (t) => {
  const { app } = await setup(t);
  const row = app.crm.createEntity("customers", {
    name: "Shared email",
    general_email: "a@company.example",
  });
  app.finance.updateCustomer(row.id, {
    billing_address: "Example road",
    general_email: "billing@company.example",
  });
  assert.equal(
    app.crm.entity("customers", row.id).general_email,
    "billing@company.example",
  );
  app.crm.updateEntity("customers", row.id, {
    general_email: "office@company.example",
  });
  assert.equal(
    app.finance.customer(row.id).general_email,
    "office@company.example",
  );
  assert.equal(app.finance.customer(row.id).billing_address, "Example road");
  assert.throws(
    () =>
      app.crm.updateEntity("customers", row.id, {
        name: "Invalid change",
        general_email: "bad email",
      }),
    /E-Mail/,
  );
  assert.equal(app.crm.entity("customers", row.id).name, "Shared email");
  const before = app.crm.listEntities("customers").length;
  const response = await app.inject({
    method: "POST",
    url: "/api/customers",
    payload: { name: "Invalid", general_email: "bad email" },
  });
  assert.equal(response.statusCode, 422);
  assert.equal(app.crm.listEntities("customers").length, before);
});

test("explicit website takes priority over a personal email and manual logos or removal opt out", async (t) => {
  const { app, requests } = await setup(t);
  const create = (payload) =>
    app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: "Priority", ...payload },
    });
  let response = await create({
    general_email: "person@gmail.com",
    website: "https://auto-logo.example/",
  });
  assert.equal(response.json().has_logo, true);
  assert.equal(requests[0].url, "https://auto-logo.example/");
  const count = requests.length;
  response = await create({ general_email: "person@gmail.com" });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().has_logo, false);
  response = await create({
    general_email: "hello@auto-logo.example",
    logo: demoCustomerLogo,
  });
  assert.equal(response.json().has_logo, true);
  const id = response.json().id;
  await app.inject({
    method: "PATCH",
    url: "/api/customers/" + id,
    payload: { logo: null },
  });
  assert.equal(app.crm.entity("customers", id).has_logo, false);
  response = await create({
    general_email: "hello@auto-logo.example",
    logo: null,
  });
  assert.equal(response.json().has_logo, false);
  assert.equal(requests.length, count);
});

test("missing icons, broken websites and blocked private domains still save the customer", async (t) => {
  const { app } = await setup(t);
  for (const website of [
    "https://unavailable.example/",
    "http://127.0.0.1/",
    "http://[::1]/",
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: {
        name: "No icon",
        general_email: "office@unavailable.example",
        website,
      },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().has_logo, false);
    assert.equal(response.json().general_email, "office@unavailable.example");
  }
});

test("SVG and ICO favicons are rasterized and a failed preferred icon falls back", async (t) => {
  const ico = Buffer.from(
    await encodeIco([
      { buffer: Buffer.from(demoCustomerLogo.data_base64, "base64") },
    ]),
  );
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><defs><linearGradient id="brand"><stop stop-color="#4d8dff"/></linearGradient></defs><style>rect{fill:url("#brand")}</style><rect width="40" height="40"/></svg>';
  const { app } = await setup(t, {
    fetchImpl: async (url) => {
      const { hostname, pathname } = new URL(url);
      if (pathname === "/")
        return new Response(
          hostname.startsWith("svg")
            ? '<link rel="apple-touch-icon" href="/broken.png"><link rel="shortcut ICON" href="/logo.svg">'
            : "<html><head></head></html>",
          { headers: { "content-type": "text/html" } },
        );
      if (pathname === "/logo.svg")
        return new Response(svg, {
          headers: { "content-type": "image/svg+xml" },
        });
      if (pathname === "/favicon.ico")
        return new Response(ico, {
          headers: { "content-type": "image/x-icon" },
        });
      return new Response("Not found", { status: 404 });
    },
  });
  for (const domain of ["svg.example", "ico.example"]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: domain, general_email: "hi@" + domain },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().has_logo, true, domain);
    const image = app.crm.customerLogo(response.json().id);
    assert.equal(image.mime, "image/png");
    assert.equal(
      (await sharp(image.data).metadata()).width,
      domain.startsWith("svg") ? 40 : 64,
    );
  }
});

test("a logo lookup cannot overwrite a concurrent manual upload, email change or archived customer", async (t) => {
  for (const action of ["manual", "email", "archive"]) {
    const started = Promise.withResolvers(),
      finish = Promise.withResolvers();
    const { app } = await setup(t, {
      discover: async (row) => {
        started.resolve(row);
        return finish.promise;
      },
    });
    const creating = app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: action, general_email: "hi@auto-logo.example" },
    });
    const row = await started.promise;
    if (action === "manual")
      app.crm.updateEntity("customers", row.id, { logo: demoCustomerLogo });
    if (action === "email")
      app.crm.updateEntity("customers", row.id, {
        general_email: "changed@company.example",
      });
    if (action === "archive") app.crm.archive("customers", row.id);
    finish.resolve({
      mime_type: "image/png",
      data_base64: Buffer.from(
        await sharp({
          create: { width: 12, height: 12, channels: 4, background: "#4d8dff" },
        })
          .png()
          .toBuffer(),
      ).toString("base64"),
    });
    assert.equal((await creating).statusCode, 201);
    const current = app.crm.entity("customers", row.id);
    assert.equal(current.has_logo, action === "manual");
    if (action === "manual")
      assert.deepEqual(
        app.crm.customerLogo(row.id).data,
        Buffer.from(demoCustomerLogo.data_base64, "base64"),
      );
  }
});

test("SVG resources cannot load local files or remote fonts and safe fallback icons still work", async (t) => {
  const resources = [
    '<image href="file:///etc/passwd"/>',
    '<style>@import "https://private.example/secret.css";</style>',
    '<style>rect {fill: url("http://127.0.0.1/private");}</style>',
  ];
  for (const resource of resources) {
    const fetched = [];
    const { app } = await setup(t, {
      fetchImpl: async (url) => {
        fetched.push(url);
        const pathname = new URL(url).pathname;
        if (pathname === "/")
          return new Response(
            '<link rel="apple-touch-icon" href="/unsafe.svg"><link rel="icon" href="/safe.png">',
            { headers: { "content-type": "text/html" } },
          );
        if (pathname === "/unsafe.svg")
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
              resource +
              "</svg>",
            { headers: { "content-type": "image/svg+xml" } },
          );
        if (pathname === "/safe.png")
          return new Response(
            Buffer.from(demoCustomerLogo.data_base64, "base64"),
            { headers: { "content-type": "image/png" } },
          );
        throw new Error("Unexpected request");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: "Safe fallback", general_email: "hello@svg.example" },
    });
    assert.equal(response.json().has_logo, true);
    assert.deepEqual(fetched, [
      "https://svg.example/",
      "https://svg.example/unsafe.svg",
      "https://svg.example/safe.png",
    ]);
    assert.equal(
      (await sharp(app.crm.customerLogo(response.json().id).data).metadata())
        .width,
      64,
    );
  }
});

test("public fetching rejects private DNS, redirected private URLs and oversized responses", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(isPublicAddress(address), false, address);
  let calls = 0;
  const blocked = createPublicFetch({
    lookup: async () => [{ address: "10.0.0.1", family: 4 }],
    fetchImpl: async () => {
      calls++;
      throw new Error("Should not fetch");
    },
  });
  await assert.rejects(blocked("https://private.example/"), /Private/);
  assert.equal(calls, 0);
  const redirects = createPublicFetch({
    lookup: publicLogoLookup,
    fetchImpl: async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      });
    },
  });
  await assert.rejects(redirects("https://public.example/"), /Private/);
  assert.equal(calls, 1);
  const limited = createPublicFetch({
    maxBytes: 16,
    lookup: publicLogoLookup,
    fetchImpl: async () => new Response("a".repeat(17)),
  });
  await assert.rejects(limited("https://public.example/"), /size limit/);
  const headers = createPublicFetch({
    lookup: publicLogoLookup,
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.get("cookie"), null);
      assert.equal(options.headers.get("authorization"), null);
      return new Response("OK");
    },
  });
  assert.equal(
    await (
      await headers("https://public.example/", {
        headers: { cookie: "secret", authorization: "secret" },
      })
    ).text(),
    "OK",
  );
});
