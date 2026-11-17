import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateInvoice } from "../src/business/invoice-calculation.js";

test("invoice decimal arithmetic rounds net lines and category VAT half-up without floating point", () => {
  const result = calculateInvoice({
    items: [
      {
        name: "Fraction A",
        quantity: "0.1",
        unit_price: "0.15",
        tax_category: "S",
        tax_rate: "20",
      },
      {
        name: "Fraction B",
        quantity: "0.1",
        unit_price: "0.15",
        tax_category: "S",
        tax_rate: "20",
      },
      {
        name: "Time",
        quantity: "1.234567",
        unit_price: "123.4567",
        tax_category: "S",
        tax_rate: "20",
      },
    ],
  });
  assert.deepEqual(
    result.items.map((row) => row.net_amount_minor),
    [2, 2, 15242],
  );
  assert.deepEqual(result.totals, {
    net_amount_minor: 15246,
    tax_amount_minor: 3049,
    total_amount_minor: 18295,
    tax_breakdown: [
      {
        tax_category: "S",
        tax_rate: "20",
        tax_reason: "",
        net_amount_minor: 15246,
        tax_amount_minor: 3049,
      },
    ],
  });
});

test("invoice VAT categories retain their explicit reasons and cannot masquerade as 0 percent standard VAT", () => {
  const result = calculateInvoice({
    items: [
      {
        name: "Reverse charge",
        quantity: "1",
        unit_price: "10",
        tax_category: "AE",
        tax_rate: "0",
      },
      {
        name: "Exempt",
        quantity: "1",
        unit_price: "20",
        tax_category: "E",
        tax_rate: "0",
        tax_reason: "Fictional exemption reason",
      },
    ],
  });
  assert.equal(result.totals.total_amount_minor, 3000);
  assert.equal(result.totals.tax_breakdown.length, 2);
  assert.equal(result.items[0].tax_reason, "Reverse Charge");
  for (const item of [
    { name: "Zero standard", tax_category: "S", tax_rate: "0" },
    { name: "Taxed reverse", tax_category: "AE", tax_rate: "20" },
    { name: "Unexplained exemption", tax_category: "E", tax_rate: "0" },
    { name: "Zero quantity", quantity: "0" },
    { name: "Huge", quantity: "100000000000", unit_price: "100000000000" },
    { name: "Invalid decimals", quantity: "1.0000001" },
    { name: "Negative", unit_price: "-1" },
  ])
    assert.throws(
      () => calculateInvoice({ items: [item] }),
      (error) => error.status === 422,
    );
  assert.throws(
    () =>
      calculateInvoice({
        items: [
          {
            name: "Exempt one",
            tax_category: "E",
            tax_rate: "0",
            tax_reason: "Reason A",
          },
          {
            name: "Exempt two",
            tax_category: "E",
            tax_rate: "0",
            tax_reason: "Reason B",
          },
        ],
      }),
    /Steuergrund/,
  );
});
