import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

export function isPublicAddress(address) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

async function abortable(promise, signal) {
  signal.throwIfAborted();
  let abort;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export function createPublicFetch({
  fetchImpl = fetch,
  lookup = dnsLookup,
  signal: parentSignal,
  maxBytes = 2 * 1024 * 1024,
} = {}) {
  return async (input, options = {}) => {
    const signal = AbortSignal.any(
      [parentSignal, options.signal, AbortSignal.timeout(8000)].filter(Boolean),
    );
    let url = new URL(input);
    for (let redirects = 0; redirects <= 5; redirects++) {
      signal.throwIfAborted();
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) ||
        /(^|\.)(localhost|local|internal)$/i.test(hostname)
      )
        throw new Error("Only public HTTP websites are supported.");
      const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await abortable(
            lookup(hostname, { all: true, verbatim: true }),
            signal,
          );
      if (
        !addresses.length ||
        addresses.some(({ address }) => !isPublicAddress(address))
      )
        throw new Error(
          "Private or reserved network addresses are not allowed.",
        );
      // Pin the checked DNS result for the connection, including after redirects.
      const dispatcher = new Agent({
        connect: {
          lookup: (_hostname, lookupOptions, callback) =>
            lookupOptions.all
              ? callback(null, addresses)
              : callback(null, addresses[0].address, addresses[0].family),
        },
      });
      try {
        const headers = new Headers(options.headers);
        for (const key of ["cookie", "authorization", "proxy-authorization"])
          headers.delete(key);
        const response = await fetchImpl(url.href, {
          method: "GET",
          headers,
          redirect: "manual",
          credentials: "omit",
          signal,
          dispatcher,
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get("location");
          if (!location || redirects === 5)
            throw new Error("Too many redirects.");
          url = new URL(location, url);
          continue;
        }
        if (Number(response.headers.get("content-length")) > maxBytes) {
          await response.body?.cancel();
          throw new Error("Website or icon exceeds the size limit.");
        }
        const chunks = [];
        let size = 0;
        if (response.body)
          for await (const chunk of response.body) {
            signal.throwIfAborted();
            size += chunk.byteLength;
            if (size > maxBytes)
              throw new Error("Website or icon exceeds the size limit.");
            chunks.push(Buffer.from(chunk));
          }
        const result = new Response(
          [204, 205, 304].includes(response.status)
            ? null
            : Buffer.concat(chunks),
          { status: response.status, headers: response.headers },
        );
        Object.defineProperty(result, "url", { value: url.href });
        return result;
      } finally {
        await dispatcher.destroy();
      }
    }
    throw new Error("Too many redirects.");
  };
}
