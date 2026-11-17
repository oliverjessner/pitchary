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
import { writeJavaProvenance } from "../scripts/bundle-invoice-validator.js";

test("Java provenance stays inside bundle Contents and preserves the runtime layout", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pitchary-java-bundle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const java = path.join(directory, "runtime/java");
  await mkdir(path.join(java, "Contents/Home/bin"), { recursive: true });
  await writeFile(path.join(java, "Contents/Home/bin/java"), "fixture runtime");
  await writeFile(
    path.join(java, "Contents/Info.plist"),
    "fixture bundle metadata",
  );
  const metadata = { version: "fixture-version", sha256: "fixture-checksum" };

  await writeJavaProvenance(java, metadata);
  assert.deepEqual(await readdir(java), ["Contents"]);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        path.join(java, "Contents/Resources/PITCHARY-JAVA.json"),
        "utf8",
      ),
    ),
    metadata,
  );
  assert.equal(
    await readFile(path.join(java, "Contents/Home/bin/java"), "utf8"),
    "fixture runtime",
  );
  assert.equal(
    await readFile(path.join(java, "Contents/Info.plist"), "utf8"),
    "fixture bundle metadata",
  );
});
