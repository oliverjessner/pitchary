import { invalid } from "./validation.js";

export const xrechnungProfile = Object.freeze({
  version: "3.0.2",
  syntax: "UBL 2.1",
  configuration: "2026-08-31",
  validator: "1.6.3",
  customization_id:
    "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
  process_id: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
});

const escape = (value) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const tag = (name, value, attributes = "") =>
  `<${name}${attributes}>${escape(value)}</${name}>`;
const optional = (name, value) => (value ? tag(name, value) : "");
const money = (minor) =>
  `${Math.trunc(minor / 100)}.${String(Math.abs(minor % 100)).padStart(2, "0")}`;

export function validateInvoiceXMLFields(snapshot) {
  const required = (value, field, label) => {
    if (typeof value !== "string" || !value.trim())
      invalid(`E-Rechnung: ${label} fehlt.`, field);
  };
  required(snapshot.invoice_number, "invoice_number", "Rechnungsnummer");
  required(
    snapshot.buyer_reference || snapshot.recipient.buyer_reference,
    "buyer_reference",
    "Käuferreferenz (BT-10)",
  );
  for (const [kind, party] of [
    ["seller", snapshot.seller],
    ["recipient", snapshot.recipient],
  ]) {
    for (const [field, label] of [
      ["name", "Name"],
      ["street", "Straße"],
      ["postal_code", "Postleitzahl"],
      ["city", "Ort"],
      ["country_code", "Länderkennung"],
      ["endpoint_id", "elektronische Adresse"],
      ["endpoint_scheme", "Adress-Scheme"],
    ])
      required(party[field], `${kind}.${field}`, label);
    if (!/^[A-Z]{2}$/.test(party.country_code))
      invalid("E-Rechnung: Ungültige Länderkennung.", `${kind}.country_code`);
    if (!/^[A-Z0-9]{2,4}$/.test(party.endpoint_scheme))
      invalid(
        "E-Rechnung: Ungültiges Adress-Scheme.",
        `${kind}.endpoint_scheme`,
      );
  }
  for (const [field, label] of [
    ["contact_name", "Verkäuferkontakt"],
    ["email", "Kontakt-E-Mail"],
    ["phone", "Kontakttelefon"],
  ])
    required(snapshot.seller[field], `seller.${field}`, label);
  required(snapshot.bank.iban, "bank.iban", "IBAN");
  if (snapshot.items.some((item) => item.tax_category === "AE")) {
    required(snapshot.seller.vat_id, "seller.vat_id", "eigene UID/USt-IdNr.");
    required(
      snapshot.recipient.vat_id,
      "recipient.vat_id",
      "UID/USt-IdNr. des Kunden",
    );
  }
  if (
    snapshot.items.some((item) => item.tax_category === "S") &&
    !snapshot.seller.vat_id &&
    !snapshot.seller.tax_id
  )
    invalid(
      "E-Rechnung: Eigene UID/USt-IdNr. oder Steuerkennung fehlt.",
      "seller.vat_id",
    );
  for (const item of snapshot.items)
    if (["AE", "E"].includes(item.tax_category) && !item.tax_reason?.trim())
      invalid("E-Rechnung: Steuergrund fehlt.", "items.tax_reason");
}

function partyXML(party, supplier) {
  const address = `<cac:PostalAddress>${tag("cbc:StreetName", party.street)}${tag("cbc:CityName", party.city)}${tag("cbc:PostalZone", party.postal_code)}<cac:Country>${tag("cbc:IdentificationCode", party.country_code)}</cac:Country></cac:PostalAddress>`;
  const tax = (value, scheme) =>
    value
      ? `<cac:PartyTaxScheme>${tag("cbc:CompanyID", value)}<cac:TaxScheme>${tag("cbc:ID", scheme)}</cac:TaxScheme></cac:PartyTaxScheme>`
      : "";
  return `<cac:Party>${tag("cbc:EndpointID", party.endpoint_id, ` schemeID="${escape(party.endpoint_scheme)}"`)}${party.additional_name ? `<cac:PartyName>${tag("cbc:Name", party.additional_name)}</cac:PartyName>` : ""}${address}${tax(party.vat_id, "VAT")}${supplier ? tax(party.tax_id, "FC") : ""}<cac:PartyLegalEntity>${tag("cbc:RegistrationName", party.name)}</cac:PartyLegalEntity>${supplier ? `<cac:Contact>${tag("cbc:Name", party.contact_name)}${tag("cbc:Telephone", party.phone)}${tag("cbc:ElectronicMail", party.email)}</cac:Contact>` : ""}</cac:Party>`;
}

export function createInvoiceXML(snapshot) {
  validateInvoiceXMLFields(snapshot);
  const s = snapshot,
    currency = ` currencyID="${escape(s.currency)}"`;
  const amount = (name, value) => tag(name, money(value), currency);
  const periodStart = s.service_date || s.service_period_start;
  const periodEnd = s.service_date || s.service_period_end;
  const taxCategory = (row, includeReason = false) =>
    `${tag("cbc:ID", row.tax_category)}${tag("cbc:Percent", row.tax_rate)}${includeReason ? optional("cbc:TaxExemptionReason", row.tax_reason) : ""}<cac:TaxScheme>${tag("cbc:ID", "VAT")}</cac:TaxScheme>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
${tag("cbc:UBLVersionID", "2.1")}${tag("cbc:CustomizationID", xrechnungProfile.customization_id)}${tag("cbc:ProfileID", xrechnungProfile.process_id)}${tag("cbc:ID", s.invoice_number)}${tag("cbc:IssueDate", s.invoice_date)}${tag("cbc:DueDate", s.due_date)}${tag("cbc:InvoiceTypeCode", "380")}${optional("cbc:Note", [s.subject, s.note, s.tax_text].filter(Boolean).join("\n"))}${tag("cbc:DocumentCurrencyCode", s.currency)}${tag("cbc:BuyerReference", s.buyer_reference || s.recipient.buyer_reference)}
${periodStart ? `<cac:InvoicePeriod>${tag("cbc:StartDate", periodStart)}${tag("cbc:EndDate", periodEnd || periodStart)}</cac:InvoicePeriod>` : ""}
<cac:AccountingSupplierParty>${partyXML(s.seller, true)}</cac:AccountingSupplierParty><cac:AccountingCustomerParty>${partyXML(s.recipient, false)}</cac:AccountingCustomerParty>
<cac:PaymentMeans>${tag("cbc:PaymentMeansCode", "58")}${tag("cbc:PaymentID", s.invoice_number)}<cac:PayeeFinancialAccount>${tag("cbc:ID", s.bank.iban.replace(/\s/g, ""))}${optional("cbc:Name", s.bank.account_holder)}${s.bank.bic ? `<cac:FinancialInstitutionBranch>${tag("cbc:ID", s.bank.bic)}</cac:FinancialInstitutionBranch>` : ""}</cac:PayeeFinancialAccount></cac:PaymentMeans>
${s.payment_text ? `<cac:PaymentTerms>${tag("cbc:Note", s.payment_text)}</cac:PaymentTerms>` : ""}
<cac:TaxTotal>${amount("cbc:TaxAmount", s.totals.tax_amount_minor)}${s.totals.tax_breakdown.map((row) => `<cac:TaxSubtotal>${amount("cbc:TaxableAmount", row.net_amount_minor)}${amount("cbc:TaxAmount", row.tax_amount_minor)}<cac:TaxCategory>${taxCategory(row, true)}</cac:TaxCategory></cac:TaxSubtotal>`).join("")}</cac:TaxTotal>
<cac:LegalMonetaryTotal>${amount("cbc:LineExtensionAmount", s.totals.net_amount_minor)}${amount("cbc:TaxExclusiveAmount", s.totals.net_amount_minor)}${amount("cbc:TaxInclusiveAmount", s.totals.total_amount_minor)}${amount("cbc:PayableAmount", s.totals.total_amount_minor)}</cac:LegalMonetaryTotal>
${s.items.map((item, index) => `<cac:InvoiceLine>${tag("cbc:ID", index + 1)}${tag("cbc:InvoicedQuantity", item.quantity, ` unitCode="${escape(item.unit)}"`)}${amount("cbc:LineExtensionAmount", item.net_amount_minor)}<cac:Item>${optional("cbc:Description", item.description)}${tag("cbc:Name", item.name)}<cac:ClassifiedTaxCategory>${taxCategory(item)}</cac:ClassifiedTaxCategory></cac:Item><cac:Price>${tag("cbc:PriceAmount", item.unit_price, currency)}</cac:Price></cac:InvoiceLine>`).join("\n")}
</Invoice>`;
  return Buffer.from(xml, "utf8");
}
