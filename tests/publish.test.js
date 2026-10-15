import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, renderCask, verifyManifest } from "../scripts/publish.js";
import { dmgName, sha256, target, version } from "../scripts/desktop-common.js";

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
