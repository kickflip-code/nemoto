use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Active built-in runtime ID or installed custom theme ID.
    pub active_theme: String,

    /// UI scale / zoom factor (1.0 = 100%)
    pub ui_scale: f32,

    /// User-preferred locale (future)
    pub locale: Option<String>,

    /// Auto-save interval in seconds (0 = disabled)
    pub auto_save_interval: u32,

    /// Last backup timestamp (for reminder feature)
    pub last_backup: Option<String>,

    /// Currently active temp portfolio name (None = main portfolio)
    pub active_temp_portfolio: Option<String>,

    /// Preserve future config fields without blocking older backends.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            active_theme: "soft".into(),
            ui_scale: 1.0,
            locale: None,
            auto_save_interval: 60,
            last_backup: None,
            active_temp_portfolio: None,
            extra: HashMap::new(),
        }
    }
}
