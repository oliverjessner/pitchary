#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_window;
#[cfg(target_os = "macos")]
mod dock_menu;

use app_window::window;

use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, RunEvent, Url};
use tauri_plugin_dialog::DialogExt;

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

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(app_window::opener_plugin())
        .on_menu_event(|app, event| {
            #[cfg(target_os = "macos")]
            if let Err(error) = dock_menu::handle_event(app, event.id().as_ref()) {
                app.dialog()
                    .message(error.to_string())
                    .title("Ansicht konnte nicht geöffnet werden")
                    .show(|_| {});
            }
        })
        .setup(|app| {
            let data = std::env::var_os("PITCHARY_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let runtime = app.path().resource_dir()?.join("runtime");
            match start_backend(&runtime, &data) {
                Ok((backend, url)) => {
                    app.manage(backend);
                    window(app.handle(), "main", url)?;
                    #[cfg(target_os = "macos")]
                    dock_menu::install()?;
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
