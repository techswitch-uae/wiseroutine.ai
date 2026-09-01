//! Serving an addon its own origin, with its own Content-Security-Policy.
//!
//! # Why this exists at all
//!
//! An addon runs in a sandboxed frame. The obvious way to build that frame is
//! `srcdoc`, and it works - right up until the app is packaged, at which point
//! it stops, silently.
//!
//! A document created from a *local scheme* - `about:srcdoc`, `about:blank`,
//! `blob:`, `data:` - inherits its parent's Content-Security-Policy. The app
//! ships with `default-src 'self'`, so an addon frame built from `srcdoc`
//! inherits it, and the addon's own inline script is refused. In development
//! the app is served by Vite and Tauri attaches no CSP header at all, so the
//! frame works there and only there: the failure appears for the first time in
//! a release build.
//!
//! A document *fetched* over a real scheme does not inherit. It gets the CSP
//! of its own response, which is what this file is for: one small HTML
//! document per addon, served over the `addon:` scheme, carrying a policy
//! built from that addon's own manifest.
//!
//! # What the boundary is made of
//!
//! Three separate things, and it is worth being clear about which does what,
//! because they are easy to confuse for one another:
//!
//! 1. **The scheme** is what gives the response its own CSP header. That is
//!    this file's entire job.
//! 2. **`sandbox="allow-scripts"`** on the iframe, set by the frontend, is
//!    what makes the origin opaque - so no storage, and no reaching the app.
//!    A custom scheme alone would give every addon the *same* origin
//!    (`addon://localhost`), and one addon could then read another's.
//! 3. **The capability check** in the host bridge is what governs what an
//!    addon may ask the app to do. Nothing here knows about capabilities
//!    beyond turning `net:fetch` into a `connect-src`.
//!
//! # The store
//!
//! Installed addons live under the app data directory, written by
//! `install_addon`. Today the frontend fetches a bundled addon and hands it
//! over; when there is a registry, the bytes will arrive from there and their
//! signature will be checked *here*, before anything is written - which is the
//! reason installing is a Rust command rather than a directory the webview
//! writes to directly.

use std::fs;
use std::path::PathBuf;

// `http` through Tauri rather than as a dependency of our own: the types
// have to be the ones its protocol handler expects, and a second copy of
// the crate at a different version would not be.
use tauri::http;
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext};

/// The scheme addon frames are served from.
///
/// The URL differs by platform - `addon://localhost/…` on macOS and Linux,
/// `http://addon.localhost/…` on Windows - which is why the frontend builds it
/// with Tauri's own `convertFileSrc` rather than by concatenation.
pub const SCHEME: &str = "addon";

/// An addon id, as a path component.
///
/// The id is taken from a manifest and then used to build a path, which makes
/// it the one piece of attacker-controlled input in this file. Checked against
/// the same shape `@wiseroutine/addons` enforces - lowercase, dot or hyphen
/// separated - which as a side effect contains no separator, no `..` and no
/// null byte. Rejecting rather than sanitising: an id that needs cleaning up
/// is an id that should not have been published.
fn is_valid_id(id: &str) -> bool {
  if id.is_empty() || id.len() > 64 {
    return false;
  }

  let mut previous_separator = true;
  for byte in id.bytes() {
    match byte {
      b'a'..=b'z' | b'0'..=b'9' => previous_separator = false,
      b'.' | b'-' => {
        // No leading, trailing or doubled separator, which is what stops `..`
        // without needing to look for it.
        if previous_separator {
          return false;
        }
        previous_separator = true;
      }
      _ => return false,
    }
  }
  !previous_separator
}

fn store_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
  app.path().app_data_dir().ok().map(|dir| dir.join("addons"))
}

/// Write an addon where the protocol handler can serve it.
///
/// The frontend calls this once per installed addon at startup. It is
/// deliberately the only way in: when bundles come from a registry, the
/// signature check belongs on this side of the boundary, before bytes reach
/// the disk, and a directory the webview wrote to directly would have no such
/// gate.
#[tauri::command]
pub fn install_addon<R: Runtime>(
  app: AppHandle<R>,
  id: String,
  manifest: String,
  bundle: String,
) -> Result<(), String> {
  if !is_valid_id(&id) {
    return Err(format!("not an addon id: {id}"));
  }

  // A manifest that is not JSON would be served to a frame that then cannot
  // read it. Cheaper to refuse it here than to debug it there.
  serde_json::from_str::<serde_json::Value>(&manifest)
    .map_err(|error| format!("manifest is not JSON: {error}"))?;

  let dir = store_dir(&app)
    .ok_or_else(|| "no app data directory".to_string())?
    .join(&id);

  fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  fs::write(dir.join("manifest.json"), manifest).map_err(|error| error.to_string())?;
  fs::write(dir.join("addon.js"), bundle).map_err(|error| error.to_string())?;

  Ok(())
}

/// The origins an addon declared, as a `connect-src` value.
///
/// Read from the manifest rather than passed in, so the policy cannot be
/// widened by whatever asked for the frame. An addon that declared nothing
/// gets `'none'`, which is most of them and is the right default: a pacer that
/// draws a circle has no business making requests.
fn connect_src(manifest: &str) -> String {
  let parsed: serde_json::Value = match serde_json::from_str(manifest) {
    Ok(value) => value,
    Err(_) => return "'none'".to_string(),
  };

  let origins: Vec<String> = parsed
    .get("capabilities")
    .and_then(|value| value.as_array())
    .map(|capabilities| {
      capabilities
        .iter()
        .filter(|capability| {
          capability.get("kind").and_then(|k| k.as_str()) == Some("net:fetch")
        })
        .filter_map(|capability| capability.get("origins")?.as_array())
        .flatten()
        .filter_map(|origin| origin.as_str())
        // Only a plain `https://host`. The same rule `isGrantable` applies on
        // the other side, restated here because this is where it becomes a
        // header - and a header is the half the browser actually enforces.
        .filter(|origin| {
          origin.starts_with("https://")
            && !origin.contains('*')
            && !origin.contains(' ')
            && !origin.contains(';')
            && origin.matches('/').count() == 2
        })
        .map(str::to_string)
        .collect()
    })
    .unwrap_or_default();

  if origins.is_empty() {
    "'none'".to_string()
  } else {
    origins.join(" ")
  }
}

/// The document an addon runs in.
///
/// `script-src 'unsafe-inline'` reads alarmingly and is not: this policy
/// governs one document, whose only script is the bundle put there on the line
/// below, in a frame with an opaque origin and nothing worth taking. The point
/// of serving it from here is precisely that this policy is *not* the app's.
fn document(bundle: &str, connect: &str) -> (String, String) {
  let csp = format!(
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; \
     img-src data: blob:; font-src data:; connect-src {connect}; \
     form-action 'none'; base-uri 'none'; frame-ancestors *"
  );

  // A bundle is text inside a `<script>` element, and `</script>` anywhere in
  // it - in a string literal, in a comment - would close the element early and
  // let the rest be parsed as markup. Escaping the one sequence that can do
  // that is cheaper than a parser, and is done on both sides of this boundary.
  let safe = bundle.replace("</script", "<\\/script");

  let html = format!(
    "<!doctype html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n</head>\n\
     <body>\n<script>{safe}</script>\n</body>\n</html>"
  );

  (html, csp)
}

fn not_found(reason: &str) -> http::Response<Vec<u8>> {
  http::Response::builder()
    .status(http::StatusCode::NOT_FOUND)
    .header(http::header::CONTENT_TYPE, "text/plain")
    .body(reason.as_bytes().to_vec())
    .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

/// Serve `addon://localhost/<id>`.
///
/// One route, and the whole path is the addon id. Deliberately only one: this
/// scheme exists to hand a frame a policy, not to be a filesystem. An addon
/// that wants a second file inlines it - which is also what stops a path here
/// ever naming something outside the store.
///
/// The id is the entire path rather than the first segment of one because the
/// frontend builds this URL with Tauri's `convertFileSrc`, which percent-
/// encodes what it is given: a `/` in there would arrive as `%2F` and would
/// have to be decoded back before it could be split - a decode step on
/// attacker-controlled input, immediately before it is used to build a path,
/// which is the shape of most path traversals. There is no separator, so
/// there is nothing to decode.
pub fn serve<R: Runtime>(
  ctx: UriSchemeContext<'_, R>,
  request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
  let id = request.uri().path().trim_start_matches('/');

  if !is_valid_id(id) {
    return not_found("not an addon id");
  }

  let Some(dir) = store_dir(ctx.app_handle()).map(|dir| dir.join(id)) else {
    return not_found("no app data directory");
  };

  let (Ok(manifest), Ok(bundle)) = (
    fs::read_to_string(dir.join("manifest.json")),
    fs::read_to_string(dir.join("addon.js")),
  ) else {
    return not_found("that addon is not installed");
  };

  let (html, csp) = document(&bundle, &connect_src(&manifest));

  http::Response::builder()
    .status(http::StatusCode::OK)
    .header(http::header::CONTENT_TYPE, "text/html; charset=utf-8")
    .header("Content-Security-Policy", csp)
    // The store is rewritten in place when an addon is updated, and a frame
    // showing the previous version of a session is worse than a slow one.
    .header(http::header::CACHE_CONTROL, "no-store")
    .body(html.into_bytes())
    .unwrap_or_else(|_| not_found("could not build the frame"))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn accepts_the_ids_the_manifest_format_allows() {
    assert!(is_valid_id("wiseroutine.breathing"));
    assert!(is_valid_id("acme-fitness"));
    assert!(is_valid_id("a1.b2-c3"));
  }

  /// The id becomes a path component, so this is the check that stops a
  /// manifest naming a file outside the store.
  #[test]
  fn refuses_anything_that_could_leave_the_store() {
    for id in [
      "..",
      "../etc",
      "a/../b",
      "a/b",
      "/absolute",
      ".hidden",
      "trailing.",
      "double..dot",
      "Upper",
      "with space",
      "with\0null",
      "",
    ] {
      assert!(!is_valid_id(id), "{id} should be refused");
    }
  }

  #[test]
  fn an_addon_that_declared_nothing_may_reach_nothing() {
    assert_eq!(connect_src(r#"{"capabilities":[]}"#), "'none'");
    assert_eq!(connect_src("not json"), "'none'");
    assert_eq!(
      connect_src(r#"{"capabilities":[{"kind":"ui:session"}]}"#),
      "'none'"
    );
  }

  #[test]
  fn declared_origins_become_the_connect_source() {
    let manifest = r#"{"capabilities":[
      {"kind":"net:fetch","origins":["https://api.acme.example"]}
    ]}"#;
    assert_eq!(connect_src(manifest), "https://api.acme.example");
  }

  /// A wildcard is a request for the whole web wearing a specific coat, and a
  /// space or a semicolon would let a manifest write its own extra directives.
  #[test]
  fn refuses_an_origin_that_is_not_a_plain_https_host() {
    let manifest = r#"{"capabilities":[{"kind":"net:fetch","origins":[
      "https://*.acme.example",
      "http://acme.example",
      "https://acme.example/path",
      "https://a.example; script-src *",
      "https://b.example c.example"
    ]}]}"#;
    assert_eq!(connect_src(manifest), "'none'");
  }

  #[test]
  fn a_bundle_cannot_close_its_own_script_element() {
    let (html, _) = document("</script><img onerror=alert(1)>", "'none'");
    assert!(!html.contains("</script><img"));
    assert!(html.contains("<\\/script>"));
  }

  #[test]
  fn the_policy_names_the_addons_own_origins_and_nothing_else() {
    let (_, csp) = document("", "https://api.acme.example");
    assert!(csp.contains("default-src 'none'"));
    assert!(csp.contains("connect-src https://api.acme.example"));
  }
}
