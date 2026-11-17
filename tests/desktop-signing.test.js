import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  createDesktopSigningPlan,
  signDesktopApp,
} from "../scripts/desktop-signing.js";

const machO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]);
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "pitchary-signing-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = path.join(directory, "Pitchary.app");
  const java = path.join(app, "Contents/Resources/runtime/java");
  const plugin = path.join(java, "Contents/PlugIns/Engine.bundle");
  const executables = new Map();
  function write(filename, bytes) {
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, bytes);
    return filename;
  }
  function bundle(root, executable) {
    const info = write(
      path.join(root, "Contents/Info.plist"),
      `<plist><dict><key>CFBundleExecutable</key><string>${executable}</string></dict></plist>`,
    );
    executables.set(info, executable);
    return write(path.join(root, "Contents/MacOS", executable), machO);
  }
  const main = bundle(app, "pitchary");
  const javaMain = bundle(java, "libjli.dylib");
  const pluginMain = bundle(plugin, "Engine");
  const node = write(
    path.join(app, "Contents/Resources/runtime/bin/node"),
    machO,
  );
  const javaLibrary = write(
    path.join(java, "Contents/Home/lib/libverify.dylib"),
    machO,
  );
  const pluginLibrary = write(
    path.join(plugin, "Contents/Frameworks/support.dylib"),
    machO,
  );
  write(
    path.join(app, "Contents/Resources/ordinary/Info.plist"),
    "not a code bundle",
  );
  const reads = [];
  const readBundleExecutable = (filename) => {
    reads.push(filename);
    assert.ok(
      executables.has(filename),
      `Unexpected bundle metadata read: ${filename}`,
    );
    return executables.get(filename);
  };
  return {
    directory,
    app,
    java,
    plugin,
    main,
    javaMain,
    pluginMain,
    node,
    javaLibrary,
    pluginLibrary,
    reads,
    readBundleExecutable,
    bundle,
    write,
  };
}

test("signing inventory discovers extensionless Java and excludes every bundle entrypoint from native leaves", (t) => {
  const f = fixture(t);
  const plan = createDesktopSigningPlan(f.app, {
    readBundleExecutable: f.readBundleExecutable,
  });
  assert.deepEqual(
    plan.leaves,
    [f.node, f.javaLibrary, f.pluginLibrary].sort(),
  );
  assert.deepEqual(plan.nestedBundles, [f.plugin, f.java]);
  assert.deepEqual(plan.targets, [...plan.leaves, f.plugin, f.java, f.app]);
  for (const executable of [f.main, f.javaMain, f.pluginMain])
    assert.equal(plan.targets.includes(executable), false);
  assert.equal(f.reads.length, 3);
});

test("signing proceeds inside out without deep signing and verifies the finished outer bundle strictly", (t) => {
  const f = fixture(t),
    calls = [];
  const plan = signDesktopApp(f.app, {
    readBundleExecutable: f.readBundleExecutable,
    runCommand: (command, args) => calls.push({ command, args }),
  });
  const signing = calls.filter((call) => call.args.includes("--sign"));
  const verification = calls.filter((call) => call.args.includes("--verify"));
  assert.deepEqual(
    signing.map((call) => call.args.at(-1)),
    plan.targets,
  );
  for (const call of signing) {
    assert.equal(call.command, "codesign");
    assert.deepEqual(call.args.slice(0, -1), ["--force", "--sign", "-"]);
    assert.equal(call.args.includes("--deep"), false);
  }
  assert.deepEqual(
    verification.map((call) => call.args.at(-1)),
    [...plan.nestedBundles, plan.app],
  );
  for (const call of verification) {
    assert.equal(call.command, "codesign");
    assert.deepEqual(call.args.slice(0, -1), [
      "--verify",
      "--deep",
      "--strict",
    ]);
  }
  assert.deepEqual(calls.slice(0, plan.targets.length), signing);
  assert.deepEqual(calls.slice(plan.targets.length), verification);
  for (const bundle of [f.java, f.app])
    assert.equal(
      calls.filter(
        (call) => call.args.includes("--sign") && call.args.at(-1) === bundle,
      ).length,
      1,
    );
});

test("nested signing failure propagates before signing or verifying the outer app", (t) => {
  const f = fixture(t),
    calls = [];
  assert.throws(
    () =>
      signDesktopApp(f.app, {
        readBundleExecutable: f.readBundleExecutable,
        runCommand: (_command, args) => {
          calls.push(args);
          if (args.at(-1) === f.java)
            throw new Error("Fixture nested signing failure");
        },
      }),
    /Fixture nested signing failure/,
  );
  assert.equal(
    calls.some((args) => args.at(-1) === f.app),
    false,
  );
  assert.equal(
    calls.some((args) => args.includes("--verify")),
    false,
  );
});

test("strict nested verification failure propagates after all signing targets", (t) => {
  const f = fixture(t),
    calls = [];
  assert.throws(
    () =>
      signDesktopApp(f.app, {
        readBundleExecutable: f.readBundleExecutable,
        runCommand: (_command, args) => {
          calls.push(args);
          if (args.includes("--verify"))
            throw new Error("Fixture signature verification failure");
        },
      }),
    /Fixture signature verification failure/,
  );
  assert.equal(calls.at(-2).at(-1), f.app);
  assert.equal(calls.at(-1).includes("--verify"), true);
  assert.equal(calls.at(-1).at(-1), f.plugin);
  assert.equal(
    calls.some((args) => args.includes("--verify") && args.at(-1) === f.app),
    false,
  );
});

test("outer verification failures propagate after nested bundle verification", (t) => {
  const f = fixture(t),
    calls = [];
  assert.throws(
    () =>
      signDesktopApp(f.app, {
        readBundleExecutable: f.readBundleExecutable,
        runCommand: (_command, args) => {
          calls.push(args);
          if (args.includes("--verify") && args.at(-1) === f.app)
            throw new Error("Fixture outer verification failure");
        },
      }),
    /Fixture outer verification failure/,
  );
  assert.deepEqual(
    calls
      .filter((args) => args.includes("--verify"))
      .map((args) => args.at(-1)),
    [f.plugin, f.java, f.app],
  );
});

test(
  "bundle inventory does not follow linked directories or native files",
  { skip: process.platform === "win32" },
  (t) => {
    const f = fixture(t);
    const outside = path.join(f.directory, "Outside.app");
    const outsideMain = f.bundle(outside, "Outside");
    symlinkSync(
      outside,
      path.join(f.app, "Contents/Resources/LinkedJava"),
      "dir",
    );
    symlinkSync(
      outsideMain,
      path.join(f.app, "Contents/Resources/linked-native"),
    );
    const plan = createDesktopSigningPlan(f.app, {
      readBundleExecutable: f.readBundleExecutable,
    });
    assert.equal(
      plan.targets.some((filename) => filename.startsWith(outside)),
      false,
    );
    assert.equal(
      f.reads.some((filename) => filename.startsWith(outside)),
      false,
    );
    assert.equal(
      plan.leaves.some((filename) => filename.endsWith("linked-native")),
      false,
    );
  },
);

test(
  "bundle executables cannot escape MacOS or refer to symlinks",
  { skip: process.platform === "win32" },
  (t) => {
    const f = fixture(t);
    assert.throws(
      () =>
        createDesktopSigningPlan(f.app, {
          readBundleExecutable: () => "../outside",
        }),
      /Invalid CFBundleExecutable/,
    );
    const original = path.join(f.directory, "outside-native");
    f.write(original, machO);
    rmSync(f.javaMain);
    symlinkSync(original, f.javaMain);
    assert.throws(
      () =>
        createDesktopSigningPlan(f.app, {
          readBundleExecutable: f.readBundleExecutable,
        }),
      /Bundle executable must be a real file/,
    );
  },
);
