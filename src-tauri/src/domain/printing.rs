//! Printing settings travel as raw `jsonb` end to end (WS-M-1): PostgreSQL is
//! the only place that knows the field list, so a new identity column never
//! needs a matching Rust struct. `serde_json::Value` is the wire type for
//! both `get_printing_settings` and `save_printing_settings`.
