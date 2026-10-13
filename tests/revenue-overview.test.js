import { test } from "node:test";
import assert from "node:assert/strict";
import { revenueOverview } from "../src/business/revenue-overview.js";
import { buildApp } from "../src/server/app.js";

const invoice = (
  name,
  amount,
  currency = "EUR",
  category = "revenue",
  invoice_date = "2026-10-01",
) => ({
  counterparty_name: name,
  total_amount_minor: amount,
  currency,
  category,
  invoice_date,
});

test("nominal rankings merge currencies by counterparty, order globally and return at most four", () => {
  const rows = [
    invoice("Alpha", 4000),
    invoice("ALPHA", 6000, "USD"),
    invoice("Alpha", -500),
    invoice("Beta", 9500, "USD"),
    invoice("Gamma", 9000),
    invoice("Delta", 8500, "GBP"),
    invoice("Epsilon", 8000),
    invoice("Zeta", 7000, "USD"),
    invoice("Alpha", 2300, "EUR", "revenue", "2025-01-01"),
    invoice("Undated", 500, "EUR", "revenue", null),
    invoice("Supplier A", 5000, "EUR", "payable"),
    invoice("Supplier A", 8000, "USD", "payable"),
    invoice("Supplier B", 11000, "USD", "payable"),
    invoice("Supplier C", 9500, "EUR", "payable"),
    invoice("Supplier D", 9000, "EUR", "payable"),
    invoice("Supplier E", 8000, "EUR", "payable"),
  ];
  const before = structuredClone(rows);
  const result = revenueOverview(rows, "2026");
  assert.deepEqual(
    result.top_revenue.map((row) => row.name),
    ["Alpha", "Beta", "Gamma", "Delta"],
  );
  assert.equal(result.top_revenue[0].total_amount_minor, 9500);
  assert.deepEqual(result.top_revenue[0].amounts, [
    { currency: "EUR", total_amount_minor: 3500 },
    { currency: "USD", total_amount_minor: 6000 },
  ]);
  assert.deepEqual(
    result.top_payable.map((row) => row.name),
    ["Supplier A", "Supplier B", "Supplier C", "Supplier D"],
  );
  assert.equal(result.top_payable[0].total_amount_minor, 13000);
  assert.equal(result.overall_revenue.total_amount_minor, 54300);
  assert.equal(result.overall_revenue.invoice_count, 10);
  assert.deepEqual(result.overall_revenue.amounts, [
    { currency: "EUR", total_amount_minor: 23300 },
    { currency: "GBP", total_amount_minor: 8500 },
    { currency: "USD", total_amount_minor: 22500 },
  ]);
  assert.deepEqual(result.years, ["2026", "2025"]);
  assert.equal(
    revenueOverview(rows, "2025").overall_revenue.total_amount_minor,
    54300,
  );
  assert.deepEqual(rows, before);
});

test("nominal overview rejects invalid years and unsafe sums and supports an empty history", () => {
  assert.deepEqual(revenueOverview([], "2026").overall_revenue, {
    total_amount_minor: 0,
    invoice_count: 0,
    amounts: [],
  });
  assert.throws(
    () => revenueOverview([], "invalid"),
    (error) => error.status === 422,
  );
  assert.throws(
    () =>
      revenueOverview(
        [invoice("A", Number.MAX_SAFE_INTEGER), invoice("A", 1)],
        "2026",
      ),
    (error) => error.status === 422,
  );
});

test("revenue overview API uses effective invoice corrections and preserves original currencies and money", async (t) => {
  const app = await buildApp({ databasePath: ":memory:" });
  t.after(() => app.close());
  const customer = app.crm.createEntity("customers", {
    name: "Combined customer",
  });
  const eur = app.finance.record({
    counterparty_name: customer.name,
    total_amount_minor: 10000,
    currency: "EUR",
    invoice_date: "2026-01-01",
  });
  const usd = app.finance.record({
    counterparty_name: customer.name,
    total_amount_minor: 5000,
    currency: "USD",
    invoice_date: "2026-01-01",
  });
  app.finance.update(usd.id, { total_amount_minor: 7500 });
  const previous = app.finance.record({
    counterparty_name: customer.name,
    total_amount_minor: 3000,
    currency: "EUR",
    invoice_date: "2025-01-01",
  });
  const response = await app.inject("/api/finance/revenue-overview?year=2026");
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().overall_revenue.total_amount_minor, 20500);
  assert.equal(response.json().top_revenue.length, 1);
  assert.equal(response.json().top_revenue[0].total_amount_minor, 17500);
  assert.equal(response.json().top_revenue[0].customer_id, customer.id);
  assert.equal(app.finance.get(eur.id).total_amount_minor, 10000);
  assert.equal(app.finance.get(usd.id).currency, "USD");
  assert.equal(app.finance.get(usd.id).original.total_amount_minor, 5000);
  assert.equal(app.finance.get(previous.id).invoice_date, "2025-01-01");
  assert.equal(
    (await app.inject("/api/finance/revenue-overview?year=bad")).statusCode,
    422,
  );
});
