import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";

test(
  "desktop backend authenticates its own session, persists data and shuts down when its parent closes",
  { timeout: 15000 },
  async (t) => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "pitchary-desktop-test-"),
    );
    const child = spawn(process.execPath, ["src/server/desktop.js"], {
      env: { ...process.env, PITCHARY_DATA_DIR: directory },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (bytes) => {
      stderr += bytes;
    });
    t.after(() => {
      child.kill();
      rmSync(directory, { recursive: true, force: true });
    });
    const ready = await Promise.race([
      once(createInterface({ input: child.stdout }), "line").then(([line]) =>
        JSON.parse(line),
      ),
      once(child, "exit").then(([code]) => {
        throw new Error(`Backend exited (${code}): ${stderr}`);
      }),
    ]);
    assert.equal(ready.event, "ready");
    const url = new URL(ready.url),
      origin = url.origin;
    assert.equal(url.hostname, "127.0.0.1");
    assert.notEqual(url.port, "3031");
    assert.equal((await fetch(origin + "/api/health")).status, 403);
    assert.equal(
      (
        await fetch(origin + "/?desktop_token=incorrect", {
          redirect: "manual",
        })
      ).status,
      403,
    );
    const bootstrap = await fetch(ready.url, { redirect: "manual" });
    assert.equal(bootstrap.status, 302);
    const cookie = bootstrap.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    const headers = { cookie: cookie.split(";")[0] };
    assert.equal(
      (await fetch(origin + "/api/health", { headers })).status,
      200,
    );
    const html = await fetch(origin, { headers });
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Pitchary/);
    const response = await fetch(origin + "/api/customers", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Desktop persistence" }),
    });
    assert.equal(response.status, 201);
    const customer = await response.json();
    assert.equal(
      (
        await fetch(origin + "/api/health", {
          headers: { ...headers, origin: "https://foreign.example" },
        })
      ).status,
      403,
    );
    const exited = once(child, "exit");
    child.stdin.end();
    assert.equal((await exited)[0], 0);
    const db = new DatabaseSync(path.join(directory, "pitchary.sqlite"), {
      readOnly: true,
    });
    try {
      assert.equal(
        db.prepare("SELECT name FROM customers WHERE id=?").get(customer.id)
          .name,
        customer.name,
      );
      assert.equal(
        db.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok",
      );
    } finally {
      db.close();
    }
    await assert.rejects(fetch(origin + "/api/health", { headers }));
  },
);
