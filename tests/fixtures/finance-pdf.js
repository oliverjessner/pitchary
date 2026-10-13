// A small, valid fictional invoice PDF; no personal financial data in fixtures.
export function invoicePDF(number = "QA-2026-001") {
  const lines = [
    "INVOICE " + number,
    "Customer: Example Studio",
    "Invoice date: 2026-10-01",
    "Due date: 2026-10-15",
    "Net: EUR 100.00",
    "Tax: EUR 20.00",
    "Total: EUR 120.00",
  ];
  const stream =
    "BT /F1 18 Tf 50 780 Td " +
    lines
      .map(
        (line, index) =>
          `${index ? "0 -30 Td " : ""}(${line.replace(/[()\\]/g, "\\$&")}) Tj`,
      )
      .join("\n") +
    " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
