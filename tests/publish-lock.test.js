import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquirePublishLock } from "../scripts/publish-lock.js";

test("a publish lock excludes another process and releases for the next run", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pitchary-lock-"));
  const lock = path.join(directory, "artifacts/.publish-lock");
  try {
    const release = acquirePublishLock(lock);
    try {
      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { acquirePublishLock } from ${JSON.stringify(new URL("../scripts/publish-lock.js", import.meta.url).href)}; acquirePublishLock(${JSON.stringify(lock)});`,
        ],
        { encoding: "utf8" },
      );
      assert.equal(child.status, 1);
      assert.match(child.stderr, /Another publish is already running/);
      assert.ok(existsSync(path.join(lock, `${process.pid}.pid`)));
    } finally {
      release();
    }
    release();
    assert.equal(existsSync(lock), false);
    acquirePublishLock(lock)();
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an interrupted publish with a dead owner can resume without manual cleanup", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pitchary-lock-"));
  const lock = path.join(directory, ".publish-lock");
  try {
    const child = spawnSync(process.execPath, ["-e", ""], {
      encoding: "utf8",
    });
    assert.equal(child.status, 0);
    mkdirSync(lock);
    writeFileSync(path.join(lock, `${child.pid}.pid`), "");
    const release = acquirePublishLock(lock);
    assert.equal(existsSync(path.join(lock, `${child.pid}.pid`)), false);
    assert.ok(existsSync(path.join(lock, `${process.pid}.pid`)));
    release();
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an incomplete or unexpected lock is preserved instead of deleting its contents", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pitchary-lock-"));
  try {
    writeFileSync(path.join(directory, "keep.txt"), "preserve me");
    assert.throws(() => acquirePublishLock(directory), /lock is incomplete/);
    assert.equal(
      readFileSync(path.join(directory, "keep.txt"), "utf8"),
      "preserve me",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
