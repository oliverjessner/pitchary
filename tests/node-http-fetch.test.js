import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import { nodeHttpFetch, createWebFetch } from "../src/business/web-fetch.js";

async function fixture(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://native-http.example:${server.address().port}`;
}

function loopbackLookup(_hostname, options, callback) {
  const address = { address: "127.0.0.1", family: 4 };
  if (options.all) callback(null, [address]);
  else callback(null, address.address, address.family);
}

test("native HTTP connects using the supplied lookup and leaves redirects to the caller", async (t) => {
  const requests = [];
  const origin = await fixture(t, (request, response) => {
    requests.push({ host: request.headers.host, path: request.url });
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "http://127.0.0.1/private" });
      response.end("Redirect");
    } else response.end("Company HTML");
  });
  let lookups = 0;
  const lookup = (hostname, options, callback) => {
    assert.equal(hostname, "native-http.example");
    lookups++;
    loopbackLookup(hostname, options, callback);
  };
  const response = await nodeHttpFetch(origin + "/", { lookup });
  assert.equal(await response.text(), "Company HTML");
  assert.equal(lookups, 1);
  const redirect = await nodeHttpFetch(origin + "/redirect", { lookup });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "http://127.0.0.1/private");
  await redirect.body.cancel();
  assert.deepEqual(
    requests.map(({ path }) => path),
    ["/", "/redirect"],
  );
  assert.equal(requests[0].host, new URL(origin).host);
});

test("native HTTP decodes gzip, deflate and Brotli responses and preserves empty responses", async (t) => {
  const content = Buffer.from('<link rel="icon" href="/logo.png"> Grüß dich');
  const encoders = {
    gzip: gzipSync,
    deflate: deflateSync,
    br: brotliCompressSync,
  };
  const origin = await fixture(t, (request, response) => {
    if (request.url === "/empty") {
      response.writeHead(204);
      response.end();
      return;
    }
    assert.equal(request.headers["accept-encoding"], "gzip, deflate, br");
    const encoding = request.url.slice(1);
    response.writeHead(200, { "content-encoding": encoding });
    response.end(encoders[encoding](content));
  });
  for (const encoding of Object.keys(encoders)) {
    const response = await nodeHttpFetch(origin + "/" + encoding, {
      lookup: loopbackLookup,
    });
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
  }
  const empty = await nodeHttpFetch(origin + "/empty", {
    lookup: loopbackLookup,
  });
  assert.equal(empty.status, 204);
  assert.equal(empty.body, null);
});

test(
  "website fetching limits decoded native HTTP bodies and cancels oversized streams",
  { timeout: 5000 },
  async (t) => {
    let closeStream;
    const streamClosed = new Promise((resolve) => {
      closeStream = resolve;
    });
    const origin = await fixture(t, (request, response) => {
      if (request.url === "/compressed") {
        const encoded = gzipSync(Buffer.alloc(1024, 65));
        response.writeHead(200, {
          "content-encoding": "gzip",
          "content-length": encoded.length,
        });
        response.end(encoded);
      } else {
        response.once("close", closeStream);
        response.write(Buffer.alloc(1024, 65));
      }
    });
    const fetch = createWebFetch({
      maxBytes: 128,
      // Route requests to a controlled local HTTP fixture.
      fetchImpl: (url, options) =>
        nodeHttpFetch(origin + new URL(url).pathname, {
          ...options,
          lookup: loopbackLookup,
        }),
    });
    await assert.rejects(
      fetch("http://public.example/compressed"),
      /size limit/,
    );
    await assert.rejects(fetch("http://public.example/stream"), /size limit/);
    await streamClosed;
  },
);

test(
  "aborting a native HTTP body closes the connection and rejects body reading",
  { timeout: 5000 },
  async (t) => {
    let closeStream;
    const streamClosed = new Promise((resolve) => {
      closeStream = resolve;
    });
    const origin = await fixture(t, (_request, response) => {
      response.once("close", closeStream);
      response.write("Pending response");
    });
    const controller = new AbortController();
    const response = await nodeHttpFetch(origin + "/", {
      lookup: loopbackLookup,
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(response.text());
    await streamClosed;
  },
);
