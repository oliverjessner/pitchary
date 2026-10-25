import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDiskImage } from "../scripts/disk-image.js";

function fixture(t, { modern = true, createError, verifyError } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "pitchary-dmg-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, "Pitchary.dmg");
  writeFileSync(destination, "previous verified image");
  const calls = [],
    waits = [],
    attempts = [];
  const runCommand = (command, args) => {
    calls.push({ command, args });
    if (args.includes("--help")) {
      if (!modern) throw new Error("Unknown verb image");
      return "Usage: diskutil image create from";
    }
    if (command === "ditto") {
      mkdirSync(args[1]);
      writeFileSync(path.join(args[1], "contents"), "signed app");
      return "";
    }
    if (args[0] === "verify") {
      // The public artifact must remain unchanged until verification succeeds.
      assert.equal(
        readFileSync(destination, "utf8"),
        "previous verified image",
      );
      assert.equal(readFileSync(args[1], "utf8"), "new verified image");
      if (verifyError) throw verifyError;
      return "verified";
    }
    const source = modern ? args.at(-2) : args[args.indexOf("-srcfolder") + 1];
    assert.equal(
      readlinkSync(path.join(source, "Applications")),
      "/Applications",
    );
    assert.equal(
      readFileSync(path.join(source, "Pitchary.app/contents"), "utf8"),
      "signed app",
    );
    const image = args.at(-1);
    assert.equal(existsSync(image), false);
    attempts.push(image);
    // Simulate a partial image left behind by the OS on a failed attempt.
    writeFileSync(image, "new verified image");
    const error = createError?.(attempts.length);
    if (error) throw error;
    return "image created";
  };
  return {
    directory,
    destination,
    calls,
    waits,
    attempts,
    options: {
      runCommand,
      wait: async (milliseconds) => waits.push(milliseconds),
      log: () => {},
    },
  };
}

test("DMG packaging uses diskutil and replaces an artifact only after verification", async (t) => {
  const f = fixture(t);
  await createDiskImage("/built/Pitchary.app", f.destination, f.options);
  const creation = f.calls.find(
    (call) => call.args[2] === "from" && !call.args.includes("--help"),
  );
  assert.equal(creation.command, "diskutil");
  assert.equal(creation.args[creation.args.indexOf("--format") + 1], "UDZO");
  assert.equal(
    creation.args[creation.args.indexOf("--volumeName") + 1],
    "Pitchary",
  );
  assert.equal(readFileSync(f.destination, "utf8"), "new verified image");
  assert.deepEqual(readdirSync(f.directory), ["Pitchary.dmg"]);
  assert.deepEqual(f.waits, []);
});

test("older macOS uses hdiutil when diskutil image create is unavailable", async (t) => {
  const f = fixture(t, { modern: false });
  await createDiskImage("/built/Pitchary.app", f.destination, f.options);
  assert.ok(
    f.calls.some(
      (call) => call.command === "hdiutil" && call.args[0] === "create",
    ),
  );
  assert.equal(readFileSync(f.destination, "utf8"), "new verified image");
});

test("Resource busy retries use new image paths and preserve the previous artifact", async (t) => {
  const f = fixture(t, {
    createError: (attempt) =>
      attempt < 3
        ? Object.assign(new Error("create failed"), {
            stderr: Buffer.from("Resource busy"),
          })
        : null,
  });
  await createDiskImage("/built/Pitchary.app", f.destination, f.options);
  assert.equal(new Set(f.attempts).size, 3);
  assert.deepEqual(f.waits, [1000, 2000]);
  assert.equal(readFileSync(f.destination, "utf8"), "new verified image");
  assert.deepEqual(readdirSync(f.directory), ["Pitchary.dmg"]);
});

test("permanent busy errors stop after three attempts without replacing the artifact", async (t) => {
  const f = fixture(t, {
    createError: () =>
      Object.assign(new Error("disk is busy"), { code: "EBUSY" }),
  });
  await assert.rejects(
    createDiskImage("/built/Pitchary.app", f.destination, f.options),
    /DMG creation or verification failed/,
  );
  assert.equal(f.attempts.length, 3);
  assert.deepEqual(f.waits, [1000, 2000]);
  assert.equal(readFileSync(f.destination, "utf8"), "previous verified image");
  assert.deepEqual(readdirSync(f.directory), ["Pitchary.dmg"]);
});

test("other creation errors fail immediately and retain their diagnostic details", async (t) => {
  const f = fixture(t, {
    createError: () =>
      Object.assign(new Error("create failed"), {
        stderr: "No space left on device",
      }),
  });
  await assert.rejects(
    createDiskImage("/built/Pitchary.app", f.destination, f.options),
    /No space left on device/,
  );
  assert.equal(f.attempts.length, 1);
  assert.deepEqual(f.waits, []);
  assert.equal(readFileSync(f.destination, "utf8"), "previous verified image");
  assert.deepEqual(readdirSync(f.directory), ["Pitchary.dmg"]);
});

test("failed verification preserves the previous artifact and removes the failed image", async (t) => {
  const f = fixture(t, { verifyError: new Error("checksum mismatch") });
  await assert.rejects(
    createDiskImage("/built/Pitchary.app", f.destination, f.options),
    /checksum mismatch/,
  );
  assert.equal(f.attempts.length, 1);
  assert.equal(readFileSync(f.destination, "utf8"), "previous verified image");
  assert.deepEqual(readdirSync(f.directory), ["Pitchary.dmg"]);
});

test("a failed final rename retains the verified image for recovery", async (t) => {
  const f = fixture(t);
  rmSync(f.destination);
  mkdirSync(f.destination);
  const runCommand = f.options.runCommand;
  f.options.runCommand = (command, args) => {
    if (args[0] === "verify") {
      assert.equal(readFileSync(args[1], "utf8"), "new verified image");
      return "verified";
    }
    return runCommand(command, args);
  };
  await assert.rejects(
    createDiskImage("/built/Pitchary.app", f.destination, f.options),
    /The verified DMG is preserved at/,
  );
  assert.equal(f.attempts.length, 1);
  assert.equal(readFileSync(f.attempts[0], "utf8"), "new verified image");
  assert.deepEqual(readdirSync(f.destination), []);
});
