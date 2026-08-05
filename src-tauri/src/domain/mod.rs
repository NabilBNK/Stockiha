//! Domain layer — value types, typed identifiers, status enums, and
//! validation constructors for the S1-001 production schemas.
mod business_document;
pub(crate) mod canonical_json;
pub(crate) mod cash_session;
pub(crate) mod catalog;
pub(crate) mod customer;
mod document_sequence;
pub(crate) mod drawer;
mod error;
mod fiscal_period;
mod identifiers;
mod journal;
mod money;
pub(crate) mod onboarding;
pub(crate) mod opening_state;
pub(crate) mod procurement;
mod product;
mod queue;
pub(crate) mod receivables;
pub(crate) mod recovery;
pub(crate) mod residual;
mod sale;
pub(crate) mod stock;
pub(crate) mod supplier;
mod warehouse;
