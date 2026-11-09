import { getLocale } from "./i18n.js";

export function today() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat(getLocale(), {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(value + "T00:00:00.000Z"))
    : "–";
