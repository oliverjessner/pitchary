#![cfg(unix)]

#[path = "../build_support.rs"]
mod build_support;

use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

struct TemporaryDirectory(PathBuf);

impl TemporaryDirectory {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "pitchary-build-resources-{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory).unwrap();
        Self(directory)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn write_fixture(file: &Path, bytes: &[u8], mode: u32) {
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, bytes).unwrap();
    fs::set_permissions(file, fs::Permissions::from_mode(mode)).unwrap();
}

fn mode(file: &Path) -> u32 {
    fs::metadata(file).unwrap().permissions().mode() & 0o777
}

fn output_directory(profile: &Path) -> PathBuf {
    let output = profile.join("build/pitchary-fixture/out");
    fs::create_dir_all(&output).unwrap();
    output
}

#[test]
fn copied_read_only_licenses_can_be_overwritten_on_every_build() {
    let temporary = TemporaryDirectory::new();
    let profile = temporary.path().join("target/release");
    let output = output_directory(&profile);
    let destination = profile.join("runtime/java/Contents/Home/legal/java.base/LICENSE");
    write_fixture(&destination, b"previous copied license", 0o444);

    for generation in ["first replacement", "second replacement"] {
        let source = temporary.path().join(format!("source/{generation}/LICENSE"));
        write_fixture(&source, generation.as_bytes(), 0o444);
        build_support::prepare_java_resource_copy(&output).unwrap();
        assert_eq!(mode(&destination), 0o644);
        fs::copy(&source, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), generation.as_bytes());
        // Copying the archive file restores its original read-only mode.
        assert_eq!(mode(&destination), 0o444);
    }
}

#[test]
fn owner_write_preserves_executable_bits_contents_and_unrelated_resources() {
    let temporary = TemporaryDirectory::new();
    let profile = temporary.path().join("target/debug");
    let output = output_directory(&profile);
    let java = profile.join("runtime/java/Contents/Home/bin/java");
    let other = profile.join("runtime/app/unrelated.txt");
    write_fixture(&java, b"fictional executable bytes", 0o555);
    write_fixture(&other, b"unrelated read-only resource", 0o444);
    let directory = java.parent().unwrap();
    fs::set_permissions(directory, fs::Permissions::from_mode(0o751)).unwrap();

    build_support::prepare_java_resource_copy(&output).unwrap();
    assert_eq!(mode(&java), 0o755);
    assert_eq!(fs::read(&java).unwrap(), b"fictional executable bytes");
    assert_eq!(mode(directory), 0o751);
    assert_eq!(mode(&other), 0o444);
    assert_eq!(fs::read(&other).unwrap(), b"unrelated read-only resource");
}

#[test]
fn preparing_existing_java_resources_is_idempotent() {
    let temporary = TemporaryDirectory::new();
    let profile = temporary.path().join("target/release");
    let output = output_directory(&profile);
    let file = profile.join("runtime/java/Contents/Home/lib/server/classes.jsa");
    write_fixture(&file, b"fictional class archive", 0o440);

    build_support::prepare_java_resource_copy(&output).unwrap();
    assert_eq!(mode(&file), 0o640);
    build_support::prepare_java_resource_copy(&output).unwrap();
    assert_eq!(mode(&file), 0o640);
    assert_eq!(fs::read(&file).unwrap(), b"fictional class archive");
}

#[test]
fn output_directory_locates_stable_nightly_and_custom_target_profiles() {
    for (relative, output_relative) in [
        ("target/release", "build/pitchary-fixture/out"),
        (
            "target/nightly/release",
            "build/pitchary-fixture/abc123/out",
        ),
        (
            "custom-target/aarch64-apple-darwin/debug",
            "build/pitchary-fixture/custom-hash/out",
        ),
    ] {
        let temporary = TemporaryDirectory::new();
        let profile = temporary.path().join(relative);
        let output = profile.join(output_relative);
        fs::create_dir_all(&output).unwrap();
        let file = profile.join("runtime/java/Contents/Home/legal/LICENSE");
        write_fixture(&file, b"fictional license", 0o444);

        build_support::prepare_java_resource_copy(&output).unwrap();
        assert_eq!(mode(&file), 0o644, "profile layout: {relative}");
    }
}

#[test]
fn missing_java_resources_are_a_no_op_without_creating_runtime_directories() {
    let temporary = TemporaryDirectory::new();
    let profile = temporary.path().join("target/release");
    let output = output_directory(&profile);

    build_support::prepare_java_resource_copy(&output).unwrap();
    assert!(!profile.join("runtime").exists());
    fs::create_dir(profile.join("runtime")).unwrap();
    build_support::prepare_java_resource_copy(&output).unwrap();
    assert!(!profile.join("runtime/java").exists());
}

#[test]
fn symlinks_in_runtime_java_or_descendants_never_modify_outside_files() {
    for component in ["runtime", "java", "descendant"] {
        let temporary = TemporaryDirectory::new();
        let profile = temporary.path().join("target/release");
        let output = output_directory(&profile);
        let outside = temporary.path().join("outside");
        let outside_file = if component == "runtime" {
            outside.join("java/Contents/Home/legal/LICENSE")
        } else {
            outside.join("Contents/Home/legal/LICENSE")
        };
        write_fixture(&outside_file, b"outside file must remain untouched", 0o444);
        match component {
            "runtime" => symlink(&outside, profile.join("runtime")).unwrap(),
            "java" => {
                fs::create_dir(profile.join("runtime")).unwrap();
                symlink(&outside, profile.join("runtime/java")).unwrap();
            }
            _ => {
                let java = profile.join("runtime/java");
                fs::create_dir_all(&java).unwrap();
                symlink(&outside_file, java.join("linked-license")).unwrap();
            }
        }

        assert!(
            build_support::prepare_java_resource_copy(&output).is_err(),
            "symlink component must be rejected: {component}"
        );
        assert_eq!(mode(&outside_file), 0o444);
        assert_eq!(
            fs::read(&outside_file).unwrap(),
            b"outside file must remain untouched"
        );
    }
}

#[test]
fn legacy_bundle_root_metadata_is_removed_without_pruning_other_files() {
    let temporary = TemporaryDirectory::new();
    let profile = temporary
        .path()
        .join("custom-target/aarch64-apple-darwin/release");
    let output = output_directory(&profile);
    let java = profile.join("runtime/java");
    let legacy = java.join("PITCHARY-JAVA.json");
    let current = java.join("Contents/Resources/PITCHARY-JAVA.json");
    let unrelated = java.join("unrelated.json");
    write_fixture(&legacy, b"obsolete generated metadata", 0o444);
    write_fixture(&current, b"current generated metadata", 0o444);
    write_fixture(&unrelated, b"unrelated root file", 0o640);

    build_support::prepare_java_resource_copy(&output).unwrap();
    assert!(!legacy.exists());
    assert_eq!(fs::read(&current).unwrap(), b"current generated metadata");
    assert_eq!(fs::read(&unrelated).unwrap(), b"unrelated root file");
    assert_eq!(mode(&unrelated), 0o640);

    build_support::prepare_java_resource_copy(&output).unwrap();
    assert!(!legacy.exists());
    assert_eq!(fs::read(&current).unwrap(), b"current generated metadata");
    assert_eq!(fs::read(&unrelated).unwrap(), b"unrelated root file");
}

#[test]
fn legacy_metadata_symlinks_and_directories_are_rejected_without_removing_them() {
    for kind in ["symlink", "directory"] {
        let temporary = TemporaryDirectory::new();
        let profile = temporary.path().join("target/debug");
        let output = output_directory(&profile);
        let java = profile.join("runtime/java");
        fs::create_dir_all(&java).unwrap();
        let legacy = java.join("PITCHARY-JAVA.json");
        let outside = temporary.path().join("outside.json");
        write_fixture(&outside, b"outside metadata must stay unchanged", 0o444);
        if kind == "symlink" {
            symlink(&outside, &legacy).unwrap();
        } else {
            fs::create_dir(&legacy).unwrap();
            write_fixture(&legacy.join("preserved.txt"), b"directory contents", 0o444);
        }

        let error = build_support::prepare_java_resource_copy(&output).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
        assert!(error.to_string().contains(&legacy.display().to_string()));
        assert!(fs::symlink_metadata(&legacy).is_ok());
        assert_eq!(
            fs::read(&outside).unwrap(),
            b"outside metadata must stay unchanged"
        );
        assert_eq!(mode(&outside), 0o444);
        if kind == "directory" {
            assert_eq!(
                fs::read(legacy.join("preserved.txt")).unwrap(),
                b"directory contents"
            );
            assert_eq!(mode(&legacy.join("preserved.txt")), 0o444);
        }
    }
}

#[test]
fn descendant_symlink_prevents_legacy_marker_removal() {
    let temporary = TemporaryDirectory::new();
    let profile = temporary.path().join("target/release");
    let output = output_directory(&profile);
    let java = profile.join("runtime/java");
    let legacy = java.join("PITCHARY-JAVA.json");
    write_fixture(&legacy, b"legacy marker remains on unsafe tree", 0o644);
    let outside = temporary.path().join("outside.txt");
    write_fixture(&outside, b"outside content", 0o444);
    symlink(&outside, java.join("linked-resource")).unwrap();

    assert!(build_support::prepare_java_resource_copy(&output).is_err());
    assert_eq!(
        fs::read(&legacy).unwrap(),
        b"legacy marker remains on unsafe tree"
    );
    assert_eq!(fs::read(&outside).unwrap(), b"outside content");
    assert_eq!(mode(&outside), 0o444);
}
