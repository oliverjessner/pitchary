import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { buildApp } from "./app.js";

const directory = process.env.PITCHARY_DATA_DIR;
if (!directory || !path.isAbsolute(directory))
  throw new Error("PITCHARY_DATA_DIR must be an absolute writable directory.");
await mkdir(directory, { recursive: true, mode: 0o700 });
const token = randomBytes(32).toString("hex");
const app = await buildApp({
  databasePath: path.join(directory, "pitchary.sqlite"),
  desktopToken: token,
});
let closing;
function stop() {
  closing ??= app.close().then(() => process.exit(0));
  return closing;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
// The parent owns stdin: its exit also closes the backend after a crash.
process.stdin.on("end", stop);
process.stdin.on("data", stop);
process.stdin.resume();
const address = await app.listen({ host: "127.0.0.1", port: 0 });
process.stdout.write(
  JSON.stringify({
    event: "ready",
    url: `${address}/?desktop_token=${token}`,
  }) + "\n",
);
