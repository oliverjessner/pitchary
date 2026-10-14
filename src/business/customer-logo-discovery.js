import { extractFavicon } from "fetchary";
import sharp from "sharp";
import { decodeIco, isIco } from "icojs";
import { createWebFetch } from "./web-fetch.js";
import { logo, maxLogoBytes } from "./customer-branding.js";

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
  if (website) return new URL(website);
  const domain = general_email?.split("@").at(-1)?.toLowerCase();
  if (!domain || personalDomains.has(domain)) return null;
  return new URL("https://" + domain + "/");
}

async function pngLogo(input) {
  let bytes = input;
  if (isIco(bytes)) {
    const count = bytes.readUInt16LE(4);
    if (!count || count > 32 || bytes.length < 6 + count * 16)
      throw new Error("Invalid ICO.");
    for (let index = 0; index < count; index++) {
      const entry = 6 + index * 16;
      const length = bytes.readUInt32LE(entry + 8),
        offset = bytes.readUInt32LE(entry + 12);
      if (
        offset < 6 + count * 16 ||
        offset + length > bytes.length ||
        length < 16
      )
        throw new Error("Invalid ICO.");
      if (bytes.toString("hex", offset, offset + 8) === "89504e470d0a1a0a") {
        if (
          length < 24 ||
          bytes.readUInt32BE(offset + 16) > 512 ||
          bytes.readUInt32BE(offset + 20) > 512
        )
          throw new Error("Oversized ICO.");
      } else if (
        [12, 40, 52, 56, 108, 124].includes(bytes.readUInt32LE(offset))
      ) {
        const core = bytes.readUInt32LE(offset) === 12;
        const width = core
            ? bytes.readUInt16LE(offset + 4)
            : bytes.readInt32LE(offset + 4),
          height = core
            ? bytes.readUInt16LE(offset + 6)
            : Math.abs(bytes.readInt32LE(offset + 8));
        if (width < 1 || width > 512 || height < 1 || height > 1024)
          throw new Error("Oversized ICO.");
      } else throw new Error("Unsupported ICO image.");
    }
    const images = await decodeIco(bytes, "image/png");
    const image = images.sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0];
    if (!image) throw new Error("Invalid ICO.");
    bytes = Buffer.from(image.buffer);
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
  { fetchImpl, extractIcon = extractFavicon, discover: suppliedDiscover } = {},
) {
  const controller = new AbortController();
  async function discover(input) {
    const site = siteFor(input);
    if (!site) return null;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10000),
    ]);
    const fetchResource = createWebFetch({ fetchImpl, signal });
    const images = new Map();
    let pageRequested = false;
    const result = await extractIcon(site.href, {
      mode: "http",
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
    close() {
      controller.abort();
    },
  };
}
