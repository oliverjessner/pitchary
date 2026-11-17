# Invoice creation

Open **Invoices → Revenue → New invoice**, **Customer → Create invoice**, or **Offer → Create invoice**. Combine several accepted/completed offers for one customer and currency, or add free positions. Offer prices are suggestions for net unit prices: check quantities and the service period explicitly. Invoicing never advances the pipeline status.

Outgoing invoice creation uses local CRM/SQLite data throughout: drafts, calculations, numbering, previews, PDFs and XML never use OpenAI. Imported revenue PDFs are also read locally with text extraction/OCR and completed manually. Optional OpenAI recognition is restricted to imported payable expense invoices. Customer billing profiles are maintained manually; the former AI enrichment action is unavailable.

Before the first invoice, complete **Settings → Company**: company name, email, structured issuer address, country, tax identification and optionally a logo. The existing free-form company address remains available there. Under **Settings → Invoice creation**, configure bank details, payment terms, explicit tax treatment and number prefix/width/next counter. Each tab saves its own form. Edit the customer's billing address, tax/electronic details and customer number in the customer entry. Customer numbers are assigned automatically as `K-00001`, `K-00002`, etc.; they remain editable and must be unique. Existing nonempty customer numbers are preserved.

Selecting a customer fixes its recipient data in the invoice editor. Recipient name, billing address, customer number and electronic addresses are displayed read-only and are taken from the canonical customer/profile records by the backend. Edit the customer record to change these values. On wider screens, subject, document language and payment term share one row; invoice date, due date and currency share the next. Invoice positions group quantity, unit and net unit price in one row, followed by tax treatment, rate and reason. New invoices use only a service period with a start and end date; use the same date in both fields for a single day. Existing issued documents keep their original service-date representation and stored bytes.

The structured address is used consistently for display and export when a street is available. The preserved free-form address remains a fallback and can still be maintained on the customer record.

Drafts live outside `finance_invoices`. They consume no number, do not affect financial summaries and do not promote leads to customers. Save, reopen, preview or delete them in the revenue invoice list. Previews show a draft mark on each page; their number is a nonbinding preview.

## Finalization and persistence

Documents are generated before the synchronous SQLite commit. The commit checks the draft version, issuer and recipient data and number availability, inserts exactly one regular revenue invoice, freezes the snapshot and validation report, and advances the counter together. Concurrent number allocation retries; changed draft, customer or issuer content rejects a stale request. Repeating finalization returns the same document. Existing effective imported revenue numbers are skipped; payable numbering keeps its existing behavior.

Issued PDF/XML bytes are stored in SQLite and reused. The frozen snapshot includes issuer, recipient, contact, bank, logo, language, lines, tax groups, service dates and terms. Later CRM/settings changes never regenerate it. Existing editing, reset, deletion and reprocessing cannot change an authored issued invoice. Payment status and payment date remain editable. Imported invoices retain their correction workflow.

Multi-offer references live on `invoice_document_lines`; imported `customer_service_id` links still work. Filters find either reference without multiplying financial totals. Customer merge moves live ownership and drafts while keeping issued snapshot JSON and bytes. Offer deletion removes only its live reference. Importing a generated PDF hash returns the existing invoice, including when a different import category was selected. SQLite backup/restore includes drafts, profiles, number settings, logos, snapshots and both formats.

## Calculation and tax

The server is authoritative. The editor calls the same calculation used for storage, PDF and XML. Quantities support six decimal places, net unit prices four and tax rates two. Decimal strings become scaled `BigInt` values. Each line net amount rounds half-up to cents; VAT rounds half-up once per category/rate group. Totals add rounded minor-unit values. Conflicting reasons within a category/rate are rejected. EUR, USD and GBP use two minor-unit digits.

Supported categories: **S** (explicit positive VAT rate), **AE** (Reverse Charge, zero tax with both VAT IDs), **E** (explicit exemption/small-business reason). Zero percent never substitutes for a tax category. Treatment is not inferred from customer location.

## Structured invoices

The optional export is **XRechnung 3.0.2, UBL 2.1**, using the PDF's snapshot and number. Local KoSIT checks the official UBL schema, EN 16931 and XRechnung rules before issue. Selecting XML blocks finalization until required data and validation pass. A PDF-only invoice does not require XML-only fields and cannot later acquire XML from changed master data.

Enter the actual buyer reference (BT-10) and electronic buyer address and scheme on the customer record. The seller's electronic address defaults to the company email with scheme `EM`; the seller contact defaults to the owner/additional name, or the company name. Explicitly configured seller values remain in use. A buyer reference is not automatically a Leitweg-ID. Conformance is shown only after a successful stored validator assessment.

Pinned components, checksums, upstream notices and reproduction details are under [vendor/xrechnung](../vendor/xrechnung/). Desktop preparation bundles a pinned Java runtime for offline validation without an OpenAI key. Development uses local Java or `PITCHARY_JAVA`. A complete desktop build remains a separate packaging check.

## API

Existing local-only security and structured errors apply.

| Method               | Endpoint                                                            | Purpose                                           |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| GET                  | `/api/finance/creation/options?customer_id=…&customer_service_id=…` | Customers, contacts, eligible offers and defaults |
| GET / PATCH          | `/api/finance/creation/settings`                                    | Shared issuer data, logo and number preview       |
| GET / PATCH          | `/api/finance/creation/profiles/:id`                                | Customer's structured billing profile             |
| POST                 | `/api/finance/creation/calculate`                                   | Authoritative calculation of `items`              |
| GET / POST           | `/api/finance/creation/drafts`                                      | List or create drafts                             |
| GET / PATCH / DELETE | `/api/finance/creation/drafts/:id`                                  | Reopen, save or delete a draft                    |
| GET / POST           | `/api/finance/creation/drafts/:id/preview`                          | Marked draft PDF; no number consumed              |
| POST                 | `/api/finance/creation/drafts/:id/finalize`                         | Validate, render and atomically issue             |
| GET                  | `/api/finance/invoices/:id/file?download=1`                         | Stored final PDF                                  |
| GET                  | `/api/finance/invoices/:id/xml`                                     | Stored validated XML, if selected at issue        |

Draft updates/finalization accept `expected_version` to detect another editor's save. Issued records use the existing invoice, payment, dashboard, revenue and customer APIs.

## Checks

```sh
npm test
npm run test:ui
npm run format:check
```

Focused tests: `tests/invoice-{calculation,creation,exports,integration}.test.js`. Export tests execute KoSIT for all three tax cases, reject altered totals and block external entities. Integration tests exercise real PDF/XML issue, payment, duplicate import, merge, deletion and SQLite backup. Browser coverage exercises the editor and downloads. PDF checks use local Poppler and rendered short/multipage examples for visual inspection. Fixtures use fictitious identities and a generated test-only IBAN.
