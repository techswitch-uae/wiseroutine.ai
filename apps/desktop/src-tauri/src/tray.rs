/**
 * The mark in the macOS menu bar, and what it can tell you at a glance.
 *
 * Two jobs. The icon says the app is running, so that closing the window is
 * not mistaken for stopping it. The title beside it and the menu behind it
 * carry the one thing worth knowing without switching apps: what is up next,
 * how long until it starts, and a way to start it now.
 *
 * `icon_as_template` is what makes it behave like every other menu bar icon.
 * The PNG is pure black plus alpha, and macOS paints it itself - dark on a
 * light bar, light on a dark one, inverted again while the item is selected.
 * Without the flag the same file renders as a permanently black blob that
 * disappears into a dark menu bar.
 *
 * ponytail: a native menu, not a popover window. A window would add quick-add
 * and richer layout, and cost positioning under the icon, dismiss-on-blur, its
 * own route and its own fetch. Build it when quick-add from the menu bar is
 * the thing people ask for; until then the menu says the same things natively
 * and for free.
 */
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// What the webview knows about the day, reduced to what fits in a menu bar.
///
/// Deliberately pre-formatted. Working out that a slot is "in 18 min" needs
/// the plan, the clock and the user's timezone, all of which the webview
/// already holds and none of which is worth teaching Rust a second time.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpNext {
  /// "Shoulder stretch · 11:40", or absent when the day has nothing left.
  pub label: Option<String>,
  /// The countdown drawn next to the icon, e.g. "18m". Absent leaves the menu
  /// bar showing the icon alone, which is the right look for an empty day.
  pub badge: Option<String>,
  /// Present only while a slot is actually startable, which is what decides
  /// whether "Start now" is live or greyed.
  pub slot_id: Option<String>,
}

const TRAY_ID: &str = "menu-bar";

/// Rebuild the menu and the title from the day as it now stands.
///
/// Rebuilt whole rather than mutated in place: the menu changes at most once a
/// minute, and swapping five items is cheaper to read than tracking which of
/// them moved.
fn render<R: Runtime>(app: &AppHandle<R>, next: &UpNext) -> tauri::Result<()> {
  use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};

  let Some(tray) = app.tray_by_id(TRAY_ID) else {
    return Ok(());
  };

  let heading = MenuItemBuilder::with_id("up-next", next.label.as_deref().unwrap_or("Nothing up next"))
    .enabled(false)
    .build(app)?;

  // Greyed rather than hidden when there is nothing to start: an item that
  // comes and goes makes the menu jump under the cursor.
  let start = MenuItemBuilder::with_id("start", "Start now")
    .enabled(next.slot_id.is_some())
    .build(app)?;

  let pause = MenuItemBuilder::with_id("pause", "Pause for an hour").build(app)?;
  let show = MenuItemBuilder::with_id("show", "Open Wise Routine").build(app)?;
  let quit = MenuItemBuilder::with_id("quit", "Quit Wise Routine").build(app)?;

  let menu = MenuBuilder::new(app)
    .items(&[
      &heading,
      &start,
      &PredefinedMenuItem::separator(app)?,
      &pause,
      &show,
      &PredefinedMenuItem::separator(app)?,
      &quit,
    ])
    .build()?;

  tray.set_menu(Some(menu))?;
  tray.set_title(next.badge.as_deref())?;
  Ok(())
}

/// Tell the menu bar what is up next. Called from the webview whenever the
/// plan or the clock moves it on.
#[tauri::command]
pub fn set_up_next<R: Runtime>(app: AppHandle<R>, next: UpNext) -> tauri::Result<()> {
  render(&app, &next)
}

/// Bring the window back after a close hid it.
fn show_window<R: Runtime>(app: &AppHandle<R>) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

pub fn install<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
  use tauri::{image::Image, tray::TrayIconBuilder};

  // Compiled in rather than read from disk: the tray is built during setup,
  // before there is anywhere to have shipped a loose file to.
  let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
  let tray = TrayIconBuilder::with_id(TRAY_ID)
    .icon(icon)
    .on_menu_event(|app, event| match event.id().as_ref() {
      // Ends the process rather than closing the window. There is no
      // accelerator on it: the app menu already owns Cmd+Q, and a second
      // registration of the same chord is a fight nobody wins.
      "quit" => app.exit(0),
      "show" => show_window(app),
      // Acted on by the webview, which owns the session and the queue that
      // makes these work offline. Rust only carries the press across.
      "start" => {
        let _ = app.emit("tray://start", ());
      }
      "pause" => {
        show_window(app);
        let _ = app.emit("tray://pause", ());
      }
      _ => {}
    });

  #[cfg(target_os = "macos")]
  let tray = tray.icon_as_template(true);

  tray.build(app)?;
  render(&app.handle().clone(), &UpNext::default())
}
