use std::{cell::RefCell, error::Error, ptr};

use muda::{ContextMenu, Menu, MenuItem};
use objc2::{
    class, msg_send,
    runtime::{AnyObject, Imp, Sel},
    sel, MainThreadMarker,
};
use tauri::{AppHandle, Manager, Url};

const ENTRIES: &[(&str, &str, &str)] = &[
    ("dock-dashboard", "Dashboard", "/dashboard"),
    ("dock-customers", "Kunden", "/customers"),
    ("dock-employees", "Personen", "/employees"),
    ("dock-services", "Dienstleistungen", "/services"),
    ("dock-pipeline", "Pipeline", "/pipeline"),
    ("dock-analytics", "Analytics", "/analytics"),
    ("dock-invoices", "Rechnungen", "/invoices"),
    ("dock-revenue", "Umsatz", "/finance-customers"),
    ("dock-settings", "Einstellungen", "/finance-settings"),
];

thread_local! {
    // AppKit requests the menu on the main thread. Keeping its owner here also
    // retains the native menu and its action targets for the application's life.
    static DOCK_MENU: RefCell<Option<Menu>> = const { RefCell::new(None) };
}

extern "C-unwind" fn application_dock_menu(
    _delegate: &AnyObject,
    _selector: Sel,
    _application: &AnyObject,
) -> *mut AnyObject {
    DOCK_MENU.with(|slot| {
        slot.borrow()
            .as_ref()
            .map_or(ptr::null_mut(), |menu| menu.ns_menu().cast())
    })
}

pub fn install() -> Result<(), Box<dyn Error>> {
    let _main_thread = MainThreadMarker::new().ok_or("Dock menu requires the main thread")?;
    let menu = Menu::new();
    for &(id, label, _) in ENTRIES {
        menu.append(&MenuItem::with_id(id, label, true, None))?;
    }

    // Tauri owns the app delegate. Add only the optional AppKit Dock callback,
    // leaving its window, URL and shutdown handling on the original delegate.
    // SAFETY: Both selectors have their documented AppKit signatures. The
    // delegate is live for the event loop and all access is on the main thread.
    unsafe {
        let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = msg_send![application, delegate];
        let delegate = delegate
            .as_ref()
            .ok_or("Application delegate unavailable")?;
        let selector = sel!(applicationDockMenu:);
        if delegate.class().instance_method(selector).is_some() {
            return Err("Application delegate already provides a Dock menu".into());
        }
        let implementation: Imp = std::mem::transmute(
            application_dock_menu
                as extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> *mut AnyObject,
        );
        if !objc2::ffi::class_addMethod(
            (delegate.class() as *const objc2::runtime::AnyClass).cast_mut(),
            selector,
            implementation,
            c"@@:@".as_ptr(),
        )
        .as_bool()
        {
            return Err("Unable to register the Dock menu".into());
        }
    }
    DOCK_MENU.with(|slot| *slot.borrow_mut() = Some(menu));
    Ok(())
}

fn destination(mut current: Url, id: &str) -> Option<Url> {
    let (_, _, route) = ENTRIES.iter().find(|(item_id, _, _)| *item_id == id)?;
    current.set_path("/");
    current.set_query(None);
    current.set_fragment(Some(route));
    Some(current)
}

pub fn handle_event(app: &AppHandle, id: &str) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        if let Some(url) = destination(window.url()?, id) {
            window.navigate(url)?;
            app.show()?;
            window.show()?;
            window.unminimize()?;
            window.set_focus()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn dock_destinations_use_the_running_backend_and_drop_bootstrap_credentials() {
        use super::*;

        for port in [49175, 50123] {
            let current = Url::parse(&format!(
                "http://127.0.0.1:{port}/?desktop_token=secret#/employees/contact"
            ))
            .unwrap();
            for &(id, _, route) in ENTRIES {
                let target = destination(current.clone(), id).unwrap();
                assert_eq!(target.origin(), current.origin());
                assert_eq!(target.path(), "/");
                assert_eq!(target.query(), None);
                assert_eq!(target.fragment(), Some(route));
            }
            assert!(destination(current, "unrelated-menu-item").is_none());
        }
    }
}
