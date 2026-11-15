import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  capture,
  compareMacOSVersions,
  macOSMinimum,
  root,
  run,
  sha256,
} from "./desktop-common.js";

export const lz4Release = {
  version: "1.11.1",
  url: "https://github.com/lz4/lz4/archive/refs/tags/v1.11.1.tar.gz",
  sha256: "683fed08a844ad012196381e40badf80c0bbe4962959761416d41c9e67d77ec7",
};

export function lz4RequiresRebuild({ minimumVersion, hostVersion, version }) {
  if (compareMacOSVersions(minimumVersion, hostVersion) <= 0) return false;
  if (version !== lz4Release.version)
    throw new Error(
      `LZ4 ${version ?? "with an unknown version"} requires macOS ${minimumVersion}, but this Mac runs ${hostVersion}. The bundled source repair supports only LZ4 ${lz4Release.version}. Update its pinned source before rebuilding.`,
    );
  return true;
}

export function verifyLz4Source(bytes) {
  if (sha256(bytes) !== lz4Release.sha256)
    throw new Error(
      "LZ4 source checksum mismatch. The source will not be built.",
    );
}

export function lz4CacheMatches(stamp, expected, bytes) {
  return (
    Boolean(stamp) &&
    Object.entries(expected).every(([key, value]) => stamp[key] === value) &&
    stamp.binarySha256 === sha256(bytes)
  );
}

export async function ensureCompatibleLz4(
  filename,
  { hostVersion, minimumSystemVersion, licenseDirectory },
) {
  const minimumVersion = macOSMinimum(filename);
  if (compareMacOSVersions(minimumVersion, hostVersion) <= 0) return filename;
  const dependencies = capture("otool", ["-L", filename]);
  const version = dependencies.match(/current version ([\d.]+)\)/)?.[1];
  lz4RequiresRebuild({ minimumVersion, hostVersion, version });
  if (!/^\d+(?:\.\d+){0,2}$/.test(minimumSystemVersion))
    throw new Error("A numeric macOS deployment target is required for LZ4.");

  const cache = path.join(root, "artifacts/desktop-cache");
  mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, `lz4-${version}.tar.gz`);
  if (!existsSync(archive)) {
    const response = await fetch(lz4Release.url, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok)
      throw new Error(`LZ4 source download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    verifyLz4Source(bytes);
    writeFileSync(archive, bytes);
  }
  verifyLz4Source(readFileSync(archive));

  const directory = path.join(
    cache,
    `lz4-${version}-arm64-macos-${minimumSystemVersion}`,
  );
  const source = path.join(directory, "source");
  const library = path.join(source, "lib", `liblz4.${version}.dylib`);
  const license = path.join(source, "lib/LICENSE");
  const stampFile = path.join(directory, "build.json");
  const expected = {
    recipe: 1,
    version,
    sourceSha256: lz4Release.sha256,
    architecture: "arm64",
    minimumSystemVersion,
    compiler: capture("/usr/bin/clang", ["--version"]),
    sdk: capture("xcrun", ["--sdk", "macosx", "--show-sdk-version"]),
  };
  let cached = false;
  try {
    cached =
      existsSync(license) &&
      lz4CacheMatches(
        JSON.parse(readFileSync(stampFile, "utf8")),
        expected,
        readFileSync(library),
      ) &&
      compareMacOSVersions(macOSMinimum(library), minimumSystemVersion) <= 0;
  } catch {
    // A partial or stale build is replaced within Pitchary's own cache.
  }
  if (!cached) {
    console.log(
      `Rebuilding bundled LZ4 ${version} for macOS ${minimumSystemVersion}; the Homebrew copy requires ${minimumVersion}.`,
    );
    rmSync(source, { recursive: true, force: true });
    mkdirSync(source, { recursive: true });
    run("tar", ["-xzf", archive, "--strip-components=1", "-C", source]);
    const flags = `-arch arm64 -mmacosx-version-min=${minimumSystemVersion}`;
    run(
      "/usr/bin/make",
      [
        "-C",
        path.join(source, "lib"),
        "liblz4",
        "CC=/usr/bin/clang",
        "libdir=@rpath",
        `CFLAGS=-O3 ${flags}`,
        `LDFLAGS=${flags}`,
      ],
      {
        env: {
          ...process.env,
          MACOSX_DEPLOYMENT_TARGET: minimumSystemVersion,
        },
      },
    );
    if (
      capture("lipo", ["-archs", library]) !== "arm64" ||
      compareMacOSVersions(macOSMinimum(library), minimumSystemVersion) > 0
    )
      throw new Error("Rebuilt LZ4 does not match the macOS deployment target.");
    writeFileSync(
      stampFile,
      JSON.stringify(
        { ...expected, binarySha256: sha256(readFileSync(library)) },
        null,
        2,
      ) + "\n",
    );
  }
  mkdirSync(licenseDirectory, { recursive: true });
  copyFileSync(license, path.join(licenseDirectory, "LICENSE"));
  return library;
}
