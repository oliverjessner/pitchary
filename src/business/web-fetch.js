import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

export function nodeHttpFetch(input, { headers, signal, lookup } = {}) {
  const url = new URL(input);
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("accept-encoding"))
    requestHeaders.set("accept-encoding", "gzip, deflate, br");
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        headers: Object.fromEntries(requestHeaders),
        lookup,
        signal,
      },
      (response) => {
        try {
          const headers = new Headers();
          for (let i = 0; i < response.rawHeaders.length; i += 2)
            headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
          const status = response.statusCode;
          let body = null;
          if ([204, 205, 304].includes(status)) response.resume();
          else {
            body = Readable.toWeb(response);
            const encoding = headers
              .get("content-encoding")
              ?.trim()
              .toLowerCase();
            if (encoding && encoding !== "identity") {
              const format = { gzip: "gzip", deflate: "deflate", br: "brotli" }[
                encoding
              ];
              if (!format)
                throw new Error("Unsupported HTTP content encoding.");
              body = body.pipeThrough(new DecompressionStream(format));
            }
          }
          resolve(new Response(body, { status, headers }));
        } catch (error) {
          response.destroy();
          reject(error);
        }
      },
    );
    req.on("error", reject);
    req.on("upgrade", (_response, socket) => {
      socket.destroy();
      reject(new Error("HTTP protocol upgrades are not supported."));
    });
    req.end();
  });
}

export function createWebFetch({
  fetchImpl = nodeHttpFetch,
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
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error(
          "Only HTTP websites without URL credentials are supported.",
        );
      const headers = new Headers(options.headers);
      for (const key of ["cookie", "authorization", "proxy-authorization"])
        headers.delete(key);
      const response = await fetchImpl(url.href, {
        method: "GET",
        headers,
        redirect: "manual",
        credentials: "omit",
        signal,
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
    }
    throw new Error("Too many redirects.");
  };
}
