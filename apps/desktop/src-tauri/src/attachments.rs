use base64::{engine::general_purpose::STANDARD, Engine};
use std::io::Write;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

const MAX_BYTES: usize = 5 * 1024 * 1024;
fn decode(name: &str, encoded: &str) -> Result<Vec<u8>, String> {
  if name.is_empty()
    || name.chars().count() > 200
    || name.contains(['/', '\\'])
    || name.chars().any(char::is_control)
  {
    return Err("Invalid attachment name".into());
  }
  if encoded.len() > MAX_BYTES.div_ceil(3) * 4 {
    return Err("Attachment too large".into());
  }
  let bytes = STANDARD
    .decode(encoded)
    .map_err(|_| "Invalid attachment data")?;
  if bytes.len() > MAX_BYTES {
    return Err("Attachment too large".into());
  }
  Ok(bytes)
}

/// The only path comes from the user's native save dialog, never from web
/// content. Save bytes, never execute/open them. Publish atomically so a failed
/// write cannot truncate an existing document the user chose to replace.
#[tauri::command]
pub async fn save_attachment<R: Runtime>(
  app: AppHandle<R>,
  name: String,
  encoded: String,
) -> Result<bool, String> {
  let bytes = decode(&name, &encoded)?;
  tauri::async_runtime::spawn_blocking(move || {
    let Some(file) = app
      .dialog()
      .file()
      .set_file_name(&name)
      .blocking_save_file()
    else {
      return Ok(false);
    };
    let path = file.into_path().map_err(|_| "Choose a local file")?;
    let parent = path.parent().ok_or("Invalid destination")?;
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    staged.write_all(&bytes).map_err(|e| e.to_string())?;
    staged.as_file().sync_all().map_err(|e| e.to_string())?;
    staged.persist(path).map_err(|e| e.to_string())?;
    Ok(true)
  })
  .await
  .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn validates_size_names_and_encoding_without_opening_documents() {
    assert_eq!(decode("paper.pdf", "JVBERg==").unwrap(), b"%PDF");
    for name in ["", "../paper.pdf", "a\\b", "a\nb"] {
      assert!(decode(name, "").is_err());
    }
    assert!(decode("paper.pdf", "not base64!").is_err());
    assert!(decode("paper.pdf", &"a".repeat(MAX_BYTES.div_ceil(3) * 4 + 1)).is_err());
  }
}
