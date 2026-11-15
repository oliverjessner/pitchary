import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertMacOSCompatibility,
  compareMacOSVersions,
  macOSMinimum,
  minimumMacOS,
} from "../scripts/desktop-common.js";

function buildVersion(minimum, sdk = "27.2") {
  return `Load command 0
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos ${minimum}
      sdk ${sdk}
   ntools 1
     tool 3
  version 1250.0
`;
}

function legacyVersion(minimum, sdk = "15.0") {
  return `Load command 0
      cmd LC_VERSION_MIN_MACOSX
  cmdsize 16
  version ${minimum}
      sdk ${sdk}
`;
}

function fixture(t, files) {
  const directory = mkdtempSync(
    path.join(tmpdir(), "pitchary-macos-compatibility-"),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = new Map();
  for (const [relative, loadCommands] of Object.entries(files)) {
    const filename = path.join(directory, relative);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, Buffer.from("cffaedfe00000000", "hex"));
    output.set(filename, loadCommands);
  }
  const inspected = [];
  const inspect = (command, args) => {
    assert.equal(command, "otool");
    assert.equal(args[0], "-l");
    assert.equal(args.length, 2);
    assert.ok(output.has(args[1]), `Unexpected native file: ${args[1]}`);
    inspected.push(args[1]);
    return output.get(args[1]);
  };
  return { directory, inspected, options: { inspect } };
}

test("macOS versions compare numerically including patch versions and omitted zeros", () => {
  for (const [left, right, expected] of [
    ["27.0.1", "27.2", -1],
    ["27.2", "27.0.1", 1],
    ["13.5", "27.0.1", -1],
    ["13.10", "13.9", 1],
    ["27.0.1", "27.0.1", 0],
    ["13.5", "13.5.0", 0],
    ["27", "27.0.0", 0],
  ])
    assert.equal(compareMacOSVersions(left, right), expected);
});

test("native minimum uses LC_BUILD_VERSION minos without treating the SDK or tool version as a requirement", (t) => {
  const f = fixture(t, {
    "libCompatible.dylib":
      buildVersion("13.5", "27.2") +
      `Load command 1
          cmd LC_ID_DYLIB
      cmdsize 64
         name @rpath/libCompatible.dylib (offset 24)
   time stamp 1 Thu Jan  1 00:00:01 1970
      current version 99.0.0
compatibility version 99.0.0
`,
  });
  assert.equal(
    macOSMinimum(path.join(f.directory, "libCompatible.dylib"), f.options),
    "13.5",
  );
});

test("legacy LC_VERSION_MIN_MACOSX contributes its version rather than its SDK", (t) => {
  const f = fixture(t, {
    "legacy.node": legacyVersion("10.13", "27.2"),
  });
  assert.equal(
    macOSMinimum(path.join(f.directory, "legacy.node"), f.options),
    "10.13",
  );
});

test("deployment requirements for non-macOS platforms do not raise the macOS minimum", (t) => {
  const f = fixture(t, {
    "mixed-platform.dylib":
      buildVersion("13.5").replace("platform 1", "platform MACOS") +
      buildVersion("99.0").replace("platform 1", "platform 2"),
    "ios-only.dylib": buildVersion("99.0").replace(
      "platform 1",
      "platform IOS",
    ),
  });
  assert.equal(
    macOSMinimum(path.join(f.directory, "mixed-platform.dylib"), f.options),
    "13.5",
  );
  assert.equal(
    macOSMinimum(path.join(f.directory, "ios-only.dylib"), f.options),
    "0",
  );
  assert.equal(
    assertMacOSCompatibility(f.directory, "13.5", f.options),
    "13.5",
  );
});

test("a universal native file reports the highest deployment minimum across its load commands", (t) => {
  const f = fixture(t, {
    "universal.dylib":
      "universal.dylib (architecture x86_64):\n" +
      legacyVersion("13.5") +
      "universal.dylib (architecture arm64):\n" +
      buildVersion("14.0"),
  });
  assert.equal(
    macOSMinimum(path.join(f.directory, "universal.dylib"), f.options),
    "14.0",
  );
});

test("bundle compatibility finds nested native requirements and ignores ordinary files", (t) => {
  const f = fixture(t, {
    "bin/node": buildVersion("13.5"),
    "lib/libvips.dylib": buildVersion("26.0.1"),
    "lib/legacy.node": legacyVersion("14.0"),
  });
  writeFileSync(
    path.join(f.directory, "README.txt"),
    "minos 99.0\nversion 99.0\n",
  );
  assert.equal(minimumMacOS(f.directory, f.options), "26.0.1");
  assert.equal(
    assertMacOSCompatibility(f.directory, "27.0.1", f.options),
    "26.0.1",
  );
  assert.equal(new Set(f.inspected).size, 3);
});

test("bundling rejects an LZ4 dylib requiring macOS 27.2 on a macOS 27.0.1 host with an actionable filename", (t) => {
  const f = fixture(t, {
    "bin/node": buildVersion("13.5"),
    "lib/libvips.dylib": buildVersion("13.5"),
    "lib/liblz4.1.dylib": buildVersion("27.2"),
  });
  assert.throws(
    () => assertMacOSCompatibility(f.directory, "27.0.1", f.options),
    (error) => {
      assert.match(error.message, /lib[/\\]liblz4\.1\.dylib/);
      assert.match(error.message, /27\.2/);
      assert.match(error.message, /27\.0\.1/);
      return true;
    },
  );
  assert.equal(
    assertMacOSCompatibility(f.directory, "27.2", f.options),
    "27.2",
  );
});

test("a bundle without native files retains the supported macOS 13.5 floor", (t) => {
  const f = fixture(t, {});
  assert.equal(minimumMacOS(f.directory, f.options), "13.5");
  assert.equal(
    assertMacOSCompatibility(f.directory, "27.0.1", f.options),
    "13.5",
  );
  assert.deepEqual(f.inspected, []);
});
