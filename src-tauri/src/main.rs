#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

struct Backend(Mutex<Option<Child>>);

impl Backend {
    fn stop(&self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(b"shutdown\n");
            }
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                thread::sleep(Duration::from_millis(25));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.stop();
    }
}

fn start_backend(
    runtime: &Path,
    data: &Path,
) -> Result<(Backend, Url), Box<dyn std::error::Error>> {
    fs::create_dir_all(data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(data, fs::Permissions::from_mode(0o700))?;
    }
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data.join("desktop.log"))?;
    let mut paths = vec![
        runtime.join("tools/bin"),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
    ];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let mut child = Command::new(runtime.join("bin/node"))
        .arg(runtime.join("app/src/server/desktop.js"))
        .current_dir(data)
        .env("PITCHARY_DATA_DIR", data)
        .env("PATH", std::env::join_paths(paths)?)
        .env("TESSDATA_PREFIX", runtime.join("tools/share/tessdata"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log))
        .spawn()?;
    let stdout = child.stdout.take().ok_or("Backend stdout unavailable")?;
    let backend = Backend(Mutex::new(Some(child)));
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                if value["event"] == "ready" {
                    let _ = tx.send(value["url"].as_str().unwrap_or_default().to_string());
                }
            }
        }
    });
    let ready = rx.recv_timeout(Duration::from_secs(45)).map_err(|_| {
        "Pitchary konnte nicht starten. Details stehen in desktop.log im App-Datenordner."
    })?;
    let url = Url::parse(&ready)?;
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.port().is_none() {
        return Err("Invalid backend address".into());
    }
    Ok((backend, url))
}

fn external(app: &tauri::AppHandle, url: &Url) {
    if matches!(url.scheme(), "https" | "http" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

fn window(app: &tauri::AppHandle, label: &str, url: Url) -> tauri::Result<WebviewWindow> {
    let origin = url.origin();
    let navigation_app = app.clone();
    let popup_app = app.clone();
    let popup_origin = origin.clone();
    let download_app = app.clone();
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title("Pitchary")
        .inner_size(1400.0, 950.0)
        .min_inner_size(360.0, 560.0)
        .on_navigation(move |url| {
            if url.origin() == origin {
                return true;
            }
            external(&navigation_app, url);
            false
        })
        .on_new_window(move |url, _features| {
            if url.origin() == popup_origin {
                static NUMBER: AtomicUsize = AtomicUsize::new(0);
                let label = format!("document-{}", NUMBER.fetch_add(1, Ordering::Relaxed));
                if let Ok(window) = window(&popup_app, &label, url) {
                    return tauri::webview::NewWindowResponse::Create { window };
                }
            } else {
                external(&popup_app, &url);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_download(move |_webview, event| {
            if let tauri::webview::DownloadEvent::Requested { destination, .. } = event {
                let name = destination
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                if let Ok(directory) = download_app.path().download_dir() {
                    // This callback runs on the WebView event loop. A blocking
                    // native dialog would deadlock it; keep downloads automatic.
                    let original = std::path::PathBuf::from(name);
                    let stem = original.file_stem().unwrap_or_default().to_string_lossy();
                    let extension = original
                        .extension()
                        .map(|value| format!(".{}", value.to_string_lossy()))
                        .unwrap_or_default();
                    let mut filename = directory.join(&original);
                    let mut number = 1;
                    while filename.exists() {
                        filename = directory.join(format!("{stem} ({number}){extension}"));
                        number += 1;
                    }
                    *destination = filename;
                    return true;
                }
                return false;
            }
            true
        })
        .build()
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data = std::env::var_os("PITCHARY_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let runtime = app.path().resource_dir()?.join("runtime");
            match start_backend(&runtime, &data) {
                Ok((backend, url)) => {
                    app.manage(backend);
                    window(app.handle(), "main", url)?;
                    Ok(())
                }
                Err(error) => {
                    let handle = app.handle().clone();
                    app.dialog()
                        .message(error.to_string())
                        .title("Pitchary konnte nicht starten")
                        .show(move |_| handle.exit(1));
                    Ok(())
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Unable to initialize Pitchary");
    app.run(|app, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Some(backend) = app.try_state::<Backend>() {
                backend.stop();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_backend_uses_its_data_directory_and_stops_with_its_owner() {
        let directory = std::env::temp_dir().join(format!("pitchary-rust-{}", std::process::id()));
        fs::create_dir(&directory).unwrap();
        let runtime = Path::new(env!("CARGO_MANIFEST_DIR")).join("runtime");
        let (backend, url) = start_backend(&runtime, &directory).unwrap();
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        assert!(url.query().unwrap().starts_with("desktop_token="));
        assert!(directory.join("pitchary.sqlite").exists());
        let address = format!("127.0.0.1:{}", url.port().unwrap());
        assert!(std::net::TcpStream::connect(&address).is_ok());
        drop(backend);
        assert!(std::net::TcpStream::connect(&address).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
