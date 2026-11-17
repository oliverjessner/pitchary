use std::{ffi::OsStr, fs, io, path::Path};

fn path_error(path: &Path, operation: &str, error: io::Error) -> io::Error {
    io::Error::new(
        error.kind(),
        format!("{operation} '{}': {error}", path.display()),
    )
}

fn reject_symlink(path: &Path, metadata: &fs::Metadata) -> io::Result<()> {
    if metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "Refusing generated Java resource symlink '{}'",
                path.display()
            ),
        ));
    }
    Ok(())
}

fn make_files_owner_writable(directory: &Path) -> io::Result<()> {
    for entry in fs::read_dir(directory)
        .map_err(|error| path_error(directory, "Unable to read directory", error))?
    {
        let entry = entry
            .map_err(|error| path_error(directory, "Unable to read directory entry", error))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| path_error(&path, "Unable to inspect generated resource", error))?;
        reject_symlink(&path, &metadata)?;
        if metadata.is_dir() {
            make_files_owner_writable(&path)?;
        } else if metadata.is_file() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;

                let mode = metadata.permissions().mode();
                if mode & 0o200 == 0 {
                    fs::set_permissions(&path, fs::Permissions::from_mode(mode | 0o200)).map_err(
                        |error| {
                            path_error(
                                &path,
                                "Unable to make generated resource owner-writable",
                                error,
                            )
                        },
                    )?;
                }
            }
        }
    }
    Ok(())
}

/// Prepare only the existing Java resource copy beside Cargo's profile output.
/// Tauri copies the source runtime with its original modes; a later copy must
/// be able to overwrite those generated files without changing the archive.
pub fn prepare_java_resource_copy(out_dir: &Path) -> io::Result<()> {
    let profile = out_dir
        .ancestors()
        .find(|path| path.file_name() == Some(OsStr::new("build")))
        .and_then(Path::parent)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "Unable to derive Cargo profile directory from '{}'",
                    out_dir.display()
                ),
            )
        })?;

    let mut directory = profile.to_path_buf();
    for component in ["runtime", "java"] {
        directory.push(component);
        let metadata = match fs::symlink_metadata(&directory) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(path_error(
                    &directory,
                    "Unable to inspect generated resource directory",
                    error,
                ))
            }
        };
        reject_symlink(&directory, &metadata)?;
        if !metadata.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "Generated Java resource path '{}' is not a directory",
                    directory.display()
                ),
            ));
        }
    }

    let legacy_marker = directory.join("PITCHARY-JAVA.json");
    let has_legacy_marker = match fs::symlink_metadata(&legacy_marker) {
        Ok(metadata) => {
            reject_symlink(&legacy_marker, &metadata)?;
            if !metadata.is_file() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!(
                        "Legacy generated Java metadata '{}' is not a regular file",
                        legacy_marker.display()
                    ),
                ));
            }
            true
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => {
            return Err(path_error(
                &legacy_marker,
                "Unable to inspect legacy generated Java metadata",
                error,
            ))
        }
    };

    make_files_owner_writable(&directory)?;
    if has_legacy_marker {
        // Tauri overwrites resources but does not prune removed source files.
        // Only this formerly generated bundle-root marker is obsolete; the
        // replacement under Contents/Resources and all other files stay put.
        fs::remove_file(&legacy_marker).map_err(|error| {
            path_error(
                &legacy_marker,
                "Unable to remove legacy generated Java metadata",
                error,
            )
        })?;
    }
    Ok(())
}
