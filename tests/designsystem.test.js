import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { syncDesignSystem } from "../scripts/sync-designsystem.js";

async function fixture(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "pitchary-designsystem-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "node_modules/oj-designsystem");
  const destination = path.join(directory, "public/vendor/oj-designsystem");
  await mkdir(path.join(source, "dist/assets/fonts"), { recursive: true });
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(source, "package.json"), '{"version":"0.3.0"}');
  await writeFile(path.join(source, "dist/styles.css"), "new styles");
  await writeFile(path.join(source, "dist/assets/fonts/local.woff2"), "font");
  await writeFile(path.join(source, "LICENSE"), "MIT");
  await writeFile(path.join(source, "THIRD-PARTY-NOTICES.md"), "notices");
  await writeFile(path.join(destination, "styles.css"), "old styles");
  await writeFile(path.join(destination, "obsolete.js"), "old module");
  return { directory, source, destination };
}

test("design system updates replace old assets and preserve local fonts and notices", async (t) => {
  const f = await fixture(t);
  assert.equal(await syncDesignSystem(f.directory), "0.3.0");
  assert.equal(
    await readFile(path.join(f.destination, "VERSION"), "utf8"),
    "0.3.0\n",
  );
  assert.equal(
    await readFile(path.join(f.destination, "styles.css"), "utf8"),
    "new styles",
  );
  assert.equal(
    await readFile(
      path.join(f.destination, "assets/fonts/local.woff2"),
      "utf8",
    ),
    "font",
  );
  assert.equal(
    await readFile(path.join(f.destination, "THIRD-PARTY-NOTICES.md"), "utf8"),
    "notices",
  );
  assert.equal((await readdir(f.destination)).includes("obsolete.js"), false);
  assert.deepEqual(await readdir(path.dirname(f.destination)), [
    "oj-designsystem",
  ]);
});

test("incomplete design system packages leave the working assets intact", async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.source, "THIRD-PARTY-NOTICES.md"));
  await assert.rejects(syncDesignSystem(f.directory), { code: "ENOENT" });
  assert.equal(
    await readFile(path.join(f.destination, "styles.css"), "utf8"),
    "old styles",
  );
  assert.equal(
    await readFile(path.join(f.destination, "obsolete.js"), "utf8"),
    "old module",
  );
  assert.deepEqual(await readdir(path.dirname(f.destination)), [
    "oj-designsystem",
  ]);
});

test("first install synchronizes assets without an existing destination", async (t) => {
  const f = await fixture(t);
  await rm(f.destination, { recursive: true });
  assert.equal(await syncDesignSystem(f.directory), "0.3.0");
  assert.equal(
    await readFile(path.join(f.destination, "styles.css"), "utf8"),
    "new styles",
  );
});
