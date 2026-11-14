//! Experimental composition primitives with explicit fixture-only integration.
//!
//! `worker::run_fixture` proves finite local-file composition only. Its fixed
//! filtergraph does not provide independently replaceable live slot decoders.
//! Production admission remains disabled. The private fixture router exercises
//! the source broker, persistent per-input lifecycle and output transport without
//! registering a production service or enabling a player capability.

pub mod broker;
pub mod decoder;
pub mod encoder;
pub mod frames;
pub mod geometry;
pub mod persistent;
pub mod plan;
mod timing;
pub mod worker;

#[cfg(test)]
mod tests;
