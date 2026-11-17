import { invalid, text } from "./validation.js";

export const invoiceProfileFields = [
  "additional_name",
  "street",
  "postal_code",
  "city",
  "country_code",
  "vat_id",
  "tax_id",
  "customer_number",
  "invoice_email",
  "endpoint_id",
  "endpoint_scheme",
  "buyer_reference",
];
export const customerBillingFields = [
  "billing_address",
  "general_email",
  ...invoiceProfileFields,
];

export function customerBillingPatch(input, { creating = false } = {}) {
  const patch = {};
  for (const field of customerBillingFields) {
    if (!Object.hasOwn(input, field)) continue;
    const value = text(input[field] ?? "", field, {
      max:
        field === "billing_address"
          ? 10000
          : field === "customer_number"
            ? 100
            : 500,
    });
    if (field === "customer_number" && !value) {
      if (creating) continue;
      invalid("Bitte eine Kundennummer angeben.", field);
    }
    if (
      ["general_email", "invoice_email"].includes(field) &&
      value &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    )
      invalid("Ungültige E-Mail-Adresse.", field);
    if (field === "country_code" && value) {
      const code = value.toUpperCase();
      let valid =
        /^[A-Z]{2}$/.test(code) && !["ZZ", "EU", "UN", "XK"].includes(code);
      try {
        valid &&=
          new Intl.DisplayNames(["en"], {
            type: "region",
            fallback: "none",
          }).of(code) !== undefined;
      } catch {
        valid = false;
      }
      if (!valid) invalid("Bitte einen gültigen Ländercode angeben.", field);
      patch[field] = code;
    } else patch[field] = value;
  }
  return patch;
}

export function saveCustomerBilling(db, id, input, at, options) {
  const patch = customerBillingPatch(input, options);
  if (
    patch.customer_number &&
    db
      .prepare(
        "SELECT customer_id FROM finance_customer_profiles WHERE trim(customer_number)=? COLLATE NOCASE AND customer_id<>?",
      )
      .get(patch.customer_number, id)
  )
    invalid("Diese Kundennummer ist bereits vergeben.", "customer_number");
  if (!Object.keys(patch).length) return;
  db.prepare(
    "INSERT INTO finance_customer_profiles(customer_id,created_at,updated_at) VALUES(?,?,?) ON CONFLICT(customer_id) DO NOTHING",
  ).run(id, at, at);
  db.prepare(
    `UPDATE finance_customer_profiles SET ${Object.keys(patch)
      .map((field) => `${field}=?`)
      .join(",")},updated_at=? WHERE customer_id=?`,
  ).run(...Object.values(patch), at, id);
}
