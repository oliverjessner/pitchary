# GLib security backport

`glib/` contains the published `glib 0.18.5` crate with its original MIT license
and copyright notices. Its crates.io archive SHA-256 is
`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.
The source commit recorded in `.cargo_vcs_info.json` is
`42b9caf98e03ded086362d9653ca58fe94dc8658` in
[gtk-rs-core](https://github.com/gtk-rs/gtk-rs-core/tree/42b9caf98e03ded086362d9653ca58fe94dc8658/glib).

The only change to the published crate is the two-line backport of
[gtk-rs-core#1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343), commit
`b5a4071e439bef2b5eea76c3aa25e5ae84839e34`, addressing
[RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).
`VariantStrIter::impl_get` passes a mutable out-pointer (`&mut p`) to
`g_variant_get_child`. The original immutable reference can cause undefined
behavior and null-pointer crashes in optimized builds.

The failed [Dependabot update](https://github.com/oliverjessner/pitchary/actions/runs/38741805050)
reports `security_update_not_possible`: the earliest fixed registry release is
`glib 0.20.0`, while Tauri's GTK3/WebKitGTK dependencies require `glib 0.18`.
Adding a separate `glib 0.20` dependency would leave the affected transitive
dependency in place. The `[patch.crates-io]` entry in `../Cargo.toml` instead
replaces the registry crate throughout the dependency graph with this patched
local copy. `../Cargo.lock` retains version `0.18.5` for compatibility and
removes the registry source and checksum for this package.

The version remains `0.18.5`; version-only scanners may still report the
advisory. No advisory is ignored or dismissed by this change. A successful
Dependabot run or cleared alert must be checked on GitHub after this change
reaches the default branch; historical failed runs retain their status.

Remove the local patch only when Tauri's complete GTK dependency graph can
resolve to an upstream GLib release containing the fix. Inspect the resolution:

```sh
cargo tree --manifest-path src-tauri/Cargo.toml --locked --target all -i glib
```

The original crate includes iterator regression tests. CI runs them with release
optimizations, which expose the original pointer bug. Run the same check locally:

```sh
cargo test --manifest-path src-tauri/vendor/glib/Cargo.toml --release --lib variant_iter::tests
```

This requires native GLib development libraries (`brew install glib` on macOS,
`libglib2.0-dev` on Ubuntu). Standalone test lockfiles and build output are ignored.
Also verify the application against its locked graph before a desktop release:

```sh
cargo check --manifest-path src-tauri/Cargo.toml --locked
```
