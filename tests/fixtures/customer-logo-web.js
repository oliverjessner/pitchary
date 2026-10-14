import { demoCustomerLogo } from "../../scripts/demo-assets.js";

export const publicLogoLookup = async () => [
  { address: "93.184.216.34", family: 4 },
];
export async function customerLogoWeb(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== "auto-logo.example")
    return new Response("Not found", { status: 404 });
  if (parsed.pathname === "/")
    return new Response(
      '<html><head><base href="/assets/"><link rel="apple-touch-icon" sizes="180x180" href="brand.png"></head><body>Example company</body></html>',
      { headers: { "content-type": "text/html" } },
    );
  if (parsed.pathname === "/assets/brand.png")
    return new Response(Buffer.from(demoCustomerLogo.data_base64, "base64"), {
      headers: { "content-type": "image/png" },
    });
  return new Response("Not found", { status: 404 });
}
