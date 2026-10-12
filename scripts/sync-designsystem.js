import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "node_modules/oj-designsystem");
const destination = path.join(root, "public/vendor/oj-designsystem");
const { version } = JSON.parse(
  await readFile(path.join(source, "package.json"), "utf8"),
);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(path.join(source, "dist"), destination, { recursive: true });
for (const name of ["LICENSE", "THIRD-PARTY-NOTICES.md"])
  await cp(path.join(source, name), path.join(destination, name));
await writeFile(path.join(destination, "VERSION"), version + "\n");
console.log(`Local oj-designsystem assets synchronized (${version}).`);
