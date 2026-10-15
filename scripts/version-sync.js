import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function synchronizeVersions(directory) {
  const metadata = JSON.parse(
    readFileSync(path.join(directory, "package.json")),
  );
  const version = metadata.version;
  if (typeof version !== "string" || !version)
    throw new Error("package.json must contain an application version.");
  const pending = [];
  function update(name, transform, optional = false) {
    const filename = path.join(directory, name);
    let before;
    try {
      before = readFileSync(filename, "utf8");
    } catch (error) {
      if (optional && error.code === "ENOENT") return;
      throw error;
    }
    const after = transform(before);
    if (after !== before) pending.push({ name, filename, after });
  }
  let cargoName;
  update("src-tauri/Cargo.toml", (text) => {
    const section = text
      .split(/(?=^\[)/m)
      .find((block) => /^\[package\][\t ]*(?:#.*)?(?:\r?\n|$)/.test(block));
    if (!section) throw new Error("Cargo.toml has no [package] section.");
    cargoName = section.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1];
    if (!cargoName)
      throw new Error("Cargo.toml has no application package name.");
    const pattern = /^(\s*version\s*=\s*)(["'])[^"'\r\n]+\2(.*)$/m;
    if (!pattern.test(section))
      throw new Error("Cargo.toml has no application package version.");
    const next = section.replace(
      pattern,
      (_match, prefix, quote, suffix) =>
        `${prefix}${quote}${version}${quote}${suffix}`,
    );
    return text.replace(section, () => next);
  });
  update("src-tauri/tauri.conf.json", (text) => {
    const config = JSON.parse(text);
    if (config.version === version) return text;
    config.version = version;
    return JSON.stringify(config, null, 2) + "\n";
  });
  update(
    "src-tauri/Cargo.lock",
    (text) => {
      let found = false;
      const result = text
        .split(/(?=^\[\[package\]\])/m)
        .map((block) => {
          if (
            block.match(/^name = "([^"]+)"/m)?.[1] !== cargoName ||
            /^source\s*=/m.test(block)
          )
            return block;
          if (!/^version = "[^"]+"/m.test(block))
            throw new Error("Cargo.lock has no application version.");
          found = true;
          return block.replace(/^version = "[^"]+"/m, `version = "${version}"`);
        })
        .join("");
      if (!found)
        throw new Error(`Cargo.lock has no local ${cargoName} package.`);
      return result;
    },
    true,
  );
  update(
    "package-lock.json",
    (text) => {
      const lock = JSON.parse(text);
      if (
        lock.version === version &&
        (!lock.packages?.[""] || lock.packages[""].version === version)
      )
        return text;
      lock.version = version;
      if (lock.packages?.[""]) lock.packages[""].version = version;
      return JSON.stringify(lock, null, 4) + "\n";
    },
    true,
  );
  // Validate every file before changing any of them.
  for (const { filename, after } of pending) writeFileSync(filename, after);
  return pending.map(({ name }) => name);
}
