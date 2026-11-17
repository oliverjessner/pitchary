# Local invoice exports and validation

Invoice PDF and UBL XML consume the same frozen, server-calculated invoice snapshot. UI language changes do not change an issued document. The PDF uses PDFKit's locally supplied Helvetica metrics and embeds any uploaded PNG logo; no browser, internet service, API key or installed office suite is needed to generate it. Generated document bytes are persisted and downloads return those bytes.

Quantities retain up to six decimal places, net unit prices up to four, and VAT rates up to two. The shared calculation module uses scaled `BigInt` values. Line net amounts are rounded half up to cents. VAT is rounded half up once per category/rate subtotal. PDF, UBL monetary totals and finance records all use these calculated integer cents. The PDF prints unit prices with up to four decimals; invoice totals always have two.

## Pinned XRechnung components

The implemented profile is **XRechnung 3.0.2, UBL 2.1**, using the official **2026-08-31** validator configuration and **KoSIT Validator 1.6.3**. The official version overview still lists XRechnung 3.0 as the active standard on 2026-11-16; XRechnung 4.0 is a preview, so it is not selected.

- [Official versions and bundles](https://xeinkauf.de/xrechnung/versionen-und-bundles/).
- [Pinned validator configuration release](https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/tag/v2026-08-31).
- [Official validator usage](https://github.com/itplr-kosit/validator-configuration-xrechnung/blob/v2026-08-31/docs/usage.md).
- [KoSIT Validator 1.6.3](https://github.com/itplr-kosit/validator/releases/tag/v1.6.3).

`vendor/xrechnung/` contains the original configuration, UBL XSDs, compiled EN 16931 and XRechnung Schematron rules and the standalone validator JAR. `PITCHARY-MANIFEST.json` records the official download URLs, archive SHA-256 values and every vendored file digest. The application verifies these digests before first validation. Original upstream licenses and resource notices are retained.

The local application invokes the official Java validator, with temporary files in a private temporary directory, and removes them after validation. It requires the validator report to recommend acceptance; well-formed XML and a successful Java exit alone are insufficient. Validation runs the UBL schema, EN 16931 business rules and XRechnung rules. Missing runtime/resources and validation failures prevent issuance of an invoice with the XML option enabled. No application request downloads components or calls a remote validation service.

The desktop preparation script bundles a SHA-256 pinned Eclipse Temurin **21.0.13+9 JRE for macOS arm64**, matching the supported desktop target. Its license and legal directories travel with the runtime. The packaged application finds `runtime/java/Contents/Home/bin/java` automatically. Development and CLI use `java` on `PATH` (Java 11 or later); `PITCHARY_JAVA` can specify an absolute executable for an isolated environment.

## Reproducible checks

```sh
npm run invoice:validate -- path/to/invoice.xml
# Optionally preserve the actual KoSIT XML report in a new file:
npm run invoice:validate -- path/to/invoice.xml path/to/new-report.xml
node --test tests/invoice-exports.test.js
```

Equivalent upstream command:

```sh
java -jar vendor/xrechnung/validator-1.6.3-standalone.jar \
  -s vendor/xrechnung/scenarios.xml -r vendor/xrechnung \
  -o /path/to/report-directory /path/to/invoice.xml
```

The regression tests submit standard VAT, reverse charge and explicitly selected tax exemption to the official validator. They also submit a well-formed invoice with inconsistent tax totals and require rejection. The generated fixtures contain exclusively fictional businesses, `example.test` contacts, and a generated checksum-valid IBAN with a nonexistent all-zero bank identifier. PDF tests use Poppler `pdfinfo` and `pdftotext` to check A4 pages, repeated table headers, complete descriptions, page totals, frozen document language, draft markings and footer repetition. Visual acceptance additionally renders short and many-position PDFs with `pdftoppm` and inspects the resulting PNGs.

## Supported tax treatments and identifiers

- `S`: selected positive VAT rate. Seller VAT ID or tax registration ID is required for XML.
- `AE`: reverse charge, zero VAT amount, explicit reverse-charge reason, and seller/buyer VAT IDs.
- `E`: explicitly chosen exemption or small-business treatment, zero VAT amount, explicit exemption reason.

Zero percent alone never selects a treatment. Invoice lines and category/rate tax subtotals retain their explicit category and reason. The XRechnung option additionally requires structured party addresses and country codes, the real buyer reference BT-10, seller/buyer electronic endpoints with schemes, seller contact details and payment account. An email endpoint commonly uses scheme `EM`; a buyer reference is not manufactured from a UUID or automatically treated as a Leitweg-ID. The official validator remains authoritative for code-list and profile rules.

PDF-only invoices do not require these XML-only fields. Such an issued invoice has no retrospective XML generation path using later customer/settings changes.
