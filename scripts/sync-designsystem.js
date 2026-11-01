import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
export async function syncDesignSystem(directory = root) {
  const source = path.join(directory, "node_modules/oj-designsystem");
  const parent = path.join(directory, "public/vendor");
  const destination = path.join(parent, "oj-designsystem");
  const { version } = JSON.parse(
    await readFile(path.join(source, "package.json"), "utf8"),
  );
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(path.join(parent, ".oj-designsystem-"));
  const next = path.join(staging, "next");
  const previous = path.join(staging, "previous");
  let movedPrevious = false;
  let preserveBackup = false;
  try {
    await cp(path.join(source, "dist"), next, { recursive: true });
    for (const name of ["LICENSE", "THIRD-PARTY-NOTICES.md"])
      await cp(path.join(source, name), path.join(next, name));
    await writeFile(path.join(next, "VERSION"), version + "\n");
    try {
      await rename(destination, previous);
      movedPrevious = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(next, destination);
    } catch (error) {
      if (movedPrevious) {
        try {
          await rename(previous, destination);
        } catch (restoreError) {
          preserveBackup = true;
          throw new AggregateError(
            [error, restoreError],
            `Asset update and recovery failed. Previous assets retained at ${previous}.`,
          );
        }
      }
      throw error;
    }
  } finally {
    if (!preserveBackup) await rm(staging, { recursive: true, force: true });
  }
  return version;
}
if (import.meta.main) {
  const version = await syncDesignSystem();
  console.log(`Local oj-designsystem assets synchronized (${version}).`);
}
