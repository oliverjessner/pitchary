import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { synchronizeVersions } from "../scripts/version-sync.js";

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "pitchary-versions-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, "src-tauri"));
  const write = (name, value) =>
    writeFileSync(path.join(directory, name), value);
  const read = (name) => readFileSync(path.join(directory, name), "utf8");
  write(
    "package.json",
    '{"name":"pitchary","version":"12.3.4","custom":"preserved"}\n',
  );
  write(
    "src-tauri/Cargo.toml",
    '[package]\nname = "pitchary"\nversion = \'0.4.1\' # app version\n\n[dependencies]\ntauri = { version = "2.12.3" }\n',
  );
  write(
    "src-tauri/tauri.conf.json",
    '{"version":"0.4.1","identifier":"com.pitchary.app","app":{"windows":[]}}\n',
  );
  write(
    "src-tauri/Cargo.lock",
    '# Lockfile\nversion = 4\n\n[[package]]\nname = "pitchary"\nversion = "0.4.1"\ndependencies = ["tauri"]\n\n[[package]]\nname = "tauri"\nversion = "2.12.3"\n\n[[package]]\nname = "pitchary"\nversion = "0.1.0"\nsource = "registry+https://example.test"\n',
  );
  write(
    "package-lock.json",
    '{"version":"0.4.1","lockfileVersion":3,"packages":{"":{"name":"pitchary","version":"0.4.1"},"node_modules/fastify":{"version":"5.12.5"}}}\n',
  );
  return { directory, write, read };
}

test("package.json synchronizes Cargo, Tauri and root lock versions without changing dependencies or package.json", (t) => {
  const { directory, read } = fixture(t);
  const metadata = read("package.json");
  assert.equal(synchronizeVersions(directory).length, 4);
  assert.equal(read("package.json"), metadata);
  assert.match(
    read("src-tauri/Cargo.toml"),
    /version = '12\.3\.4' # app version/,
  );
  assert.match(
    read("src-tauri/Cargo.toml"),
    /tauri = \{ version = "2\.12\.3" \}/,
  );
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.equal(config.version, "12.3.4");
  assert.deepEqual(config.app, { windows: [] });
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.version, "12.3.4");
  assert.equal(lock.packages[""].version, "12.3.4");
  assert.equal(lock.packages["node_modules/fastify"].version, "5.12.5");
  assert.match(
    read("src-tauri/Cargo.lock"),
    /name = "pitchary"\nversion = "12\.3\.4"\ndependencies/,
  );
  assert.match(
    read("src-tauri/Cargo.lock"),
    /name = "pitchary"\nversion = "0\.1\.0"\nsource/,
  );
  assert.match(
    read("src-tauri/Cargo.lock"),
    /name = "tauri"\nversion = "2\.12\.3"/,
  );
  assert.deepEqual(synchronizeVersions(directory), []);
});

test("version synchronization validates all inputs before writing files", (t) => {
  const { directory, read, write } = fixture(t);
  write("src-tauri/tauri.conf.json", "invalid JSON");
  const before = read("src-tauri/Cargo.toml");
  assert.throws(() => synchronizeVersions(directory), SyntaxError);
  assert.equal(read("src-tauri/Cargo.toml"), before);
});

test("version synchronization supports the initial build before lockfiles exist", (t) => {
  const { directory, read } = fixture(t);
  rmSync(path.join(directory, "src-tauri/Cargo.lock"));
  rmSync(path.join(directory, "package-lock.json"));
  assert.deepEqual(synchronizeVersions(directory), [
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json",
  ]);
  assert.match(read("src-tauri/Cargo.toml"), /version = '12\.3\.4'/);
});
