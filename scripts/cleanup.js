import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { root } from "./desktop-common.js";
import { acquirePublishLock } from "./publish-lock.js";

// Keep this list explicit: artifacts also contains releases, backups and
// migration evidence which must survive both cleanup and a publish retry.
export const cleanupPaths = Object.freeze([
  "src-tauri/target",
  "src-tauri/runtime",
  "src-tauri/gen",
  "src-tauri/vendor/glib/target",
  "src-tauri/vendor/glib/Cargo.lock",
  "artifacts/desktop-cache",
  "artifacts/browser-report",
  "artifacts/test-results",
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

export function planCleanup(directory = root) {
  const absolute = projectRoot(directory);
  const tracked = execFileSync(
    "git",
    ["--literal-pathspecs", "ls-files", "-z", "--", ...cleanupPaths],
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
  return {
    root: absolute,
    entries,
    bytes: entries.reduce((bytes, entry) => bytes + entry.bytes, 0),
  };
}

export function cleanupBuildArtifacts({
  directory = root,
  dryRun = false,
} = {}) {
  const plan = planCleanup(directory);
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
    "Release artifacts, databases, backups, screenshots and installed dependencies are preserved.",
  ].join("\n");
}

export function runCleanup({ directory = root, dryRun = false } = {}) {
  if (dryRun) return cleanupBuildArtifacts({ directory, dryRun });
  const absolute = projectRoot(directory);
  // The lock itself must not be created through an artifacts symlink.
  safeTarget(absolute, "artifacts/.publish-lock");
  const unlock = acquirePublishLock(
    path.join(absolute, "artifacts/.publish-lock"),
  );
  try {
    return cleanupBuildArtifacts({ directory: absolute });
  } finally {
    unlock();
  }
}

export function main(args = process.argv.slice(2)) {
  const options = parseCleanupArgs(args);
  if (options.help) {
    console.log(
      "Usage: npm run cleanup -- [--dry-run]\n\nRemove only generated desktop and test caches in this checkout.\n--dry-run previews paths and file sizes without changing files.\nSuccessful publishes run cleanup automatically; failed publishes and publish --dry-run keep build files.",
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
