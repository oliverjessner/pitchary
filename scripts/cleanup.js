import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { releaseRepo, root, sha256 } from "./desktop-common.js";
import { acquirePublishLock } from "./publish-lock.js";

// Keep this list explicit: artifacts also contains private data and migration
// evidence. Release directories require separate publication checks below.
export const cleanupPaths = Object.freeze([
  "src-tauri/target",
  "src-tauri/runtime",
  "src-tauri/gen",
  "src-tauri/vendor/glib/target",
  "src-tauri/vendor/glib/Cargo.lock",
  "artifacts/desktop-cache",
  "artifacts/browser-report",
  "artifacts/test-results",
  "artifacts/invoice-package-check",
  "artifacts/invoice-validator",
  "tests/tmp",
  "coverage",
]);

export function parseCleanupArgs(args) {
  const options = { dryRun: false, help: false };
  for (const arg of args) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (["--help", "-h"].includes(arg)) options.help = true;
    else throw new Error(`Unknown cleanup option: ${arg}`);
  }
  return options;
}

function projectRoot(directory) {
  const absolute = realpathSync(directory);
  const metadata = JSON.parse(
    readFileSync(path.join(absolute, "package.json"), "utf8"),
  );
  const cargo = readFileSync(
    path.join(absolute, "src-tauri/Cargo.toml"),
    "utf8",
  );
  if (
    metadata.name !== "pitchary" ||
    !/^name\s*=\s*"pitchary"\s*$/m.test(cargo)
  )
    throw new Error("Cleanup requires the Pitchary project root.");
  const checkout = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: absolute,
    encoding: "utf8",
  }).trim();
  if (realpathSync(checkout) !== absolute)
    throw new Error("Cleanup requires the root of the Pitchary checkout.");
  return absolute;
}

function safeTarget(directory, relative) {
  const parts = relative.split("/");
  let current = directory;
  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new Error(`Refusing cleanup through a symlink: ${current}`);
    if (current !== path.join(directory, ...parts) && !stat.isDirectory())
      throw new Error(`Cleanup parent is not a directory: ${current}`);
  }
  return current;
}

function sizeOf(filename) {
  const stat = lstatSync(filename);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(filename).reduce(
    (bytes, name) => bytes + sizeOf(path.join(filename, name)),
    0,
  );
}

function githubRelease(tag, directory) {
  try {
    return JSON.parse(
      execFileSync(
        "gh",
        [
          "api",
          "--hostname",
          "github.com",
          `repos/${releaseRepo}/releases/tags/${tag}`,
        ],
        {
          cwd: directory,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30_000,
          maxBuffer: 8 * 1024 ** 2,
        },
      ),
    );
  } catch (error) {
    if (String(error.stderr).includes("HTTP 404")) return null;
    throw new Error(
      "GitHub release verification unavailable; check gh authentication and network access.",
    );
  }
}

function versionParts(version) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
    ? version.split(".").map(BigInt)
    : null;
}

function olderThan(version, current) {
  const left = versionParts(version);
  const right = versionParts(current);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

function releaseManifest(directory, relative, version) {
  const filename = `Pitchary_${version}_aarch64.dmg`;
  const allowed = new Set([
    filename,
    "manifest.json",
    "SHA256SUMS",
    "release-notes.md",
    ".DS_Store",
  ]);
  const release = safeTarget(directory, relative);
  if (!release || !lstatSync(release).isDirectory())
    throw new Error("Not a generated release directory.");
  // Never remove unrecognized files that someone has saved next to a DMG.
  for (const entry of readdirSync(release, { withFileTypes: true })) {
    if (entry.name === "Casks" && entry.isDirectory()) {
      const casks = readdirSync(path.join(release, "Casks"), {
        withFileTypes: true,
      });
      if (casks.every((item) => item.isFile() && item.name === "pitchary.rb"))
        continue;
    }
    if (!entry.isFile() || !allowed.has(entry.name))
      throw new Error("Contains unrecognized files; manual review required.");
  }
  const manifest = JSON.parse(
    readFileSync(path.join(release, "manifest.json"), "utf8"),
  );
  if (
    manifest.version !== version ||
    manifest.target !== "aarch64-apple-darwin" ||
    manifest.file !== filename ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  )
    throw new Error("Missing or inconsistent release metadata.");
  if (sha256(readFileSync(path.join(release, filename))) !== manifest.sha256)
    throw new Error("Local DMG checksum differs from its manifest.");
  return manifest;
}

function planOldReleases(directory, getRelease) {
  const releases = safeTarget(directory, "artifacts/releases");
  const entries = [];
  const preservedReleases = [];
  if (!releases) return { entries, preservedReleases };
  const { version: current } = JSON.parse(
    readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  let unavailable;
  for (const tag of readdirSync(releases).sort()) {
    const relative = `artifacts/releases/${tag}`;
    const version = tag.startsWith("v") ? tag.slice(1) : "";
    if (!olderThan(version, current)) {
      preservedReleases.push({
        path: relative,
        reason: "Current, newer or unrecognized version.",
      });
      continue;
    }
    // Refuse symlink release roots before any deletion, just like cache roots.
    safeTarget(directory, relative);
    try {
      const manifest = releaseManifest(directory, relative, version);
      if (unavailable) throw unavailable;
      let remote;
      try {
        remote = getRelease(tag, directory);
      } catch (error) {
        unavailable = error;
        throw error;
      }
      const asset = remote?.assets?.find((item) => item.name === manifest.file);
      if (
        remote?.tag_name !== tag ||
        remote.draft !== false ||
        !remote.published_at ||
        asset?.state !== "uploaded" ||
        asset.digest !== `sha256:${manifest.sha256}`
      )
        throw new Error(
          "No published GitHub DMG with a matching SHA-256 digest.",
        );
      entries.push({
        path: relative,
        bytes: sizeOf(path.join(directory, relative)),
      });
    } catch (error) {
      preservedReleases.push({ path: relative, reason: error.message });
    }
  }
  return { entries, preservedReleases };
}

export function planCleanup(
  directory = root,
  { getRelease = githubRelease } = {},
) {
  const absolute = projectRoot(directory);
  const releases = planOldReleases(absolute, getRelease);
  const paths = [
    ...cleanupPaths,
    ...releases.entries.map((entry) => entry.path),
  ];
  const tracked = execFileSync(
    "git",
    ["--literal-pathspecs", "ls-files", "-z", "--", ...paths],
    { cwd: absolute, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  if (tracked.length)
    throw new Error(`Refusing to remove tracked files: ${tracked.join(", ")}`);
  // Validate every destination before deleting the first one.
  const entries = cleanupPaths.flatMap((relative) => {
    const filename = safeTarget(absolute, relative);
    return filename ? [{ path: relative, bytes: sizeOf(filename) }] : [];
  });
  entries.push(...releases.entries);
  return {
    root: absolute,
    entries,
    preservedReleases: releases.preservedReleases,
    bytes: entries.reduce((bytes, entry) => bytes + entry.bytes, 0),
  };
}

export function cleanupBuildArtifacts({
  directory = root,
  dryRun = false,
  getRelease = githubRelease,
} = {}) {
  const plan = planCleanup(directory, { getRelease });
  if (!dryRun)
    for (const entry of plan.entries) {
      const filename = safeTarget(plan.root, entry.path);
      if (filename) rmSync(filename, { recursive: true, force: true });
    }
  return { ...plan, dryRun };
}

export function formatCleanupReport(result) {
  const mebibytes = (result.bytes / 1024 ** 2).toFixed(1);
  const verb = result.dryRun ? "Would remove" : "Removed";
  return [
    `${verb} ${result.entries.length} generated paths (${mebibytes} MiB of file contents).`,
    ...result.entries.map((entry) => `  ${entry.path}`),
    ...(result.preservedReleases ?? []).map(
      (entry) => `  Kept ${entry.path}: ${entry.reason}`,
    ),
    "Current and unverified releases, private databases, backups, manual screenshots and installed dependencies are preserved.",
  ].join("\n");
}

export function runCleanup({
  directory = root,
  dryRun = false,
  getRelease = githubRelease,
} = {}) {
  if (dryRun) return cleanupBuildArtifacts({ directory, dryRun, getRelease });
  const absolute = projectRoot(directory);
  // The lock itself must not be created through an artifacts symlink.
  safeTarget(absolute, "artifacts/.publish-lock");
  const unlock = acquirePublishLock(
    path.join(absolute, "artifacts/.publish-lock"),
  );
  try {
    return cleanupBuildArtifacts({ directory: absolute, getRelease });
  } finally {
    unlock();
  }
}

export function main(args = process.argv.slice(2)) {
  const options = parseCleanupArgs(args);
  if (options.help) {
    console.log(
      "Usage: npm run cleanup -- [--dry-run]\n\nRemove generated desktop/test files and older releases whose local DMG checksum matches the published GitHub asset digest. Keep the current version and unverified releases. Requires gh for release verification.\n--dry-run performs read-only GitHub checks and previews paths and file sizes without changing files.\nSuccessful publishes run cleanup automatically; failed publishes and publish --dry-run keep build files.",
    );
    return;
  }
  console.log(formatCleanupReport(runCleanup(options)));
}

if (import.meta.main)
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
