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
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{
  atomic::{AtomicU64, Ordering},
  LazyLock, Mutex,
};
use std::time::{Duration, Instant};

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
const MAX_BUNDLE_BYTES: usize = 2 * 1024 * 1024;
static STAGING_ID: AtomicU64 = AtomicU64::new(0);
static AUTHORITIES: LazyLock<Mutex<HashMap<(String, String, String), Instant>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Deserialize)]
pub struct Authority {
  id: String,
  revision: String,
}
fn safe_mode_requested(mut arguments: impl Iterator<Item = String>) -> bool {
  arguments.any(|arg| arg == "--safe-addons")
}
#[tauri::command]
pub fn authorize_addons(account_id: String, releases: Vec<Authority>) -> Result<(), String> {
  account_component(&account_id)?;
  if !releases.is_empty() && safe_mode_requested(std::env::args()) {
    return Err("Native addon safe mode: restart without --safe-addons to enable addons".into());
  }
  if releases.len() > 32
    || releases
      .iter()
      .any(|r| !is_valid_id(&r.id) || !is_hash(&r.revision))
  {
    return Err("Invalid addon authorities".into());
  }
  let mut authorities = AUTHORITIES
    .lock()
    .map_err(|_| "Addon authority unavailable")?;
  authorities.retain(|(account, _, _), until| account != &account_id && *until > Instant::now());
  for release in releases {
    authorities.insert(
      (account_id.clone(), release.id, release.revision),
      Instant::now() + Duration::from_secs(300),
    );
  }
  Ok(())
}
fn authorized(account: &str, id: &str, revision: &str) -> bool {
  AUTHORITIES
    .lock()
    .ok()
    .and_then(|map| {
      map
        .get(&(account.into(), id.into(), revision.into()))
        .copied()
    })
    .is_some_and(|until| until > Instant::now())
}
fn is_hash(value: &str) -> bool {
  value.len() == 64
    && value
      .bytes()
      .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn release_revision(manifest: &str, granted: &str, hash: &str) -> String {
  sha256_hex(format!("{manifest}\n{granted}\n{hash}").as_bytes())
}
fn read_release(dir: &Path, revision: &str) -> Result<(String, String), String> {
  if !is_hash(revision) {
    return Err("Invalid release identity".into());
  }
  let read = |name: &str, max: u64| -> Result<String, String> {
    let path = dir.join(name);
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > max {
      return Err("Release file too large".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
  };
  let manifest = read("manifest.json", 65536)?;
  let granted = read("granted.json", 65536)?;
  let bundle = read("addon.js", MAX_BUNDLE_BYTES as u64)?;
  let hash = read("hash", 64)?;
  if !is_hash(&hash)
    || sha256_hex(bundle.as_bytes()) != hash
    || release_revision(&manifest, &granted, &hash) != revision
  {
    return Err("Release verification failed".into());
  }
  Ok((granted, bundle))
}
/// Publish a complete directory with one rename. There is no mutable current pointer:
/// the approved frontend frame URL is the activation, including its exact revision.
fn stage_release(
  root: &Path,
  manifest: &str,
  granted: &str,
  bundle: &str,
  hash: &str,
) -> Result<String, String> {
  if manifest.len() > 65536
    || granted.len() > 65536
    || bundle.len() > MAX_BUNDLE_BYTES
    || !is_hash(hash)
    || sha256_hex(bundle.as_bytes()) != hash
  {
    return Err("Invalid release size or hash".into());
  }
  let revision = release_revision(manifest, granted, hash);
  let releases = root.join("releases");
  fs::create_dir_all(&releases).map_err(|e| e.to_string())?;
  let destination = releases.join(&revision);
  if destination.exists() {
    read_release(&destination, &revision)?;
    return Ok(revision);
  }
  // Bound retained versions per addon. Never remove a release underneath a running frame.
  if fs::read_dir(&releases).map_err(|e| e.to_string())?.count() >= 32 {
    return Err("Release cache full; remove and reinstall this addon".into());
  }
  let staging = releases.join(format!(
    ".stage-{}-{}",
    std::process::id(),
    STAGING_ID.fetch_add(1, Ordering::Relaxed)
  ));
  fs::create_dir(&staging).map_err(|e| e.to_string())?;
  let result = (|| {
    for (name, content) in [
      ("manifest.json", manifest),
      ("granted.json", granted),
      ("addon.js", bundle),
      ("hash", hash),
    ] {
      let mut file = fs::File::create(staging.join(name)).map_err(|e| e.to_string())?;
      file
        .write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
      file.sync_all().map_err(|e| e.to_string())?;
    }
    read_release(&staging, &revision)?;
    if let Err(error) = fs::rename(&staging, &destination) {
      // A concurrent installation of the same immutable snapshot is success,
      // but never accept an existing corrupt directory as an activation.
      if destination.exists() {
        read_release(&destination, &revision)?;
      } else {
        return Err(error.to_string());
      }
    }
    #[cfg(unix)]
    fs::File::open(&releases)
      .and_then(|file| file.sync_all())
      .map_err(|e| e.to_string())?;
    Ok(revision)
  })();
  let _ = fs::remove_dir_all(staging);
  result
}

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

fn account_component(account_id: &str) -> Result<String, String> {
  if account_id.is_empty() || account_id.len() > 256 {
    return Err("no signed-in account".to_string());
  }
  Ok(sha256_hex(account_id.as_bytes()))
}

fn addon_dir<R: Runtime>(
  app: &AppHandle<R>,
  account_id: &str,
  id: &str,
) -> Result<PathBuf, String> {
  if !is_valid_id(id) {
    return Err(format!("not an addon id: {id}"));
  }
  let account = account_component(account_id)?;
  store_dir(app)
    .map(|dir| dir.join("accounts").join(account).join(id))
    .ok_or_else(|| "no app data directory".to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
  format!("{:x}", Sha256::digest(bytes))
}

/// Write an addon where the protocol handler can serve it.
///
/// `hash` is mandatory: the published community digest or the digest of
/// trusted signed-app assets computed by the host. A mismatch is refused
/// before disk writes. Returns the immutable manifest/grant/code revision.
///
/// # Errors
///
/// A bad id, a manifest or grant that is not JSON, a hash mismatch, or a
/// write that failed.
#[tauri::command]
pub fn install_addon<R: Runtime>(
  app: AppHandle<R>,
  account_id: String,
  id: String,
  manifest: String,
  granted: String,
  bundle: String,
  hash: String,
) -> Result<String, String> {
  serde_json::from_str::<serde_json::Value>(&manifest)
    .map_err(|error| format!("manifest is not JSON: {error}"))?;
  serde_json::from_str::<serde_json::Value>(&granted)
    .map_err(|error| format!("grant is not JSON: {error}"))?;

  let dir = addon_dir(&app, &account_id, &id)?;
  stage_release(&dir, &manifest, &granted, &bundle, &hash)
}

/// Remove everything the device holds for an addon, secrets included.
///
/// # Errors
///
/// A bad id, or a delete that failed.
#[tauri::command]
pub fn forget_addon<R: Runtime>(
  app: AppHandle<R>,
  account_id: String,
  id: String,
) -> Result<(), String> {
  let dir = addon_dir(&app, &account_id, &id)?;
  AUTHORITIES
    .lock()
    .map_err(|_| "Addon authority unavailable")?
    .retain(|(account, addon, _), _| account != &account_id || addon != &id);
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
  let Ok(url) = reqwest::Url::parse(origin) else {
    return false;
  };
  url.scheme() == "https"
    && !origin
      .chars()
      .any(|c| c.is_whitespace() || matches!(c, '*' | ';' | '"' | '\'' | '<' | '>'))
    && url.username().is_empty()
    && url.password().is_none()
    && origin_of(&url).as_deref() == Some(origin)
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
  let mut safe = String::new();
  let mut start = 0;
  for (offset, _) in bundle.to_ascii_lowercase().match_indices("</script") {
    safe.push_str(&bundle[start..offset]);
    safe.push_str("<\\/script");
    start = offset + 8;
  }
  safe.push_str(&bundle[start..]);

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

fn frame_identity(path: &str) -> Option<(String, &str, &str)> {
  if path.len() > 1024 {
    return None;
  }
  let mut parts = path.trim_start_matches('/').split('/');
  let account = percent_encoding::percent_decode_str(parts.next()?)
    .decode_utf8()
    .ok()?
    .into_owned();
  let id = parts.next()?;
  let revision = parts.next()?;
  if parts.next().is_some()
    || !is_valid_id(id)
    || !is_hash(revision)
    || account_component(&account).is_err()
  {
    return None;
  }
  Some((account, id, revision))
}

/// Serve only an approved `addon://localhost/<account>/<id>/<revision>`.
/// The revision binds all files; a partial or unapproved snapshot cannot run.
pub fn serve<R: Runtime>(
  ctx: UriSchemeContext<'_, R>,
  request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
  let path = request.uri().path().trim_start_matches('/');
  let Some((account_id, id, revision)) = frame_identity(path) else {
    return not_found("Invalid addon release URL");
  };
  let Ok(dir) = addon_dir(ctx.app_handle(), &account_id, id) else {
    return not_found("not an addon id");
  };

  if !authorized(&account_id, id, revision) {
    return not_found("Addon approval expired or withdrawn");
  }
  let Ok((granted, bundle)) = read_release(&dir.join("releases").join(revision), revision) else {
    return not_found("Release verification failed");
  };

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

fn secrets_path<R: Runtime>(
  app: &AppHandle<R>,
  account_id: &str,
  id: &str,
) -> Result<PathBuf, String> {
  Ok(addon_dir(app, account_id, id)?.join("secrets.json"))
}

fn read_secrets<R: Runtime>(
  app: &AppHandle<R>,
  account_id: &str,
  id: &str,
) -> Result<HashMap<String, String>, String> {
  let path = secrets_path(app, account_id, id)?;
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
  account_id: String,
  id: String,
  key: String,
  value: String,
) -> Result<(), String> {
  if !is_setting_key(&key) {
    return Err(format!("not a setting key: {key}"));
  }
  let mut secrets = read_secrets(&app, &account_id, &id)?;
  if value.is_empty() {
    secrets.remove(&key);
  } else {
    secrets.insert(key, value);
  }

  let path = secrets_path(&app, &account_id, &id)?;
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
pub fn addon_secret_keys<R: Runtime>(
  app: AppHandle<R>,
  account_id: String,
  id: String,
) -> Result<Vec<String>, String> {
  let mut keys: Vec<String> = read_secrets(&app, &account_id, &id)?.into_keys().collect();
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
  account_id: String,
  id: String,
  revision: String,
  url: String,
  method: String,
  headers: HashMap<String, String>,
  body: Option<String>,
) -> Result<FetchReply, String> {
  let dir = addon_dir(&app, &account_id, &id)?;
  if !authorized(&account_id, &id, &revision) {
    return Err("Addon approval expired or withdrawn".into());
  }
  let (granted, _) = read_release(&dir.join("releases").join(&revision), &revision)?;
  if url.len() > 4096
    || headers.len() > 64
    || headers.iter().any(|(k, v)| k.len() > 128 || v.len() > 8192)
    || body.as_ref().is_some_and(|b| b.len() > 65536)
  {
    return Err("Request limit exceeded".into());
  }

  let parsed = reqwest::Url::parse(&url).map_err(|_| "not a URL".to_string())?;
  if !parsed.username().is_empty() || parsed.password().is_some() {
    return Err("URL credentials are not allowed".into());
  }
  let origin = origin_of(&parsed).ok_or_else(|| "not a URL".to_string())?;
  let grant = fetch_grant_for(&granted, &origin)
    .ok_or_else(|| format!("This addon may not reach {origin}."))?;

  let method =
    reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "not an HTTP method".to_string())?;

  let mut header_map = reqwest::header::HeaderMap::new();
  let auth_header = grant
    .auth
    .as_ref()
    .map(|auth| auth.header.to_ascii_lowercase());
  for (name, value) in headers {
    let lower = name.to_ascii_lowercase();
    if [
      "cookie",
      "host",
      "connection",
      "content-length",
      "transfer-encoding",
      "proxy-authorization",
      "proxy-connection",
      "upgrade",
    ]
    .contains(&lower.as_str())
      || Some(&lower) == auth_header.as_ref()
    {
      continue;
    }
    let name = reqwest::header::HeaderName::from_bytes(lower.as_bytes())
      .map_err(|_| format!("bad header name: {name}"))?;
    let value = reqwest::header::HeaderValue::from_str(&value)
      .map_err(|_| format!("bad header value for {name}"))?;
    header_map.insert(name, value);
  }

  if let Some(auth) = grant.auth {
    let secrets = read_secrets(&app, &account_id, &id)?;
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

  if !authorized(&account_id, &id, &revision) {
    return Err("Addon approval expired or withdrawn".into());
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
  fn immutable_release_staging_is_verified_and_interrupted_writes_do_not_activate() {
    let root = std::env::temp_dir().join(format!(
      "wr-addon-test-{}-{}",
      std::process::id(),
      STAGING_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let first = stage_release(&root, "{}", "[]", "version1", &sha256_hex(b"version1")).unwrap();
    let second = stage_release(&root, "{}", "[]", "version2", &sha256_hex(b"version2")).unwrap();
    assert_ne!(first, second);
    assert_eq!(
      read_release(&root.join("releases").join(&first), &first)
        .unwrap()
        .1,
      "version1"
    );
    assert!(stage_release(&root, "{}", "[]", "bad", "").is_err());
    let interrupted = root.join("releases").join(".stage-interrupted");
    fs::create_dir(&interrupted).unwrap();
    fs::write(interrupted.join("addon.js"), "partial").unwrap();
    assert!(read_release(&interrupted, &second).is_err());
    assert_eq!(
      read_release(&root.join("releases").join(&second), &second)
        .unwrap()
        .1,
      "version2"
    );
    let dir = root.join("releases").join(&first);
    fs::remove_file(dir.join("hash")).unwrap();
    assert!(read_release(&dir, &first).is_err());
    fs::write(dir.join("hash"), sha256_hex(b"version1")).unwrap();
    fs::write(dir.join("granted.json"), "[{}]").unwrap();
    assert!(read_release(&dir, &first).is_err());
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn frame_urls_decode_only_the_account_component_and_require_exact_revision() {
    let revision = sha256_hex(b"revision");
    let path = format!("/user%2Fwith%25value/example.test/{revision}");
    let (account, id, found) = frame_identity(&path).unwrap();
    assert_eq!(account, "user/with%value");
    assert_eq!(id, "example.test");
    assert_eq!(found, revision);
    assert!(frame_identity(&format!("user/example.test/{revision}/extra")).is_none());
    assert!(frame_identity(&format!("user/../{revision}")).is_none());
    assert!(frame_identity("user/example.test/").is_none());
    assert!(frame_identity(&format!("user%FF/example.test/{revision}")).is_none());
  }

  #[test]
  fn out_of_band_safe_mode_is_explicit() {
    assert!(safe_mode_requested(
      ["app", "--safe-addons"].into_iter().map(str::to_string)
    ));
    assert!(!safe_mode_requested(
      ["app", "--other"].into_iter().map(str::to_string)
    ));
  }

  #[test]
  fn native_authority_expires_and_is_account_and_revision_scoped() {
    let revision = sha256_hex(b"release");
    authorize_addons(
      "lease-test".into(),
      vec![Authority {
        id: "example.test".into(),
        revision: revision.clone(),
      }],
    )
    .unwrap();
    assert!(authorized("lease-test", "example.test", &revision));
    assert!(!authorized("other-account", "example.test", &revision));
    assert!(!authorized(
      "lease-test",
      "example.test",
      &sha256_hex(b"other")
    ));
    AUTHORITIES.lock().unwrap().insert(
      ("lease-test".into(), "example.test".into(), revision.clone()),
      Instant::now() - Duration::from_secs(1),
    );
    assert!(!authorized("lease-test", "example.test", &revision));
    authorize_addons("lease-test".into(), vec![]).unwrap();
    assert!(!authorized("lease-test", "example.test", &revision));
  }

  #[test]
  fn account_namespaces_do_not_share_addon_secrets_or_accept_empty_identity() {
    let a = account_component("user-a").unwrap();
    let b = account_component("user-b").unwrap();
    assert_ne!(a, b);
    assert_eq!(a, account_component("user-a").unwrap());
    assert_eq!(a.len(), 64);
    assert!(account_component("").is_err());
    // An identity cannot inject path components into the native store.
    assert!(!account_component("../../another-user")
      .unwrap()
      .contains('/'));
  }

  #[test]
  fn embed_and_fetch_origins_do_not_leak_into_each_other() {
    let granted = r#"[
      {"kind":"net:fetch","origins":["https://api.acme.example"]},
      {"kind":"ui:embed","origins":["https://player.acme.example"]}
    ]"#;
    assert_eq!(
      origins_for(granted, "net:fetch"),
      "https://api.acme.example"
    );
    assert_eq!(
      origins_for(granted, "ui:embed"),
      "https://player.acme.example"
    );
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
  fn an_addon_granted_nothing_may_reach_nothing() {
    assert_eq!(origins_for("[]", "net:fetch"), "'none'");
    assert_eq!(origins_for("not json", "net:fetch"), "'none'");
    assert_eq!(
      origins_for(r#"[{"kind":"ui:session"}]"#, "net:fetch"),
      "'none'"
    );
  }

  #[test]
  fn refuses_an_origin_that_is_not_a_plain_https_host() {
    let granted = r#"[{"kind":"net:fetch","origins":[
      "https://*.acme.example",
      "http://acme.example",
      "https://acme.example/path",
      "https://a.example; script-src *",
      "https://a.example;script-src",
      "https://user@a.example",
      "https://a.example?query",
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
    let (upper, _) = document("</SCRIPT><p>x</p>", "'none'", "'none'");
    assert!(!upper.contains("</SCRIPT>"));
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
    assert_eq!(
      grant.and_then(|g| g.auth).map(|a| a.prefix),
      Some("Bearer ".to_string())
    );
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
