import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createDiskImage } from "./disk-image.js";
import {
  appPath,
  assertPlatform,
  syncVersions,
  capture,
  dmgName,
  releaseDirectory,
  root,
  run,
  sha256,
  sourceHash,
  target,
  version,
  nativeFiles,
  minimumMacOS,
} from "./desktop-common.js";

assertPlatform();
syncVersions();
run(process.execPath, ["scripts/prepare-desktop.js"]);
const inputsHash = sourceHash();
const minimumSystemVersion = minimumMacOS(path.join(root, "src-tauri/runtime"));
const buildConfig = path.join(
  root,
  "artifacts/desktop-cache/build-config.json",
);
writeFileSync(
  buildConfig,
  JSON.stringify({ bundle: { macOS: { minimumSystemVersion } } }),
);
// Tauri assembles the app; signing is done after all bundled native modules.
run(path.join(root, "node_modules/.bin/tauri"), [
  "build",
  "--bundles",
  "app",
  "--no-sign",
  "--config",
  buildConfig,
  "--",
  "--locked",
]);
if (!existsSync(appPath)) throw new Error(`App missing: ${appPath}`);
for (const filename of nativeFiles(path.join(appPath, "Contents")))
  run("codesign", ["--force", "--sign", "-", filename], { stdio: "pipe" });
run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
run("codesign", ["--verify", "--deep", "--strict", appPath]);
mkdirSync(releaseDirectory, { recursive: true });
const dmg = path.join(releaseDirectory, dmgName);
await createDiskImage(appPath, dmg);
if (sourceHash() !== inputsHash)
  throw new Error(
    "Sources changed during packaging. Rebuild before publishing.",
  );
const manifest = {
  version,
  target,
  file: dmgName,
  minimumSystemVersion,
  sha256: sha256(readFileSync(dmg)),
  sourceHash: inputsHash,
  commit: capture("git", ["rev-parse", "HEAD"]),
  signing: "ad-hoc",
  app: path.relative(root, appPath),
};
writeFileSync(
  path.join(releaseDirectory, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
writeFileSync(
  path.join(releaseDirectory, "SHA256SUMS"),
  `${manifest.sha256}  ${dmgName}\n`,
);
console.log(`Built ${dmg}\nSHA-256: ${manifest.sha256}`);
