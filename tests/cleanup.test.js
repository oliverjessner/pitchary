import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanupBuildArtifacts,
  cleanupPaths,
  formatCleanupReport,
  parseCleanupArgs,
  planCleanup,
  runCleanup,
} from "../scripts/cleanup.js";
import { acquirePublishLock } from "../scripts/publish-lock.js";
import {
  needsDesktopPreparation,
  publishAndCleanup,
} from "../scripts/publish.js";
import { sha256 } from "../scripts/desktop-common.js";

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "pitchary-cleanup-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", directory]);
  write(
    directory,
    "package.json",
    JSON.stringify({ name: "pitchary", version: "1.0.2" }),
  );
  write(directory, "src-tauri/Cargo.toml", '[package]\nname = "pitchary"\n');
  return directory;
}

function write(directory, relative, contents = "generated") {
  const filename = path.join(directory, relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, contents);
}

test("cleanup removes only its generated allowlist and keeps release retries and private data", (t) => {
  const directory = fixture(t);
  for (const relative of cleanupPaths)
    write(
      directory,
      relative.endsWith("Cargo.lock") ? relative : `${relative}/generated.bin`,
    );
  const protectedFiles = [
    "data/pitchary.sqlite",
    "data/.encryption-key",
    "backups/customer-backup.sqlite",
    ".env",
    "node_modules/example/index.js",
    "src-tauri/icons/icon.icns",
    "src-tauri/vendor/glib/src/lib.rs",
    "src-tauri/screenshots/dashboard.png",
    "screenshots/manual.png",
    "artifacts/screenshots/customer.png",
    "artifacts/releases/v0.6.5/Pitchary_0.6.5_aarch64.dmg",
    "artifacts/releases/v0.6.5/manifest.json",
    "artifacts/releases/v0.6.5/SHA256SUMS",
    "artifacts/releases/v0.6.5/Casks/pitchary.rb",
    "artifacts/releases/v0.6.5/release-notes.md",
    "artifacts/installed-app-backups/Pitchary.app/backup",
    "artifacts/migrations/source.sqlite",
    "artifacts/transfers/export.sqlite",
    "artifacts/validation.sqlite",
    "artifacts/tests.log",
    "artifacts/.publish-lock/123.pid",
    ".playwright-mcp/manual-snapshot.yml",
  ];
  for (const relative of protectedFiles) write(directory, relative, "keep");
  const result = cleanupBuildArtifacts({ directory });
  assert.deepEqual(
    result.entries.map((entry) => entry.path),
    cleanupPaths,
  );
  assert.equal(
    result.bytes,
    cleanupPaths.length * Buffer.byteLength("generated"),
  );
  for (const relative of cleanupPaths)
    assert.equal(existsSync(path.join(directory, relative)), false, relative);
  for (const relative of protectedFiles)
    assert.equal(
      readFileSync(path.join(directory, relative), "utf8"),
      "keep",
      relative,
    );
  assert.match(
    formatCleanupReport(result),
    new RegExp(`Removed ${cleanupPaths.length} generated paths`),
  );
  assert.equal(cleanupBuildArtifacts({ directory }).entries.length, 0);
});

test("cleanup previews leave all files intact and report the same planned sizes", (t) => {
  const directory = fixture(t);
  write(directory, "src-tauri/target/debug/output", "123456");
  write(directory, "artifacts/desktop-cache/archive.tar.gz", "1234");
  const before = planCleanup(directory);
  const result = cleanupBuildArtifacts({ directory, dryRun: true });
  assert.deepEqual(result, { ...before, dryRun: true });
  assert.equal(result.bytes, 10);
  assert.equal(
    readFileSync(path.join(directory, "src-tauri/target/debug/output"), "utf8"),
    "123456",
  );
  assert.equal(
    existsSync(path.join(directory, "artifacts/desktop-cache/archive.tar.gz")),
    true,
  );
  assert.match(formatCleanupReport(result), /Would remove 2 generated paths/);
  assert.deepEqual(parseCleanupArgs(["--dry-run"]), {
    dryRun: true,
    help: false,
  });
  assert.equal(parseCleanupArgs(["--help"]).help, true);
  assert.throws(
    () => parseCleanupArgs(["--root", "/"]),
    /Unknown cleanup option/,
  );
});

test("cleanup refuses tracked output before removing any generated path", (t) => {
  const directory = fixture(t);
  write(directory, "src-tauri/target/debug/output");
  write(directory, "coverage/important.txt", "tracked");
  execFileSync("git", ["add", "coverage/important.txt"], { cwd: directory });
  assert.throws(
    () => cleanupBuildArtifacts({ directory }),
    /Refusing to remove tracked files: coverage\/important.txt/,
  );
  assert.equal(
    existsSync(path.join(directory, "src-tauri/target/debug/output")),
    true,
  );
  assert.equal(
    readFileSync(path.join(directory, "coverage/important.txt"), "utf8"),
    "tracked",
  );
});

test("cleanup refuses symlink targets and ancestors before the first deletion", (t) => {
  for (const relative of ["src-tauri/runtime", "artifacts"]) {
    const directory = fixture(t);
    const outside = mkdtempSync(
      path.join(tmpdir(), "pitchary-cleanup-outside-"),
    );
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    write(directory, "src-tauri/target/keep-on-failure");
    write(outside, "desktop-cache/keep", "outside");
    mkdirSync(path.dirname(path.join(directory, relative)), {
      recursive: true,
    });
    symlinkSync(outside, path.join(directory, relative), "dir");
    assert.throws(
      () => cleanupBuildArtifacts({ directory }),
      /Refusing cleanup through a symlink/,
    );
    assert.equal(
      existsSync(path.join(directory, "src-tauri/target/keep-on-failure")),
      true,
    );
    assert.equal(
      readFileSync(path.join(outside, "desktop-cache/keep"), "utf8"),
      "outside",
    );
  }
});

test("symlinks inside disposable output are removed without following their targets", (t) => {
  const directory = fixture(t);
  write(directory, "data/private.sqlite", "private");
  mkdirSync(path.join(directory, "src-tauri/target/debug"), {
    recursive: true,
  });
  symlinkSync(
    path.join(directory, "data"),
    path.join(directory, "src-tauri/target/debug/data"),
    "dir",
  );
  cleanupBuildArtifacts({ directory });
  assert.equal(existsSync(path.join(directory, "src-tauri/target")), false);
  assert.equal(
    readFileSync(path.join(directory, "data/private.sqlite"), "utf8"),
    "private",
  );
});

test("cleanup requires the Pitchary checkout root", (t) => {
  const directory = fixture(t);
  write(directory, "src-tauri/target/output");
  write(directory, "package.json", JSON.stringify({ name: "another-app" }));
  assert.throws(
    () => cleanupBuildArtifacts({ directory }),
    /Pitchary project root/,
  );
  assert.equal(
    existsSync(path.join(directory, "src-tauri/target/output")),
    true,
  );
  write(directory, "nested/package.json", JSON.stringify({ name: "pitchary" }));
  write(
    directory,
    "nested/src-tauri/Cargo.toml",
    '[package]\nname = "pitchary"\n',
  );
  assert.throws(
    () => cleanupBuildArtifacts({ directory: path.join(directory, "nested") }),
    /root of the Pitchary checkout/,
  );
});

test("independent cleanup shares the publish lock and leaves dry-run read-only", (t) => {
  const directory = fixture(t);
  write(directory, "src-tauri/target/output");
  runCleanup({ directory, dryRun: true });
  assert.equal(existsSync(path.join(directory, "artifacts")), false);
  const unlock = acquirePublishLock(
    path.join(directory, "artifacts/.publish-lock"),
  );
  try {
    assert.throws(
      () => runCleanup({ directory }),
      /Another publish is already running/,
    );
    assert.equal(
      existsSync(path.join(directory, "src-tauri/target/output")),
      true,
    );
  } finally {
    unlock();
  }
  runCleanup({ directory });
  assert.equal(existsSync(path.join(directory, "src-tauri/target")), false);
  assert.equal(
    existsSync(path.join(directory, "artifacts/.publish-lock")),
    false,
  );
});

test("independent cleanup refuses lock symlinks before changing anything outside the checkout", (t) => {
  for (const relative of ["artifacts", "artifacts/.publish-lock"]) {
    const directory = fixture(t);
    const outside = mkdtempSync(
      path.join(tmpdir(), "pitchary-cleanup-lock-test-"),
    );
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    write(outside, "999999999.pid", "preserved");
    mkdirSync(path.dirname(path.join(directory, relative)), {
      recursive: true,
    });
    symlinkSync(outside, path.join(directory, relative), "dir");
    assert.throws(
      () => runCleanup({ directory }),
      /Refusing cleanup through a symlink/,
    );
    assert.equal(existsSync(path.join(outside, ".publish-lock")), false);
    assert.equal(
      readFileSync(path.join(outside, "999999999.pid"), "utf8"),
      "preserved",
    );
  }
});

test("publish runs cleanup once after all publishing finishes, including --skip-brew", async () => {
  for (const skipBrew of [false, true]) {
    const operations = [];
    const options = { dryRun: false, skipBrew };
    await publishAndCleanup(options, {
      async publishRelease(actual) {
        assert.equal(actual, options);
        operations.push("verified release");
        await Promise.resolve();
        if (!skipBrew) operations.push("cask pushed");
      },
      cleanup() {
        operations.push("cleanup");
        return { entries: [], bytes: 0, dryRun: false };
      },
      log() {},
    });
    assert.deepEqual(
      operations,
      skipBrew
        ? ["verified release", "cleanup"]
        : ["verified release", "cask pushed", "cleanup"],
    );
  }
});

test("dry-run and failed publishes preserve generated artifacts for review and retry", async () => {
  let cleanups = 0;
  const cleanup = () => {
    cleanups++;
  };
  await publishAndCleanup(
    { dryRun: true },
    { publishRelease: async () => {}, cleanup },
  );
  for (const failure of [
    "checks failed",
    "build failed",
    "upload failed",
    "checksum mismatch",
    "cask push failed",
  ])
    await assert.rejects(
      publishAndCleanup(
        { dryRun: false },
        {
          publishRelease: async () => {
            throw new Error(failure);
          },
          cleanup,
        },
      ),
      { message: failure },
    );
  assert.equal(cleanups, 0);
});

test("cleanup errors clearly distinguish an already successful publish", async () => {
  await assert.rejects(
    publishAndCleanup(
      { dryRun: false },
      {
        publishRelease: async () => {},
        cleanup() {
          throw new Error("cache is locked");
        },
      },
    ),
    /Publishing succeeded, but local cleanup failed: cache is locked\nResolve the local cleanup issue and run npm run cleanup/,
  );
});

test("--skip-build prepares a missing runtime for native tests after cleanup", () => {
  assert.equal(
    needsDesktopPreparation({ skipBuild: false }, () => true),
    true,
  );
  assert.equal(
    needsDesktopPreparation({ skipBuild: true }, () => false),
    true,
  );
  assert.equal(
    needsDesktopPreparation({ skipBuild: true }, (filename) =>
      filename.endsWith("src-tauri/runtime/bin/node"),
    ),
    false,
  );
});

function releaseFixture(directory, version) {
  const relative = `artifacts/releases/v${version}`;
  const manifest = {
    version,
    target: "aarch64-apple-darwin",
    file: `Pitchary_${version}_aarch64.dmg`,
    sha256: sha256(Buffer.from(`DMG ${version}`)),
  };
  write(directory, `${relative}/manifest.json`, JSON.stringify(manifest));
  write(directory, `${relative}/${manifest.file}`, `DMG ${version}`);
  write(directory, `${relative}/Casks/pitchary.rb`);
  return {
    tag_name: `v${version}`,
    draft: false,
    published_at: "2026-11-19T10:00:00Z",
    assets: [
      {
        name: manifest.file,
        state: "uploaded",
        digest: `sha256:${manifest.sha256}`,
      },
    ],
  };
}

test("cleanup prunes verified older releases and preserves current, newer and unknown versions", (t) => {
  const directory = fixture(t);
  const remote = new Map();
  for (const version of ["0.9.0", "1.0.1", "1.0.2", "1.0.10"])
    remote.set(`v${version}`, releaseFixture(directory, version));
  write(directory, "artifacts/releases/manual/private.sqlite", "private");
  const calls = [];
  const getRelease = (tag) => {
    calls.push(tag);
    return remote.get(tag);
  };
  const preview = runCleanup({ directory, dryRun: true, getRelease });
  assert.deepEqual(calls, ["v0.9.0", "v1.0.1"]);
  assert.deepEqual(
    preview.entries.map((entry) => entry.path),
    ["artifacts/releases/v0.9.0", "artifacts/releases/v1.0.1"],
  );
  for (const version of ["0.9.0", "1.0.1", "1.0.2", "1.0.10"])
    assert.equal(
      existsSync(path.join(directory, `artifacts/releases/v${version}`)),
      true,
    );
  assert.equal(
    existsSync(path.join(directory, "artifacts/.publish-lock")),
    false,
  );
  const result = runCleanup({ directory, getRelease });
  assert.deepEqual(result.entries, preview.entries);
  for (const version of ["0.9.0", "1.0.1"])
    assert.equal(
      existsSync(path.join(directory, `artifacts/releases/v${version}`)),
      false,
    );
  for (const version of ["1.0.2", "1.0.10"])
    assert.equal(
      existsSync(path.join(directory, `artifacts/releases/v${version}`)),
      true,
    );
  assert.equal(
    readFileSync(
      path.join(directory, "artifacts/releases/manual/private.sqlite"),
      "utf8",
    ),
    "private",
  );
  assert.match(
    formatCleanupReport(result),
    /Kept artifacts\/releases\/v1\.0\.2/,
  );
});

test("unpublished, unavailable and mismatched GitHub assets keep their local release", (t) => {
  const cases = [
    () => null,
    (remote) => ({ ...remote, draft: true }),
    (remote) => ({ ...remote, published_at: null }),
    (remote) => ({ ...remote, tag_name: "v0.1.0" }),
    (remote) => ({ ...remote, assets: [] }),
    (remote) => ({
      ...remote,
      assets: [{ ...remote.assets[0], state: "new" }],
    }),
    (remote) => ({
      ...remote,
      assets: [{ ...remote.assets[0], digest: null }],
    }),
    (remote) => ({
      ...remote,
      assets: [{ ...remote.assets[0], digest: `sha256:${"0".repeat(64)}` }],
    }),
    () => {
      throw new Error("GitHub offline");
    },
  ];
  for (const change of cases) {
    const directory = fixture(t);
    const remote = releaseFixture(directory, "1.0.1");
    write(directory, "artifacts/desktop-cache/download");
    const result = cleanupBuildArtifacts({
      directory,
      getRelease: () => change(remote),
    });
    assert.deepEqual(
      result.entries.map((entry) => entry.path),
      ["artifacts/desktop-cache"],
    );
    assert.equal(
      existsSync(path.join(directory, "artifacts/releases/v1.0.1")),
      true,
    );
    assert.equal(result.preservedReleases.length, 1);
    assert.match(
      formatCleanupReport(result),
      /Kept artifacts\/releases\/v1\.0\.1:/,
    );
  }
});

test("cleanup preserves modified DMGs, unexpected files, unsafe metadata and incomplete releases", (t) => {
  const cases = [
    (directory) =>
      write(
        directory,
        "artifacts/releases/v1.0.1/Pitchary_1.0.1_aarch64.dmg",
        "changed",
      ),
    (directory) =>
      write(directory, "artifacts/releases/v1.0.1/private.sqlite", "private"),
    (directory) =>
      write(
        directory,
        "artifacts/releases/v1.0.1/Casks/private.sqlite",
        "private",
      ),
    (directory) =>
      write(
        directory,
        "artifacts/releases/v1.0.1/manifest.json",
        JSON.stringify({ version: "1.0.1", file: "../../private.sqlite" }),
      ),
    (directory) =>
      rmSync(path.join(directory, "artifacts/releases/v1.0.1/manifest.json")),
    (directory) => {
      write(directory, "data/private.sqlite", "private");
      symlinkSync(
        path.join(directory, "data/private.sqlite"),
        path.join(directory, "artifacts/releases/v1.0.1/Casks/secret"),
      );
    },
  ];
  for (const change of cases) {
    const directory = fixture(t);
    releaseFixture(directory, "1.0.1");
    change(directory);
    const result = cleanupBuildArtifacts({
      directory,
      getRelease: () =>
        assert.fail("Invalid local releases must not trigger GitHub checks"),
    });
    assert.equal(result.entries.length, 0);
    assert.equal(result.preservedReleases.length, 1);
    assert.equal(
      existsSync(path.join(directory, "artifacts/releases/v1.0.1")),
      true,
    );
  }
});

test("tracked and symlinked old releases prevent all cleanup deletions", (t) => {
  for (const kind of ["tracked", "symlink"]) {
    const directory = fixture(t);
    const remote = releaseFixture(directory, "1.0.1");
    write(directory, "src-tauri/target/output");
    if (kind === "tracked") {
      execFileSync("git", ["add", "artifacts/releases/v1.0.1/manifest.json"], {
        cwd: directory,
      });
    } else {
      rmSync(path.join(directory, "artifacts/releases/v1.0.1"), {
        recursive: true,
      });
      mkdirSync(path.join(directory, "data"));
      symlinkSync(
        path.join(directory, "data"),
        path.join(directory, "artifacts/releases/v1.0.1"),
        "dir",
      );
    }
    assert.throws(
      () => cleanupBuildArtifacts({ directory, getRelease: () => remote }),
      kind === "tracked"
        ? /Refusing to remove tracked files/
        : /Refusing cleanup through a symlink/,
    );
    assert.equal(
      existsSync(path.join(directory, "src-tauri/target/output")),
      true,
    );
  }
});

test("a GitHub failure stops further requests and retains remaining local releases", (t) => {
  const directory = fixture(t);
  releaseFixture(directory, "1.0.0");
  releaseFixture(directory, "1.0.1");
  let calls = 0;
  const result = cleanupBuildArtifacts({
    directory,
    getRelease: () => {
      calls++;
      throw new Error("GitHub offline");
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.entries.length, 0);
  assert.equal(result.preservedReleases.length, 2);
});
