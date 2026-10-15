import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  renderCask,
  verifyManifest,
  releaseTagCommit,
  findGitHubRelease,
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
  assert.match(cask, /depends_on macos: :tahoe/);
  assert.doesNotMatch(cask, /depends_on macos: "/);
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

test("casks use Homebrew release symbols for exact app minimum versions and reject unknown releases", () => {
  const manifest = {
    version,
    target,
    file: dmgName,
    sha256: "a".repeat(64),
  };
  for (const [minimumSystemVersion, release] of [
    ["13.5", "ventura"],
    ["14.7.1", "sonoma"],
    ["15", "sequoia"],
    ["26.4", "tahoe"],
    ["26.4.1", "tahoe"],
    ["27.0", "golden_gate"],
  ]) {
    const cask = renderCask({ ...manifest, minimumSystemVersion });
    assert.ok(cask.includes(`depends_on macos: :${release}`));
  }
  assert.throws(
    () => renderCask({ ...manifest, minimumSystemVersion: "99.1" }),
    /Unsupported Homebrew macOS release/,
  );
  assert.throws(
    () => renderCask({ ...manifest, minimumSystemVersion: '26.4"; abort' }),
    /Invalid cask metadata/,
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

test("publishing finds and resumes drafts before their tag exists", () => {
  const draft = { id: 123, tag_name: "v0.4.2", draft: true };
  const calls = [];
  const result = findGitHubRelease("v0.4.2", (endpoint) => {
    calls.push(endpoint);
    assert.match(endpoint, /\/releases\?per_page=100&page=1$/);
    return [draft, { id: 122, tag_name: "v0.4.1", draft: false }];
  });
  assert.equal(result, draft);
  assert.equal(calls.length, 1);
  assert.equal(
    findGitHubRelease("v0.4.2", () => []),
    null,
  );
  assert.throws(() => findGitHubRelease("v0.4.2", () => null), /Cannot list/);
});

test("draft discovery paginates and refuses ambiguous duplicate drafts", () => {
  const draft = { id: 123, tag_name: "v0.4.2", draft: true };
  const calls = [];
  assert.equal(
    findGitHubRelease("v0.4.2", (endpoint) => {
      calls.push(endpoint);
      return endpoint.endsWith("page=1")
        ? Array.from({ length: 100 }, (_, id) => ({
            id,
            tag_name: `other-${id}`,
            draft: false,
          }))
        : [draft];
    }),
    draft,
  );
  assert.equal(calls.length, 2);
  assert.throws(
    () => findGitHubRelease("v0.4.2", () => [draft, { ...draft, id: 124 }]),
    /Multiple GitHub drafts.*123, 124/,
  );
  const published = { ...draft, id: 125, draft: false };
  assert.equal(
    findGitHubRelease("v0.4.2", () => [draft, published]),
    published,
  );
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
