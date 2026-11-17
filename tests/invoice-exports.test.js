import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  createInvoiceXML,
  xrechnungProfile,
} from "../src/business/invoice-xml.js";
import { validateInvoiceXML } from "../src/business/invoice-validation.js";
import { renderInvoicePDF } from "../src/business/invoice-pdf.js";
import { invoiceSnapshot } from "./fixtures/invoice-snapshot.js";

for (const category of ["S", "AE", "E"]) {
  test(
    `official KoSIT validates ${category} invoices against UBL, EN16931 and XRechnung`,
    { timeout: 90000 },
    async () => {
      const snapshot = invoiceSnapshot(category);
      const xml = createInvoiceXML(snapshot);
      const result = await validateInvoiceXML(xml);
      assert.equal(result.valid, true);
      assert.equal(result.profile.version, "3.0.2");
      assert.equal(result.profile.configuration, "2026-08-31");
      assert.deepEqual(result.warnings, []);
      assert.match(xml.toString(), /TEST-00001/);
      assert.match(
        xml.toString(),
        new RegExp(
          `<cbc:PayableAmount currencyID="EUR">${(snapshot.totals.total_amount_minor / 100).toFixed(2)}</cbc:PayableAmount>`,
        ),
      );
      assert.match(result.report_xml, /assessment/);
    },
  );
}

test(
  "official validation rejects well-formed XML with inconsistent totals",
  { timeout: 90000 },
  async () => {
    const xml = createInvoiceXML(invoiceSnapshot())
      .toString()
      .replace(
        '<cbc:TaxAmount currencyID="EUR">57.00</cbc:TaxAmount>',
        '<cbc:TaxAmount currencyID="EUR">1.00</cbc:TaxAmount>',
      );
    await assert.rejects(
      validateInvoiceXML(Buffer.from(xml)),
      (error) =>
        error.code === "invoice_xml_invalid" && /BR-CO/.test(error.message),
    );
  },
);

test("XRechnung fields are explicit and XML escapes all authored content", () => {
  const snapshot = invoiceSnapshot("AE");
  snapshot.subject = 'A & B <Test> "Sicher"';
  assert.match(
    createInvoiceXML(snapshot).toString(),
    /A &amp; B &lt;Test&gt; &quot;Sicher&quot;/,
  );
  snapshot.buyer_reference = "";
  assert.throws(() => createInvoiceXML(snapshot), /Käuferreferenz/);
  snapshot.buyer_reference = "AUFTRAG-TEST";
  snapshot.recipient.vat_id = "";
  assert.throws(() => createInvoiceXML(snapshot), /UID\/USt-IdNr/);
});

test("validator rejects external entities before starting Java", async () => {
  await assert.rejects(
    validateInvoiceXML(
      Buffer.from(
        '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><x>&a;</x>',
      ),
    ),
    (error) => error.code === "invoice_xml_invalid",
  );
});

test("A4 PDF paginates long descriptions, repeats headers and preserves all rows and footers", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pitchary-pdf-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshot = invoiceSnapshot("AE", 35);
  snapshot.items[0].unit = "C62";
  snapshot.items[5].description =
    "QA-Volltextmarker Lange Beschreibung mit vollständig zu erhaltendem Text. ".repeat(
      80,
    );
  snapshot.items[8].unit_price = "100.0050";
  snapshot.items[8].net_amount_minor++;
  snapshot.totals.net_amount_minor++;
  snapshot.totals.total_amount_minor++;
  snapshot.totals.tax_breakdown[0].net_amount_minor++;
  const originalSnapshot = structuredClone(snapshot);
  const file = path.join(directory, "invoice.pdf");
  const bytes = await renderInvoicePDF(snapshot, { draft: true });
  const xml = createInvoiceXML(snapshot).toString();
  assert.match(xml, /unitCode="C62"/);
  assert.match(xml, /unitCode="HUR"/);
  assert.deepEqual(snapshot, originalSnapshot);
  assert.ok(bytes.subarray(0, 8).toString().startsWith("%PDF-"));
  await writeFile(file, bytes);
  const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
  assert.match(info, /A4|595\.28 x 841\.89/);
  const pages = Number(info.match(/Pages:\s+(\d+)/)[1]);
  assert.ok(pages >= 4);
  const text = execFileSync("pdftotext", ["-layout", file, "-"], {
    encoding: "utf8",
  });
  for (let page = 1; page <= pages; page++)
    assert.match(text, new RegExp(`Seite ${page} von ${pages}`));
  for (let item = 1; item <= 35; item++)
    assert.match(text, new RegExp(`Fiktive Beratungsleistung ${item}\\b`));
  assert.equal((text.match(/Fiktive Testbank/g) || []).length, pages);
  assert.equal((text.match(/\bKontakt\b/g) || []).length, pages);
  assert.equal((text.match(/\bBankverbindung\b/g) || []).length, pages);
  const pageTexts = text.split("\f").filter((page) => page.trim());
  assert.equal(pageTexts.length, pages);
  for (const pageText of pageTexts) {
    const ownerOffset = pageText.lastIndexOf(snapshot.seller.additional_name);
    assert.ok(ownerOffset >= 0, "Every page retains the seller's owner line.");
    const footer = pageText.slice(ownerOffset);
    assert.ok(footer.includes(snapshot.seller.street));
    assert.ok(
      footer.includes(`${snapshot.seller.postal_code} ${snapshot.seller.city}`),
    );
    assert.match(footer, /\bDE\b/);
    assert.ok(
      footer.indexOf(snapshot.seller.street) <
        footer.indexOf(
          `${snapshot.seller.postal_code} ${snapshot.seller.city}`,
        ),
      "The postal address follows the owner line in address order.",
    );
  }
  assert.ok((text.match(/Beschreibung/g) || []).length >= pages - 1);
  assert.match(text, /ENTWURF/);
  assert.match(text, /100,005/);
  assert.match(text, /Reverse Charge/);
  assert.match(text, /DE987654321/);
  assert.match(text, /\bStück\b/);
  assert.match(text, /\bStunde\b/);
  assert.doesNotMatch(text, /\b(?:C62|HUR)\b/);
  assert.equal((text.match(/QA-Volltextmarker/g) || []).length, 80);
});

test("PDF text follows the frozen document language instead of the UI locale", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "pitchary-pdf-en-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshot = invoiceSnapshot();
  snapshot.language = "en";
  for (const item of snapshot.items) item.unit = "C62";
  snapshot.seller.street = "";
  snapshot.seller.postal_code = "";
  snapshot.seller.city = "";
  snapshot.seller.country_code = "";
  snapshot.seller.billing_address =
    "Fictional Postal Lane 7\n12345 Exampletown\nDE";
  snapshot.contact = {
    name: "Alex Fictional Contact",
    email: "contact@example.test",
  };
  const file = path.join(directory, "invoice.pdf");
  await writeFile(file, await renderInvoicePDF(snapshot));
  const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
  assert.match(text, /Invoice number/);
  assert.match(text, /Alex Fictional Contact/);
  assert.match(text, /Page 1 of 1/);
  assert.match(text, /^Contact$/m);
  assert.match(text, /^Bank details$/m);
  assert.match(text, /\bItem\b/);
  assert.doesNotMatch(text, /\b(?:C62|HUR)\b/);
  assert.ok(snapshot.items.every((item) => item.unit === "C62"));
  const ownerOffset = text.lastIndexOf(snapshot.seller.additional_name);
  assert.ok(ownerOffset >= 0);
  const footer = text.slice(ownerOffset);
  assert.match(footer, /Fictional Postal Lane 7\s+12345 Exampletown\s+DE\b/);
  assert.ok(
    footer.indexOf("12345 Exampletown") <
      footer.indexOf(snapshot.seller.vat_id),
    "The legacy multiline address remains below the owner and above tax data.",
  );
  assert.equal(xrechnungProfile.syntax, "UBL 2.1");
});
