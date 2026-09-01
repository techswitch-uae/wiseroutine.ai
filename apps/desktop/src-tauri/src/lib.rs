// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
// Desktop only, like the updater below: there is no menu bar to put an icon
// in on a phone.
mod addons;

#[cfg(desktop)]
mod tray;

use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
fn greet() -> String {
  let now = SystemTime::now();
  let epoch_ms = now.duration_since(UNIX_EPOCH).unwrap().as_millis();
  format!("Hello world from Rust! Current epoch: {epoch_ms}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_notification::init())
    // An addon frame is served over its own scheme so that it is a *fetched*
    // document rather than a local one - which is what stops it inheriting
    // this app's Content-Security-Policy and lets it carry its own. See
    // `addons.rs`; the reason is subtle and only shows up in a release build.
    .register_uri_scheme_protocol(addons::SCHEME, addons::serve);

  // ponytail: debug builds only, so it never ships.
  #[cfg(debug_assertions)]
  let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

  // The updater downloads and swaps the app bundle; `process` is what lets it
  // restart into the version it just installed. Neither exists on mobile.
  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init());

  #[cfg(desktop)]
  let builder = builder
    .setup(|app| {
      tray::install(app)?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      greet,
      tray::set_schedule,
      addons::install_addon
    ]);

  #[cfg(not(desktop))]
  let builder =
    builder.invoke_handler(tauri::generate_handler![greet, addons::install_addon]);

  builder
    .on_window_event(|window, event| {
      // Closing the window hides it; the process keeps running behind the menu
      // bar icon. Load-bearing rather than a nicety: the day's notifications
      // are scheduled by the webview, so quitting on close would mean the app
      // only ever reminds you while you are already looking at it. Quit is on
      // the tray menu and on Cmd+Q, both of which still end the process.
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app, _event| {
      // Clicking the dock icon while the window is hidden brings it back.
      // Without this, closing the window on macOS leaves the app running with
      // no obvious way in: the dock icon bounces and nothing appears, which
      // reads as the app being broken rather than backgrounded.
      #[cfg(target_os = "macos")]
      if let tauri::RunEvent::Reopen { .. } = _event {
        tray::show_window(_app);
      }
    });
}
