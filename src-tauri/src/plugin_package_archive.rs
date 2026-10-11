//! Strict bounded reader for `.axiom-plugin` ZIP archives.
//!
//! The reader deliberately supports only ordinary stored or raw-deflate files.
//! It cross-checks central and local headers, rejects ambiguous ZIP features,
//! and never extracts package-controlled paths to the filesystem.

use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Read, Take},
};

use flate2::bufread::DeflateDecoder;
use serde::Serialize;

pub const MAX_PLUGIN_PACKAGE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_PLUGIN_EXPANDED_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_PLUGIN_PACKAGE_FILES: usize = 100;
pub const MAX_PLUGIN_ARCHIVE_ENTRIES: usize = 200;
pub const MAX_PLUGIN_ENTRY_BYTES: usize = 5 * 1024 * 1024;

const EOCD_SIGNATURE: u32 = 0x0605_4b50;
const CENTRAL_SIGNATURE: u32 = 0x0201_4b50;
const LOCAL_SIGNATURE: u32 = 0x0403_4b50;
const ZIP64_EXTRA_ID: u16 = 0x0001;
const UTF8_FLAG: u16 = 0x0800;
const DEFLATE_OPTION_FLAGS: u16 = 0x0006;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PluginArchiveErrorCode {
    EmptyArchive,
    ArchiveTooLarge,
    InvalidZip,
    UnsupportedZipFeature,
    TooManyEntries,
    UnsafePath,
    DuplicatePath,
    EntryTooLarge,
    ExpandedArchiveTooLarge,
    IntegrityMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginArchiveError {
    pub code: PluginArchiveErrorCode,
    pub message: &'static str,
}

impl PluginArchiveError {
    fn new(code: PluginArchiveErrorCode, message: &'static str) -> Self {
        Self { code, message }
    }
}

impl std::fmt::Display for PluginArchiveError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for PluginArchiveError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundedPluginArchive {
    pub files: BTreeMap<String, Vec<u8>>,
    pub compressed_bytes: usize,
    pub expanded_bytes: usize,
}

#[derive(Debug)]
struct CentralEntry {
    name: String,
    flags: u16,
    method: u16,
    crc32: u32,
    compressed_size: usize,
    uncompressed_size: usize,
    local_offset: usize,
    is_directory: bool,
}

pub fn read_bounded_plugin_archive(
    archive_bytes: &[u8],
) -> Result<BoundedPluginArchive, PluginArchiveError> {
    if archive_bytes.is_empty() {
        return Err(PluginArchiveError::new(
            PluginArchiveErrorCode::EmptyArchive,
            "The plugin archive is empty.",
        ));
    }
    if archive_bytes.len() > MAX_PLUGIN_PACKAGE_BYTES {
        return Err(PluginArchiveError::new(
            PluginArchiveErrorCode::ArchiveTooLarge,
            "The plugin archive exceeds the compressed size limit.",
        ));
    }

    let eocd_offset = find_eocd(archive_bytes)?;
    let disk_number = read_u16(archive_bytes, eocd_offset + 4)?;
    let central_disk = read_u16(archive_bytes, eocd_offset + 6)?;
    let disk_entries = read_u16(archive_bytes, eocd_offset + 8)? as usize;
    let total_entries = read_u16(archive_bytes, eocd_offset + 10)? as usize;
    let central_size = read_u32(archive_bytes, eocd_offset + 12)? as usize;
    let central_offset = read_u32(archive_bytes, eocd_offset + 16)? as usize;
    if disk_number != 0
        || central_disk != 0
        || disk_entries != total_entries
        || total_entries == u16::MAX as usize
        || central_size == u32::MAX as usize
        || central_offset == u32::MAX as usize
    {
        return Err(unsupported_zip());
    }
    if total_entries == 0 || total_entries > MAX_PLUGIN_ARCHIVE_ENTRIES {
        return Err(PluginArchiveError::new(
            PluginArchiveErrorCode::TooManyEntries,
            "The plugin archive contains an unsupported number of entries.",
        ));
    }
    let central_end = central_offset
        .checked_add(central_size)
        .ok_or_else(invalid_zip)?;
    if central_end != eocd_offset || central_end > archive_bytes.len() {
        return Err(invalid_zip());
    }

    let mut cursor = central_offset;
    let mut entries = Vec::with_capacity(total_entries);
    let mut names = BTreeSet::new();
    let mut file_count = 0_usize;
    let mut declared_expanded = 0_usize;
    for _ in 0..total_entries {
        if read_u32(archive_bytes, cursor)? != CENTRAL_SIGNATURE {
            return Err(invalid_zip());
        }
        require_range(archive_bytes, cursor, 46)?;
        let made_by = read_u16(archive_bytes, cursor + 4)?;
        let flags = read_u16(archive_bytes, cursor + 8)?;
        let method = read_u16(archive_bytes, cursor + 10)?;
        let crc32 = read_u32(archive_bytes, cursor + 16)?;
        let compressed_size = read_u32(archive_bytes, cursor + 20)? as usize;
        let uncompressed_size = read_u32(archive_bytes, cursor + 24)? as usize;
        let name_length = read_u16(archive_bytes, cursor + 28)? as usize;
        let extra_length = read_u16(archive_bytes, cursor + 30)? as usize;
        let comment_length = read_u16(archive_bytes, cursor + 32)? as usize;
        let start_disk = read_u16(archive_bytes, cursor + 34)?;
        let external_attributes = read_u32(archive_bytes, cursor + 38)?;
        let local_offset = read_u32(archive_bytes, cursor + 42)? as usize;
        if compressed_size == u32::MAX as usize
            || uncompressed_size == u32::MAX as usize
            || local_offset == u32::MAX as usize
            || start_disk != 0
        {
            return Err(unsupported_zip());
        }
        validate_flags(flags, method)?;
        let variable_length = name_length
            .checked_add(extra_length)
            .and_then(|value| value.checked_add(comment_length))
            .ok_or_else(invalid_zip)?;
        require_range(archive_bytes, cursor + 46, variable_length)?;
        let name_bytes = &archive_bytes[cursor + 46..cursor + 46 + name_length];
        let name = std::str::from_utf8(name_bytes)
            .map_err(|_| unsafe_path())?
            .to_owned();
        let extra_start = cursor + 46 + name_length;
        validate_extra(&archive_bytes[extra_start..extra_start + extra_length])?;
        let is_directory = name.ends_with('/');
        validate_external_attributes(made_by, external_attributes, is_directory)?;
        validate_archive_path(&name, is_directory)?;
        if !names.insert(name.clone()) {
            return Err(PluginArchiveError::new(
                PluginArchiveErrorCode::DuplicatePath,
                "The plugin archive contains a duplicate path.",
            ));
        }
        if is_directory {
            if compressed_size != 0 || uncompressed_size != 0 {
                return Err(invalid_zip());
            }
        } else {
            file_count += 1;
            if file_count > MAX_PLUGIN_PACKAGE_FILES {
                return Err(PluginArchiveError::new(
                    PluginArchiveErrorCode::TooManyEntries,
                    "The plugin archive contains too many files.",
                ));
            }
            if uncompressed_size > MAX_PLUGIN_ENTRY_BYTES {
                return Err(PluginArchiveError::new(
                    PluginArchiveErrorCode::EntryTooLarge,
                    "A plugin archive entry exceeds the expanded file limit.",
                ));
            }
            declared_expanded = declared_expanded
                .checked_add(uncompressed_size)
                .ok_or_else(expanded_too_large)?;
            if declared_expanded > MAX_PLUGIN_EXPANDED_BYTES {
                return Err(expanded_too_large());
            }
        }
        entries.push(CentralEntry {
            name,
            flags,
            method,
            crc32,
            compressed_size,
            uncompressed_size,
            local_offset,
            is_directory,
        });
        cursor = cursor
            .checked_add(46 + variable_length)
            .ok_or_else(invalid_zip)?;
    }
    if cursor != central_end || file_count == 0 {
        return Err(invalid_zip());
    }

    let mut data_ranges = Vec::with_capacity(entries.len());
    let mut files = BTreeMap::new();
    let mut expanded_bytes = 0_usize;
    for entry in entries {
        require_range(archive_bytes, entry.local_offset, 30)?;
        if read_u32(archive_bytes, entry.local_offset)? != LOCAL_SIGNATURE {
            return Err(invalid_zip());
        }
        let local_flags = read_u16(archive_bytes, entry.local_offset + 6)?;
        let local_method = read_u16(archive_bytes, entry.local_offset + 8)?;
        let local_crc32 = read_u32(archive_bytes, entry.local_offset + 14)?;
        let local_compressed_size = read_u32(archive_bytes, entry.local_offset + 18)? as usize;
        let local_uncompressed_size = read_u32(archive_bytes, entry.local_offset + 22)? as usize;
        let local_name_length = read_u16(archive_bytes, entry.local_offset + 26)? as usize;
        let local_extra_length = read_u16(archive_bytes, entry.local_offset + 28)? as usize;
        let local_variable_length = local_name_length
            .checked_add(local_extra_length)
            .ok_or_else(invalid_zip)?;
        require_range(
            archive_bytes,
            entry.local_offset + 30,
            local_variable_length,
        )?;
        let local_name_start = entry.local_offset + 30;
        let local_name = &archive_bytes[local_name_start..local_name_start + local_name_length];
        if local_name != entry.name.as_bytes()
            || local_flags != entry.flags
            || local_method != entry.method
            || local_crc32 != entry.crc32
            || local_compressed_size != entry.compressed_size
            || local_uncompressed_size != entry.uncompressed_size
        {
            return Err(PluginArchiveError::new(
                PluginArchiveErrorCode::IntegrityMismatch,
                "The plugin archive headers do not describe the same entry.",
            ));
        }
        let local_extra_start = local_name_start + local_name_length;
        validate_extra(&archive_bytes[local_extra_start..local_extra_start + local_extra_length])?;
        let data_start = entry
            .local_offset
            .checked_add(30 + local_variable_length)
            .ok_or_else(invalid_zip)?;
        let data_end = data_start
            .checked_add(entry.compressed_size)
            .ok_or_else(invalid_zip)?;
        if data_end > central_offset {
            return Err(invalid_zip());
        }
        data_ranges.push((entry.local_offset, data_end));
        let compressed = &archive_bytes[data_start..data_end];
        let content = expand_entry(compressed, entry.method, entry.uncompressed_size)?;
        if crc32fast::hash(&content) != entry.crc32 {
            return Err(PluginArchiveError::new(
                PluginArchiveErrorCode::IntegrityMismatch,
                "A plugin archive entry failed its CRC check.",
            ));
        }
        expanded_bytes = expanded_bytes
            .checked_add(content.len())
            .ok_or_else(expanded_too_large)?;
        if expanded_bytes > MAX_PLUGIN_EXPANDED_BYTES {
            return Err(expanded_too_large());
        }
        if !entry.is_directory {
            files.insert(entry.name, content);
        }
    }

    data_ranges.sort_unstable();
    if data_ranges.first().map(|range| range.0) != Some(0)
        || data_ranges.last().map(|range| range.1) != Some(central_offset)
        || data_ranges
            .windows(2)
            .any(|ranges| ranges[0].1 != ranges[1].0)
    {
        return Err(PluginArchiveError::new(
            PluginArchiveErrorCode::IntegrityMismatch,
            "The plugin archive contains overlapping or prefixed file records.",
        ));
    }

    Ok(BoundedPluginArchive {
        files,
        compressed_bytes: archive_bytes.len(),
        expanded_bytes,
    })
}

fn expand_entry(
    compressed: &[u8],
    method: u16,
    expected_size: usize,
) -> Result<Vec<u8>, PluginArchiveError> {
    if method == 0 {
        if compressed.len() != expected_size {
            return Err(invalid_zip());
        }
        return Ok(compressed.to_vec());
    }
    let decoder = DeflateDecoder::new(compressed);
    let mut bounded: Take<DeflateDecoder<&[u8]>> =
        decoder.take((MAX_PLUGIN_ENTRY_BYTES as u64) + 1);
    let mut output = Vec::with_capacity(expected_size.min(MAX_PLUGIN_ENTRY_BYTES));
    bounded
        .read_to_end(&mut output)
        .map_err(|_| invalid_zip())?;
    let remaining_input = bounded.into_inner().into_inner();
    if !remaining_input.is_empty()
        || output.len() != expected_size
        || output.len() > MAX_PLUGIN_ENTRY_BYTES
    {
        return Err(PluginArchiveError::new(
            PluginArchiveErrorCode::IntegrityMismatch,
            "A plugin archive entry expanded to an unexpected size.",
        ));
    }
    Ok(output)
}

fn find_eocd(bytes: &[u8]) -> Result<usize, PluginArchiveError> {
    if bytes.len() < 22 {
        return Err(invalid_zip());
    }
    let start = bytes.len().saturating_sub(22 + u16::MAX as usize);
    for offset in (start..=bytes.len() - 22).rev() {
        if read_u32(bytes, offset).ok() != Some(EOCD_SIGNATURE) {
            continue;
        }
        let comment_length = read_u16(bytes, offset + 20)? as usize;
        if offset + 22 + comment_length == bytes.len() {
            return Ok(offset);
        }
    }
    Err(invalid_zip())
}

fn validate_flags(flags: u16, method: u16) -> Result<(), PluginArchiveError> {
    let allowed = UTF8_FLAG | if method == 8 { DEFLATE_OPTION_FLAGS } else { 0 };
    if !matches!(method, 0 | 8) || flags & !allowed != 0 {
        return Err(unsupported_zip());
    }
    Ok(())
}

fn validate_extra(extra: &[u8]) -> Result<(), PluginArchiveError> {
    let mut cursor = 0_usize;
    while cursor < extra.len() {
        if extra.len() - cursor < 4 {
            return Err(invalid_zip());
        }
        let header_id = u16::from_le_bytes([extra[cursor], extra[cursor + 1]]);
        let size = u16::from_le_bytes([extra[cursor + 2], extra[cursor + 3]]) as usize;
        cursor = cursor.checked_add(4).ok_or_else(invalid_zip)?;
        if header_id == ZIP64_EXTRA_ID || cursor + size > extra.len() {
            return Err(unsupported_zip());
        }
        cursor += size;
    }
    Ok(())
}

fn validate_external_attributes(
    made_by: u16,
    attributes: u32,
    is_directory: bool,
) -> Result<(), PluginArchiveError> {
    let host_system = (made_by >> 8) as u8;
    if host_system == 3 {
        let mode = (attributes >> 16) as u16;
        let file_type = mode & 0o170000;
        let expected = if is_directory { 0o040000 } else { 0o100000 };
        if file_type != 0 && file_type != expected {
            return Err(unsupported_zip());
        }
    }
    let dos_directory = attributes & 0x10 != 0;
    if dos_directory != is_directory && (dos_directory || is_directory) {
        return Err(unsupported_zip());
    }
    Ok(())
}

fn validate_archive_path(path: &str, is_directory: bool) -> Result<(), PluginArchiveError> {
    let normalized = if is_directory {
        path.strip_suffix('/').unwrap_or(path)
    } else {
        path
    };
    let segments = normalized.split('/').collect::<Vec<_>>();
    let safe = !normalized.is_empty()
        && normalized.len() <= 240
        && !normalized.starts_with('/')
        && !normalized.contains('\\')
        && !normalized.contains('\0')
        && !normalized.contains(':')
        && segments
            .iter()
            .all(|segment| !segment.is_empty() && *segment != "." && *segment != "..");
    if !safe {
        return Err(unsafe_path());
    }
    Ok(())
}

fn require_range(bytes: &[u8], offset: usize, length: usize) -> Result<(), PluginArchiveError> {
    if offset
        .checked_add(length)
        .is_none_or(|end| end > bytes.len())
    {
        return Err(invalid_zip());
    }
    Ok(())
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, PluginArchiveError> {
    require_range(bytes, offset, 2)?;
    Ok(u16::from_le_bytes([bytes[offset], bytes[offset + 1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, PluginArchiveError> {
    require_range(bytes, offset, 4)?;
    Ok(u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ]))
}

fn invalid_zip() -> PluginArchiveError {
    PluginArchiveError::new(
        PluginArchiveErrorCode::InvalidZip,
        "The plugin archive is not a supported ZIP file.",
    )
}

fn unsupported_zip() -> PluginArchiveError {
    PluginArchiveError::new(
        PluginArchiveErrorCode::UnsupportedZipFeature,
        "The plugin archive uses an unsupported or ambiguous ZIP feature.",
    )
}

fn unsafe_path() -> PluginArchiveError {
    PluginArchiveError::new(
        PluginArchiveErrorCode::UnsafePath,
        "The plugin archive contains an unsafe path.",
    )
}

fn expanded_too_large() -> PluginArchiveError {
    PluginArchiveError::new(
        PluginArchiveErrorCode::ExpandedArchiveTooLarge,
        "The expanded plugin archive exceeds the total size limit.",
    )
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use flate2::{write::DeflateEncoder, Compression};

    use super::*;

    fn push_u16(target: &mut Vec<u8>, value: u16) {
        target.extend_from_slice(&value.to_le_bytes());
    }

    fn push_u32(target: &mut Vec<u8>, value: u32) {
        target.extend_from_slice(&value.to_le_bytes());
    }

    fn zip(entries: &[(&str, &[u8], bool)]) -> Vec<u8> {
        let mut output = Vec::new();
        let mut central = Vec::new();
        for (name, content, deflated) in entries {
            let offset = output.len() as u32;
            let compressed = if *deflated {
                let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
                encoder.write_all(content).unwrap();
                encoder.finish().unwrap()
            } else {
                content.to_vec()
            };
            let method = if *deflated { 8 } else { 0 };
            let crc = crc32fast::hash(content);
            push_u32(&mut output, LOCAL_SIGNATURE);
            push_u16(&mut output, 20);
            push_u16(&mut output, 0);
            push_u16(&mut output, method);
            push_u16(&mut output, 0);
            push_u16(&mut output, 0);
            push_u32(&mut output, crc);
            push_u32(&mut output, compressed.len() as u32);
            push_u32(&mut output, content.len() as u32);
            push_u16(&mut output, name.len() as u16);
            push_u16(&mut output, 0);
            output.extend_from_slice(name.as_bytes());
            output.extend_from_slice(&compressed);

            push_u32(&mut central, CENTRAL_SIGNATURE);
            push_u16(&mut central, 20);
            push_u16(&mut central, 20);
            push_u16(&mut central, 0);
            push_u16(&mut central, method);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u32(&mut central, crc);
            push_u32(&mut central, compressed.len() as u32);
            push_u32(&mut central, content.len() as u32);
            push_u16(&mut central, name.len() as u16);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u32(&mut central, if name.ends_with('/') { 0x10 } else { 0 });
            push_u32(&mut central, offset);
            central.extend_from_slice(name.as_bytes());
        }
        let central_offset = output.len() as u32;
        let central_size = central.len() as u32;
        output.extend_from_slice(&central);
        push_u32(&mut output, EOCD_SIGNATURE);
        push_u16(&mut output, 0);
        push_u16(&mut output, 0);
        push_u16(&mut output, entries.len() as u16);
        push_u16(&mut output, entries.len() as u16);
        push_u32(&mut output, central_size);
        push_u32(&mut output, central_offset);
        push_u16(&mut output, 0);
        output
    }

    #[test]
    fn reads_stored_and_deflated_files_without_extracting_paths() {
        let archive = zip(&[
            ("manifest.json", br#"{"schema":"axiom.plugin"}"#, true),
            ("runtime/", b"", false),
            ("runtime/plugin.wasm", b"wasm", false),
        ]);
        let inspected = read_bounded_plugin_archive(&archive).unwrap();
        assert_eq!(
            inspected.files["manifest.json"],
            br#"{"schema":"axiom.plugin"}"#
        );
        assert_eq!(inspected.files["runtime/plugin.wasm"], b"wasm");
        assert!(!inspected.files.contains_key("runtime/"));
    }

    #[test]
    fn rejects_traversal_duplicates_crc_drift_and_encrypted_entries() {
        assert_eq!(
            read_bounded_plugin_archive(&zip(&[("../escape", b"x", false)]))
                .unwrap_err()
                .code,
            PluginArchiveErrorCode::UnsafePath
        );
        assert_eq!(
            read_bounded_plugin_archive(&zip(&[
                ("manifest.json", b"one", false),
                ("manifest.json", b"two", false),
            ]))
            .unwrap_err()
            .code,
            PluginArchiveErrorCode::DuplicatePath
        );

        let mut crc_drift = zip(&[("manifest.json", b"content", false)]);
        let data_offset = 30 + "manifest.json".len();
        crc_drift[data_offset] ^= 0xff;
        assert_eq!(
            read_bounded_plugin_archive(&crc_drift).unwrap_err().code,
            PluginArchiveErrorCode::IntegrityMismatch
        );

        let mut encrypted = zip(&[("manifest.json", b"content", false)]);
        encrypted[6] = 1;
        assert_eq!(
            read_bounded_plugin_archive(&encrypted).unwrap_err().code,
            PluginArchiveErrorCode::IntegrityMismatch
        );

        let mut hidden_gap = zip(&[("manifest.json", b"content", false)]);
        let central_offset = read_u32(&hidden_gap, hidden_gap.len() - 6).unwrap() as usize;
        hidden_gap.splice(central_offset..central_offset, *b"hidden");
        let shifted_central_offset = (central_offset + b"hidden".len()) as u32;
        let offset_field = hidden_gap.len() - 6;
        hidden_gap[offset_field..offset_field + 4]
            .copy_from_slice(&shifted_central_offset.to_le_bytes());
        assert_eq!(
            read_bounded_plugin_archive(&hidden_gap).unwrap_err().code,
            PluginArchiveErrorCode::IntegrityMismatch
        );
    }

    #[test]
    fn rejects_declared_zip_bombs_before_expansion() {
        let mut archive = zip(&[("manifest.json", b"small", true)]);
        let central_offset = read_u32(&archive, archive.len() - 6).unwrap() as usize;
        archive[central_offset + 24..central_offset + 28]
            .copy_from_slice(&((MAX_PLUGIN_ENTRY_BYTES + 1) as u32).to_le_bytes());
        assert_eq!(
            read_bounded_plugin_archive(&archive).unwrap_err().code,
            PluginArchiveErrorCode::EntryTooLarge
        );
    }
}
