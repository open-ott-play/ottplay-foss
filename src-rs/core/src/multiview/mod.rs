//! Experimental composition primitives, deliberately not wired into a player or route.
//!
//! `worker::run_fixture` proves finite local-file composition only. Its fixed
//! filtergraph does not provide independently replaceable live slot decoders.
//! Production admission must stay unavailable until a separately reviewed source
//! broker, persistent per-input lifecycle and output transport are connected.

pub mod broker;
pub mod decoder;
pub mod encoder;
pub mod frames;
pub mod geometry;
pub mod persistent;
pub mod plan;
pub mod worker;

#[cfg(test)]
mod tests;
