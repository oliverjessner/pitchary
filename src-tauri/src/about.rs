use std::cell::RefCell;

use objc2::{rc::Retained, runtime::AnyObject, AnyThread, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSColor, NSFont, NSFontAttributeName, NSForegroundColorAttributeName,
    NSImage, NSImageScaling, NSImageView, NSLayoutAttribute, NSLinkAttributeName, NSPanel, NSStackView,
    NSStackViewDistribution, NSTextAlignment, NSTextField, NSUserInterfaceLayoutOrientation,
    NSWindowStyleMask, NSWindowTitleVisibility,
};
use objc2_foundation::{
    ns_string, NSAttributedString, NSData, NSDictionary, NSEdgeInsets, NSRect, NSSize, NSString, NSURL,
};
use tauri::menu::MenuItem;

const MENU_ID: &str = "pitchary-about";

thread_local! {
    // AppKit objects stay on the main thread. Retain the panel after closing so
    // subsequent About actions reuse it instead of opening duplicate windows.
    static PANEL: RefCell<Option<Retained<NSPanel>>> = const { RefCell::new(None) };
}

pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let menu = app.menu().ok_or("Application menu unavailable")?;
    let items = menu.items()?;
    let app_menu = items
        .first()
        .and_then(|item| item.as_submenu())
        .ok_or("Application submenu unavailable")?;
    let entries = app_menu.items()?;
    let original = entries
        .first()
        .and_then(|item| item.as_predefined_menuitem())
        .ok_or("Default About menu item unavailable")?;
    let about = MenuItem::with_id(app, MENU_ID, original.text()?, true, None::<&str>)?;
    app_menu.remove_at(0)?;
    app_menu.insert(&about, 0)?;
    Ok(())
}

pub fn handle_event(app: &tauri::AppHandle, id: &str) -> tauri::Result<()> {
    if id != MENU_ID {
        return Ok(());
    }
    let name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| app.package_info().name.clone());
    let version = app
        .config()
        .version
        .clone()
        .unwrap_or_else(|| app.package_info().version.to_string());
    app.run_on_main_thread(move || {
        let mtm = MainThreadMarker::new().expect("About panel requires the main thread");
        PANEL.with(|slot| {
            let mut slot = slot.borrow_mut();
            let panel = slot.get_or_insert_with(|| panel(mtm, &name, &version));
            panel.makeKeyAndOrderFront(None);
        });
    })
}

fn label(mtm: MainThreadMarker, text: &str, font: &NSFont, color: &NSColor) -> Retained<NSTextField> {
    let label = NSTextField::labelWithString(&NSString::from_str(text), mtm);
    label.setFont(Some(font));
    label.setTextColor(Some(color));
    label.setAlignment(NSTextAlignment::Center);
    label.setTranslatesAutoresizingMaskIntoConstraints(false);
    label
}

fn website_link(mtm: MainThreadMarker) -> Retained<NSTextField> {
    let url =
        NSURL::URLWithString(ns_string!("https://oliverjessner.at")).expect("Valid author website URL");
    let font = NSFont::systemFontOfSize(12.0);
    let color = NSColor::linkColor();
    // SAFETY: These are AppKit's documented attributed-string keys and their
    // corresponding NSURL, NSFont and NSColor value types.
    let title = unsafe {
        let attributes = NSDictionary::from_slices(
            &[
                NSLinkAttributeName,
                NSFontAttributeName,
                NSForegroundColorAttributeName,
            ],
            &[
                &*url as &AnyObject,
                &*font as &AnyObject,
                &*color as &AnyObject,
            ],
        );
        NSAttributedString::initWithString_attributes(
            NSAttributedString::alloc(),
            ns_string!("oliverjessner.at"),
            Some(&attributes),
        )
    };
    let link = NSTextField::labelWithAttributedString(&title, mtm);
    // A selectable, non-editable rich-text field lets AppKit handle the link
    // through the user's default browser without a WebView or IPC permissions.
    link.setAllowsEditingTextAttributes(true);
    link.setSelectable(true);
    link.setEditable(false);
    link.setAlignment(NSTextAlignment::Center);
    link.setTranslatesAutoresizingMaskIntoConstraints(false);
    link
}

fn panel(mtm: MainThreadMarker, name: &str, version: &str) -> Retained<NSPanel> {
    let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
        NSPanel::alloc(mtm),
        NSRect::ZERO,
        NSWindowStyleMask::Titled | NSWindowStyleMask::Closable,
        NSBackingStoreType::Buffered,
        false,
    );
    // SAFETY: PANEL owns this retained window for its entire reusable lifetime.
    unsafe { panel.setReleasedWhenClosed(false) };
    panel.setTitle(&NSString::from_str(&format!("About {name}")));
    panel.setTitleVisibility(NSWindowTitleVisibility::Hidden);
    panel.setTitlebarAppearsTransparent(true);
    panel.setHidesOnDeactivate(false);

    let icon_data = NSData::with_bytes(include_bytes!("../icons/icon.icns"));
    let image = NSImage::initWithData(NSImage::alloc(), &icon_data)
        .expect("Bundled app icon must be a valid image");
    let icon = NSImageView::imageViewWithImage(&image, mtm);
    icon.setImageScaling(NSImageScaling::ScaleProportionallyUpOrDown);
    icon.setTranslatesAutoresizingMaskIntoConstraints(false);
    icon.widthAnchor()
        .constraintEqualToConstant(52.0)
        .setActive(true);
    icon.heightAnchor()
        .constraintEqualToConstant(52.0)
        .setActive(true);

    let font = NSFont::systemFontOfSize(12.0);
    let secondary = NSColor::secondaryLabelColor();
    let name = label(
        mtm,
        name,
        &NSFont::boldSystemFontOfSize(16.0),
        &NSColor::labelColor(),
    );
    let version = label(mtm, &format!("Version {version}"), &font, &secondary);
    let copyright = label(mtm, "Copyright © 2026 Oliver Jessner", &font, &secondary);
    let license = label(mtm, "MIT License", &font, &secondary);
    let website = website_link(mtm);

    let stack = NSStackView::new(mtm);
    stack.setOrientation(NSUserInterfaceLayoutOrientation::Vertical);
    stack.setAlignment(NSLayoutAttribute::CenterX);
    stack.setDistribution(NSStackViewDistribution::Fill);
    stack.setSpacing(6.0);
    stack.setEdgeInsets(NSEdgeInsets {
        top: 16.0,
        left: 32.0,
        bottom: 24.0,
        right: 32.0,
    });
    stack.addArrangedSubview(&icon);
    stack.addArrangedSubview(&name);
    stack.addArrangedSubview(&version);
    stack.addArrangedSubview(&copyright);
    stack.addArrangedSubview(&license);
    stack.addArrangedSubview(&website);
    stack.setCustomSpacing_afterView(12.0, &icon);
    stack.setCustomSpacing_afterView(12.0, &version);

    // Auto Layout measures the actual system fonts and app metadata. There is
    // no fixed window height, clipping container or scroll view.
    let size = stack.fittingSize();
    let size = NSSize::new(size.width.ceil(), size.height.ceil());
    stack.setFrameSize(size);
    panel.setContentView(Some(&stack));
    panel.setContentSize(size);
    stack.layoutSubtreeIfNeeded();
    panel.center();
    panel
}
