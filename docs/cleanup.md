# Generated files after publishing

A successful `npm run publish` removes generated desktop and test files after the GitHub release has been verified and published and the Homebrew cask has been pushed. With `--skip-brew`, cleanup follows the successful GitHub release. A failed publish keeps these files for diagnosis and `--skip-build` retries. `publish --dry-run` keeps them for review.

Preview the cleanup without changing any files:

```sh
npm run cleanup -- --dry-run
```

Run the same cleanup independently:

```sh
npm run cleanup
```

The script removes only these generated paths in this checkout:

| Path                               | Contents                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `src-tauri/target`                 | Rust build outputs and the intermediate app bundle                           |
| `src-tauri/runtime`                | The prepared copy of Node, production dependencies and bundled tools         |
| `src-tauri/gen`                    | Generated Tauri schemas                                                      |
| `src-tauri/vendor/glib/target`     | Vendored GLib build outputs                                                  |
| `src-tauri/vendor/glib/Cargo.lock` | The generated lockfile for testing the vendored library separately           |
| `artifacts/desktop-cache`          | Downloaded runtime archives, extracted tools and temporary icon/build inputs |
| `artifacts/browser-report`         | Generated Playwright HTML reports                                            |
| `artifacts/test-results`           | Generated Playwright traces and failure outputs                              |
| `artifacts/invoice-package-check`  | Disposable invoice packaging runtime and check result                        |
| `artifacts/invoice-validator`      | Disposable validator runtime, downloaded tools and generated check documents |
| `tests/tmp`                        | Temporary test files                                                         |
| `coverage`                         | Generated coverage reports                                                   |

The release matching the current version in `package.json` is kept for review and `--skip-build` retries. Numerically older stable versions in `artifacts/releases/vX.Y.Z` are removed only when their local DMG matches the manifest SHA-256 and the uploaded DMG asset's SHA-256 digest in the published GitHub release in `oliverjessner/pitchary`. Verification uses the existing `gh` CLI and its authentication. Missing releases, drafts, unavailable checks, missing or different digests, modified local DMGs, unexpected files and incomplete release directories are retained and listed with a reason. Newer versions and unrecognized directory names are also retained. Only generated release filenames are eligible; release folders containing additional personal files are preserved.

The cleanup dry-run performs the same read-only GitHub checks and shows both the removal plan and retained releases without changing files. A GitHub availability failure preserves the affected and remaining releases; disposable caches can still be removed. The cleanup never deletes GitHub releases or assets.

A later publish prepares a missing desktop runtime again for its native tests, even with `--skip-build`; it still verifies the retained current DMG against its source hash and checksum. A regular desktop build recreates the runtime and build caches, so the next build can take longer and download runtime files again.

Databases, encryption keys, `.env` files, backups, migration and transfer evidence, manually saved logs, screenshots outside the two disposable invoice check directories, installed app data, tracked icons, vendored source code and the checkout's `node_modules` are preserved. Cleanup does not scan or remove global Cargo, npm, Homebrew or system caches. The two invoice check directories are entirely disposable; keep personal documents and database backups elsewhere.

The script checks the Pitchary checkout root, refuses tracked files in its removal list and refuses symlinks at any target or parent. Symlinks within a generated directory are removed as links without following their destinations. All destinations are checked before removal begins. Independent cleanup shares the publish lock, so it cannot run during another publish.

If publishing succeeds but cleanup fails, the error identifies the cleanup failure separately. Resolve that local issue and run `npm run cleanup`; the release does not need to be published again.
