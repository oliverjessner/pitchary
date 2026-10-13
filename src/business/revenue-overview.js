import { invalid } from "./validation.js";

function total(left, right) {
  const result = left + right;
  if (!Number.isSafeInteger(result))
    invalid("Die Summe der Rechnungsbeträge ist zu groß.");
  return result;
}
const nameKey = (name) =>
  name.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("de-AT");
const empty = () => ({
  total_amount_minor: 0,
  invoice_count: 0,
  amounts: new Map(),
});
function add(group, invoice) {
  group.total_amount_minor = total(
    group.total_amount_minor,
    invoice.total_amount_minor,
  );
  group.invoice_count++;
  group.amounts.set(
    invoice.currency,
    total(group.amounts.get(invoice.currency) || 0, invoice.total_amount_minor),
  );
}
const result = ({ amounts, ...group }) => ({
  ...group,
  amounts: [...amounts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, total_amount_minor]) => ({
      currency,
      total_amount_minor,
    })),
});

export function revenueOverview(invoices, year) {
  if (!/^\d{4}$/.test(year) || Number(year) < 1)
    invalid("Ungültiges Jahr.", "year");
  const overall = empty(),
    groups = { revenue: new Map(), payable: new Map() };
  for (const invoice of invoices) {
    if (invoice.category === "revenue") add(overall, invoice);
    if (!invoice.invoice_date?.startsWith(year + "-")) continue;
    const name =
      invoice.customer_name || invoice.counterparty_name || "Unbekannt";
    const key = invoice.customer_id
      ? "customer:" + invoice.customer_id
      : "name:" + nameKey(name);
    const category = groups[invoice.category];
    if (!category.has(key))
      category.set(key, {
        ...empty(),
        customer_id: invoice.customer_id || null,
        name,
      });
    add(category.get(key), invoice);
  }
  const top = (category) =>
    [...groups[category].values()]
      .sort((left, right) =>
        left.total_amount_minor === right.total_amount_minor
          ? left.name.localeCompare(right.name, "de")
          : left.total_amount_minor > right.total_amount_minor
            ? -1
            : 1,
      )
      .slice(0, 4)
      .map(result);
  return {
    year,
    years: [
      ...new Set(
        invoices
          .map((invoice) => invoice.invoice_date?.slice(0, 4))
          .filter(Boolean),
      ),
    ]
      .sort()
      .reverse(),
    overall_revenue: result(overall),
    top_revenue: top("revenue"),
    top_payable: top("payable"),
  };
}
