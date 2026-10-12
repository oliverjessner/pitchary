export const statuses = [
  "open",
  "pitched",
  "ghosted",
  "accepted",
  "done",
  "rejected",
];
export const channels = ["linkedin", "email", "phone", "meeting", "other"];
export const billingTypes = [
  "one_time",
  "monthly",
  "yearly",
  "hourly",
  "daily",
];
export const currencies = ["EUR", "USD", "GBP"];
export const rejectionCodes = [
  "budget",
  "timing",
  "competitor",
  "no_need",
  "no_response",
  "other",
];
export class AppError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
export function invalid(message, field) {
  throw new AppError(
    422,
    "validation_error",
    message,
    field ? { [field]: message } : undefined,
  );
}
export function text(value, field, { required = false, max = 10000 } = {}) {
  if (typeof value !== "string") invalid(`${field}: Text erwartet.`, field);
  const result = value.trim();
  if (result.length > max || (required && !result))
    invalid(`${field}: Bitte einen gültigen Wert eingeben.`, field);
  return result;
}
export function choice(value, choices, field) {
  if (!choices.includes(value)) invalid(`${field}: Ungültige Auswahl.`, field);
  return value;
}
export function money(value, field, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000000)
    invalid(
      `${field}: Betrag muss in ganzen Cent vorliegen (0 bis 1.000.000.000.000).`,
      field,
    );
  return value;
}
export function uuid(value, field) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    invalid(`${field}: UUID erwartet.`, field);
  return value;
}
export function dateTime(value, now, earliest, field = "occurred_at") {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    invalid("Ungültiger Zeitpunkt.", field);
  const calendarDate = value.slice(0, 10);
  if (
    new Date(calendarDate + "T00:00:00.000Z").toISOString().slice(0, 10) !==
    calendarDate
  )
    invalid("Ungültiger Kalendertag.", field);
  const normalized = new Date(value).toISOString();
  if (normalized > now || (earliest && normalized < earliest))
    invalid(
      "Zeitpunkt muss nach dem bisherigen Verlauf und spätestens jetzt liegen.",
      field,
    );
  return normalized;
}
export function filterInput(filters = {}) {
  const out = {};
  for (const key of ["customer_id", "service_id"])
    if (filters[key]) out[key] = uuid(filters[key], key);
  if (filters.pitch_channel)
    out.pitch_channel = choice(
      filters.pitch_channel,
      channels,
      "pitch_channel",
    );
  if (filters.status) out.status = choice(filters.status, statuses, "status");
  for (const key of ["from", "to"])
    if (filters[key]) {
      const v = filters[key];
      if (
        !/^\d{4}-\d\d-\d\d$/.test(v) ||
        !Number.isFinite(Date.parse(v)) ||
        new Date(v).toISOString().slice(0, 10) !== v
      )
        invalid("Ungültiges Filterdatum.", key);
      out[key] = v;
    }
  if (out.from && out.to && out.from > out.to)
    invalid("Startdatum muss vor dem Enddatum liegen.", "from");
  if (filters.archived !== undefined)
    out.archived = filters.archived === true || filters.archived === "true";
  return out;
}
export function allowedKeys(input, allowed) {
  for (const key of Object.keys(input))
    if (!allowed.includes(key))
      invalid(`Feld ${key} ist hier nicht änderbar.`, key);
}
