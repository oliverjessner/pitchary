import test from "node:test";
import assert from "node:assert/strict";
import { defaultBilllySource } from "../src/config/billly-source.js";

const macHome = "/homes/fixture";
const macActual =
  macHome + "/Library/Application Support/com.oli.billly/billly.sqlite";
const macLegacy = macHome + "/Library/Application Support/Billly/billly.sqlite";
const existing =
  (...files) =>
  (filename) =>
    files.includes(filename);

test("macOS defaults to the Tauri application identifier when no database exists", () => {
  assert.equal(
    defaultBilllySource({
      platform: "darwin",
      home: macHome,
      env: {},
      exists: existing(),
    }),
    macActual,
  );
});
test("an existing identifier database takes priority over an existing legacy database", () => {
  assert.equal(
    defaultBilllySource({
      platform: "darwin",
      home: macHome,
      env: {},
      exists: existing(macActual, macLegacy),
    }),
    macActual,
  );
});
test("an existing product-name database remains a compatible macOS fallback", () => {
  assert.equal(
    defaultBilllySource({
      platform: "darwin",
      home: macHome,
      env: {},
      exists: existing(macLegacy),
    }),
    macLegacy,
  );
});
test("Windows uses APPDATA and Windows separators even when tested on another OS", () => {
  assert.equal(
    defaultBilllySource({
      platform: "win32",
      home: "C:\\Users\\fixture",
      env: { APPDATA: "D:\\Roaming" },
      exists: existing(),
    }),
    "D:\\Roaming\\com.oli.billly\\billly.sqlite",
  );
});
test("Windows finds an existing legacy product-name database", () => {
  const legacy = "D:\\Roaming\\Billly\\billly.sqlite";
  assert.equal(
    defaultBilllySource({
      platform: "win32",
      home: "C:\\Users\\fixture",
      env: { APPDATA: "D:\\Roaming" },
      exists: existing(legacy),
    }),
    legacy,
  );
});
test("Windows without APPDATA falls back to the user's roaming app-data folder", () => {
  assert.equal(
    defaultBilllySource({
      platform: "win32",
      home: "C:\\Users\\fixture",
      env: {},
      exists: existing(),
    }),
    "C:\\Users\\fixture\\AppData\\Roaming\\com.oli.billly\\billly.sqlite",
  );
});
test("Linux respects XDG_DATA_HOME and prioritizes the identifier path", () => {
  const actual = "/data/fixture/com.oli.billly/billly.sqlite";
  assert.equal(
    defaultBilllySource({
      platform: "linux",
      home: macHome,
      env: { XDG_DATA_HOME: "/data/fixture" },
      exists: existing(actual, "/data/fixture/Billly/billly.sqlite"),
    }),
    actual,
  );
});
test("Linux recognizes an existing legacy database under XDG_DATA_HOME", () => {
  const legacy = "/data/fixture/Billly/billly.sqlite";
  assert.equal(
    defaultBilllySource({
      platform: "linux",
      home: macHome,
      env: { XDG_DATA_HOME: "/data/fixture" },
      exists: existing(legacy),
    }),
    legacy,
  );
});
test("Linux without XDG_DATA_HOME defaults to the user's local data folder", () => {
  assert.equal(
    defaultBilllySource({
      platform: "linux",
      home: macHome,
      env: {},
      exists: existing(),
    }),
    macHome + "/.local/share/com.oli.billly/billly.sqlite",
  );
});
