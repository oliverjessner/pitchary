import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  chmodSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { capture, run, sha256 } from "./desktop-common.js";

export function bundleTools(directory) {
  const bin = path.join(directory, "bin"),
    lib = path.join(directory, "lib"),
    notices = path.join(directory, "licenses");
  for (const destination of [bin, lib, notices])
    mkdirSync(destination, { recursive: true });
  const copied = new Map(),
    names = new Map(),
    formulas = new Set(),
    queue = [];
  function licenses(source) {
    const match = source.match(/^(.*\/Cellar\/([^/]+)\/[^/]+)\//);
    if (!match || formulas.has(match[1])) return;
    formulas.add(match[1]);
    const destination = path.join(notices, match[2]);
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(match[1]))
      if (/^(COPYING|LICENSE|COPYRIGHT|AUTHORS|NOTICE)/i.test(name))
        cpSync(path.join(match[1], name), path.join(destination, name), {
          recursive: true,
        });
    if (existsSync(path.join(match[1], "share/licenses")))
      cpSync(
        path.join(match[1], "share/licenses"),
        path.join(destination, "licenses"),
        { recursive: true },
      );
  }
  function copy(source, destination) {
    source = realpathSync(source);
    if (copied.has(source)) return copied.get(source);
    const existing = names.get(destination);
    if (
      existing &&
      sha256(readFileSync(existing)) !== sha256(readFileSync(source))
    )
      throw new Error(
        `Conflicting bundled libraries: ${existing} and ${source}`,
      );
    copyFileSync(source, destination);
    chmodSync(destination, 0o755);
    licenses(source);
    copied.set(source, destination);
    names.set(destination, source);
    queue.push({ source, destination });
    return destination;
  }
  const prefix = capture("brew", ["--prefix"]);
  for (const name of ["pdftotext", "pdftoppm", "pdfinfo", "tesseract"])
    copy(path.join(prefix, "bin", name), path.join(bin, name));
  function resolveDependency(dependency, source) {
    if (dependency.startsWith("/System/") || dependency.startsWith("/usr/lib/"))
      return null;
    if (dependency.startsWith("@loader_path/"))
      return path.resolve(path.dirname(source), dependency.slice(13));
    if (dependency.startsWith("@rpath/")) {
      const name = dependency.slice(7);
      const commands = capture("otool", ["-l", source]);
      const rpaths = [
        ...commands.matchAll(
          /cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset/g,
        ),
      ].map((match) => match[1].replace("@loader_path", path.dirname(source)));
      const candidates = [
        ...rpaths,
        path.dirname(source),
        path.resolve(path.dirname(source), "../lib"),
        path.join(prefix, "lib"),
      ].map((directory) => path.join(directory, name));
      const found = candidates.find(existsSync);
      if (!found)
        throw new Error(`Cannot resolve ${dependency} required by ${source}`);
      return found;
    }
    if (
      dependency.startsWith("/opt/homebrew/") ||
      dependency.startsWith("/usr/local/")
    )
      return dependency;
    throw new Error(`Unsupported native dependency ${dependency} in ${source}`);
  }
  for (const { source, destination } of queue) {
    const dependencies = capture("otool", ["-L", source])
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(" ")[0]);
    for (const dependency of dependencies) {
      const resolved = resolveDependency(dependency, source);
      if (!resolved || realpathSync(resolved) === source) continue;
      const bundled = copy(resolved, path.join(lib, path.basename(dependency)));
      const relative = path.relative(path.dirname(destination), bundled);
      run(
        "install_name_tool",
        ["-change", dependency, `@loader_path/${relative}`, destination],
        { stdio: "pipe" },
      );
    }
    if (destination.endsWith(".dylib"))
      run(
        "install_name_tool",
        ["-id", `@rpath/${path.basename(destination)}`, destination],
        { stdio: "pipe" },
      );
    run("codesign", ["--force", "--sign", "-", destination], { stdio: "pipe" });
  }
  console.log(`Bundled PDF/OCR tools and ${copied.size - 4} libraries.`);
}
