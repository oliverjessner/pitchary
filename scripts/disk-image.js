import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { run } from "./desktop-common.js";

export async function createDiskImage(
  app,
  destination,
  { runCommand = run, wait = setTimeout, log = console.log } = {},
) {
  const options = { stdio: "pipe", encoding: "utf8" };
  let modern = true;
  try {
    runCommand("diskutil", ["image", "create", "from", "--help"], options);
  } catch {
    // Older supported macOS versions only provide hdiutil create.
    modern = false;
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = mkdtempSync(
    path.join(path.dirname(destination), ".pitchary-dmg-"),
  );
  const source = path.join(temporary, "source");
  let keepTemporary = false;
  try {
    mkdirSync(source);
    runCommand("ditto", [app, path.join(source, "Pitchary.app")]);
    symlinkSync("/Applications", path.join(source, "Applications"));
    for (let attempt = 1; attempt <= 3; attempt++) {
      // A fresh path avoids reusing an image left busy by a failed attempt.
      const image = path.join(temporary, `attempt-${attempt}.dmg`);
      try {
        const output = modern
          ? runCommand(
              "diskutil",
              [
                "image",
                "create",
                "from",
                "--volumeName",
                "Pitchary",
                "--format",
                "UDZO",
                source,
                image,
              ],
              options,
            )
          : runCommand(
              "hdiutil",
              [
                "create",
                "-volname",
                "Pitchary",
                "-srcfolder",
                source,
                "-format",
                "UDZO",
                image,
              ],
              options,
            );
        if (output?.trim()) log(output.trim());
        runCommand("hdiutil", ["verify", image], options);
      } catch (error) {
        const detail = [error.message, error.code, error.stderr]
          .filter(Boolean)
          .join("\n");
        if (/resource busy|\bEBUSY\b/iu.test(detail) && attempt < 3) {
          log(`DMG creation is busy; retrying (${attempt}/3)…`);
          await wait(attempt * 1000);
          continue;
        }
        throw new Error(`DMG creation or verification failed:\n${detail}`, {
          cause: error,
        });
      }
      try {
        // Both paths share a filesystem; publish only a verified image.
        renameSync(image, destination);
      } catch (error) {
        keepTemporary = true;
        throw new Error(
          `Could not replace ${destination}. The verified DMG is preserved at ${image}.`,
          { cause: error },
        );
      }
      return;
    }
  } finally {
    if (!keepTemporary) {
      try {
        rmSync(temporary, { recursive: true, force: true });
      } catch (error) {
        log(`Could not clean up ${temporary}: ${error.message}`);
      }
    }
  }
}
