//! Slice 1 MVP batch — canonical JSON payload hashing for idempotency
//! (final-architecture.md section 2.4: "Payloads are serialized to a
//! deterministic canonical form (sorted keys, normalized whitespace)
//! before hashing. Semantically identical JSON with different key order
//! must produce the same hash.").
//!
//! This is the Rust side of the contract `core.reserve_idempotent_request`
//! depends on: the database only ever compares opaque hash bytes, so
//! producing the SAME hash for semantically identical payloads is entirely
//! this module's responsibility. `serde_json::Value` is already a crate
//! dependency (S0-010); no new dependency is needed for canonicalization,
//! and the existing `sha2` dependency (S0-009) provides the hash itself.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

/// Serializes `value` to a canonical byte form: object keys sorted
/// lexicographically at every nesting level, no insignificant whitespace.
///
/// This does not assume anything about whether `serde_json`'s
/// `preserve_order` feature happens to be active for this build (Cargo's
/// feature unification means that is a whole-dependency-graph property,
/// not something this crate's own `Cargo.toml` alone controls) — every
/// object is explicitly rebuilt with its keys inserted in sorted order
/// before serializing, so the output is sorted whether the underlying
/// `Map` type is a `BTreeMap` (sorts automatically) or an order-preserving
/// map (sorted because insertion order was already sorted).
pub(crate) fn canonicalize(value: &Value) -> Vec<u8> {
    let sorted = sort_keys(value);
    // `to_vec` (not `to_vec_pretty`) never inserts insignificant whitespace.
    serde_json::to_vec(&sorted)
        .expect("canonicalized serde_json::Value serialization is infallible")
}

fn sort_keys(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut sorted_map = Map::with_capacity(map.len());
            for key in keys {
                sorted_map.insert(key.clone(), sort_keys(&map[key]));
            }
            Value::Object(sorted_map)
        }
        Value::Array(items) => Value::Array(items.iter().map(sort_keys).collect()),
        other => other.clone(),
    }
}

/// The exact 32-byte SHA-256 digest `core.reserve_idempotent_request`
/// expects for `p_payload_hash` (`bytea`). Hashing the canonical form (not
/// the caller's original byte-for-byte JSON) is what makes key-order and
/// whitespace differences irrelevant, matching architecture's requirement.
pub(crate) fn payload_hash(value: &Value) -> [u8; 32] {
    let canonical = canonicalize(value);
    let digest = Sha256::digest(&canonical);
    digest.into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn identical_payloads_with_different_key_order_hash_the_same() {
        let a = json!({"variant_id": 1, "quantity": 2});
        let b = json!({"quantity": 2, "variant_id": 1});
        assert_eq!(payload_hash(&a), payload_hash(&b));
    }

    #[test]
    fn different_payloads_hash_differently() {
        let a = json!({"variant_id": 1, "quantity": 2});
        let b = json!({"variant_id": 1, "quantity": 3});
        assert_ne!(payload_hash(&a), payload_hash(&b));
    }

    #[test]
    fn nested_object_key_order_does_not_affect_the_hash() {
        let a = json!({
            "lines": [{"variant_id": 1, "quantity": 2}],
            "warehouse_id": 1
        });
        let b = json!({
            "warehouse_id": 1,
            "lines": [{"quantity": 2, "variant_id": 1}]
        });
        assert_eq!(payload_hash(&a), payload_hash(&b));
    }

    #[test]
    fn hash_is_the_expected_sha256_length() {
        let value = json!({"a": 1});
        assert_eq!(payload_hash(&value).len(), 32);
    }
}
