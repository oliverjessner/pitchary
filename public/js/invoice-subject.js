import { localeFor, translate } from "./translate.js";

export function defaultInvoiceSubject(invoiceDate, language = "de") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate || "")) return "";
  const date = new Date(invoiceDate + "T12:00:00.000Z");
  if (!Number.isFinite(date.getTime())) return "";
  const month = new Intl.DateTimeFormat(localeFor(language), {
    month: "long",
    timeZone: "Europe/Vienna",
  }).format(date);
  return translate("{month} Rechnung {year}", language, {
    month,
    year: invoiceDate.slice(0, 4),
  });
}
