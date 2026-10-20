use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{
    webview::NewWindowFeatures, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub(crate) fn opener_plugin() -> impl tauri::plugin::Plugin<tauri::Wry> {
    // Navigation and popup handlers below decide which links stay in the app.
    // The plugin's injected click handler would intercept authenticated PDFs
    // and try to send them through an unavailable frontend IPC permission.
    tauri_plugin_opener::Builder::new()
        .open_js_links_on_click(false)
        .build()
}

fn external(app: &tauri::AppHandle, url: &Url) {
    if matches!(url.scheme(), "https" | "http" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

pub(crate) fn window(
    app: &tauri::AppHandle,
    label: &str,
    url: Url,
) -> tauri::Result<WebviewWindow> {
    window_builder(app, label, url, None).build()
}

pub(crate) fn window_builder<'a>(
    app: &'a tauri::AppHandle,
    label: &str,
    url: Url,
    features: Option<NewWindowFeatures>,
) -> WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle> {
    let origin = url.origin();
    let navigation_app = app.clone();
    let popup_app = app.clone();
    let popup_origin = origin.clone();
    let download_app = app.clone();
    // WebKit supplies the configuration that the child WebView must use.
    // It also owns the first navigation, so avoid loading the PDF twice.
    let initial_url = if features.is_some() {
        Url::parse("about:blank").expect("Valid blank URL")
    } else {
        url
    };
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(initial_url));
    if let Some(features) = features {
        builder = builder.window_features(features);
    }
    builder
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
        .on_new_window(move |url, features| {
            if url.origin() == popup_origin {
                static NUMBER: AtomicUsize = AtomicUsize::new(0);
                let label = format!("document-{}", NUMBER.fetch_add(1, Ordering::Relaxed));
                match window_builder(&popup_app, &label, url, Some(features)).build() {
                    Ok(window) => return tauri::webview::NewWindowResponse::Create { window },
                    Err(error) => {
                        eprintln!("Unable to open document window: {error}");
                        popup_app
                            .dialog()
                            .message(error.to_string())
                            .title("Dokument konnte nicht geöffnet werden")
                            .show(|_| {});
                    }
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
}
