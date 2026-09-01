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
 *
 * It has since grown a second job, and one file rather than two because both
 * are the same mechanism: everything the app says while you are not looking at
 * it. One schedule, one clock, two outputs - the title beside the icon, and
 * the notification when a slot comes round. Splitting them would mean the
 * schedule and the tick living in a third file that both imported, which is
 * more moving parts than either job has on its own.
 */
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;

/// One of the day's remaining slots, as the menu bar needs it.
///
/// Timestamps rather than the finished sentence, and this is the fix for a
/// real bug: the webview used to work out "Breathing · now" and push the
/// finished string here every 30 seconds. Closing the window *hides* it (see
/// `on_window_event`), and a hidden WKWebView's timers are throttled and
/// eventually suspended by App Nap - so the last thing pushed before the
/// window went away stayed in the menu bar, naming an activity that had long
/// since finished. Exactly when the menu bar is the only thing you can see.
///
/// So the webview says what the day *is*, once per change, and the picking and
/// the counting happen here, on a clock that keeps running. `up_next` below is
/// `upNextOf` in `lib/alerts.ts`, and the two have to keep agreeing - the
/// webview still uses its copy to decide what "Start now" starts.
///
/// The start notifications were lost to the same thing, and worse: a menu bar
/// that is a minute stale is untidy, but an alert that never arrives is the
/// whole product failing quietly. They were one `setTimeout` per slot in that
/// same webview. They are `due_starts` below now.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
  pub id: String,
  pub title: String,
  pub starts_at: i64,
  pub ends_at: i64,
}

/// The day as last pushed, and what has already been said about it.
///
/// One lock over the three together rather than three locks: every read wants
/// all of them, and a tick that took them one at a time could announce a start
/// against a schedule that had been replaced halfway through.
#[derive(Default)]
struct DayState {
  /// Empty until the webview has loaded a plan, which renders "Nothing up
  /// next" - the honest answer before we know.
  entries: Vec<Entry>,
  /// Starts already announced, keyed by id *and* time, so a slot that moves is
  /// announced again at its new time - which is the whole point of a plan that
  /// rebuilds itself.
  announced: HashSet<String>,
}

#[derive(Default)]
struct Day(Mutex<DayState>);

/// What the menu bar draws, worked out from the schedule and the clock.
#[derive(Default)]
pub struct UpNext {
  /// "Shoulder stretch", or absent when the day has nothing left. Named in the
  /// menu bar itself and not only in the menu behind it: a bare "18m" says
  /// something is coming without saying what, which is the one thing worth
  /// knowing without switching apps.
  pub title: Option<String>,
  /// How long it runs, e.g. "10 min". Shown under the name in the menu.
  pub label: Option<String>,
  /// The countdown drawn next to the icon, e.g. "18m". Absent leaves the menu
  /// bar showing the icon alone, which is the right look for an empty day.
  pub badge: Option<String>,
  /// Present only while a slot is actually startable, which is what decides
  /// whether "Start now" is live or greyed.
  pub slot_id: Option<String>,
}

fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    // A clock before 1970 is not a case worth a branch anywhere else.
    .unwrap_or(0)
}

/// "18m", or "2h 05m". Rounded up, because a slot 90 seconds away reading
/// "1m" and then sitting there for the next 89 of them looks stuck.
fn countdown(ms: i64) -> String {
  let minutes = if ms <= 0 { 0 } else { (ms + 59_999) / 60_000 };
  if minutes < 60 {
    format!("{minutes}m")
  } else {
    // Both units named. Without the second one this read "9h 10", which is
    // not a duration - it is two numbers, and the eye has to guess which.
    format!("{}h {:02}m", minutes / 60, minutes % 60)
  }
}

/// The one slot worth naming: the earliest that has not finished yet.
///
/// Note `ends_at > now` rather than `starts_at > now`. Something running right
/// now *is* what is up next - dropping it the moment it began would leave the
/// menu bar naming the thing after it while you were still in this one.
fn up_next(entries: &[Entry], now: i64) -> UpNext {
  let Some(entry) = entries
    .iter()
    .filter(|entry| entry.ends_at > now)
    .min_by_key(|entry| entry.starts_at)
  else {
    return UpNext::default();
  };

  let live = entry.starts_at <= now;
  UpNext {
    title: Some(entry.title.clone()),
    label: Some(format!("{} min", minutes(entry))),
    badge: Some(if live {
      "now".to_string()
    } else {
      countdown(entry.starts_at - now)
    }),
    // Only offered while it is actually startable. Starting something an hour
    // early is not a shortcut, it is a different plan.
    slot_id: live.then(|| entry.id.clone()),
  }
}

/// How long a slot runs, in whole minutes.
fn minutes(entry: &Entry) -> i64 {
  (entry.ends_at - entry.starts_at + 30_000) / 60_000
}

/// How late an alert may still fire.
///
/// A slot whose start was missed while the machine was asleep should not
/// announce itself an hour afterwards - by then the day has been replanned
/// around it and the notification is a lie. But firing only on the exact
/// millisecond loses every alert to a tick that ran a beat late, so there is a
/// window rather than an instant.
const LATE: i64 = 90_000;

/// The starts that have just come round and have not been announced yet.
///
/// Takes `&mut` and records what it returns, so calling it twice with the same
/// clock is not two notifications. That "exactly once" is the whole reason the
/// announced set exists: the tick runs every fifteen seconds, and a start
/// stays inside the `LATE` window for six of them.
fn due_starts(state: &mut DayState, now: i64) -> Vec<Entry> {
  let ready: Vec<Entry> = state
    .entries
    .iter()
    .filter(|entry| {
      entry.starts_at <= now && entry.starts_at > now - LATE
    })
    .cloned()
    .collect();

  ready
    .into_iter()
    .filter(|entry| {
      state
        .announced
        .insert(format!("{}@{}", entry.id, entry.starts_at))
    })
    .collect()
}

/// Say that a slot has come round.
///
/// Failure is swallowed on purpose: notifications the user has denied, or an
/// OS that dropped it, are not something the menu bar can do anything about,
/// and a panic in the tick would take the clock down with it.
fn announce<R: Runtime>(app: &AppHandle<R>, entry: &Entry) {
  let _ = app
    .notification()
    .builder()
    .title(entry.title.clone())
    .body(format!("{} min. Starting now.", minutes(entry)))
    .show();
}

/// How much of a name the menu bar may take.
///
/// The title sits between the other status items and the clock, and a long
/// activity name pushes all of them along. Ellipsised rather than dropped: a
/// truncated name still says which of your activities this is.
const TITLE_MAX: usize = 22;

fn menu_bar_title(next: &UpNext) -> Option<String> {
  let badge = next.badge.as_deref()?;
  let Some(title) = next.title.as_deref() else {
    return Some(badge.to_string());
  };

  // By character, not by byte: an activity someone named with an emoji or an
  // accent would otherwise be cut mid-codepoint and panic.
  let short: String = if title.chars().count() > TITLE_MAX {
    title.chars().take(TITLE_MAX - 1).collect::<String>() + "…"
  } else {
    title.to_string()
  };
  Some(format!("{short} · {badge}"))
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
    // Said out loud. A menu bar that stops updating looks exactly like one
    // with nothing to say, so the one thing that must not happen here is
    // failing quietly - see the note on `refresh`.
    eprintln!("tray: no icon with id {TRAY_ID}; menu bar left as it was");
    return Ok(());
  };

  let heading_text = match (next.title.as_deref(), next.label.as_deref()) {
    (Some(title), Some(label)) => format!("{title} · {label}"),
    (Some(title), None) => title.to_string(),
    _ => "Nothing up next".to_string(),
  };
  let heading = MenuItemBuilder::with_id("up-next", heading_text)
    .enabled(false)
    .build(app)?;

  // Greyed rather than hidden when there is nothing to start: an item that
  // comes and goes makes the menu jump under the cursor.
  let start = MenuItemBuilder::with_id("start", "Start now")
    .enabled(next.slot_id.is_some())
    .build(app)?;

  // Quit stays, and is not swapped for a Hide. Closing the window already
  // hides it, and once it is hidden this menu is the only way to stop the app
  // that is always reachable - Cmd+Q needs the app to be focused, which it
  // cannot be. Reopening is the dock icon's job; see `RunEvent::Reopen`.
  let quit = MenuItemBuilder::with_id("quit", "Quit Wise Routine").build(app)?;

  let menu = MenuBuilder::new(app)
    .items(&[
      &heading,
      &start,
      &PredefinedMenuItem::separator(app)?,
      &quit,
    ])
    .build()?;

  tray.set_menu(Some(menu))?;
  tray.set_title(menu_bar_title(next).as_deref())?;
  Ok(())
}

/// Say whatever the day now calls for: the starts that have come round, and
/// the menu bar as it should read this second.
///
/// The lock is taken once and let go before anything is shown. Holding it
/// across the notification would mean a slow OS call blocking the next push
/// from the webview, for no gain - `due_starts` has already recorded what it
/// returned, so nothing else can claim the same start.
fn refresh<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
  let now = now_ms();
  let (entries, due) = {
    /*
     * Taken back off a panic rather than given up on.
     *
     * This used to return on a poisoned lock, on the grounds that the panic
     * was better reported elsewhere. But the tick is the only thing that ever
     * redraws the bar, so one poisoned lock stopped it redrawing *for the life
     * of the process* - the menu bar frozen on whatever it happened to be
     * saying, hours after that was true, on a machine where everything else
     * still worked. A stale title is indistinguishable from a correct one,
     * which is what made it so hard to see.
     *
     * The state behind the lock is a schedule and a set of ids. A panic
     * mid-update can leave it out of date, never inconsistent, and the next
     * push replaces it wholesale.
     */
    let day = app.state::<Day>();
    let mut state = day.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let due = due_starts(&mut state, now);
    (state.entries.clone(), due)
  };

  for entry in &due {
    announce(app, entry);
  }
  render(app, &up_next(&entries, now))
}

/// Tell the app what today holds. Called from the webview whenever the plan
/// changes - not on a clock, which is what `tick` is for.
///
/// The announced set is deliberately *not* cleared here. A plan re-read is not
/// news, and clearing it would announce every slot of the day again every time
/// the day was reloaded.
#[tauri::command]
pub fn set_schedule<R: Runtime>(app: AppHandle<R>, entries: Vec<Entry>) -> tauri::Result<()> {
  if let Ok(mut state) = app.state::<Day>().0.lock() {
    state.entries = entries;
  }
  refresh(&app)
}

/// How often the app re-reads its own clock.
///
/// Under a minute because that is the menu bar's smallest unit, and well
/// inside `LATE` so no start can pass through the window unannounced. It is a
/// redraw of six menu items, not work.
const TICK: Duration = Duration::from_secs(15);

/// The clock the day runs on, in the process rather than in the webview.
///
/// A thread rather than a timer in the frontend: see `Entry`. Nothing here
/// asks the webview for anything, so it keeps counting while the window is
/// hidden, which is the case that was broken.
fn tick<R: Runtime>(app: &AppHandle<R>) {
  let handle = app.clone();
  std::thread::spawn(move || {
    loop {
      std::thread::sleep(TICK);
      let inner = handle.clone();
      // Menus and tray titles are AppKit objects, and touching them off the
      // main thread is undefined behaviour rather than an error.
      if let Err(error) = handle.run_on_main_thread(move || {
        if let Err(error) = refresh(&inner) {
          eprintln!("tray: refresh failed: {error}");
        }
      }) {
        eprintln!("tray: could not reach the main thread: {error}");
      }
    }
  });
}

/// Bring the window back after a close hid it. Called from the dock icon and
/// from any menu item that only makes sense with the window in front.
pub fn show_window<R: Runtime>(app: &AppHandle<R>) {
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
      // Acted on by the webview, which owns the session and the queue that
      // makes these work offline. Rust only carries the press across.
      "start" => {
        let _ = app.emit("tray://start", ());
      }
      _ => {}
    });

  #[cfg(target_os = "macos")]
  let tray = tray.icon_as_template(true);

  // Before the tray, not after. The menu items and the webview's first push
  // both read this state, and either arriving in the gap between building the
  // tray and managing it would panic on a `State` that does not exist yet.
  app.manage(Day::default());
  tray.build(app)?;

  let handle = app.handle().clone();
  tick(&handle);
  render(&handle, &UpNext::default())
}

#[cfg(test)]
mod tests {
  use super::*;

  const MIN: i64 = 60_000;
  const AT: i64 = 1_700_000_000_000;

  fn entry(id: &str, starts_at: i64, ends_at: i64) -> Entry {
    Entry {
      id: id.to_string(),
      title: "Breathing".to_string(),
      starts_at,
      ends_at,
    }
  }

  /// The reported bug, as a test: an activity that has finished must leave the
  /// menu bar, and it must leave on the clock alone - no new push from the
  /// webview, which is the thing that had stopped arriving.
  #[test]
  fn drops_a_slot_once_it_has_finished() {
    let day = [entry("a", AT, AT + 10 * MIN)];

    let during = up_next(&day, AT + 5 * MIN);
    assert_eq!(during.title.as_deref(), Some("Breathing"));
    assert_eq!(during.badge.as_deref(), Some("now"));

    // Same schedule, later clock. Nothing else changed.
    let after = up_next(&day, AT + 11 * MIN);
    assert_eq!(after.title, None);
    assert_eq!(after.badge, None);
    assert_eq!(menu_bar_title(&after), None);
  }

  #[test]
  fn names_the_earliest_slot_still_to_come() {
    let day = [
      entry("over", AT - 30 * MIN, AT - 20 * MIN),
      entry("next", AT + MIN, AT + 11 * MIN),
      entry("later", AT + 40 * MIN, AT + 50 * MIN),
    ];
    let next = up_next(&day, AT);
    assert_eq!(next.badge.as_deref(), Some("1m"));
    assert_eq!(next.label.as_deref(), Some("10 min"));
    // Not startable yet, so the menu item stays greyed.
    assert_eq!(next.slot_id, None);
  }

  #[test]
  fn offers_a_start_only_once_the_slot_is_live() {
    let day = [entry("a", AT - MIN, AT + 9 * MIN)];
    assert_eq!(up_next(&day, AT).slot_id.as_deref(), Some("a"));
  }

  fn day(entries: &[Entry]) -> DayState {
    DayState {
      entries: entries.to_vec(),
      ..DayState::default()
    }
  }

  /// The other half of the same bug: these were one `setTimeout` each in a
  /// webview that gets suspended when the window is hidden.
  #[test]
  fn announces_a_start_exactly_once() {
    let mut state = day(&[entry("a", AT, AT + 10 * MIN)]);

    assert_eq!(due_starts(&mut state, AT - 1).len(), 0, "not yet");

    let due = due_starts(&mut state, AT);
    assert_eq!(due.len(), 1);
    assert_eq!(minutes(&due[0]), 10);

    // The tick comes round every 15 seconds and the start stays inside the
    // late window for six of them. Only the first may speak.
    assert_eq!(due_starts(&mut state, AT + 15_000).len(), 0);
    assert_eq!(due_starts(&mut state, AT + 30_000).len(), 0);
  }

  #[test]
  fn stays_quiet_about_a_start_it_slept_through() {
    let mut state = day(&[entry("a", AT, AT + 10 * MIN)]);
    // Woken well after the fact. By now the day has been replanned around it
    // and the notification would be a lie.
    assert_eq!(due_starts(&mut state, AT + LATE + 1).len(), 0);
  }

  #[test]
  fn announces_a_slot_again_once_it_has_moved() {
    let mut state = day(&[entry("a", AT, AT + 10 * MIN)]);
    assert_eq!(due_starts(&mut state, AT).len(), 1);

    // Same slot, replanned half an hour later. That is a new thing to say.
    state.entries = vec![entry("a", AT + 30 * MIN, AT + 40 * MIN)];
    assert_eq!(due_starts(&mut state, AT + 30 * MIN).len(), 1);
  }

  #[test]
  fn counts_the_same_way_the_webview_does() {
    assert_eq!(countdown(90_000), "2m");
    assert_eq!(countdown(125 * MIN), "2h 05m");
    assert_eq!(countdown(-5 * MIN), "0m");
  }

  #[test]
  fn ellipsises_a_long_name_by_character() {
    let mut next = up_next(&[entry("a", AT, AT + MIN)], AT);
    next.title = Some("Café ☕ and a very long stretch name".to_string());
    let title = menu_bar_title(&next).unwrap();
    assert_eq!(title, "Café ☕ and a very lon… · now");
  }
}
