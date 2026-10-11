use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Path generic error: {0}")]
    Generic(String),

    #[error("Plugin device storage revision conflict")]
    PluginDeviceStorageRevisionConflict {
        expected_revision: u64,
        actual_revision: u64,
    },

    #[error("Plugin device document conflict")]
    PluginDeviceDocumentConflict {
        key: String,
        expected_version: Option<u64>,
        actual_version: Option<u64>,
    },

    #[error("Plugin device storage quota exceeded")]
    PluginDeviceStorageQuota,

    #[error("Plugin device storage data is invalid")]
    PluginDeviceStorageData,

    #[error("Operating-system credential storage is unavailable")]
    PluginSecretStoreUnavailable,
}

// Convert the actual error into a clean JSON structure for the frontend
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 5)?;

        let code = match self {
            AppError::Io(_) => "IO_ERROR",
            AppError::Json(_) => "JSON_ERROR",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Validation(_) => "VALIDATION_ERROR",
            AppError::Internal(_) => "INTERNAL_ERROR",
            AppError::Generic(_) => "GENERIC_ERROR",
            AppError::PluginDeviceStorageRevisionConflict { .. } => {
                "PLUGIN_DEVICE_STORAGE_REVISION_CONFLICT"
            }
            AppError::PluginDeviceDocumentConflict { .. } => "PLUGIN_DEVICE_DOCUMENT_CONFLICT",
            AppError::PluginDeviceStorageQuota => "PLUGIN_DEVICE_STORAGE_QUOTA_EXCEEDED",
            AppError::PluginDeviceStorageData => "PLUGIN_DEVICE_STORAGE_DATA_INVALID",
            AppError::PluginSecretStoreUnavailable => "PLUGIN_SECRET_STORE_UNAVAILABLE",
        };

        state.serialize_field("code", code)?;
        state.serialize_field("message", &self.to_string())?;
        match self {
            AppError::PluginDeviceStorageRevisionConflict {
                expected_revision,
                actual_revision,
            } => {
                state.serialize_field("expectedRevision", expected_revision)?;
                state.serialize_field("actualRevision", actual_revision)?;
            }
            AppError::PluginDeviceDocumentConflict {
                key,
                expected_version,
                actual_version,
            } => {
                state.serialize_field("key", key)?;
                state.serialize_field("expectedVersion", expected_version)?;
                state.serialize_field("actualVersion", actual_version)?;
            }
            _ => {}
        }
        state.end()
    }
}

// Ensure string-based From conversions still work to smoothly transition the backend
impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Generic(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Generic(s.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_device_storage_conflicts_without_native_details() {
        let value = serde_json::to_value(AppError::PluginDeviceStorageRevisionConflict {
            expected_revision: 2,
            actual_revision: 4,
        })
        .unwrap();

        assert_eq!(value["code"], "PLUGIN_DEVICE_STORAGE_REVISION_CONFLICT");
        assert_eq!(value["expectedRevision"], 2);
        assert_eq!(value["actualRevision"], 4);
        assert_eq!(value["message"], "Plugin device storage revision conflict");
    }
}
