import {
  mkdirSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export function acquirePublishLock(directory) {
  mkdirSync(path.dirname(directory), { recursive: true });
  const owner = path.join(directory, `${process.pid}.pid`);
  for (;;) {
    try {
      mkdirSync(directory);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    let entries;
    try {
      entries = readdirSync(directory);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (entries.length !== 1 || !/^\d+\.pid$/.test(entries[0]))
      throw new Error(
        `Another publish is starting, or its lock is incomplete: ${directory}. Check for a running publish before removing this directory.`,
      );
    const pid = Number.parseInt(entries[0], 10);
    try {
      process.kill(pid, 0);
      throw new Error(`Another publish is already running (PID ${pid}).`);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    // Only the process which removes this exact dead owner's file may
    // remove its directory. Never recursively delete a newer process's lock.
    try {
      unlinkSync(path.join(directory, entries[0]));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    rmdirSync(directory);
  }
  try {
    writeFileSync(owner, "", { flag: "wx" });
  } catch (error) {
    rmdirSync(directory);
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    unlinkSync(owner);
    rmdirSync(directory);
    released = true;
  };
}
