pub fn parse_control_change(message: &[u8]) -> Option<(u8, u8)> {
    if message.len() < 3 {
        return None;
    }

    let status = message[0] & 0xF0;
    if status == 0xB0 {
        Some((message[1], message[2]))
    } else {
        None
    }
}
