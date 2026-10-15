import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertPlatform,
  syncVersions,
  capture,
  dmgName,
  releaseDirectory,
  releaseRepo,
  root,
  run,
  sha256,
  sourceHash,
  tapRepo,
  target,
  version,
} from "./desktop-common.js";
import { changelogRelease } from "./changelog.js";

export function parseArgs(args) {
  const options = {
    dryRun: false,
    skipBuild: false,
    skipBrew: false,
    help: false,
    tapPath: path.resolve(root, "../homebrew-tap"),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") options.dryRun = true;
    else if (args[i] === "--skip-build") options.skipBuild = true;
    else if (args[i] === "--skip-brew") options.skipBrew = true;
    else if (["--help", "-h"].includes(args[i])) options.help = true;
    else if (
      args[i] === "--tap-path" &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      options.tapPath = path.resolve(args[++i]);
    else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  return options;
}
export function renderCask(manifest) {
  if (
    !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    !/^\d+(\.\d+){0,2}$/.test(manifest.minimumSystemVersion)
  )
    throw new Error("Invalid cask metadata.");
  if (
    manifest.target !== target ||
    manifest.file !== `Pitchary_${manifest.version}_aarch64.dmg`
  )
    throw new Error("Unexpected release architecture or filename.");
  return `cask "pitchary" do
  version "${manifest.version}"
  sha256 "${manifest.sha256}"

  url "https://github.com/${releaseRepo}/releases/download/v#{version}/Pitchary_#{version}_aarch64.dmg"
  name "Pitchary"
  desc "Local customer, sales and invoice management"
  homepage "https://github.com/${releaseRepo}"

  depends_on arch: :arm64
  depends_on macos: ">= ${manifest.minimumSystemVersion}"

  app "Pitchary.app"

  zap trash: [
    "~/Library/Application Support/com.pitchary.app",
    "~/Library/Caches/com.pitchary.app",
    "~/Library/Preferences/com.pitchary.app.plist",
    "~/Library/WebKit/com.pitchary.app",
  ]
end
`;
}
export function verifyManifest(manifest, bytes, inputsHash) {
  if (
    manifest.version !== version ||
    manifest.target !== target ||
    manifest.file !== dmgName
  )
    throw new Error(
      "The built artifact does not match the current package version/architecture.",
    );
  if (manifest.sourceHash !== inputsHash)
    throw new Error(
      "Sources changed since the build. Rebuild without --skip-build.",
    );
  if (manifest.sha256 !== sha256(bytes))
    throw new Error("The DMG checksum differs from its build manifest.");
}
function repositoryMatches(directory, expected) {
  const remote = capture("git", ["remote", "get-url", "origin"], {
    cwd: directory,
  });
  if (
    ![
      `https://github.com/${expected}`,
      `https://github.com/${expected}.git`,
      `git@github.com:${expected}.git`,
      `ssh://git@github.com/${expected}.git`,
    ].includes(remote)
  )
    throw new Error(`Unexpected origin in ${directory}: expected ${expected}.`);
}
function clean(directory) {
  if (
    capture("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: directory,
    })
  )
    throw new Error(
      `Uncommitted changes in ${directory}. Commit the intended changes before publishing.`,
    );
}
function githubGet(endpoint) {
  const result = spawnSync("gh", ["api", endpoint], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status === 0) return JSON.parse(result.stdout);
  if (result.stderr.includes("HTTP 404")) return null;
  throw new Error(
    result.stderr || result.error?.message || "GitHub request failed.",
  );
}
export function releaseTagCommit(tag, get = githubGet) {
  // Missing tag refs return 404; /commits/:tag returns 422 instead.
  if (!get(`repos/${releaseRepo}/git/ref/tags/${tag}`)) return null;
  const commit = get(`repos/${releaseRepo}/commits/${tag}`);
  if (!commit?.sha) throw new Error(`Cannot resolve existing tag ${tag}.`);
  return commit.sha;
}
function verifyRemoteAsset(directory, manifest) {
  run("gh", [
    "release",
    "download",
    `v${version}`,
    "--repo",
    releaseRepo,
    "--pattern",
    dmgName,
    "--dir",
    directory,
    "--clobber",
  ]);
  if (sha256(readFileSync(path.join(directory, dmgName))) !== manifest.sha256)
    throw new Error("The GitHub release asset has a different checksum.");
}
export function publishGitHubRelease(
  { existing, commit, manifest, notes, title, downloadDirectory },
  { runCommand = run, verifyAsset = verifyRemoteAsset } = {},
) {
  if (!title?.trim())
    throw new Error("The GitHub release needs a changelog title.");
  const tag = `v${version}`;
  if (!existing) {
    runCommand("gh", [
      "release",
      "create",
      tag,
      "--repo",
      releaseRepo,
      "--target",
      commit,
      "--title",
      title,
      "--notes-file",
      notes,
      "--draft",
    ]);
    existing = { draft: true };
  }
  if (existing.draft) {
    runCommand("gh", [
      "release",
      "upload",
      tag,
      path.join(releaseDirectory, dmgName),
      path.join(releaseDirectory, "SHA256SUMS"),
      "--repo",
      releaseRepo,
      "--clobber",
    ]);
    verifyAsset(downloadDirectory, manifest);
    runCommand("gh", [
      "release",
      "edit",
      tag,
      "--repo",
      releaseRepo,
      "--title",
      title,
      "--notes-file",
      notes,
      "--draft=false",
    ]);
  } else verifyAsset(downloadDirectory, manifest);
}
export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(
      "Usage: npm run publish -- [--dry-run] [--skip-build] [--skip-brew] [--tap-path PATH]\n\nDefault: tests, macOS app/DMG build, GitHub release, cask commit and tap push.\n--dry-run only prepares local artifacts and never writes to GitHub or the tap.\n--skip-build only accepts an artifact with matching source and DMG checksums.",
    );
    return;
  }
  assertPlatform();
  syncVersions();
  const release = changelogRelease(
    readFileSync(path.join(root, "docs/changelog.md"), "utf8"),
    version,
  );
  const tag = `v${version}`;
  let existing = null;
  const commit = capture("git", ["rev-parse", "HEAD"]);
  if (!options.dryRun) {
    clean(root);
    repositoryMatches(root, releaseRepo);
    const repository = JSON.parse(
      capture("gh", [
        "repo",
        "view",
        releaseRepo,
        "--json",
        "nameWithOwner,viewerPermission",
      ]),
    );
    if (
      repository.nameWithOwner !== releaseRepo ||
      !["ADMIN", "MAINTAIN", "WRITE"].includes(repository.viewerPermission)
    )
      throw new Error(
        "GitHub write access to the intended repository is required.",
      );
    if (githubGet(`repos/${releaseRepo}/commits/${commit}`)?.sha !== commit)
      throw new Error("Push the source commit to GitHub before publishing.");
    const remoteTag = releaseTagCommit(tag);
    if (remoteTag && remoteTag !== commit)
      throw new Error(
        `${tag} points at another commit. Existing tags are never replaced.`,
      );
    existing = githubGet(`repos/${releaseRepo}/releases/tags/${tag}`);
    if (existing?.draft && existing.target_commitish !== commit)
      throw new Error("The existing draft targets a different commit.");
    if (!options.skipBrew) {
      clean(options.tapPath);
      repositoryMatches(options.tapPath, tapRepo);
      const upstream = capture(
        "git",
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        { cwd: options.tapPath },
      );
      if (!upstream.startsWith("origin/"))
        throw new Error("The tap branch must track origin.");
      run("git", ["fetch", "origin"], { cwd: options.tapPath });
      if (
        capture("git", ["rev-list", "--count", `${upstream}..HEAD`], {
          cwd: options.tapPath,
        }) !== "0"
      )
        throw new Error(
          "The tap has unpublished commits. Publish them separately first.",
        );
      run("git", ["pull", "--ff-only"], { cwd: options.tapPath });
    }
  }
  run("npm", ["run", "format:check"]);
  run("npm", ["test"]);
  if (!options.skipBuild) run("npm", ["run", "desktop:prepare"]);
  run("cargo", ["test", "--locked", "--manifest-path", "src-tauri/Cargo.toml"]);
  if (!options.skipBuild) run("npm", ["run", "desktop:build"]);
  const manifest = JSON.parse(
    readFileSync(path.join(releaseDirectory, "manifest.json")),
  );
  verifyManifest(
    manifest,
    readFileSync(path.join(releaseDirectory, dmgName)),
    sourceHash(),
  );
  const caskDirectory = path.join(releaseDirectory, "Casks");
  mkdirSync(caskDirectory, { recursive: true });
  const cask = path.join(caskDirectory, "pitchary.rb");
  writeFileSync(cask, renderCask(manifest));
  run("brew", ["style", cask], {
    env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1" },
  });
  const notes = path.join(releaseDirectory, "release-notes.md");
  writeFileSync(notes, release.body);
  if (options.dryRun) {
    console.log(
      `Dry run complete. Review ${releaseDirectory}\nRelease title: ${release.title}\nRelease notes: ${notes}\nWould publish: https://github.com/${releaseRepo}/releases/tag/${tag}\nWould update: ${path.join(options.tapPath, "Casks/pitchary.rb")}\nNo tags, releases, tap files, commits or pushes were created.`,
    );
    return;
  }
  clean(root);
  const temporary = mkdtempSync(path.join(tmpdir(), "pitchary-publish-"));
  try {
    publishGitHubRelease({
      existing,
      commit,
      manifest,
      notes,
      title: release.title,
      downloadDirectory: temporary,
    });
    if (!options.skipBrew) {
      clean(options.tapPath);
      const destination = path.join(options.tapPath, "Casks/pitchary.rb");
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(cask, destination);
      run("brew", ["style", destination], {
        env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1" },
      });
      run("git", ["add", "--", "Casks/pitchary.rb"], { cwd: options.tapPath });
      if (
        capture("git", ["diff", "--cached", "--name-only"], {
          cwd: options.tapPath,
        })
      ) {
        run("git", ["commit", "-m", `Update Pitchary cask to ${tag}`], {
          cwd: options.tapPath,
        });
        run("git", ["push", "origin", "HEAD"], { cwd: options.tapPath });
      }
    }
    console.log(
      `Published https://github.com/${releaseRepo}/releases/tag/${tag}${options.skipBrew ? "" : " and the Homebrew cask"}.`,
    );
  } catch (error) {
    throw new Error(
      `${error.message}\nThe source checkout was not committed or pushed. Existing published assets are never replaced. After resolving the failure, resume with npm run publish -- --skip-build.`,
      { cause: error },
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (import.meta.main)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
