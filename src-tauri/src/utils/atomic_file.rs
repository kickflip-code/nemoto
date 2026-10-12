#[cfg(not(windows))]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn backup_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "nemoto-data".to_string());
    path.with_file_name(format!("{file_name}.bak"))
}

fn sibling_work_path(path: &Path, label: &str) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "nemoto-data".to_string());
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    path.with_file_name(format!(
        ".{file_name}.{label}-{}-{nonce}",
        std::process::id()
    ))
}

fn write_synced(path: &Path, content: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(content)?;
    file.sync_all()
}

#[cfg(windows)]
fn replace_existing(target: &Path, replacement: &Path, backup: Option<&Path>) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;

    if let Some(backup_path) = backup {
        if backup_path.exists() {
            fs::remove_file(backup_path)?;
        }
    }

    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let replacement_wide: Vec<u16> = replacement
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let backup_wide: Option<Vec<u16>> =
        backup.map(|path| path.as_os_str().encode_wide().chain(Some(0)).collect());
    let backup_ptr = backup_wide
        .as_ref()
        .map_or(std::ptr::null(), |value| value.as_ptr());

    let result = unsafe {
        ReplaceFileW(
            target_wide.as_ptr(),
            replacement_wide.as_ptr(),
            backup_ptr,
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    };

    if result == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_existing(target: &Path, replacement: &Path, backup: Option<&Path>) -> io::Result<()> {
    if let Some(backup_path) = backup {
        let backup_work_path = sibling_work_path(backup_path, "backup");
        fs::copy(target, &backup_work_path)?;
        File::open(&backup_work_path)?.sync_all()?;
        fs::rename(&backup_work_path, backup_path)?;
    }
    fs::rename(replacement, target)
}

#[cfg(not(windows))]
fn sync_parent_directory(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(windows)]
fn sync_parent_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

/// Write and sync a sibling temporary file, verify it, then replace the target.
/// Existing targets can be retained as `<filename>.bak` during the replacement.
pub fn atomic_write_verified<F>(
    path: &Path,
    content: &[u8],
    create_backup: bool,
    verify: F,
) -> io::Result<()>
where
    F: FnOnce(&Path) -> io::Result<()>,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let work_path = sibling_work_path(path, "write");
    let result = (|| {
        write_synced(&work_path, content)?;
        verify(&work_path)?;

        if path.exists() {
            let backup = create_backup.then(|| backup_path(path));
            replace_existing(path, &work_path, backup.as_deref())?;
        } else {
            fs::rename(&work_path, path)?;
        }
        sync_parent_directory(path)
    })();

    if result.is_err() && work_path.exists() {
        let _ = fs::remove_file(&work_path);
    }
    result
}

pub fn atomic_write_json(path: &Path, content: &str, create_backup: bool) -> io::Result<()> {
    atomic_write_verified(path, content.as_bytes(), create_backup, |candidate| {
        let bytes = fs::read(candidate)?;
        serde_json::from_slice::<serde_json::Value>(&bytes)
            .map(|_| ())
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_new_json_and_replaces_existing_content_with_a_backup() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("portfolio.json");

        atomic_write_json(&target, r#"{"version":1}"#, true).unwrap();
        atomic_write_json(&target, r#"{"version":2}"#, true).unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"version":2}"#);
        assert_eq!(
            fs::read_to_string(backup_path(&target)).unwrap(),
            r#"{"version":1}"#
        );
    }

    #[test]
    fn failed_verification_leaves_the_existing_target_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("portfolio.json");
        fs::write(&target, r#"{"version":1}"#).unwrap();

        let error = atomic_write_json(&target, "not-json", true).unwrap_err();

        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"version":1}"#);
        assert!(!backup_path(&target).exists());
    }
}
