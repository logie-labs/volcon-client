use midir::MidiInput;

use crate::server::error::{BridgeError, BridgeResult};

pub fn midi_inputs() -> BridgeResult<Vec<String>> {
    let midi_in = MidiInput::new("volcon").map_err(|err| BridgeError(err.to_string()))?;
    let mut inputs = Vec::new();

    for port in midi_in.ports() {
        inputs.push(
            midi_in
                .port_name(&port)
                .map_err(|err| BridgeError(err.to_string()))?,
        );
    }

    Ok(inputs)
}
