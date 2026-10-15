import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  assertPlatform,
  assertVersions,
  capture,
  nodeVersion,
  root,
  run,
  sha256,
} from "./desktop-common.js";
import { bundleTools } from "./bundle-desktop-tools.js";

assertPlatform();
assertVersions();
const runtime = path.join(root, "src-tauri/runtime");
const cache = path.join(root, "artifacts/desktop-cache");
mkdirSync(cache, { recursive: true });
mkdirSync(path.join(runtime, "bin"), { recursive: true });
async function download(url, filename, digest) {
  if (
    existsSync(filename) &&
    (!digest || sha256(readFileSync(filename)) === digest)
  )
    return;
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok)
    throw new Error(`Download failed: ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest && sha256(bytes) !== digest)
    throw new Error(`Checksum mismatch: ${url}`);
  writeFileSync(filename, bytes);
}
const archiveName = `node-v${nodeVersion}-darwin-arm64.tar.gz`;
const base = `https://nodejs.org/dist/v${nodeVersion}`;
const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
const digest = sums
  .split("\n")
  .find((line) => line.endsWith(`  ${archiveName}`))
  ?.split(/\s+/)[0];
if (!/^[a-f0-9]{64}$/.test(digest ?? ""))
  throw new Error("Official Node checksum missing.");
const archive = path.join(cache, archiveName);
await download(`${base}/${archiveName}`, archive, digest);
const extracted = path.join(cache, `node-v${nodeVersion}-darwin-arm64`);
if (!existsSync(path.join(extracted, "bin/node")))
  run("tar", ["-xzf", archive, "-C", cache]);
copyFileSync(path.join(extracted, "bin/node"), path.join(runtime, "bin/node"));
copyFileSync(
  path.join(extracted, "LICENSE"),
  path.join(runtime, "NODE-LICENSE"),
);
chmodSync(path.join(runtime, "bin/node"), 0o755);
if (
  capture(path.join(runtime, "bin/node"), ["--version"]) !== `v${nodeVersion}`
)
  throw new Error("Bundled Node version mismatch.");
const app = path.join(runtime, "app");
mkdirSync(app, { recursive: true });
const dependencyHash = sha256(
  readFileSync(path.join(root, "package-lock.json")),
);
const stamp = path.join(app, ".dependencies");
const install =
  !existsSync(stamp) || readFileSync(stamp, "utf8") !== dependencyHash;
for (const name of ["src", "public"]) {
  rmSync(path.join(app, name), { recursive: true, force: true });
  cpSync(path.join(root, name), path.join(app, name), { recursive: true });
}
for (const name of ["package.json", "package-lock.json", "LICENSE"])
  if (existsSync(path.join(root, name)))
    copyFileSync(path.join(root, name), path.join(app, name));
if (install) {
  run(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: app, env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "true" } },
  );
  writeFileSync(stamp, dependencyHash);
}
run(
  path.join(runtime, "bin/node"),
  [
    "--input-type=module",
    "-e",
    "import sharp from 'sharp'; import {DatabaseSync} from 'node:sqlite'; new DatabaseSync(':memory:').close(); await sharp({create:{width:1,height:1,channels:4,background:'blue'}}).png().toBuffer();",
  ],
  { cwd: app },
);
rmSync(path.join(runtime, "tools"), { recursive: true, force: true });
bundleTools(path.join(runtime, "tools"));
const tessdata = path.join(runtime, "tools/share/tessdata");
mkdirSync(tessdata, { recursive: true });
for (const [name, digest] of Object.entries({
  "eng.traineddata":
    "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
  "deu.traineddata":
    "19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d",
  LICENSE: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
})) {
  const cached = path.join(cache, `tessdata-${name}`);
  await download(
    `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/${name}`,
    cached,
    digest,
  );
  copyFileSync(cached, path.join(tessdata, name));
}
const icons = path.join(root, "src-tauri/icons");
mkdirSync(icons, { recursive: true });
const { default: sharp } = await import("sharp");
const sourceIcon = path.join(cache, "icon.png");
await sharp(path.join(root, "public/favicon.svg"))
  .resize(1024, 1024)
  .png()
  .toFile(sourceIcon);
const iconStamp = path.join(cache, "icon-source.sha256");
const iconHash = sha256(readFileSync(path.join(root, "public/favicon.svg")));
const wantedIcons = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.icns"];
if (
  !existsSync(iconStamp) ||
  readFileSync(iconStamp, "utf8") !== iconHash ||
  wantedIcons.some((name) => !existsSync(path.join(icons, name)))
) {
  run(
    path.join(root, "node_modules/.bin/tauri"),
    ["icon", sourceIcon, "--output", icons],
    { stdio: "pipe" },
  );
  writeFileSync(iconStamp, iconHash);
}
for (const name of readdirSync(icons))
  if (!wantedIcons.includes(name))
    rmSync(path.join(icons, name), { recursive: true, force: true });
console.log(
  `Desktop runtime ready: Node ${nodeVersion}, production modules, local assets, PDF tools and English/German OCR.`,
);
