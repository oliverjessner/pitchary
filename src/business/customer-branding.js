import { allowedKeys, invalid, text } from "./validation.js";
export const maxLogoBytes = 1048576;
export function website(value, field = "website") {
  const input = text(value, field, { max: 2048 });
  if (!input) return "";
  let url;
  try {
    url = new URL(input);
  } catch {
    invalid(
      "Bitte eine vollständige Website-Adresse eingeben, z. B. https://example.com.",
      field,
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !url.hostname
  )
    invalid(
      "Websites müssen HTTP oder HTTPS verwenden und dürfen keine Zugangsdaten enthalten.",
      field,
    );
  if (url.href.length > 2048)
    invalid("Die Website-Adresse ist zu lang.", field);
  return url.href;
}
export function logo(input) {
  if (input === null) return { logo_data: null, logo_mime: null };
  if (!input || typeof input !== "object" || Array.isArray(input))
    invalid("Ungültige Logo-Datei.", "logo");
  allowedKeys(input, ["mime_type", "data_base64"]);
  if (!["image/png", "image/jpeg", "image/webp"].includes(input.mime_type))
    invalid("Bitte ein PNG-, JPEG- oder WebP-Logo auswählen.", "logo");
  const encoded = input.data_base64;
  if (
    typeof encoded !== "string" ||
    encoded.length > Math.ceil(maxLogoBytes / 3) * 4 ||
    !encoded.length ||
    encoded.length % 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  )
    invalid("Ungültige Logo-Daten oder Logo größer als 1 MiB.", "logo");
  const bytes = Buffer.from(encoded, "base64");
  if (
    !bytes.length ||
    bytes.length > maxLogoBytes ||
    bytes.toString("base64") !== encoded
  )
    invalid("Ungültige Logo-Daten oder Logo größer als 1 MiB.", "logo");
  const png =
    bytes.length >= 45 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString("ascii", bytes.length - 8, bytes.length - 4) === "IEND";
  const jpeg =
    bytes.length >= 20 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes[bytes.length - 2] === 255 &&
    bytes[bytes.length - 1] === 217;
  const webp =
    bytes.length >= 20 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    bytes.readUInt32LE(4) === bytes.length - 8 &&
    ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16));
  if (
    !{ "image/png": png, "image/jpeg": jpeg, "image/webp": webp }[
      input.mime_type
    ]
  )
    invalid(
      "Der Dateiinhalt entspricht keinem unterstützten Logo-Format.",
      "logo",
    );
  return { logo_data: bytes, logo_mime: input.mime_type };
}
function logoUrl(id, hasLogo, updatedAt) {
  return hasLogo
    ? `/api/customers/${id}/logo?v=${encodeURIComponent(updatedAt)}`
    : null;
}
export function customerRecord(row) {
  return {
    ...row,
    has_logo: Boolean(row.has_logo),
    logo_url: logoUrl(row.id, row.has_logo, row.updated_at),
  };
}
export function relationshipRecord({
  customer_has_logo,
  customer_updated_at,
  ...row
}) {
  return {
    ...row,
    customer_logo_url: logoUrl(
      row.customer_id,
      customer_has_logo,
      customer_updated_at,
    ),
  };
}
