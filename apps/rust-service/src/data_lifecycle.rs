use sha2::{Digest, Sha256};

pub const MAX_PORTABLE_ARCHIVE_BYTES: usize = 1_048_576;

pub fn validate_portable_archive(archive: &serde_json::Value) -> Result<serde_json::Value, String> {
    let manifest = archive
        .get("manifest")
        .and_then(serde_json::Value::as_object)
        .ok_or("archive manifest is required")?;
    if manifest
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
        || manifest.get("format").and_then(serde_json::Value::as_str)
            != Some("rust-tutor-portable-json")
    {
        return Err("unknown portable archive schema or format".into());
    }
    let payload = archive
        .get("payload")
        .ok_or("archive payload is required")?;
    let bytes = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_PORTABLE_ARCHIVE_BYTES {
        return Err("portable archive exceeds the uncompressed size limit".into());
    }
    let checksum = format!("{:x}", Sha256::digest(&bytes));
    if manifest
        .get("checksumSha256")
        .and_then(serde_json::Value::as_str)
        != Some(checksum.as_str())
    {
        return Err("portable archive checksum does not match its canonical payload".into());
    }
    reject_paths_and_secrets(payload)?;
    let counts = payload
        .as_object()
        .ok_or("archive payload must be an object")?
        .iter()
        .filter_map(|(key, value)| value.as_array().map(|rows| (key.clone(), rows.len())))
        .collect::<std::collections::BTreeMap<_, _>>();
    Ok(serde_json::json!({
        "valid":true,"checksumSha256":checksum,"rowCounts":counts,
        "conflicts":"stable IDs are idempotent; mismatched existing identities block the apply transaction",
        "canonicalRowsChanged":0,"mode":"dry_run"
    }))
}

fn reject_paths_and_secrets(value: &serde_json::Value) -> Result<(), String> {
    match value {
        serde_json::Value::Object(object) => {
            for (key, value) in object {
                let lowered = key.to_ascii_lowercase();
                if ["token", "sessiontoken", "environment", "temppath"].contains(&lowered.as_str())
                {
                    return Err(format!("forbidden sensitive field in archive: {key}"));
                }
                if lowered.ends_with("path") && !value.is_null() {
                    return Err(format!(
                        "machine paths are forbidden in portable archives: {key}"
                    ));
                }
                reject_paths_and_secrets(value)?;
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                reject_paths_and_secrets(value)?;
            }
        }
        serde_json::Value::String(text)
            if text.contains("../") || text.contains("..\\") || text.contains('\0') =>
        {
            return Err("archive contains a traversal or NUL sequence".into());
        }
        _ => {}
    }
    Ok(())
}
