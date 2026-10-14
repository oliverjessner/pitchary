import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFetchary } from "fetchary";
import { parseHTML } from "linkedom";
import sharp from "sharp";
import { decodeIco, isIco } from "icojs";
import { createPublicFetch } from "./public-web-fetch.js";
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

export function iconCandidates(html, finalUrl) {
  const { document } = parseHTML(html);
  let base = finalUrl;
  try {
    base = new URL(
      document.querySelector("base[href]")?.getAttribute("href") || "",
      finalUrl,
    ).href;
  } catch {
    /* Use the final page URL when the base tag is invalid. */
  }
  const icons = [];
  for (const node of document.querySelectorAll("link[rel][href]")) {
    const rel = node.getAttribute("rel").toLowerCase().split(/\s+/);
    const rank =
      rel.includes("apple-touch-icon") ||
      rel.includes("apple-touch-icon-precomposed")
        ? 300
        : rel.includes("icon")
          ? 200
          : rel.includes("mask-icon")
            ? 100
            : 0;
    if (!rank) continue;
    try {
      const url = new URL(node.getAttribute("href"), base);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      const size = Math.max(
        0,
        ...(node.getAttribute("sizes") || "")
          .split(/\s+/)
          .map((value) => Number(value.split("x")[0]) || 0),
      );
      icons.push({ url: url.href, rank: rank + Math.min(size, 512) / 1000 });
    } catch {
      /* Malformed icon links do not prevent trying the next icon. */
    }
  }
  return [
    ...new Set([
      ...icons
        .sort((a, b) => b.rank - a.rank)
        .map((icon) => icon.url)
        .slice(0, 5),
      new URL("/favicon.ico", finalUrl).href,
    ]),
  ];
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
  {
    fetchImpl,
    lookup,
    fetcharyFactory = createFetchary,
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
    const publicFetch = createPublicFetch({ fetchImpl, lookup, signal });
    const dataDir = await mkdtemp(path.join(tmpdir(), "pitchary-logo-"));
    let client;
    try {
      client = await fetcharyFactory({
        dataDir,
        timeout: 8000,
        fetch: publicFetch,
        userAgent: "Pitchary/0.2 (customer logo lookup)",
      });
      const source = await client.add(site.href, {
        mode: "http",
        name: "Kundenlogo",
      });
      const version = await client.version(source.id);
      const html = await client.read(source.id);
      for (const url of iconCandidates(html, version.finalUrl || site.href)) {
        if (signal.aborted) break;
        try {
          const response = await publicFetch(url);
          if (!response.ok) continue;
          return await pngLogo(Buffer.from(await response.arrayBuffer()));
        } catch {
          /* Try the next declared icon, then /favicon.ico. */
        }
      }
      return null;
    } finally {
      await client?.close();
      await rm(dataDir, { recursive: true, force: true });
    }
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
