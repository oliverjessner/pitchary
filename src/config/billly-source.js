import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Tauri app_data_dir uses the application identifier, not its display name.
export function defaultBilllySource({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
  exists = existsSync,
} = {}) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const directory =
    platform === "darwin"
      ? paths.join(home, "Library", "Application Support")
      : platform === "win32"
        ? env.APPDATA || paths.join(home, "AppData", "Roaming")
        : env.XDG_DATA_HOME || paths.join(home, ".local", "share");
  const actual = paths.join(directory, "com.oli.billly", "billly.sqlite");
  const legacy = paths.join(directory, "Billly", "billly.sqlite");
  if (exists(actual)) return actual;
  return exists(legacy) ? legacy : actual;
}
