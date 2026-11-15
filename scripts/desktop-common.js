import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { synchronizeVersions } from "./version-sync.js";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const metadata = JSON.parse(
  readFileSync(path.join(root, "package.json")),
);
export const version = metadata.version;
export const target = "aarch64-apple-darwin";
export const nodeVersion = "26.11.1";
export const releaseRepo = "oliverjessner/pitchary";
export const tapRepo = "oliverjessner/homebrew-tap";
export const releaseDirectory = path.join(
  root,
  "artifacts/releases",
  `v${version}`,
);
export const dmgName = `Pitchary_${version}_aarch64.dmg`;
export const appPath = path.join(
  root,
  "src-tauri/target/release/bundle/macos/Pitchary.app",
);
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function run(command, args = [], options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
}
export const capture = (command, args, options = {}) =>
  run(command, args, { stdio: "pipe", encoding: "utf8", ...options }).trim();
export function assertPlatform() {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error(
      "Desktop packaging currently supports Apple Silicon macOS (darwin/arm64).",
    );
}
export function syncVersions() {
  const changed = synchronizeVersions(root);
  if (changed.length)
    console.log(`Versions synchronized to ${version}: ${changed.join(", ")}`);
  return changed;
}
export function nativeFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...nativeFiles(filename));
    else if (entry.isFile()) {
      const descriptor = openSync(filename, "r"),
        magic = Buffer.alloc(4);
      try {
        readSync(descriptor, magic, 0, 4, 0);
      } finally {
        closeSync(descriptor);
      }
      if (
        [
          "feedface",
          "feedfacf",
          "cefaedfe",
          "cffaedfe",
          "cafebabe",
          "bebafeca",
        ].includes(magic.toString("hex"))
      )
        files.push(filename);
    }
  }
  return files;
}
export function compareMacOSVersions(a, b) {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
export function macOSMinimum(filename, { inspect = capture } = {}) {
  let minimum = "0";
  const output = inspect("otool", ["-l", filename]);
  for (const command of output.split(/Load command \d+/)) {
    let version;
    if (/\bcmd LC_BUILD_VERSION\b/.test(command)) {
      if (!/\bplatform (?:1|macos)\b/i.test(command)) continue;
      version = command.match(/\bminos (\d+(?:\.\d+){0,2})\b/)?.[1];
    } else if (/\bcmd LC_VERSION_MIN_MACOSX\b/.test(command)) {
      version = command.match(/\bversion (\d+(?:\.\d+){0,2})\b/)?.[1];
    }
    if (version && compareMacOSVersions(version, minimum) > 0)
      minimum = version;
  }
  return minimum;
}
export function minimumMacOS(
  directory,
  { inspect = capture, maximumVersion } = {},
) {
  let minimum = "13.5";
  const incompatible = [];
  for (const filename of nativeFiles(directory)) {
    const version = macOSMinimum(filename, { inspect });
    if (compareMacOSVersions(version, minimum) > 0) minimum = version;
    if (maximumVersion && compareMacOSVersions(version, maximumVersion) > 0)
      incompatible.push(
        `${path.relative(directory, filename)} requires ${version}`,
      );
  }
  if (incompatible.length)
    throw new Error(
      `Bundled native files exceed macOS ${maximumVersion}:\n${incompatible.join("\n")}\nRebuild these dependencies for a compatible macOS version before packaging.`,
    );
  return minimum;
}
export function assertMacOSCompatibility(
  directory,
  maximumVersion,
  options = {},
) {
  return minimumMacOS(directory, { ...options, maximumVersion });
}
export function sourceHash() {
  const hash = createHash("sha256");
  function visit(relative) {
    const absolute = path.join(root, relative);
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) {
        hash.update(name);
        hash.update(readFileSync(path.join(root, name)));
      } else throw new Error(`Unexpected symlink in packaging inputs: ${name}`);
    }
  }
  for (const name of [
    "src",
    "public",
    "scripts",
    "src-tauri/src",
    "src-tauri/icons",
  ])
    visit(name);
  for (const name of [
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
    "src-tauri/build.rs",
  ]) {
    hash.update(name);
    hash.update(readFileSync(path.join(root, name)));
  }
  return hash.digest("hex");
}
