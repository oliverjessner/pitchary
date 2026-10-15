import os from "node:os";
import path from "node:path";
import { AppError, text } from "../business/validation.js";

export function resolveImportSource(
  value,
  { platform = process.platform, home = os.homedir() } = {},
) {
  const filename = text(value ?? "", "source", { max: 4000 });
  const paths = platform === "win32" ? path.win32 : path.posix;
  const resolved = filename.startsWith("~/")
    ? paths.join(home, filename.slice(2))
    : filename;
  if (!resolved || !paths.isAbsolute(resolved))
    throw new AppError(
      422,
      "invalid_source",
      "Bitte einen absoluten Pfad zur Quelldatenbank angeben.",
    );
  return resolved;
}
