import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveImportSource } from "../src/config/import-source.js";

test("imports require an explicit absolute source instead of guessing a product data path", () => {
  for (const source of [undefined, null, "", " ", "relative.sqlite"])
    assert.throws(
      () => resolveImportSource(source),
      (error) => error.code === "invalid_source",
    );
});

test("explicit macOS and Linux sources remain unchanged", () => {
  for (const platform of ["darwin", "linux"])
    assert.equal(
      resolveImportSource("/data/fixture/source.sqlite", { platform }),
      "/data/fixture/source.sqlite",
    );
});

test("tilde paths expand only to the explicitly selected source", () => {
  assert.equal(
    resolveImportSource("~/exports/source.sqlite", {
      platform: "darwin",
      home: "/homes/fixture",
    }),
    "/homes/fixture/exports/source.sqlite",
  );
  assert.equal(
    resolveImportSource("~/exports/source.sqlite", {
      platform: "win32",
      home: "C:\\Users\\fixture",
    }),
    "C:\\Users\\fixture\\exports\\source.sqlite",
  );
});

test("Windows sources use native drive and UNC path rules", () => {
  assert.equal(
    resolveImportSource("D:\\Exports\\source.sqlite", { platform: "win32" }),
    "D:\\Exports\\source.sqlite",
  );
  assert.equal(
    resolveImportSource("\\\\server\\share\\source.sqlite", {
      platform: "win32",
    }),
    "\\\\server\\share\\source.sqlite",
  );
  assert.throws(
    () => resolveImportSource("D:source.sqlite", { platform: "win32" }),
    (error) => error.code === "invalid_source",
  );
});
