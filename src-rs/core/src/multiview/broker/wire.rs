//! Private compositor protocol. This is not the public controller protocol.
//! No request can supply a provider URL, path, credential, or owner identity.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const VERSION: u8 = 1;
pub const AUDIENCE: &str = "ottplay-multiview-v1";
pub const MAX_CONTROL_BYTES: usize = 16_384;
pub const MAX_RESULT_BYTES: usize = 262_144;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Permission {
    SourcesManage,
    MultiviewControl,
}

/// Constructed by the trusted server credential store, never deserialized.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Principal {
    pub subject: String,
    pub installation_id: String,
    pub permissions: BTreeSet<Permission>,
}
impl Principal {
    pub fn permits(&self, permission: Permission) -> bool {
        self.permissions.contains(&permission)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackendExpected {
    pub runtime: u64,
    pub scene: String,
    pub geometry_revision: u64,
    pub focus_revision: u64,
    pub audio_revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeRevisions {
    pub scene: String,
    pub layout_revision: String,
    pub focus_revision: String,
    pub audio_revision: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeExpected {
    pub runtime: String,
    pub expected: NativeRevisions,
    pub slot_id: u8,
    pub slot_generation: String,
    pub source_revision: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub server_epoch: String,
    pub session_id: String,
    pub backend_expected: BackendExpected,
    pub native_expected: NativeExpected,
    pub backend_slot_revision: u64,
}
impl Binding {
    pub fn valid(&self) -> bool {
        let n = &self.native_expected;
        let e = &n.expected;
        [
            self.server_epoch.as_str(),
            self.session_id.as_str(),
            self.backend_expected.scene.as_str(),
            n.runtime.as_str(),
            e.scene.as_str(),
            e.layout_revision.as_str(),
            e.focus_revision.as_str(),
            e.audio_revision.as_str(),
            n.slot_generation.as_str(),
            n.source_revision.as_str(),
        ]
        .iter()
        .all(|s| opaque(s))
            && n.slot_id < 9
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Protection {
    pub known: bool,
    pub restricted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Descriptor {
    pub title: String,
    pub provider: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogItem {
    pub source_ref: String,
    pub item_ref: String,
    pub item_revision: String,
    pub identity_version: u8,
    pub favorite_sha256: String,
    pub kind: String,
    pub input_adapter: String,
    pub protection: Protection,
    pub descriptor: Descriptor,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourcesRequest {
    pub version: u8,
    pub context: Binding,
    pub cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourcesResponse {
    pub version: u8,
    pub server_id: String,
    pub context: Binding,
    pub catalog_revision: String,
    pub items: Vec<CatalogItem>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrantRequest {
    pub version: u8,
    pub context: Binding,
    pub source_ref: String,
    pub item_ref: String,
    pub item_revision: String,
    pub identity_version: u8,
    pub favorite_sha256: String,
    pub catalog_revision: String,
    /// Narrows the server's 30-second maximum; never extends an existing budget.
    pub remaining_budget_ms: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrantResponse {
    pub version: u8,
    pub server_id: String,
    pub context: Binding,
    pub item: CatalogItem,
    pub catalog_revision: String,
    pub policy_revision: String,
    pub input_grant: String,
    pub expires_in_ms: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlRequest {
    pub version: u8,
    pub context: Binding,
    pub op: ControlOp,
}

/// Internally tagged closed variants avoid accepting ignored authority fields.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "name", rename_all = "snake_case", deny_unknown_fields)]
pub enum ControlOp {
    Play { input_grant: String },
    Renew {},
    Focus {},
    Audio { policy: AudioPolicy },
    Layout { geometry: Geometry },
    Stop {},
    Off {},
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioPolicy {
    FollowsFocus,
    Muted,
    Slot,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GeometryMode {
    Disjoint,
    Pip,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Canvas {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rect {
    pub slot_id: u8,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub z: u8,
}

/// Native supplies exact raster geometry; server validates, never recomputes it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Geometry {
    pub canvas: Canvas,
    pub revision: u64,
    pub mode: GeometryMode,
    pub rects: Vec<Rect>,
}

/// Bootstrap has no prior backend identity. The server allocates it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionCreateRequest {
    pub version: u8,
    pub server_epoch: String,
    pub native_expected: NativeExpected,
    pub output_profile_id: String,
    pub geometry: Geometry,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutputProfile {
    pub profile_id: String,
    pub canvas: Canvas,
    pub max_inputs: u8,
    pub geometry_modes: Vec<GeometryMode>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Capabilities {
    pub version: u8,
    pub server_id: String,
    pub server_epoch: String,
    pub max_inputs: u8,
    pub qualified_input_adapters: Vec<String>,
    pub output_profiles: Vec<OutputProfile>,
    pub output_auth: String,
    pub catalog_revision: String,
}

/// Owner-bound read can recover fresh backend revisions after a lost response.
/// The returned snapshot is not an execution grant.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusRequest {
    pub version: u8,
    pub server_epoch: String,
    pub session_id: String,
    pub native_expected: NativeExpected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Preparing,
    Ready,
    Closing,
    Closed,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlotState {
    Empty,
    Preparing,
    Playing,
    Stalled,
    Closing,
    Closed,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SlotSnapshot {
    pub slot_id: u8,
    pub source_revision: u64,
    pub state: SlotState,
    pub error: Option<String>,
    pub frames: u64,
    pub position_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub source_ref: Option<String>,
    pub item_ref: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioState {
    pub policy: AudioPolicy,
    pub slot_id: Option<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusResponse {
    pub version: u8,
    pub server_id: String,
    pub server_epoch: String,
    pub session_id: String,
    pub native_expected: NativeExpected,
    pub backend_expected: BackendExpected,
    pub state: SessionState,
    pub geometry: Geometry,
    pub slots: Vec<SlotSnapshot>,
    pub audio: AudioState,
    pub output: Option<Output>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlResponse {
    pub version: u8,
    pub context: Binding,
    pub accepted: bool,
    pub operation_id: String,
    pub state: SessionState,
}

/// Private response only. Never copy this path into public controller receipts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Output {
    pub session_id: String,
    pub server_epoch: String,
    pub output_generation: String,
    pub playlist_path: String,
    pub lease_expires_in_ms: u32,
}

pub fn opaque(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
}
pub fn favorite_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn operation_variants_reject_unrecognized_authority_fields() {
        for raw in [
            r#"{"name":"renew","url":"https://example.test"}"#,
            r#"{"name":"play","input_grant":"g","owner":"other"}"#,
            r#"{"name":"play","input_grant":"g","input_grant":"h"}"#,
        ] {
            assert!(serde_json::from_str::<ControlOp>(raw).is_err());
        }
        assert_eq!(
            serde_json::from_str::<ControlOp>(r#"{"name":"renew"}"#).unwrap(),
            ControlOp::Renew {}
        );
    }
    #[test]
    fn identity_and_opaque_encodings_are_canonical_and_bounded() {
        assert!(favorite_digest(&"a".repeat(64)));
        assert!(!favorite_digest(&"A".repeat(64)));
        assert!(!opaque("../secret"));
        assert!(!opaque(&"a".repeat(129)));
        assert!(opaque("source_A.1"));
    }
}
