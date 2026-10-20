#[cfg(target_os = "macos")]
#[allow(dead_code)]
#[path = "../src/app_window.rs"]
mod app_window;

#[cfg(target_os = "macos")]
fn main() {
    use std::{
        io::{BufRead, BufReader},
        path::Path,
        process::{Command, Stdio},
        sync::{mpsc, Arc, Mutex},
        thread,
        time::{Duration, Instant},
    };
    use tauri::{Manager, WebviewWindow};

    fn evaluate(window: &WebviewWindow, script: &str) -> Result<serde_json::Value, String> {
        let (tx, rx) = mpsc::channel();
        window
            .eval_with_callback(script, move |value| {
                let _ = tx.send(value);
            })
            .map_err(|error| error.to_string())?;
        let value = rx
            .recv_timeout(Duration::from_secs(3))
            .map_err(|error| error.to_string())?;
        serde_json::from_str(&value).map_err(|error| error.to_string())
    }

    fn wait_until(mut condition: impl FnMut() -> bool) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if condition() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(100));
        }
        Err("Timed out waiting for the native invoice window".into())
    }

    fn wait_for(window: &WebviewWindow, script: &str) -> Result<(), String> {
        wait_until(|| evaluate(window, script).ok() == Some(serde_json::json!(true))).map_err(|error| {
            format!("{error}: {script}; {:?}", evaluate(window, "({url:location.href,type:document.contentType,text:document.body?.innerText})"))
        })
    }

    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let mut backend = Command::new(root.join("src-tauri/runtime/bin/node"))
        .arg(root.join("tests/fixtures/native-invoice-server.js"))
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("Unable to start the isolated invoice backend");
    let mut line = String::new();
    BufReader::new(backend.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let ready: serde_json::Value = serde_json::from_str(&line).unwrap();
    let url = ready["url"].as_str().unwrap().parse().unwrap();
    let outcome = Arc::new(Mutex::new(Err("Native test did not finish".to_string())));
    let final_outcome = outcome.clone();

    tauri::Builder::default()
        .plugin(app_window::opener_plugin())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            // The test clicks through JavaScript instead of a physical mouse.
            // Enable that only in this test's WebView; production keeps its default.
            let builder = app_window::window_builder(app.handle(), "main", url, None);
            let main = builder.with_webview_configuration(unsafe {
                use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
                let configuration: Retained<_> = msg_send![class!(WKWebViewConfiguration), new];
                let store: *mut AnyObject = msg_send![class!(WKWebsiteDataStore), nonPersistentDataStore];
                let _: () = msg_send![&*configuration, setWebsiteDataStore: store];
                let preferences: *mut AnyObject = msg_send![&*configuration, preferences];
                let _: () = msg_send![preferences, setJavaScriptCanOpenWindowsAutomatically: true];
                configuration
            }).build()?;
            let handle = app.handle().clone();
            thread::spawn(move || {
                let result = (|| -> Result<(), String> {
                    wait_for(&main, "document.querySelector('#main[aria-busy=false] h1') !== null")?;
                    for category in ["revenue", "payable"] {
                        main.eval(format!("location.hash = '#/invoices?category={category}'"))
                            .map_err(|error| error.to_string())?;
                        wait_for(&main, "document.querySelector('#main[aria-busy=false] h1')?.textContent === 'Rechnungen' && !!document.querySelector('.finance-file-name')")?;
                        let file_url = evaluate(&main, "document.querySelector('.finance-file-name').href")?;
                        for source in ["list", "detail"] {
                            if source == "detail" {
                                main.eval("document.querySelector('a[href^=\"#/invoices/\"]').click()")
                                    .map_err(|error| error.to_string())?;
                                wait_for(&main, "Array.from(document.querySelectorAll('a')).some(a => a.textContent === 'PDF öffnen')")?;
                            }
                            let previous = handle.webview_windows().len();
                            main.eval(if source == "list" {
                                "document.querySelector('.finance-file-name').click()"
                            } else {
                                "Array.from(document.querySelectorAll('a')).find(a => a.textContent === 'PDF öffnen').click()"
                            }).map_err(|error| error.to_string())?;
                            wait_until(|| handle.webview_windows().len() > previous).map_err(|error| format!("{error}; opening {category} {source}, windows: {:?}, main: {:?}", handle.webview_windows().keys().collect::<Vec<_>>(), evaluate(&main, "({url:location.href,links:Array.from(document.querySelectorAll('.finance-file-name')).map(a=>a.href)})")))?;
                            let popup = handle.webview_windows().into_iter()
                                .find(|(label, _)| label.starts_with("document-"))
                                .ok_or("Invoice window was not registered")?.1;
                            wait_for(&popup, "document.contentType === 'application/pdf' || !!document.querySelector('embed[type=\"application/pdf\"]')")?;
                            if serde_json::json!(popup.url().map_err(|error| error.to_string())?.as_str()) != file_url {
                                return Err("The PDF window opened an unexpected URL".into());
                            }
                            println!("Native PDF rendered with authenticated session: {category}, {source}");
                            popup.close().map_err(|error| error.to_string())?;
                            wait_until(|| handle.webview_windows().len() == previous)?;
                        }
                    }
                    Ok(())
                })();
                if let Err(error) = &result {
                    eprintln!("Native invoice test failed: {error}");
                }
                *outcome.lock().unwrap() = result;
                handle.exit(0);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Unable to initialize the native invoice test")
        .run_return(|_, _| {});
    drop(backend.stdin.take());
    backend.wait().unwrap();
    if let Err(error) = final_outcome.lock().unwrap().as_ref() {
        panic!("{error}");
    };
}

#[cfg(not(target_os = "macos"))]
fn main() {}
