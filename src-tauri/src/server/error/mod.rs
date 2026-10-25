use std::error::Error;
use std::fmt;

#[derive(Debug)]
pub struct BridgeError(pub(crate) String);

impl fmt::Display for BridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Error for BridgeError {}

impl From<String> for BridgeError {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for BridgeError {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

impl From<midir::InitError> for BridgeError {
    fn from(value: midir::InitError) -> Self {
        Self(value.to_string())
    }
}

#[cfg(windows)]
impl From<windows::core::Error> for BridgeError {
    fn from(value: windows::core::Error) -> Self {
        Self(value.to_string())
    }
}

pub type BridgeResult<T> = Result<T, BridgeError>;
