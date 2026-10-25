use std::collections::VecDeque;

use super::{Assignment, MidiControlEvent};

#[derive(Clone, Debug, Default)]
pub struct BridgeState {
    pub selected_input: Option<String>,
    pub active_preset_id: Option<String>,
    pub assignments: Vec<Assignment>,
    pub last_control: Option<u8>,
    pub last_value: Option<u8>,
    pub control_sequence: u64,
    pub recent_controls: VecDeque<MidiControlEvent>,
}
