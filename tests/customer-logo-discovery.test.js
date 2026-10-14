import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { extractFavicon } from "fetchary";
import { encodeIco } from "@oliverj/tinyico";
import sharp from "sharp";
import { buildApp } from "../src/server/app.js";
import { createWebFetch } from "../src/business/web-fetch.js";
import { demoCustomerLogo } from "../scripts/demo-assets.js";
import { customerLogoWeb } from "./fixtures/customer-logo-web.js";

async function setup(t, options = {}) {
  const requests = [];
  const app = await buildApp({
    databasePath: ":memory:",
    customerLogoOptions: {
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

test("customer creation uses Fetchary's standalone icon extractor and persists the shared email and local PNG", async (t) => {
  let extractions = 0;
  const { app, requests } = await setup(t, {
    extractIcon: async (url, options) => {
      extractions++;
      assert.equal(url, "https://auto-logo.example/");
      assert.equal(options.mode, "http");
      assert.equal("dataDir" in options, false);
      return extractFavicon(url, options);
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
  assert.equal(extractions, 1);
  assert.equal(requests[0].url, "https://auto-logo.example/");
  assert.deepEqual(requests.map(({ url }) => url).sort(), [
    "https://auto-logo.example/",
    "https://auto-logo.example/assets/brand.png",
    "https://auto-logo.example/favicon.ico",
  ]);
  assert.equal(requests[0].init.redirect, "manual");
  assert.equal(
    requests.some(({ url }) => url.includes("hello@")),
    false,
  );
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

test("Fetchary chooses the largest real manifest icon after page and manifest redirects", async (t) => {
  const image = async (size, color) =>
    sharp({
      create: { width: size, height: size, channels: 4, background: color },
    })
      .png()
      .toBuffer();
  const small = await image(24, "#4d8dff");
  const large = await image(300, "#ff6b35");
  const fetched = [];
  const { app } = await setup(t, {
    fetchImpl: async (url) => {
      fetched.push(url);
      const pathname = new URL(url).pathname;
      if (pathname === "/")
        return new Response(null, {
          status: 302,
          headers: { location: "/company/" },
        });
      if (pathname === "/company/")
        return new Response(
          '<base href="/assets/"><link rel="icon" href="small.png" sizes="4096x4096"><link rel="manifest" href="site.webmanifest">',
          { headers: { "content-type": "text/html" } },
        );
      if (pathname === "/assets/site.webmanifest")
        return new Response(null, {
          status: 302,
          headers: { location: "/manifests/app.webmanifest" },
        });
      if (pathname === "/manifests/app.webmanifest")
        return new Response(
          " ".repeat(256) +
            JSON.stringify({ icons: [{ src: "brand.png", sizes: "1x1" }] }),
          { headers: { "content-type": "application/manifest+json" } },
        );
      if (pathname === "/assets/small.png")
        return new Response(small, {
          headers: { "content-type": "image/png" },
        });
      if (pathname === "/manifests/brand.png")
        return new Response(large, {
          headers: { "content-type": "image/png" },
        });
      return new Response("Not found", { status: 404 });
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/customers",
    payload: { name: "Manifest icon", general_email: "hello@manifest.example" },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().has_logo, true);
  const metadata = await sharp(
    app.crm.customerLogo(response.json().id).data,
  ).metadata();
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
  assert.equal(
    fetched.filter(
      (url) => url === "https://manifest.example/manifests/brand.png",
    ).length,
    1,
  );
  assert.ok(fetched.includes("https://manifest.example/assets/small.png"));
});

test("an undecodable large image cannot hide a valid icon in Fetchary's selection", async (t) => {
  const broken = Buffer.from(demoCustomerLogo.data_base64, "base64");
  broken.writeUInt32BE(1024, 16);
  const { app } = await setup(t, {
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/")
        return new Response(
          '<link rel="icon" href="/broken.png"><link rel="icon" href="/safe.png">',
          { headers: { "content-type": "text/html" } },
        );
      if (pathname === "/broken.png")
        return new Response(broken, {
          headers: { "content-type": "image/png" },
        });
      if (pathname === "/safe.png")
        return new Response(
          Buffer.from(demoCustomerLogo.data_base64, "base64"),
          {
            headers: { "content-type": "image/png" },
          },
        );
      return new Response("Not found", { status: 404 });
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/customers",
    payload: {
      name: "Broken icon fallback",
      general_email: "hello@broken.example",
    },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().has_logo, true);
  const metadata = await sharp(
    app.crm.customerLogo(response.json().id).data,
  ).metadata();
  assert.equal(metadata.width, 64);
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

test("Fetchary can load and save a logo from a local HTTP website", async (t) => {
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(302, { location: "/company/" });
      response.end();
    } else if (request.url === "/company/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<link rel="icon" href="/logo.png">');
    } else if (request.url === "/logo.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.from(demoCustomerLogo.data_base64, "base64"));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const { app } = await setup(t, { fetchImpl: undefined });
  const response = await app.inject({
    method: "POST",
    url: "/api/customers",
    payload: {
      name: "Local company website",
      website: `http://127.0.0.1:${server.address().port}/`,
    },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().has_logo, true);
  const metadata = await sharp(
    app.crm.customerLogo(response.json().id).data,
  ).metadata();
  assert.equal(metadata.width, 64);
});

test("missing icons and broken websites still save the customer", async (t) => {
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

test("SVG and PNG/DIB ICO favicons are rasterized using the largest entry and a failed preferred icon falls back", async (t) => {
  const small = await sharp({
    create: { width: 16, height: 16, channels: 4, background: "#4d8dff" },
  })
    .png()
    .toBuffer();
  const ico = encodeIco([
    { buffer: small },
    { buffer: Buffer.from(demoCustomerLogo.data_base64, "base64") },
  ]);
  const dib = encodeIco(
    [{ rgba: Buffer.alloc(32 * 32 * 4, 255), width: 32, height: 32 }],
    { format: "dib" },
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
        return new Response(hostname.startsWith("dib") ? dib : ico, {
          headers: { "content-type": "image/x-icon" },
        });
      return new Response("Not found", { status: 404 });
    },
  });
  for (const [domain, width] of [
    ["svg.example", 40],
    ["ico.example", 64],
    ["dib.example", 32],
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/customers",
      payload: { name: domain, general_email: "hi@" + domain },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().has_logo, true, domain);
    const image = app.crm.customerLogo(response.json().id);
    assert.equal(image.mime, "image/png");
    assert.equal((await sharp(image.data).metadata()).width, width);
  }
});

test("a malformed ICO does not prevent using another valid icon", async (t) => {
  const broken = encodeIco([
    { buffer: Buffer.from(demoCustomerLogo.data_base64, "base64") },
  ]);
  broken.writeUInt32LE(6, 18);
  const { app } = await setup(t, {
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/")
        return new Response(
          '<link rel="icon" href="/broken.ico"><link rel="icon" href="/safe.png">',
          { headers: { "content-type": "text/html" } },
        );
      if (pathname === "/broken.ico")
        return new Response(broken, {
          headers: { "content-type": "image/x-icon" },
        });
      if (pathname === "/safe.png")
        return new Response(
          Buffer.from(demoCustomerLogo.data_base64, "base64"),
          {
            headers: { "content-type": "image/png" },
          },
        );
      return new Response("Not found", { status: 404 });
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/customers",
    payload: {
      name: "Malformed ICO",
      general_email: "hello@broken-ico.example",
    },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().has_logo, true);
  assert.equal(
    (await sharp(app.crm.customerLogo(response.json().id).data).metadata())
      .width,
    64,
  );
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
      "https://svg.example/favicon.ico",
    ]);
    assert.equal(
      (await sharp(app.crm.customerLogo(response.json().id).data).metadata())
        .width,
      64,
    );
  }
});

test("website fetching limits response size and omits credentials", async () => {
  const limited = createWebFetch({
    maxBytes: 16,
    fetchImpl: async () => new Response("a".repeat(17)),
  });
  await assert.rejects(limited("https://public.example/"), /size limit/);
  const headers = createWebFetch({
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
