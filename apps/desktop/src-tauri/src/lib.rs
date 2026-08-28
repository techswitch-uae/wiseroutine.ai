// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
fn greet() -> String {
  let now = SystemTime::now();
  let epoch_ms = now.duration_since(UNIX_EPOCH).unwrap().as_millis();
  format!("Hello world from Rust! Current epoch: {epoch_ms}")
}

/**
 * The mark in the macOS menu bar, and the one thing behind it.
 *
 * Quit only. The icon is there to say the app is running, and the menu exists
 * so that closing the window is not the same as stopping the app — which is
 * the confusion a menu bar icon otherwise creates.
 *
 * `icon_as_template` is what makes it behave like every other menu bar icon.
 * The PNG is pure black plus alpha, and macOS paints it itself — dark on a
 * light bar, light on a dark one, inverted again while the item is selected.
 * Without the flag the same file renders as a permanently black blob that
 * disappears into a dark menu bar.
 */
#[cfg(desktop)]
fn menu_bar_icon(app: &tauri::App) -> tauri::Result<()> {
  use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
  };

  let quit = MenuItemBuilder::with_id("quit", "Quit Wise Routine").build(app)?;
  let menu = MenuBuilder::new(app).items(&[&quit]).build()?;

  // Compiled in rather than read from disk: the tray is built during setup,
  // before there is anywhere to have shipped a loose file to.
  let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
  let tray = TrayIconBuilder::with_id("menu-bar")
    .icon(icon)
    .menu(&menu)
    .on_menu_event(|app, event| {
      if event.id().as_ref() == "quit" {
        // Ends the process rather than closing the window. There is no
        // accelerator on it: the app menu already owns Cmd+Q, and a second
        // registration of the same chord is a fight nobody wins.
        app.exit(0);
      }
    });

  #[cfg(target_os = "macos")]
  let tray = tray.icon_as_template(true);

  tray.build(app)?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

  // The updater downloads and swaps the app bundle; `process` is what lets it
  // restart into the version it just installed. Neither exists on mobile.
  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init());

  builder
    .setup(|app| {
      #[cfg(desktop)]
      menu_bar_icon(app)?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![greet])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
