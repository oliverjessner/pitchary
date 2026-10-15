import { createHash } from "node:crypto";
import { buildApp } from "../src/server/app.js";
import { seedDemo } from "./seed.js";

export const screenshotTime = "2026-10-15T10:00:00.000Z";

function invoicePDF(number, company, amount) {
  const text = `Invoice ${number} - ${company} - EUR ${(amount / 100).toFixed(2)}`;
  const stream = `BT /F1 16 Tf 50 780 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export async function createScreenshotApp() {
  // Always create a new in-memory database. Never inherit DATABASE_PATH,
  // desktop app data, stored API keys, watched folders or a running server.
  const app = await buildApp({
    databasePath: ":memory:",
    clock: () => screenshotTime,
    financeOptions: { watchEnabled: false },
    customerLogoOptions: { discover: async () => null },
  });
  try {
    seedDemo(app.database);
    await app.financeSettings.save({
      company_name: "Feld & Form Studio",
      company_email: "office@feld-form.example",
      company_address: "Beispielgasse 12, 1010 Wien",
    });
    const customers = app.crm.listEntities("customers");
    let sequence = 0;
    for (let month = 4; month <= 10; month++) {
      const period = `2026-${String(month).padStart(2, "0")}`;
      for (const [company, category, amount, tag, day] of [
        ["Studio Nord", "revenue", 180000 + month * 12000, null, "02"],
        ["Morgenwerk", "revenue", 110000 + month * 9000, null, "08"],
        ["Wolkenpost", "payable", 7500, "SaaS", "03"],
        ["Werkraum", "payable", 42000, "Rent", "09"],
      ]) {
        const number = `${category === "revenue" ? "RE" : "AU"}-${period}-${++sequence}`;
        const pdf = invoicePDF(number, company, amount);
        const paid = month < 10;
        app.finance.record({
          id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
          category,
          invoice_number: number,
          invoice_date: `${period}-${day}`,
          due_date: `${period}-${day === "02" || day === "03" ? "12" : "28"}`,
          counterparty_name: company,
          customer_id:
            customers.find((customer) => customer.name === company)?.id ?? null,
          total_amount_minor: amount,
          net_amount_minor: Math.round(amount / 1.2),
          tax_amount_minor: amount - Math.round(amount / 1.2),
          currency: "EUR",
          status: paid ? "paid" : "open",
          paid_at: paid ? `${period}-15` : null,
          tags: tag ? [tag] : [],
          file_name: `${number}.pdf`,
          pdf_data: pdf,
          file_hash: createHash("sha256").update(pdf).digest("hex"),
          ingestion_status: "processed",
          created_at: `${period}-${day}T09:00:00.000Z`,
          updated_at: `${period}-${day}T09:00:00.000Z`,
        });
      }
    }
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
