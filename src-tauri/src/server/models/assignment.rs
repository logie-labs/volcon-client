use serde::{Deserialize, Serialize};

fn default_trim() -> f32 {
    1.0
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Assignment {
    pub control: u8,
    pub app: String,
    pub label: Option<String>,
    /// Full executable path captured at assignment time, used as a reliable
    /// fallback for icon lookups when the process name alone can't be matched
    /// to a running/cached process.
    #[serde(default)]
    pub path: Option<String>,
    /// Per-app gain applied on top of the control's position (0.0–1.0), so one
    /// control can drive several apps while keeping them balanced against each
    /// other. Defaults to unity so assignments written before trim existed keep
    /// behaving the same.
    #[serde(default = "default_trim")]
    pub trim: f32,
    #[serde(default)]
    pub muted: bool,
}

impl Assignment {
    pub fn clamped_trim(&self) -> f32 {
        if self.trim.is_finite() {
            self.trim.clamp(0.0, 1.0)
        } else {
            1.0
        }
    }
}
