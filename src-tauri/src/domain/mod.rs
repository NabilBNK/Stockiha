//! Domain layer — value types, typed identifiers, status enums, and
//! validation constructors for the S1-001 production schemas.
mod business_document;
pub(crate) mod canonical_json;
mod cash_session;
pub(crate) mod catalog;
mod document_sequence;
mod error;
mod fiscal_period;
mod identifiers;
mod journal;
mod money;
mod product;
mod queue;
mod sale;
mod stock;
mod warehouse;
