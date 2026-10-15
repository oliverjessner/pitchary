import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { root, version } from "./desktop-common.js";
const filename = path.join(root, "src-tauri/tauri.conf.json");
const config = JSON.parse(readFileSync(filename));
config.version = version;
writeFileSync(filename, JSON.stringify(config, null, 2) + "\n");
const cargo = path.join(root, "src-tauri/Cargo.toml");
writeFileSync(
  cargo,
  readFileSync(cargo, "utf8").replace(
    /^version = "[^"]+"/m,
    `version = "${version}"`,
  ),
);
const lock = path.join(root, "src-tauri/Cargo.lock");
try {
  writeFileSync(
    lock,
    readFileSync(lock, "utf8").replace(
      /(name = "pitchary"\nversion = ")[^"]+/,
      `$1${version}`,
    ),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
console.log(`Desktop versions synchronized to ${version}.`);
