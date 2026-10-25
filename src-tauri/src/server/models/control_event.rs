use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MidiControlEvent {
    pub sequence: u64,
    pub control: u8,
    pub value: u8,
}
