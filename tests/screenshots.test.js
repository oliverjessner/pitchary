import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearScreenshotImages } from "../scripts/screenshots.js";
import { createScreenshotApp } from "../scripts/screenshot-demo.js";

test("screenshot cleanup removes old images, including nested images, and preserves other files", async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "pitchary-screenshot-clean-"),
  );
  try {
    mkdirSync(path.join(directory, "nested"));
    for (const filename of ["old.png", "old.JPG", "old.webp", "nested/old.svg"])
      writeFileSync(path.join(directory, filename), "old image");
    writeFileSync(path.join(directory, "notes.txt"), "keep");
    await clearScreenshotImages(directory);
    assert.deepEqual(readdirSync(directory).sort(), ["nested", "notes.txt"]);
    assert.deepEqual(readdirSync(path.join(directory, "nested")), []);
    assert.equal(
      readFileSync(path.join(directory, "notes.txt"), "utf8"),
      "keep",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("screenshot cleanup refuses a symlink target and never follows linked image directories", async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "pitchary-screenshot-links-"),
  );
  const output = path.join(directory, "output");
  const outside = path.join(directory, "outside");
  try {
    mkdirSync(output);
    mkdirSync(outside);
    writeFileSync(path.join(outside, "keep.png"), "keep");
    symlinkSync(outside, path.join(directory, "linked-output"), "dir");
    await assert.rejects(
      clearScreenshotImages(path.join(directory, "linked-output")),
      /must not be a symlink/,
    );
    symlinkSync(outside, path.join(output, "linked-folder"), "dir");
    symlinkSync(
      path.join(outside, "keep.png"),
      path.join(output, "linked.png"),
    );
    await clearScreenshotImages(output);
    assert.equal(readFileSync(path.join(outside, "keep.png"), "utf8"), "keep");
    assert.ok(existsSync(path.join(output, "linked-folder", "keep.png")));
    assert.equal(existsSync(path.join(output, "linked.png")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("screenshot data stays in memory and ignores configured user databases and desktop data", async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "pitchary-screenshot-data-"),
  );
  const sentinel = path.join(directory, "personal.sqlite");
  const desktopData = path.join(directory, "personal-desktop");
  const environment = Object.fromEntries(
    ["DATABASE_PATH", "PITCHARY_DATA_DIR"].map((name) => [
      name,
      process.env[name],
    ]),
  );
  writeFileSync(sentinel, "personal data must remain untouched");
  process.env.DATABASE_PATH = sentinel;
  process.env.PITCHARY_DATA_DIR = desktopData;
  let app;
  try {
    app = await createScreenshotApp();
    await app.ready();
    assert.equal(app.database.location("main"), null);
    assert.deepEqual(
      app.crm
        .listEntities("customers")
        .map((customer) => customer.name)
        .sort(),
      ["Atlas Digital", "Morgenwerk", "Studio Nord"],
    );
    assert.equal(app.finance.list().length, 28);
    assert.equal(await app.financeSettings.getKey(), null);
    assert.equal(
      app.financeSettings.values().company_email,
      "office@feld-form.example",
    );
    assert.equal(app.financeSettings.values().revenue_folder || "", "");
    assert.equal(app.financeSettings.values().payable_folder || "", "");
    assert.equal(app.invoiceProcessor.state.running, false);
    assert.equal(
      readFileSync(sentinel, "utf8"),
      "personal data must remain untouched",
    );
    assert.equal(existsSync(desktopData), false);
  } finally {
    await app?.close();
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
