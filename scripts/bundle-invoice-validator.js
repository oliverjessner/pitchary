import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, cp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const javaArchive = {
  version: "21.0.13+9",
  url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.13_9.tar.gz",
  sha256: "225bab0a09491ef06835488cd942f5d2befa9a0410a2484f0c8bbcf7506ec09a",
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function writeJavaProvenance(destination, metadata) {
  const resources = path.join(destination, "Contents/Resources");
  await mkdir(resources, { recursive: true });
  await writeFile(
    path.join(resources, "PITCHARY-JAVA.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
}

export async function bundleInvoiceJava(
  runtime,
  cache = path.join(root, "artifacts/desktop-cache"),
) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error(
      "The desktop Java bundle currently targets macOS arm64, matching Pitchary desktop packaging.",
    );
  await mkdir(cache, { recursive: true });
  const archive = path.join(cache, "invoice-temurin-21.0.13_9-jre.tar.gz");
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch {}
  if (!bytes || digest(bytes) !== javaArchive.sha256) {
    const response = await fetch(javaArchive.url, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok)
      throw new Error(`Java download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== javaArchive.sha256)
      throw new Error("Java archive checksum mismatch.");
    await writeFile(archive, bytes);
  }
  const extracted = path.join(cache, "invoice-java-extracted");
  await rm(extracted, { recursive: true, force: true });
  await mkdir(extracted);
  execFileSync("tar", ["-xzf", archive, "-C", extracted]);
  const entries = await readdir(extracted, { withFileTypes: true });
  const directory = entries.find((entry) => entry.isDirectory());
  if (!directory) throw new Error("Java archive does not contain its runtime.");
  const destination = path.join(runtime, "java");
  await rm(destination, { recursive: true, force: true });
  await cp(path.join(extracted, directory.name), destination, {
    recursive: true,
    dereference: true,
  });
  const version = execFileSync(
    path.join(destination, "Contents/Home/bin/java"),
    ["--version"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (!version.includes("21.0.13"))
    throw new Error("Unexpected bundled Java version.");
  await writeJavaProvenance(destination, { ...javaArchive, check: version });
  await rm(extracted, { recursive: true, force: true });
}
