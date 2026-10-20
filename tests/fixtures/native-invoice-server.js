import { randomBytes } from "node:crypto";
import { buildApp } from "../../src/server/app.js";
import { invoicePDF } from "./finance-pdf.js";

// Isolated authenticated backend for the real WKWebView regression test.
const token = randomBytes(32).toString("hex");
const app = await buildApp({
  databasePath: ":memory:",
  desktopToken: token,
  financeOptions: { watchEnabled: false },
  customerLogoOptions: { discover: async () => null },
});
for (const category of ["revenue", "payable"])
  app.finance.record({
    category,
    invoice_number: "NATIVE-" + category,
    invoice_date: "2026-10-01",
    counterparty_name: "Native PDF Test",
    file_name: "Testrechnung ä " + category + ".pdf",
    pdf_data: invoicePDF("NATIVE-" + category),
    ingestion_status: "processed",
    total_amount_minor: 12000,
    currency: "EUR",
  });
let closing;
function stop() {
  closing ??= app.close().then(() => process.exit(0));
  return closing;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
process.stdin.on("end", stop);
process.stdin.on("data", stop);
process.stdin.resume();
const address = await app.listen({ host: "127.0.0.1", port: 0 });
process.stdout.write(
  JSON.stringify({ url: `${address}/?desktop_token=${token}` }) + "\n",
);
