import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../../src/server/app.js";
import { seedDemo } from "../../scripts/seed.js";
import { customerLogoWeb } from "../fixtures/customer-logo-web.js";
const folder = mkdtempSync(path.join(os.tmpdir(), "pitchary-browser-"));
const port = Number(process.argv[2] ?? 3217);
const app = await buildApp({
  databasePath: path.join(folder, "demo.sqlite"),
  customerLogoOptions: { fetchImpl: customerLogoWeb },
  ...(port === 3218 ? { clock: () => "2026-10-12T10:00:00.000Z" } : {}),
});
seedDemo(app.database);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
    process.exit(0);
  });
await app.listen({ host: "127.0.0.1", port });
