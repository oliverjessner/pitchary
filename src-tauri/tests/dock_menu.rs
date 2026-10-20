#[cfg(target_os = "macos")]
#[allow(dead_code)]
#[path = "../src/dock_menu.rs"]
mod dock_menu;

#[cfg(target_os = "macos")]
fn main() {
    use objc2::{class, msg_send, runtime::AnyObject};
    use std::ffi::CStr;

    tauri::Builder::default()
        .setup(|app| {
            // Exercise the actual AppKit callback on Tauri's real delegate,
            // on the main thread, without opening a window or user database.
            unsafe {
                let application: *mut AnyObject =
                    msg_send![class!(NSApplication), sharedApplication];
                let original_delegate: *mut AnyObject = msg_send![application, delegate];
                dock_menu::install()?;
                let delegate: *mut AnyObject = msg_send![application, delegate];
                assert_eq!(delegate, original_delegate);
                let menu: *mut AnyObject = msg_send![delegate, applicationDockMenu: application];
                assert!(!menu.is_null());
                let count: isize = msg_send![menu, numberOfItems];
                let expected = [
                    "Dashboard",
                    "Kunden",
                    "Personen",
                    "Dienstleistungen",
                    "Pipeline",
                    "Analytics",
                    "Rechnungen",
                    "Umsatz",
                    "Einstellungen",
                ];
                assert_eq!(count, expected.len() as isize);
                for (index, expected_title) in expected.iter().enumerate() {
                    let item: *mut AnyObject = msg_send![menu, itemAtIndex: index as isize];
                    let title: *mut AnyObject = msg_send![item, title];
                    let utf8: *const std::ffi::c_char = msg_send![title, UTF8String];
                    assert_eq!(CStr::from_ptr(utf8).to_str().unwrap(), *expected_title);
                    let enabled: objc2::runtime::Bool = msg_send![item, isEnabled];
                    assert!(enabled.as_bool());
                    let target: *mut AnyObject = msg_send![item, target];
                    assert!(!target.is_null());
                }
            }
            println!("Native Dock callback: all 9 entries are present, enabled and have action targets; Tauri delegate preserved.");
            app.handle().exit(0);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Unable to initialize native Dock test")
        .run(|_, _| {});
}

#[cfg(not(target_os = "macos"))]
fn main() {}
