import { readFile, writeFile } from "node:fs/promises";
import { validateInvoiceXML } from "../src/business/invoice-validation.js";

const [filename, report] = process.argv.slice(2);
if (!filename)
  throw new Error(
    "Usage: npm run invoice:validate -- INVOICE.xml [REPORT.xml]",
  );
try {
  const result = await validateInvoiceXML(await readFile(filename));
  if (report)
    await writeFile(report, result.report_xml, { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        valid: result.valid,
        profile: result.profile,
        checked_at: result.checked_at,
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
