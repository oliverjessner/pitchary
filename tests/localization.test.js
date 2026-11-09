import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import english, { catalogs } from "../public/js/locales/en.js";
import {
  languages,
  localeFor,
  translate,
  translateMessage,
} from "../public/js/translate.js";
import { getLanguage, getLocale, t } from "../public/js/i18n.js";

const placeholders = (text) =>
  [
    ...new Set([...text.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((m) => m[1])),
  ].sort();

test("German is the default and supported languages have explicit formatting locales", () => {
  assert.deepEqual(languages, ["de", "en"]);
  assert.equal(getLanguage(), "de");
  assert.equal(getLocale(), "de-AT");
  assert.equal(localeFor("de"), "de-AT");
  assert.equal(localeFor("en"), "en-GB");
  assert.equal(t("Kunden"), "Kunden");
  assert.equal(translate("Kunden", "en"), "Customers");
});

test("all authored literal translation calls have English catalog entries", () => {
  const directory = new URL("../public/js/", import.meta.url);
  const missing = [];
  let calls = 0;
  for (const file of readdirSync(directory).filter((name) =>
    name.endsWith(".js"),
  )) {
    const source = readFileSync(new URL(file, directory), "utf8");
    for (const match of source.matchAll(/\bt\(\s*("(?:\\.|[^"\\])*")/g)) {
      const key = JSON.parse(match[1]);
      calls++;
      if (!Object.hasOwn(english, key)) missing.push({ file, key });
    }
  }
  assert.ok(calls > 100, "The completeness check must cover the authored UI.");
  assert.deepEqual(missing, []);
});

test("every catalog translation retains its named parameters", () => {
  const shared = new Map();
  for (const [catalog, entries] of Object.entries(catalogs)) {
    assert.ok(
      Object.keys(entries).length,
      `${catalog} must contain translations`,
    );
    for (const [source, translated] of Object.entries(entries)) {
      if (shared.has(source))
        assert.equal(
          translated,
          shared.get(source),
          `Conflicting shared key: ${source}`,
        );
      shared.set(source, translated);
      assert.equal(typeof translated, "string", `${catalog}: ${source}`);
      assert.ok(translated.length, `${catalog}: ${source}`);
      assert.deepEqual(
        placeholders(translated),
        placeholders(source),
        `${catalog}: ${source}`,
      );
    }
  }
});

test("translation interpolates values once and safely falls back to the source", () => {
  const name = "Kunden & Söhne $& <img> {count}";
  assert.equal(
    translate("Logo von {name}", "en", { name, count: 4 }),
    "Logo of " + name,
  );
  assert.equal(
    translate("Logo von {name}", "de", { name }),
    "Logo von " + name,
  );
  assert.equal(translate("Logo von {name}", "en"), "Logo of {name}");
  assert.equal(
    translate("Neuer Quelltext {name}", "en", { name: "Anna" }),
    "Neuer Quelltext Anna",
  );
  assert.equal(translate("Kunden", "unknown"), "Kunden");
  for (const source of ["constructor", "__proto__", "toString", "Unbekannt"]) {
    assert.equal(translate(source, "en"), source);
    assert.equal(translateMessage(source, "en"), source);
  }
});

test("controlled API errors translate exact messages and preserve template substitutions", () => {
  assert.equal(
    translateMessage("Ungültige E-Mail-Adresse.", "en"),
    "Invalid email address.",
  );
  assert.equal(
    translateMessage("name.*[x]$&: Text erwartet.", "en"),
    "name.*[x]$&: Text is required.",
  );
  assert.equal(
    translateMessage("Feld user_supplied_key ist hier nicht änderbar.", "en"),
    "The user_supplied_key field cannot be changed here.",
  );
  assert.equal(
    translateMessage("Statuswechsel open → rejected ist nicht erlaubt.", "en"),
    "The status change open → rejected is not allowed.",
  );
  assert.equal(
    translateMessage(
      "OpenAI-Anfrage fehlgeschlagen (HTTP 429). Schlüssel und Kontingent prüfen.",
      "en",
    ),
    "The OpenAI request failed (HTTP 429). Check the API key and quota.",
  );
  assert.equal(
    translateMessage(
      "Die Quelldatenbank enthält einen ungültigen Wert im Feld customer_name.",
      "en",
    ),
    "The source database contains an invalid value in the customer_name field.",
  );
  for (const message of [
    "Unveränderter Kundentext",
    "Vorwort: Ungültige E-Mail-Adresse.",
    "Ungültige E-Mail-Adresse. Nachwort",
    "<script>alert('Kunden')</script>",
    "3 Tage",
    "€100 · Einmalig",
  ]) {
    assert.equal(translateMessage(message, "en"), message);
  }
  assert.equal(
    translateMessage("Ungültige E-Mail-Adresse.", "de"),
    "Ungültige E-Mail-Adresse.",
  );
  assert.equal(translateMessage(null, "en"), null);
  assert.equal(translateMessage(undefined, "en"), undefined);
});
