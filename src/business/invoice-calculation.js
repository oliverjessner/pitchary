import { choice, invalid, text } from "./validation.js";

// Quantities: six decimals; net unit prices: four decimals. Each line is
// rounded half-up to the currency's minor unit, then VAT is rounded half-up
// once per category/rate/reason group. No binary floating point enters a sum.
const LIMIT = 1_000_000_000_000n;
const decimal = (value, field, precision, { positive = false } = {}) => {
  const string = String(value ?? "").trim();
  if (!new RegExp(`^\\d{1,12}(?:\\.\\d{1,${precision}})?$`).test(string))
    invalid("Bitte eine gültige positive Dezimalzahl angeben.", field);
  const [whole, fraction = ""] = string.split(".");
  const integer =
    BigInt(whole) * 10n ** BigInt(precision) +
    BigInt(fraction.padEnd(precision, "0"));
  if (positive && integer === 0n)
    invalid("Die Menge muss größer als null sein.", field);
  return { value: integer, text: string.replace(/^0+(?=\d)/, "") };
};
const rounded = (numerator, denominator) =>
  (numerator + denominator / 2n) / denominator;
const bounded = (value, field) => {
  if (value > LIMIT)
    invalid("Rechnungsbetrag überschreitet die zulässige Grenze.", field);
  return Number(value);
};

export function calculateInvoice(input) {
  const source = Array.isArray(input) ? input : input?.items;
  if (!Array.isArray(source) || !source.length || source.length > 500)
    invalid(
      "Bitte zwischen einer und 500 Rechnungspositionen angeben.",
      "items",
    );
  const groups = new Map();
  const items = source.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      invalid("Ungültige Rechnungsposition.", "items");
    const field = `items.${index}`;
    const quantity = decimal(item.quantity ?? "1", `${field}.quantity`, 6, {
      positive: true,
    });
    const price = decimal(item.unit_price ?? "0", `${field}.unit_price`, 4);
    const category = choice(
      item.tax_category ?? "S",
      ["S", "AE", "E"],
      `${field}.tax_category`,
    );
    const rate = decimal(
      item.tax_rate ?? (category === "S" ? "20" : "0"),
      `${field}.tax_rate`,
      2,
    );
    if (
      rate.value > 10000n ||
      (category === "S" ? rate.value === 0n : rate.value !== 0n)
    )
      invalid(
        "Steuerkategorie und Steuersatz passen nicht zusammen.",
        `${field}.tax_rate`,
      );
    const reason = text(item.tax_reason ?? "", `${field}.tax_reason`, {
      max: 1000,
    });
    if (category === "E" && !reason)
      invalid(
        "Bitte einen Grund für die Steuerbefreiung angeben.",
        `${field}.tax_reason`,
      );
    const net = rounded(quantity.value * price.value, 100_000_000n);
    const netMinor = bounded(net, field);
    const taxReason = category === "AE" && !reason ? "Reverse Charge" : reason;
    const key = `${category}|${rate.value}`;
    if (groups.has(key) && groups.get(key).tax_reason !== taxReason)
      invalid(
        "Positionen derselben Steuerkategorie und desselben Steuersatzes benötigen denselben Steuergrund.",
        `${field}.tax_reason`,
      );
    const group = groups.get(key) ?? {
      tax_category: category,
      tax_rate: rate.text,
      tax_reason: taxReason,
      net: 0n,
      rate: rate.value,
    };
    group.net += net;
    groups.set(key, group);
    return {
      position: index + 1,
      name: text(item.name ?? "", `${field}.name`, {
        required: true,
        max: 500,
      }),
      description: text(item.description ?? "", `${field}.description`, {
        max: 10000,
      }),
      quantity: quantity.text,
      unit: choice(
        item.unit ?? "C62",
        ["C62", "HUR", "DAY", "MON", "ANN", "KGM", "MTR", "LTR", "LS"],
        `${field}.unit`,
      ),
      unit_price: price.text,
      tax_category: category,
      tax_rate: rate.text,
      tax_reason: taxReason,
      customer_service_id: item.customer_service_id || null,
      price_source: item.price_source ?? null,
      net_amount_minor: netMinor,
    };
  });
  let net = 0n,
    tax = 0n;
  const tax_breakdown = [...groups.values()].map((group) => {
    const amount = rounded(group.net * group.rate, 10000n);
    net += group.net;
    tax += amount;
    return {
      tax_category: group.tax_category,
      tax_rate: group.tax_rate,
      tax_reason: group.tax_reason,
      net_amount_minor: bounded(group.net, "items"),
      tax_amount_minor: bounded(amount, "items"),
    };
  });
  return {
    items,
    totals: {
      net_amount_minor: bounded(net, "items"),
      tax_amount_minor: bounded(tax, "items"),
      total_amount_minor: bounded(net + tax, "items"),
      tax_breakdown,
    },
  };
}
