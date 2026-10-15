import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  renderCask,
  verifyManifest,
  releaseTagCommit,
  publishGitHubRelease,
} from "../scripts/publish.js";
import {
  dmgName,
  sha256,
  target,
  version,
  releaseDirectory,
  releaseRepo,
} from "../scripts/desktop-common.js";
import path from "node:path";

test("release metadata rejects stale, modified and mismatched desktop artifacts", () => {
  const bytes = Buffer.from("release artifact");
  const manifest = {
    version,
    target,
    file: dmgName,
    sourceHash: "current inputs",
    sha256: sha256(bytes),
    minimumSystemVersion: "26.4",
  };
  assert.doesNotThrow(() => verifyManifest(manifest, bytes, "current inputs"));
  assert.throws(
    () => verifyManifest(manifest, bytes, "changed inputs"),
    /Sources changed/,
  );
  assert.throws(
    () => verifyManifest(manifest, Buffer.from("modified"), "current inputs"),
    /checksum/,
  );
  assert.throws(
    () =>
      verifyManifest(
        { ...manifest, version: "99.0.0" },
        bytes,
        "current inputs",
      ),
    /version/,
  );
  assert.throws(
    () =>
      verifyManifest(
        { ...manifest, target: "x86_64-apple-darwin" },
        bytes,
        "current inputs",
      ),
    /architecture/,
  );
  const cask = renderCask(manifest);
  assert.ok(cask.includes(`sha256 "${manifest.sha256}"`));
  assert.match(
    cask,
    /github\.com\/oliverjessner\/pitchary\/releases\/download\/v#\{version\}/,
  );
  assert.match(cask, /depends_on macos: ">= 26\.4"/);
  assert.match(cask, /app "Pitchary\.app"/);
  assert.throws(
    () => renderCask({ ...manifest, version: '1.0.0"\nmalicious' }),
    /Invalid/,
  );
  assert.throws(
    () => renderCask({ ...manifest, file: "other.dmg" }),
    /filename/,
  );
});

test("publish dry-run and resume flags are explicit and reject unknown options", () => {
  assert.equal(parseArgs([]).dryRun, false);
  const options = parseArgs([
    "--dry-run",
    "--skip-build",
    "--tap-path",
    "../homebrew-tap",
  ]);
  assert.equal(options.dryRun, true);
  assert.equal(options.skipBuild, true);
  assert.equal(options.tapPath.endsWith("/homebrew-tap"), true);
  assert.throws(() => parseArgs(["--tap-path"]), /incomplete/);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown/);
});

test("first releases check tag refs without querying a nonexistent commit", () => {
  const requests = [];
  assert.equal(
    releaseTagCommit("v0.4.1", (endpoint) => {
      requests.push(endpoint);
      assert.match(endpoint, /\/git\/ref\/tags\/v0\.4\.1$/);
      return null;
    }),
    null,
  );
  assert.equal(requests.length, 1);
  for (const type of ["commit", "tag"]) {
    assert.equal(
      releaseTagCommit("v0.4.1", (endpoint) =>
        endpoint.includes("/git/ref/")
          ? { object: { type } }
          : { sha: "resolved-commit" },
      ),
      "resolved-commit",
    );
  }
});

test("GitHub publishing creates a draft, uploads the DMG and checksums, verifies it, then publishes", () => {
  for (const existing of [null, { draft: true }, { draft: false }]) {
    const events = [];
    const manifest = { sha256: "expected-digest" };
    publishGitHubRelease(
      {
        existing,
        commit: "source-commit",
        manifest,
        notes: "notes.md",
        title: version,
        downloadDirectory: "download",
      },
      {
        runCommand(command, args) {
          events.push({ command, args });
        },
        verifyAsset(directory, actual) {
          assert.equal(directory, "download");
          assert.equal(actual, manifest);
          events.push({ verify: true });
        },
      },
    );
    const operations = events.map((event) =>
      event.verify ? "verify" : event.args[1],
    );
    assert.deepEqual(
      operations,
      !existing
        ? ["create", "upload", "verify", "edit"]
        : existing.draft
          ? ["upload", "verify", "edit"]
          : ["verify"],
    );
    if (existing?.draft === false) continue;
    const upload = events.find((event) => event.args?.[1] === "upload");
    assert.deepEqual(upload, {
      command: "gh",
      args: [
        "release",
        "upload",
        `v${version}`,
        path.join(releaseDirectory, dmgName),
        path.join(releaseDirectory, "SHA256SUMS"),
        "--repo",
        releaseRepo,
        "--clobber",
      ],
    });
    assert.ok(events.at(-1).args.includes("--draft=false"));
    assert.equal(
      events.at(-1).args[events.at(-1).args.indexOf("--title") + 1],
      version,
    );
    if (!existing) {
      assert.ok(events[0].args.includes("--draft"));
      assert.equal(
        events[0].args[events[0].args.indexOf("--target") + 1],
        "source-commit",
      );
      assert.equal(
        events[0].args[events[0].args.indexOf("--title") + 1],
        version,
      );
    }
  }
});

test("a failed DMG verification leaves the GitHub release unpublished", () => {
  const operations = [];
  assert.throws(
    () =>
      publishGitHubRelease(
        {
          existing: null,
          commit: "source",
          manifest: {},
          notes: "notes.md",
          title: version,
          downloadDirectory: "download",
        },
        {
          runCommand(_command, args) {
            operations.push(args[1]);
          },
          verifyAsset() {
            throw new Error("checksum mismatch");
          },
        },
      ),
    /checksum mismatch/,
  );
  assert.deepEqual(operations, ["create", "upload"]);
});
