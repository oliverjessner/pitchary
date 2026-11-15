import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lz4CacheMatches,
  lz4Release,
  lz4RequiresRebuild,
  verifyLz4Source,
} from "../scripts/bundle-lz4.js";
import { sha256 } from "../scripts/desktop-common.js";

test("LZ4 repair only rebuilds the pinned incompatible version", () => {
  assert.equal(
    lz4RequiresRebuild({
      minimumVersion: "27.2",
      hostVersion: "27.0.1",
      version: lz4Release.version,
    }),
    true,
  );
  for (const minimumVersion of ["15.0", "27.0", "27.0.1"])
    assert.equal(
      lz4RequiresRebuild({
        minimumVersion,
        hostVersion: "27.0.1",
        version: "another-compatible-version",
      }),
      false,
    );
  for (const version of ["1.12.0", undefined])
    assert.throws(
      () =>
        lz4RequiresRebuild({
          minimumVersion: "27.2",
          hostVersion: "27.0.1",
          version,
        }),
      /pinned source/,
    );
});

test("an unverified LZ4 source archive is never accepted for compilation", () => {
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from("unexpected source archive"),
  ])
    assert.throws(() => verifyLz4Source(bytes), /checksum mismatch/);
});

test("LZ4 cache rejects modified binaries and stale build inputs", () => {
  const binary = Buffer.from("cached arm64 library");
  const expected = {
    version: lz4Release.version,
    sourceSha256: lz4Release.sha256,
    minimumSystemVersion: "13.5",
    compiler: "Apple clang version 18",
    sdk: "27.0",
  };
  const stamp = { ...expected, binarySha256: sha256(binary) };
  assert.equal(lz4CacheMatches(stamp, expected, binary), true);
  assert.equal(
    lz4CacheMatches(stamp, expected, Buffer.from("modified library")),
    false,
  );
  for (const [key, value] of [
    ["sourceSha256", "another archive"],
    ["minimumSystemVersion", "15.0"],
    ["compiler", "another compiler"],
    ["sdk", "27.2"],
  ])
    assert.equal(
      lz4CacheMatches(stamp, { ...expected, [key]: value }, binary),
      false,
    );
});
