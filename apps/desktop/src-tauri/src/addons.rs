//! The device half of the addon boundary.
//!
//! Four jobs:
//!
//! 1. **Serve each addon its own document** over the `addon:` scheme, with a
//!    Content-Security-Policy built from what the user granted. A `srcdoc`
//!    frame would inherit the app's own policy and refuse the addon's script
//!    in a release build; a fetched document carries its own.
//! 2. **Check the bundle** against the hash the registry published, before
//!    it is written and again every time it is served.
//! 3. **Fetch on the addon's behalf** (`addon_fetch`), so a request can be
//!    signed with a secret the addon never sees, and so the frame's
//!    `Origin: null` does not trip CORS.
//! 4. **Keep secrets** the user typed on the Addons page. They live in the
//!    app data directory, never go to the server, and never cross into the
//!    webview once written.
//!
//! What keeps the sandbox closed is three separate things: this scheme (the
//! policy), `sandbox="allow-scripts"` on the iframe set by the frontend (the
//! opaque origin), and the capability check in the host bridge (what the
//! addon may ask the app to do).
//!
//! ponytail: secrets are a plain JSON file with owner-only permissions, the
//! same protection the session token in the webview's storage has. Move them
//! to the OS keychain if that ever stops being enough.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
// `http` through Tauri so the types match its protocol handler.
use tauri::http;
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext};

/// The scheme addon frames are served from. `addon://localhost/<id>` on
/// macOS and Linux, `http://addon.localhost/<id>` on Windows; the frontend
/// builds the URL with Tauri's `convertFileSrc`.
pub const SCHEME: &str = "addon";

const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

/// An addon id as a path component: lowercase, dot or hyphen separated. That
/// shape has no separator, no `..` and no null byte, so it is safe to join
/// onto the store directory.
fn is_valid_id(id: &str) -> bool {
  if id.is_empty() || id.len() > 64 {
    return false;
  }

  let mut previous_separator = true;
  for byte in id.bytes() {
    match byte {
      b'a'..=b'z' | b'0'..=b'9' => previous_separator = false,
      b'.' | b'-' => {
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

fn addon_dir<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<PathBuf, String> {
  if !is_valid_id(id) {
    return Err(format!("not an addon id: {id}"));
  }
  store_dir(app)
    .map(|dir| dir.join(id))
    .ok_or_else(|| "no app data directory".to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
  format!("{:x}", Sha256::digest(bytes))
}

/// Write an addon where the protocol handler can serve it.
///
/// `hash` is the sha256 the registry published, or empty for an addon that
/// ships inside the app. A bundle that does not match is refused before
/// anything touches the disk.
///
/// # Errors
///
/// A bad id, a manifest or grant that is not JSON, a hash mismatch, or a
/// write that failed.
#[tauri::command]
pub fn install_addon<R: Runtime>(
  app: AppHandle<R>,
  id: String,
  manifest: String,
  granted: String,
  bundle: String,
  hash: String,
) -> Result<(), String> {
  serde_json::from_str::<serde_json::Value>(&manifest)
    .map_err(|error| format!("manifest is not JSON: {error}"))?;
  serde_json::from_str::<serde_json::Value>(&granted)
    .map_err(|error| format!("grant is not JSON: {error}"))?;

  if !hash.is_empty() && sha256_hex(bundle.as_bytes()) != hash {
    return Err("the bundle does not match its published hash".to_string());
  }

  let dir = addon_dir(&app, &id)?;
  fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  let write = |name: &str, body: &str| {
    fs::write(dir.join(name), body).map_err(|error| error.to_string())
  };
  write("manifest.json", &manifest)?;
  write("granted.json", &granted)?;
  write("addon.js", &bundle)?;
  write("hash", &hash)?;

  Ok(())
}

/// Remove everything the device holds for an addon, secrets included.
///
/// # Errors
///
/// A bad id, or a delete that failed.
#[tauri::command]
pub fn forget_addon<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
  let dir = addon_dir(&app, &id)?;
  if dir.exists() {
    fs::remove_dir_all(&dir).map_err(|error| error.to_string())?;
  }
  Ok(())
}

/// The origins granted for one capability kind, as a CSP source list.
///
/// Read from the stored grant, not the manifest, so a frame can reach only
/// what the user approved. Anything that is not a plain `https://host` is
/// dropped: it could not be an origin, and it might be a header injection.
fn origins_for(granted: &str, kind: &str) -> String {
  origin_list(granted, kind)
    .map(|origins| origins.join(" "))
    .filter(|list| !list.is_empty())
    .unwrap_or_else(|| "'none'".to_string())
}

fn origin_list(granted: &str, kind: &str) -> Option<Vec<String>> {
  let parsed: serde_json::Value = serde_json::from_str(granted).ok()?;
  let list = parsed
    .as_array()?
    .iter()
    .filter(|capability| capability.get("kind").and_then(|k| k.as_str()) == Some(kind))
    .filter_map(|capability| capability.get("origins")?.as_array())
    .flatten()
    .filter_map(|origin| origin.as_str())
    .filter(|origin| is_plain_https_origin(origin))
    .map(str::to_string)
    .collect();
  Some(list)
}

fn is_plain_https_origin(origin: &str) -> bool {
  origin.starts_with("https://")
    && !origin.contains('*')
    && !origin.contains(' ')
    && !origin.contains(';')
    && !origin.contains('"')
    && origin.matches('/').count() == 2
}

/// The document an addon runs in. The only script is the bundle, so
/// `'unsafe-inline'` here governs nothing but it.
fn document(bundle: &str, connect: &str, frame: &str) -> (String, String) {
  let csp = format!(
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; \
     img-src data: blob:; font-src data:; connect-src {connect}; frame-src {frame}; \
     form-action 'none'; base-uri 'none'; frame-ancestors *"
  );

  // `</script` anywhere in the bundle would end the element early.
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

/// Serve `addon://localhost/<id>`. The whole path is the id; there is no
/// second route and nothing to decode.
pub fn serve<R: Runtime>(
  ctx: UriSchemeContext<'_, R>,
  request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
  let id = request.uri().path().trim_start_matches('/');

  let Ok(dir) = addon_dir(ctx.app_handle(), id) else {
    return not_found("not an addon id");
  };

  let (Ok(granted), Ok(bundle)) = (
    fs::read_to_string(dir.join("granted.json")),
    fs::read_to_string(dir.join("addon.js")),
  ) else {
    return not_found("that addon is not installed");
  };

  // Re-checked on every serve, so a bundle changed on disk after install is
  // refused rather than run.
  let hash = fs::read_to_string(dir.join("hash")).unwrap_or_default();
  if !hash.is_empty() && sha256_hex(bundle.as_bytes()) != hash {
    return not_found("that addon's bundle has changed since it was installed");
  }

  let (html, csp) = document(
    &bundle,
    &origins_for(&granted, "net:fetch"),
    &origins_for(&granted, "ui:embed"),
  );

  http::Response::builder()
    .status(http::StatusCode::OK)
    .header(http::header::CONTENT_TYPE, "text/html; charset=utf-8")
    .header("Content-Security-Policy", csp)
    .header(http::header::CACHE_CONTROL, "no-store")
    .body(html.into_bytes())
    .unwrap_or_else(|_| not_found("could not build the frame"))
}

/* ── Secrets ─────────────────────────────────────────────────────────────── */

fn secrets_path<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<PathBuf, String> {
  Ok(addon_dir(app, id)?.join("secrets.json"))
}

fn read_secrets<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<HashMap<String, String>, String> {
  let path = secrets_path(app, id)?;
  let Ok(text) = fs::read_to_string(&path) else {
    return Ok(HashMap::new());
  };
  serde_json::from_str(&text).map_err(|error| format!("secrets file is not JSON: {error}"))
}

fn is_setting_key(key: &str) -> bool {
  !key.is_empty()
    && key.len() <= 64
    && key
      .bytes()
      .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Store a secret for an addon on this device. An empty value removes it.
///
/// # Errors
///
/// A bad id or key, or a write that failed.
#[tauri::command]
pub fn set_addon_secret<R: Runtime>(
  app: AppHandle<R>,
  id: String,
  key: String,
  value: String,
) -> Result<(), String> {
  if !is_setting_key(&key) {
    return Err(format!("not a setting key: {key}"));
  }
  let mut secrets = read_secrets(&app, &id)?;
  if value.is_empty() {
    secrets.remove(&key);
  } else {
    secrets.insert(key, value);
  }

  let path = secrets_path(&app, &id)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }
  let text = serde_json::to_string(&secrets).map_err(|error| error.to_string())?;
  fs::write(&path, text).map_err(|error| error.to_string())?;

  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
      .map_err(|error| error.to_string())?;
  }

  Ok(())
}

/// Which secrets are set for an addon. Names only, never values.
///
/// # Errors
///
/// A bad id, or a secrets file that is not JSON.
#[tauri::command]
pub fn addon_secret_keys<R: Runtime>(app: AppHandle<R>, id: String) -> Result<Vec<String>, String> {
  let mut keys: Vec<String> = read_secrets(&app, &id)?.into_keys().collect();
  keys.sort();
  Ok(keys)
}

/* ── Fetch ───────────────────────────────────────────────────────────────── */

#[derive(Serialize)]
pub struct FetchReply {
  status: u16,
  headers: Vec<(String, String)>,
  body: String,
}

/// The `auth` block of a `net:fetch` grant.
#[derive(Deserialize)]
struct FetchAuth {
  secret: String,
  header: String,
  #[serde(default)]
  prefix: String,
}

#[derive(Deserialize)]
struct FetchGrant {
  kind: String,
  #[serde(default)]
  origins: Vec<String>,
  auth: Option<FetchAuth>,
}

/// The `net:fetch` grant that covers this origin, if any.
fn fetch_grant_for(granted: &str, origin: &str) -> Option<FetchGrant> {
  let grants: Vec<FetchGrant> = serde_json::from_str(granted).ok()?;
  grants.into_iter().find(|grant| {
    grant.kind == "net:fetch"
      && grant
        .origins
        .iter()
        .any(|allowed| allowed == origin && is_plain_https_origin(allowed))
  })
}

fn origin_of(url: &reqwest::Url) -> Option<String> {
  let host = url.host_str()?;
  let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
  Some(format!("{}://{host}{port}", url.scheme()))
}

/// Fetch on an addon's behalf.
///
/// Refused unless the URL's origin is in the addon's `net:fetch` grant. If
/// that grant declares `auth`, the named secret is added as a header. The
/// addon may set its own headers, except `cookie` and the auth header.
///
/// # Errors
///
/// A bad id, an origin outside the grant, an auth secret the user has not
/// entered, or a request that failed or exceeded the size limit.
#[tauri::command]
pub async fn addon_fetch<R: Runtime>(
  app: AppHandle<R>,
  id: String,
  url: String,
  method: String,
  headers: HashMap<String, String>,
  body: Option<String>,
) -> Result<FetchReply, String> {
  let dir = addon_dir(&app, &id)?;
  let granted = fs::read_to_string(dir.join("granted.json"))
    .map_err(|_| "that addon is not installed".to_string())?;

  let parsed = reqwest::Url::parse(&url).map_err(|_| "not a URL".to_string())?;
  let origin = origin_of(&parsed).ok_or_else(|| "not a URL".to_string())?;
  let grant = fetch_grant_for(&granted, &origin)
    .ok_or_else(|| format!("This addon may not reach {origin}."))?;

  let method = reqwest::Method::from_bytes(method.as_bytes())
    .map_err(|_| "not an HTTP method".to_string())?;

  let mut header_map = reqwest::header::HeaderMap::new();
  let auth_header = grant
    .auth
    .as_ref()
    .map(|auth| auth.header.to_ascii_lowercase());
  for (name, value) in headers {
    let lower = name.to_ascii_lowercase();
    if lower == "cookie" || Some(&lower) == auth_header.as_ref() {
      continue;
    }
    let name = reqwest::header::HeaderName::from_bytes(lower.as_bytes())
      .map_err(|_| format!("bad header name: {name}"))?;
    let value = reqwest::header::HeaderValue::from_str(&value)
      .map_err(|_| format!("bad header value for {name}"))?;
    header_map.insert(name, value);
  }

  if let Some(auth) = grant.auth {
    let secrets = read_secrets(&app, &id)?;
    let secret = secrets
      .get(&auth.secret)
      .ok_or_else(|| "The key for this service has not been entered yet.".to_string())?;
    let name = reqwest::header::HeaderName::from_bytes(auth.header.as_bytes())
      .map_err(|_| "bad auth header name".to_string())?;
    let value = reqwest::header::HeaderValue::from_str(&format!("{}{secret}", auth.prefix))
      .map_err(|_| "bad auth header value".to_string())?;
    header_map.insert(name, value);
  }

  let client = reqwest::Client::builder()
    .timeout(FETCH_TIMEOUT)
    .redirect(reqwest::redirect::Policy::none())
    .build()
    .map_err(|error| error.to_string())?;

  let mut request = client.request(method, parsed).headers(header_map);
  if let Some(body) = body {
    request = request.body(body);
  }

  let mut response = request.send().await.map_err(|error| error.to_string())?;
  let status = response.status().as_u16();
  let reply_headers = response
    .headers()
    .iter()
    .filter_map(|(name, value)| {
      value
        .to_str()
        .ok()
        .map(|v| (name.as_str().to_string(), v.to_string()))
    })
    .filter(|(name, _)| name != "set-cookie")
    .collect();

  let mut bytes = Vec::new();
  while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
    if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
      return Err("The response was too large.".to_string());
    }
    bytes.extend_from_slice(&chunk);
  }

  Ok(FetchReply {
    status,
    headers: reply_headers,
    body: String::from_utf8_lossy(&bytes).into_owned(),
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn embed_and_fetch_origins_do_not_leak_into_each_other() {
    let granted = r#"[
      {"kind":"net:fetch","origins":["https://api.acme.example"]},
      {"kind":"ui:embed","origins":["https://player.acme.example"]}
    ]"#;
    assert_eq!(origins_for(granted, "net:fetch"), "https://api.acme.example");
    assert_eq!(origins_for(granted, "ui:embed"), "https://player.acme.example");
    assert_eq!(origins_for(granted, "open:external"), "'none'");
  }

  #[test]
  fn accepts_the_ids_the_manifest_format_allows() {
    assert!(is_valid_id("wiseroutine.breathing"));
    assert!(is_valid_id("acme-fitness"));
    assert!(is_valid_id("a1.b2-c3"));
  }

  #[test]
  fn refuses_anything_that_could_leave_the_store() {
    for id in [
      "..", "../etc", "a/../b", "a/b", "/absolute", ".hidden", "trailing.", "double..dot",
      "Upper", "with space", "with\0null", "",
    ] {
      assert!(!is_valid_id(id), "{id} should be refused");
    }
  }

  #[test]
  fn an_addon_granted_nothing_may_reach_nothing() {
    assert_eq!(origins_for("[]", "net:fetch"), "'none'");
    assert_eq!(origins_for("not json", "net:fetch"), "'none'");
    assert_eq!(origins_for(r#"[{"kind":"ui:session"}]"#, "net:fetch"), "'none'");
  }

  #[test]
  fn refuses_an_origin_that_is_not_a_plain_https_host() {
    let granted = r#"[{"kind":"net:fetch","origins":[
      "https://*.acme.example",
      "http://acme.example",
      "https://acme.example/path",
      "https://a.example; script-src *",
      "https://b.example c.example",
      "https://d.example\""
    ]}]"#;
    assert_eq!(origins_for(granted, "net:fetch"), "'none'");
  }

  #[test]
  fn a_bundle_cannot_close_its_own_script_element() {
    let (html, _) = document("</script><img onerror=alert(1)>", "'none'", "'none'");
    assert!(!html.contains("</script><img"));
    assert!(html.contains("<\\/script>"));
  }

  #[test]
  fn the_policy_names_the_granted_origins_and_nothing_else() {
    let (_, csp) = document("", "https://api.acme.example", "https://open.spotify.com");
    assert!(csp.contains("default-src 'none'"));
    assert!(csp.contains("connect-src https://api.acme.example"));
    assert!(csp.contains("frame-src https://open.spotify.com"));
  }

  #[test]
  fn the_hash_is_sha256_hex() {
    assert_eq!(
      sha256_hex(b"abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  }

  #[test]
  fn a_fetch_grant_covers_only_its_own_origins() {
    let granted = r#"[{"kind":"net:fetch","origins":["https://api.acme.example"],
      "auth":{"secret":"apiKey","header":"Authorization","prefix":"Bearer "}}]"#;
    let grant = fetch_grant_for(granted, "https://api.acme.example");
    assert!(grant.is_some());
    assert_eq!(grant.and_then(|g| g.auth).map(|a| a.prefix), Some("Bearer ".to_string()));
    assert!(fetch_grant_for(granted, "https://evil.example").is_none());
    assert!(fetch_grant_for(granted, "http://api.acme.example").is_none());
  }

  #[test]
  fn origin_of_a_url_drops_path_and_query() {
    let url = reqwest::Url::parse("https://api.acme.example/v1/x?y=1").ok();
    assert_eq!(
      url.as_ref().and_then(origin_of),
      Some("https://api.acme.example".to_string())
    );
  }

  #[test]
  fn setting_keys_are_bounded() {
    assert!(is_setting_key("apiKey"));
    assert!(is_setting_key("api-key_2"));
    assert!(!is_setting_key(""));
    assert!(!is_setting_key("a.b"));
    assert!(!is_setting_key("../x"));
  }
}
