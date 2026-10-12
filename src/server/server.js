import { buildApp } from "./app.js";
if (process.env.HOST && !["127.0.0.1", "localhost"].includes(process.env.HOST))
  throw new Error(
    "Pitchary v1 darf ausschließlich lokal an 127.0.0.1 gebunden werden.",
  );
const app = await buildApp({ logger: true });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => app.close().then(() => process.exit(0)));
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 3031) });
