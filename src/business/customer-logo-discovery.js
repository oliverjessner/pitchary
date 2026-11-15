import { createExtractor } from "fetchary";
import { purgeUrl } from "linkary";
import sharp from "sharp";
import { extractIco, isIco, parseIco } from "@oliverj/tinyico";
import { createWebFetch } from "./web-fetch.js";
import { logo, maxLogoBytes } from "./customer-branding.js";
import { AppError } from "./validation.js";

const maxIconResponseBytes = 16 * 1024 * 1024;
const fetchary = createExtractor();
fetchary.configure({ maxResponseBytes: maxIconResponseBytes });

const personalDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "yahoo.de",
  "gmx.at",
  "gmx.de",
  "gmx.net",
  "web.de",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "t-online.de",
  "mail.com",
]);

function siteFor({ website, general_email }) {
  if (website) return new URL(purgeUrl(website).cleanUrl);
  const domain = general_email?.split("@").at(-1)?.toLowerCase();
  if (!domain || personalDomains.has(domain)) return null;
  return new URL("https://" + domain + "/");
}

function normalizeIcoPadding(bytes, count) {
  const directoryEnd = 6 + count * 16;
  if (directoryEnd > bytes.length) return bytes;
  let normalized;
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const size = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    if (size < 40 || offset < directoryEnd || offset + size > bytes.length)
      continue;
    const dib = bytes.subarray(offset, offset + size);
    if (
      dib.readUInt32LE(0) !== 40 ||
      dib.readUInt16LE(12) !== 1 ||
      dib.readUInt16LE(14) !== 32 ||
      dib.readUInt32LE(16) !== 0 ||
      dib.readUInt32LE(32) !== 0
    )
      continue;
    const width = dib.readInt32LE(4);
    const doubledHeight = dib.readInt32LE(8);
    if (
      width < 1 ||
      width > 256 ||
      doubledHeight < 2 ||
      doubledHeight > 512 ||
      doubledHeight % 2
    )
      continue;
    const height = doubledHeight / 2;
    const expectedSize = 40 + (width * 4 + Math.ceil(width / 32) * 4) * height;
    if (size <= expectedSize) continue;
    if (!dib.subarray(expectedSize).every((byte) => byte === 0)) continue;
    // Some ICO generators include extra zero padding in 32-bit DIB sizes.
    // Keep the pixels and offsets intact, then let Tinyico validate the result.
    normalized ??= Buffer.from(bytes);
    normalized.writeUInt32LE(expectedSize, entry + 8);
  }
  return normalized ?? bytes;
}

async function pngLogo(input) {
  let bytes = input;
  if (isIco(bytes)) {
    const count = bytes.readUInt16LE(4);
    if (count > 32) throw new Error("Invalid ICO.");
    bytes = normalizeIcoPadding(bytes, count);
    const image = [...parseIco(bytes).images].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0];
    bytes = extractIco(bytes, { index: image.index });
  }
  const text = bytes.toString("utf8");
  const resources = [
    ...Array.from(
      text.matchAll(/\b(?:href|xlink:href)\s*=\s*["']([^"']*)["']/gi),
      (match) => match[1],
    ),
    ...Array.from(
      text.matchAll(/url\(\s*(?:["']([^"']*)["']|([^)]*))\s*\)/gi),
      (match) => match[1] ?? match[2],
    ),
  ];
  if (
    /<svg\b/i.test(text) &&
    (/<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b/i.test(text) ||
      /@import\b/i.test(text) ||
      resources.some((value) => !/^(#|data:)/i.test(value.trim())))
  )
    throw new Error("SVG icons must not load external resources.");
  const image = await sharp(bytes, {
    limitInputPixels: 4 * 1024 * 1024,
    failOn: "error",
  })
    .rotate()
    .resize(256, 256, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  if (image.length > maxLogoBytes) throw new Error("Logo is too large.");
  const result = {
    mime_type: "image/png",
    data_base64: image.toString("base64"),
  };
  logo(result);
  return result;
}

export function createCustomerLogoDiscovery(
  crm,
  {
    fetchImpl,
    extractIcon = fetchary.extractFavicon,
    discover: suppliedDiscover,
  } = {},
) {
  const controller = new AbortController();
  async function discover(input) {
    const site = siteFor(input);
    if (!site) return null;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10000),
    ]);
    const fetchResource = createWebFetch({
      fetchImpl,
      signal,
      maxBytes: maxIconResponseBytes,
    });
    const images = new Map();
    let pageRequested = false;
    const result = await extractIcon(site.href, {
      mode: "http",
      // This local CRM supports intranet sites through its own HTTP transport.
      allowPrivateNetwork: true,
      timeout: 8000,
      userAgent: "Pitchary (customer logo lookup)",
      fetch: async (url, options) => {
        const isPage = !pageRequested;
        pageRequested = true;
        const response = await fetchResource(url, options);
        if (isPage || !response.ok) return response;
        const bytes = Buffer.from(await response.clone().arrayBuffer());
        if (/^\s*[\[{]/.test(bytes.toString("utf8"))) {
          // Manifests are interpreted by Fetchary, not as image candidates.
          response.headers.set("content-type", "application/json");
          return response;
        }
        // Reject unsafe or undecodable images before Fetchary ranks them.
        // Keep the converted logo so the chosen image needs no second download.
        images.set(response.url, await pngLogo(bytes));
        return response;
      },
    });
    signal.throwIfAborted();
    return images.get(result.image.url) ?? null;
  }
  return {
    discover: suppliedDiscover || discover,
    async enrich(id) {
      try {
        const before = crm.entity("customers", id);
        if (before.has_logo || before.archived_at) return before;
        const found = await (suppliedDiscover || discover)(before);
        const current = crm.entity("customers", id);
        if (
          found &&
          !current.has_logo &&
          !current.archived_at &&
          current.general_email === before.general_email &&
          current.website === before.website
        )
          return crm.updateEntity("customers", id, { logo: found });
        return current;
      } catch {
        // An unavailable website must not prevent saving a customer.
        return crm.entity("customers", id);
      }
    },
    async refetch(id) {
      const before = crm.entity("customers", id);
      if (before.archived_at)
        throw new AppError(
          409,
          "archived",
          "Archivierte Datensätze können nicht verändert werden.",
        );
      if (!siteFor(before) || controller.signal.aborted)
        return { record: before, refreshed: false };
      const previousImage = crm.repo.customerLogo(id);
      const previousBytes = previousImage.logo_data
        ? Buffer.from(previousImage.logo_data)
        : null;
      let found;
      try {
        found = await (suppliedDiscover || discover)(before);
        if (found) logo(found);
      } catch {
        // A failed refresh must retain the customer's current logo.
        return { record: crm.entity("customers", id), refreshed: false };
      }
      const current = crm.entity("customers", id);
      const currentImage = crm.repo.customerLogo(id);
      const unchangedImage = previousBytes
        ? currentImage.logo_data &&
          previousBytes.equals(Buffer.from(currentImage.logo_data))
        : !currentImage.logo_data;
      if (
        !found ||
        controller.signal.aborted ||
        current.archived_at ||
        current.updated_at !== before.updated_at ||
        current.website !== before.website ||
        current.general_email !== before.general_email ||
        current.has_logo !== before.has_logo ||
        currentImage.logo_mime !== previousImage.logo_mime ||
        !unchangedImage
      )
        return { record: current, refreshed: false };
      return {
        record: crm.updateEntity("customers", id, { logo: found }),
        refreshed: true,
      };
    },
    close() {
      controller.abort();
    },
  };
}
