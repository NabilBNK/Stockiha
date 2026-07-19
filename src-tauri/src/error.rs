use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", content = "message")]
pub enum AppError {
    Internal(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Internal(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for AppError {}
