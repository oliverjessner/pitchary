import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { capture, nativeFiles, run } from "./desktop-common.js";

function metadata(filename) {
  try {
    return lstatSync(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const defaultExecutableReader = (infoPlist) =>
  capture("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleExecutable",
    infoPlist,
  ]);

export function createDesktopSigningPlan(
  appPath,
  {
    readBundleExecutable = defaultExecutableReader,
    listNativeFiles = nativeFiles,
  } = {},
) {
  const app = path.resolve(appPath);
  if (!metadata(app)?.isDirectory())
    throw new Error(`App bundle must be a real directory: ${app}`);
  const bundles = [];
  function visit(directory) {
    const contents = path.join(directory, "Contents");
    if (metadata(contents)?.isDirectory()) {
      const infoPlist = path.join(contents, "Info.plist");
      const info = metadata(infoPlist);
      if (info?.isSymbolicLink())
        throw new Error(`Bundle Info.plist must not be a symlink: ${infoPlist}`);
      if (info?.isFile()) {
        const executable = readBundleExecutable(infoPlist);
        if (
          typeof executable !== "string" ||
          !executable ||
          executable === "." ||
          executable === ".." ||
          /[\\/\u0000]/.test(executable)
        )
          throw new Error(`Invalid CFBundleExecutable in ${infoPlist}`);
        const executableDirectory = path.join(contents, "MacOS");
        if (!metadata(executableDirectory)?.isDirectory())
          throw new Error(
            `Bundle MacOS directory must be a real directory: ${executableDirectory}`,
          );
        const filename = path.join(executableDirectory, executable);
        const executableMetadata = metadata(filename);
        if (!executableMetadata?.isFile())
          throw new Error(`Bundle executable must be a real file: ${filename}`);
        bundles.push({ root: directory, executable: filename });
      }
    }
    for (const entry of readdirSync(directory, { withFileTypes: true }))
      if (entry.isDirectory()) visit(path.join(directory, entry.name));
  }
  visit(app);
  if (!bundles.some((bundle) => bundle.root === app))
    throw new Error(`App bundle is missing Contents/Info.plist: ${app}`);
  const entrypoints = new Set(bundles.map((bundle) => bundle.executable));
  const leaves = listNativeFiles(path.join(app, "Contents"))
    .map((filename) => path.resolve(filename))
    .filter((filename) => !entrypoints.has(filename))
    .sort();
  const nestedBundles = bundles
    .filter((bundle) => bundle.root !== app)
    .map((bundle) => bundle.root)
    .sort(
      (left, right) =>
        right.split(path.sep).length - left.split(path.sep).length ||
        left.localeCompare(right),
    );
  return {
    app,
    leaves,
    nestedBundles,
    targets: [...leaves, ...nestedBundles, app],
  };
}

export function signDesktopApp(appPath, { runCommand = run, ...options } = {}) {
  const plan = createDesktopSigningPlan(appPath, options);
  for (const filename of plan.targets)
    runCommand("codesign", ["--force", "--sign", "-", filename], {
      stdio: "pipe",
    });
  for (const bundle of [...plan.nestedBundles, plan.app])
    runCommand("codesign", ["--verify", "--deep", "--strict", bundle]);
  return plan;
}
