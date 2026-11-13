use super::super::wire::{BackendExpected, NativeExpected, NativeRevisions};
use super::*;

fn player() -> Principal {
    Principal {
        subject: "owner".into(),
        installation_id: "tv".into(),
        permissions: BTreeSet::from([Permission::MultiviewControl]),
    }
}
fn manager() -> Principal {
    Principal {
        permissions: BTreeSet::from([Permission::SourcesManage]),
        ..player()
    }
}
fn binding() -> Binding {
    Binding {
        server_epoch: "epoch".into(),
        session_id: "session".into(),
        backend_expected: BackendExpected {
            runtime: 7,
            scene: "scene".into(),
            geometry_revision: 1,
            focus_revision: 2,
            audio_revision: 3,
        },
        native_expected: NativeExpected {
            runtime: "native".into(),
            expected: NativeRevisions {
                scene: "scene".into(),
                layout_revision: "layout".into(),
                focus_revision: "focus".into(),
                audio_revision: "audio".into(),
            },
            slot_id: 0,
            slot_generation: "generation".into(),
            source_revision: "source".into(),
        },
        backend_slot_revision: 4,
    }
}
fn enrollment() -> Enrollment {
    Enrollment {
        source_ref: "saved".into(),
        profile_uuid: Uuid::from_u128(1),
        config_revision: "config1".into(),
        policy_revision: "policy1".into(),
        allowed: BTreeSet::from([SourcePrincipal::from(&player())]),
        items: vec![ItemEnrollment {
            item_ref: "item".into(),
            identity_version: 1,
            favorite_sha256: "a".repeat(64),
            kind: "vod".into(),
            input_adapter: "http-finite".into(),
            protection: Protection {
                known: true,
                restricted: false,
            },
            descriptor: Descriptor {
                title: "Fixture".into(),
                provider: "m3u".into(),
            },
            input: EnrolledInput { config_index: 5 },
        }],
    }
}
fn fixture() -> (Registry, String) {
    let registry = Registry::new("server".into(), "epoch".into()).unwrap();
    let revision = registry.enroll(&manager(), enrollment(), None).unwrap();
    registry.create_session(&player(), &binding()).unwrap();
    (registry, revision)
}
fn request(registry: &Registry, context: &Binding) -> GrantRequest {
    let catalog = registry
        .sources(
            &player(),
            &SourcesRequest {
                version: 1,
                context: context.clone(),
                cursor: None,
            },
        )
        .unwrap();
    let item = &catalog.items[0];
    GrantRequest {
        version: 1,
        context: context.clone(),
        source_ref: item.source_ref.clone(),
        item_ref: item.item_ref.clone(),
        item_revision: item.item_revision.clone(),
        identity_version: item.identity_version,
        favorite_sha256: item.favorite_sha256.clone(),
        catalog_revision: catalog.catalog_revision,
        remaining_budget_ms: 30_000,
    }
}
fn reserve(registry: &Registry, context: &Binding) -> Reservation {
    let grant = registry
        .mint(&player(), &request(registry, context))
        .unwrap();
    registry
        .redeem(&player(), context, &grant.input_grant)
        .unwrap()
}
fn attached(registry: &Registry) -> (Reservation, Binding) {
    let old = binding();
    let reservation = reserve(registry, &old);
    let mut next = old.clone();
    next.backend_slot_revision += 1;
    registry
        .prepare_attachment(&player(), &old, &next, &reservation)
        .unwrap();
    reservation
        .publication_authority()
        .attach(&reservation.decoder_context(), &mut || Ok(()))
        .unwrap();
    (reservation, next)
}
fn publishes(reservation: &Reservation) -> std::result::Result<(), DecoderError> {
    reservation
        .publication_authority()
        .publish(&reservation.decoder_context(), &mut || Ok(()))
}

#[test]
fn only_operator_enrolls_and_digest_does_not_authorize() {
    let (registry, _) = fixture();
    assert_eq!(
        registry.enroll(&player(), enrollment(), None).unwrap_err(),
        RegistryError::Forbidden
    );
    let mut request = request(&registry, &binding());
    request.source_ref = "native-witness".into();
    assert_eq!(
        registry.mint(&player(), &request).unwrap_err(),
        RegistryError::NotFound
    );
    request.source_ref = "saved".into();
    request.favorite_sha256 = "b".repeat(64);
    assert_eq!(
        registry.mint(&player(), &request).unwrap_err(),
        RegistryError::Stale
    );
}

#[test]
fn session_and_catalog_are_bound_to_both_owner_and_installation() {
    let (registry, _) = fixture();
    let request = request(&registry, &binding());
    for foreign in [
        Principal {
            subject: "other".into(),
            ..player()
        },
        Principal {
            installation_id: "other".into(),
            ..player()
        },
    ] {
        assert_eq!(
            registry.mint(&foreign, &request).unwrap_err(),
            RegistryError::Forbidden
        );
        let mut context = binding();
        context.session_id = format!("session-{}-{}", foreign.subject, foreign.installation_id);
        registry.create_session(&foreign, &context).unwrap();
        let page = registry
            .sources(
                &foreign,
                &SourcesRequest {
                    version: 1,
                    context: context.clone(),
                    cursor: None,
                },
            )
            .unwrap();
        assert!(page.items.is_empty());
        assert_eq!(
            registry
                .mint(
                    &foreign,
                    &GrantRequest {
                        context,
                        ..request.clone()
                    }
                )
                .unwrap_err(),
            RegistryError::Forbidden
        );
    }
}

#[test]
fn full_binding_dimensions_are_cas_checked() {
    let (registry, _) = fixture();
    let original = binding();
    let variants: Vec<Box<dyn Fn(&mut Binding)>> = vec![
        Box::new(|b| b.server_epoch = "other".into()),
        Box::new(|b| b.session_id = "other".into()),
        Box::new(|b| b.backend_expected.runtime += 1),
        Box::new(|b| b.backend_expected.scene = "other".into()),
        Box::new(|b| b.backend_expected.geometry_revision += 1),
        Box::new(|b| b.backend_expected.focus_revision += 1),
        Box::new(|b| b.backend_expected.audio_revision += 1),
        Box::new(|b| b.native_expected.runtime = "other".into()),
        Box::new(|b| b.native_expected.expected.scene = "other".into()),
        Box::new(|b| b.native_expected.expected.layout_revision = "other".into()),
        Box::new(|b| b.native_expected.expected.focus_revision = "other".into()),
        Box::new(|b| b.native_expected.expected.audio_revision = "other".into()),
        Box::new(|b| b.native_expected.slot_id = 1),
        Box::new(|b| b.native_expected.slot_generation = "other".into()),
        Box::new(|b| b.native_expected.source_revision = "other".into()),
        Box::new(|b| b.backend_slot_revision += 1),
    ];
    for change in variants {
        let mut changed = original.clone();
        change(&mut changed);
        assert!(registry.authorize(&player(), &changed).is_err());
    }
    registry.authorize(&player(), &original).unwrap();
}

#[test]
fn restricted_or_unknown_items_never_enter_source_grants() {
    for protection in [
        Protection {
            known: false,
            restricted: false,
        },
        Protection {
            known: true,
            restricted: true,
        },
    ] {
        let (registry, revision) = fixture();
        let mut changed = enrollment();
        changed.items[0].protection = protection;
        registry
            .enroll(&manager(), changed, Some(&revision))
            .unwrap();
        let page = registry
            .sources(
                &player(),
                &SourcesRequest {
                    version: 1,
                    context: binding(),
                    cursor: None,
                },
            )
            .unwrap();
        assert!(page.items.is_empty());
        let s = registry.lock().unwrap();
        let item = s.sources["saved"].items["item"].catalog.clone();
        drop(s);
        let request = GrantRequest {
            version: 1,
            context: binding(),
            source_ref: item.source_ref,
            item_ref: item.item_ref,
            item_revision: item.item_revision,
            identity_version: 1,
            favorite_sha256: item.favorite_sha256,
            catalog_revision: page.catalog_revision,
            remaining_budget_ms: 1000,
        };
        assert_eq!(
            registry.mint(&player(), &request).unwrap_err(),
            RegistryError::Forbidden
        );
    }
}

#[test]
fn enrollment_updates_require_cas_and_readded_item_gets_new_revision() {
    let (registry, revision) = fixture();
    let before = request(&registry, &binding());
    assert_eq!(
        registry.enroll(&manager(), enrollment(), None).unwrap_err(),
        RegistryError::Stale
    );
    let mut removed = enrollment();
    removed.items.clear();
    let next = registry
        .enroll(&manager(), removed, Some(&revision))
        .unwrap();
    registry
        .enroll(&manager(), enrollment(), Some(&next))
        .unwrap();
    let after = request(&registry, &binding());
    assert_ne!(before.item_revision, after.item_revision);
    assert_eq!(
        registry.mint(&player(), &before).unwrap_err(),
        RegistryError::Stale
    );
}

#[test]
fn one_use_grant_lifetime_is_budget_and_session_bounded() {
    let (registry, _) = fixture();
    let now = Instant::now();
    let mut request = request(&registry, &binding());
    request.remaining_budget_ms = 125;
    let grant = registry.mint_at(&player(), &request, now).unwrap();
    assert_eq!(grant.expires_in_ms, 125);
    registry
        .redeem_at(
            &player(),
            &binding(),
            &grant.input_grant,
            now + Duration::from_millis(124),
        )
        .unwrap();
    assert!(matches!(
        registry.redeem_at(
            &player(),
            &binding(),
            &grant.input_grant,
            now + Duration::from_millis(124)
        ),
        Err(RegistryError::Expired)
    ));
    request.remaining_budget_ms = u32::MAX;
    let grant = registry.mint_at(&player(), &request, now).unwrap();
    assert_eq!(grant.expires_in_ms, 30_000);
    assert!(matches!(
        registry.redeem_at(
            &player(),
            &binding(),
            &grant.input_grant,
            now + Duration::from_secs(30)
        ),
        Err(RegistryError::Expired)
    ));
    registry
        .lock()
        .unwrap()
        .sessions
        .get_mut("session")
        .unwrap()
        .expires = now + Duration::from_millis(70);
    let grant = registry.mint_at(&player(), &request, now).unwrap();
    assert_eq!(grant.expires_in_ms, 70);
}

#[test]
fn wrong_session_cannot_consume_grant_and_pending_count_is_bounded() {
    let (registry, _) = fixture();
    let request = request(&registry, &binding());
    let grant = registry.mint(&player(), &request).unwrap();
    let mut other = binding();
    other.session_id = "other".into();
    registry.create_session(&player(), &other).unwrap();
    assert!(matches!(
        registry.redeem(&player(), &other, &grant.input_grant),
        Err(RegistryError::Stale)
    ));
    for _ in 1..MAX_PENDING {
        registry.mint(&player(), &request).unwrap();
    }
    assert_eq!(
        registry.mint(&player(), &request).unwrap_err(),
        RegistryError::Limit
    );
    registry
        .redeem(&player(), &binding(), &grant.input_grant)
        .unwrap();
}

#[test]
fn preparing_and_armed_frames_cannot_publish_or_activate() {
    let (registry, _) = fixture();
    let reservation = reserve(&registry, &binding());
    assert_eq!(
        publishes(&reservation),
        Err(DecoderError::PublicationDenied)
    );
    let mut next = binding();
    next.backend_slot_revision += 1;
    registry
        .prepare_attachment(&player(), &binding(), &next, &reservation)
        .unwrap();
    assert_eq!(
        publishes(&reservation),
        Err(DecoderError::PublicationDenied)
    );
    assert_eq!(
        registry.authorize(&player(), &next),
        Err(RegistryError::Stale)
    );
    reservation
        .publication_authority()
        .attach(&reservation.decoder_context(), &mut || Ok(()))
        .unwrap();
    registry.authorize(&player(), &next).unwrap();
    publishes(&reservation).unwrap();
    assert_eq!(
        reservation
            .publication_authority()
            .attach(&reservation.decoder_context(), &mut || panic!(
                "duplicate attach must not run"
            )),
        Err(DecoderError::PublicationDenied)
    );
}

#[test]
fn successful_attachment_promotes_identity_without_changing_issued_decoder_context() {
    let (registry, _) = fixture();
    let (reservation, next) = attached(&registry);
    assert_eq!(
        reservation.decoder_context().source_revision,
        binding().backend_slot_revision
    );
    assert_eq!(
        next.backend_slot_revision,
        binding().backend_slot_revision + 1
    );
    publishes(&reservation).unwrap();
    let mut replaced = next.clone();
    replaced.backend_slot_revision += 1;
    registry
        .update_binding(&player(), &next, &replaced)
        .unwrap();
    assert!(reservation.revoked().load(Ordering::Acquire));
    assert!(publishes(&reservation).is_err());
}

#[test]
fn resolver_monitor_keeps_issue_identity_but_checks_promoted_active_authority() {
    let (registry, _) = fixture();
    let (reservation, next) = attached(&registry);
    registry
        .validate_reservation(&player(), &binding(), &reservation)
        .unwrap();
    assert_eq!(
        registry.validate_reservation(&player(), &next, &reservation),
        Err(RegistryError::Stale)
    );
    let mut focused = next.clone();
    focused.backend_expected.focus_revision += 1;
    registry.update_binding(&player(), &next, &focused).unwrap();
    registry
        .validate_reservation(&player(), &binding(), &reservation)
        .unwrap();
    let mut foreign = player();
    foreign.installation_id = "other".into();
    assert_eq!(
        registry.validate_reservation(&foreign, &binding(), &reservation),
        Err(RegistryError::Forbidden)
    );
    registry.retire_slot(&player(), &focused).unwrap();
    assert_eq!(
        registry.validate_reservation(&player(), &binding(), &reservation),
        Err(RegistryError::Revoked)
    );
}

#[test]
fn owned_cleanup_survives_promotion_focus_changes_and_expiration() {
    let (registry, _) = fixture();
    let (reservation, next) = attached(&registry);
    let mut focused = next.clone();
    focused.backend_expected.focus_revision += 1;
    registry.update_binding(&player(), &next, &focused).unwrap();
    registry
        .lock()
        .unwrap()
        .sessions
        .get_mut("session")
        .unwrap()
        .expires = Instant::now();
    let mut other = player();
    other.installation_id = "other".into();
    assert_eq!(
        registry.retire_reservation(&other, &reservation),
        Err(RegistryError::Forbidden)
    );
    let receipt = registry
        .retire_reservation(&player(), &reservation)
        .unwrap();
    assert!(receipt.cancellation_requested);
    assert!(!receipt.output_revoked);
    assert!(!receipt.reaped);
    assert_eq!(
        registry
            .retire_reservation(&player(), &reservation)
            .unwrap(),
        receipt
    );
}

#[test]
fn failed_attach_retires_without_claiming_cleanup_or_advancing_binding() {
    let (registry, _) = fixture();
    let reservation = reserve(&registry, &binding());
    let mut next = binding();
    next.backend_slot_revision += 1;
    registry
        .prepare_attachment(&player(), &binding(), &next, &reservation)
        .unwrap();
    assert_eq!(
        reservation
            .publication_authority()
            .attach(&reservation.decoder_context(), &mut || Err(
                DecoderError::Io
            )),
        Err(DecoderError::Io)
    );
    registry.authorize(&player(), &binding()).unwrap();
    let receipt = &registry.retirements(&player(), "session").unwrap()[0];
    assert!(receipt.cancellation_requested);
    assert!(!receipt.reaped);
    assert!(!receipt.output_revoked);
    assert_eq!(
        registry.with_session_authority(&player(), "session", &mut || panic!("blocked")),
        Err(RegistryError::Revoked)
    );
}

#[test]
fn attach_expiration_is_enforced_and_cannot_be_renewed() {
    let (registry, _) = fixture();
    let reservation = reserve(&registry, &binding());
    let mut next = binding();
    next.backend_slot_revision += 1;
    registry
        .prepare_attachment(&player(), &binding(), &next, &reservation)
        .unwrap();
    registry
        .lock()
        .unwrap()
        .leases
        .get_mut(reservation.id())
        .unwrap()
        .prepare_deadline = Instant::now();
    assert!(reservation
        .publication_authority()
        .attach(&reservation.decoder_context(), &mut || panic!("expired"))
        .is_err());
    assert!(reservation.revoked().load(Ordering::Acquire));
    assert_eq!(
        registry.renew(&player(), &binding()),
        Err(RegistryError::Revoked)
    );
}

#[test]
fn active_lease_outlives_redemption_but_expires_without_renewal() {
    let (registry, _) = fixture();
    let (reservation, next) = attached(&registry);
    registry
        .lock()
        .unwrap()
        .leases
        .get_mut(reservation.id())
        .unwrap()
        .prepare_deadline = Instant::now();
    publishes(&reservation).unwrap();
    let now = Instant::now();
    registry.renew_at(&player(), &next, now).unwrap();
    assert_eq!(
        registry.lock().unwrap().sessions["session"].expires,
        now + SESSION_TTL
    );
    assert_eq!(
        registry.renew_at(&player(), &next, now + SESSION_TTL),
        Err(RegistryError::Expired)
    );
    assert!(reservation.revoked().load(Ordering::Acquire));
    assert!(publishes(&reservation).is_err());
}

#[test]
fn geometry_change_preserves_active_but_retires_pending_sources() {
    let (registry, _) = fixture();
    let (reservation, old) = attached(&registry);
    let mut next = old.clone();
    next.backend_expected.focus_revision += 1;
    next.backend_expected.geometry_revision += 1;
    next.backend_expected.audio_revision += 1;
    next.native_expected.expected.focus_revision = "focus2".into();
    next.native_expected.expected.layout_revision = "layout2".into();
    next.native_expected.expected.audio_revision = "audio2".into();
    let mut slot1 = old.clone();
    slot1.native_expected.slot_id = 1;
    registry.add_slot(&player(), &slot1).unwrap();
    let pending = reserve(&registry, &slot1);
    registry.update_binding(&player(), &old, &next).unwrap();
    assert!(!reservation.revoked().load(Ordering::Acquire));
    publishes(&reservation).unwrap();
    assert!(pending.revoked().load(Ordering::Acquire));
    assert_eq!(
        registry.with_binding_authority(&player(), &old, &mut || Ok(())),
        Err(RegistryError::Stale)
    );
}

#[test]
fn redeemed_slot_preparation_survives_focus_audio_aba_and_preserves_latest_globals() {
    let (registry, _) = fixture();
    let issue0 = binding();
    let mut issue1 = issue0.clone();
    issue1.native_expected.slot_id = 1;
    registry.add_slot(&player(), &issue1).unwrap();
    let reservation0 = reserve(&registry, &issue0);
    let reservation1 = reserve(&registry, &issue1);

    // Simulate a slow probe: another slot receives focus/audio commands while
    // this explicit slot's already redeemed source is still preparing.
    let mut focused1 = issue1.clone();
    focused1.backend_expected.focus_revision += 1;
    focused1.backend_expected.audio_revision += 1;
    focused1.native_expected.expected.focus_revision = "focused-slot1".into();
    focused1.native_expected.expected.audio_revision = "audio-slot1".into();
    registry
        .update_binding(&player(), &issue1, &focused1)
        .unwrap();
    registry
        .validate_reservation(&player(), &issue0, &reservation0)
        .unwrap();
    registry
        .validate_reservation(&player(), &issue1, &reservation1)
        .unwrap();
    assert!(!reservation0.revoked().load(Ordering::Acquire));
    assert_eq!(
        registry.authorize(&player(), &issue0),
        Err(RegistryError::Stale)
    );
    assert_eq!(
        registry.update_binding(&player(), &issue1, &focused1),
        Err(RegistryError::Stale)
    );

    let mut candidate = issue0.clone();
    candidate.backend_slot_revision += 1;
    registry
        .prepare_attachment(&player(), &issue0, &candidate, &reservation0)
        .unwrap();
    assert_eq!(
        publishes(&reservation0),
        Err(DecoderError::PublicationDenied)
    );

    // Focus/audio may return to previous values while revisions still advance.
    // Even an armed attachment must preserve the newest ABA metadata.
    let mut returned1 = focused1.clone();
    returned1.backend_expected.focus_revision += 1;
    returned1.backend_expected.audio_revision += 1;
    returned1.native_expected.expected.focus_revision = "returned-slot0-new-revision".into();
    returned1.native_expected.expected.audio_revision = "returned-slot0-new-audio".into();
    registry
        .update_binding(&player(), &focused1, &returned1)
        .unwrap();
    registry
        .validate_reservation(&player(), &issue0, &reservation0)
        .unwrap();
    reservation0
        .publication_authority()
        .attach(&reservation0.decoder_context(), &mut || Ok(()))
        .unwrap();
    let mut committed0 = candidate.clone();
    committed0.backend_expected = returned1.backend_expected.clone();
    committed0.native_expected.expected = returned1.native_expected.expected.clone();
    registry.authorize(&player(), &committed0).unwrap();
    registry.authorize(&player(), &returned1).unwrap();
    assert_eq!(
        registry.authorize(&player(), &candidate),
        Err(RegistryError::Stale)
    );
    registry
        .validate_reservation(&player(), &issue1, &reservation1)
        .unwrap();
    assert_eq!(reservation0.decoder_context(), decoder_context(&issue0));
    publishes(&reservation0).unwrap();
    let s = registry.lock().unwrap();
    assert_eq!(s.sessions["session"].slots[&0], committed0);
    assert_eq!(s.sessions["session"].slots[&1], returned1);
    assert!(!s.sessions["session"].output_blocked);
}

#[test]
fn focus_audio_relaxation_never_applies_to_original_grant_or_cached_response() {
    let (registry, _) = fixture();
    let issue = binding();
    let original = request(&registry, &issue);
    let grant = registry.mint(&player(), &original).unwrap();
    let mut current = issue.clone();
    current.backend_expected.focus_revision += 1;
    current.backend_expected.audio_revision += 1;
    current.native_expected.expected.focus_revision = "focus2".into();
    current.native_expected.expected.audio_revision = "audio2".into();
    registry
        .update_binding(&player(), &issue, &current)
        .unwrap();
    assert_eq!(
        registry.mint(&player(), &original).unwrap_err(),
        RegistryError::Stale
    );
    assert!(matches!(
        registry.redeem(&player(), &issue, &grant.input_grant),
        Err(RegistryError::Stale)
    ));
    assert!(matches!(
        registry.redeem(&player(), &current, &grant.input_grant),
        Err(RegistryError::Expired)
    ));
    assert_eq!(
        registry.validate_cached_grant(&player(), &original, &grant),
        Err(RegistryError::Stale)
    );
    let fresh = registry
        .mint(&player(), &request(&registry, &current))
        .unwrap();
    assert!(matches!(
        registry.redeem(&player(), &issue, &fresh.input_grant),
        Err(RegistryError::Stale)
    ));
    registry
        .redeem(&player(), &current, &fresh.input_grant)
        .unwrap();
}

#[test]
fn source_scene_and_geometry_aba_cancel_preparing_and_armed_candidates() {
    let changes: Vec<Box<dyn Fn(&mut Binding)>> = vec![
        Box::new(|b| b.backend_expected.runtime += 1),
        Box::new(|b| b.backend_expected.scene = "new-scene".into()),
        Box::new(|b| b.backend_expected.geometry_revision += 1),
        Box::new(|b| b.native_expected.runtime = "new-native".into()),
        Box::new(|b| b.native_expected.expected.scene = "new-native-scene".into()),
        Box::new(|b| b.native_expected.expected.layout_revision = "new-layout".into()),
        Box::new(|b| b.native_expected.slot_generation = "new-generation".into()),
        Box::new(|b| b.native_expected.source_revision = "new-source".into()),
        Box::new(|b| b.backend_slot_revision += 1),
    ];
    for armed in [false, true] {
        for change in &changes {
            let (registry, _) = fixture();
            let issue = binding();
            let reservation = reserve(&registry, &issue);
            let mut candidate = issue.clone();
            candidate.backend_slot_revision += 1;
            if armed {
                registry
                    .prepare_attachment(&player(), &issue, &candidate, &reservation)
                    .unwrap();
            }
            let mut changed = issue.clone();
            change(&mut changed);
            registry
                .update_binding(&player(), &issue, &changed)
                .unwrap();
            assert!(reservation.revoked().load(Ordering::Acquire));
            assert_eq!(
                registry.validate_reservation(&player(), &issue, &reservation),
                Err(RegistryError::Revoked)
            );
            registry
                .update_binding(&player(), &changed, &issue)
                .unwrap();
            assert_eq!(
                registry.validate_reservation(&player(), &issue, &reservation),
                Err(RegistryError::Revoked)
            );
            assert!(registry
                .prepare_attachment(&player(), &issue, &candidate, &reservation)
                .is_err());
            assert!(reservation
                .publication_authority()
                .attach(&reservation.decoder_context(), &mut || panic!(
                    "stale candidate attached"
                ))
                .is_err());
            assert!(publishes(&reservation).is_err());
        }
    }
}

#[test]
fn attachment_candidate_cannot_change_preparation_scene_or_geometry() {
    let changes: Vec<Box<dyn Fn(&mut Binding)>> = vec![
        Box::new(|b| b.backend_expected.runtime += 1),
        Box::new(|b| b.backend_expected.scene = "new-scene".into()),
        Box::new(|b| b.backend_expected.geometry_revision += 1),
        Box::new(|b| b.native_expected.runtime = "new-native".into()),
        Box::new(|b| b.native_expected.expected.scene = "new-native-scene".into()),
        Box::new(|b| b.native_expected.expected.layout_revision = "new-layout".into()),
        Box::new(|b| b.native_expected.slot_id = 1),
    ];
    for change in changes {
        let (registry, _) = fixture();
        let issue = binding();
        let reservation = reserve(&registry, &issue);
        let mut candidate = issue.clone();
        candidate.backend_slot_revision += 1;
        change(&mut candidate);
        assert_eq!(
            registry.prepare_attachment(&player(), &issue, &candidate, &reservation),
            Err(RegistryError::InvalidRequest)
        );
        assert!(!reservation.revoked().load(Ordering::Acquire));
        assert_eq!(
            publishes(&reservation),
            Err(DecoderError::PublicationDenied)
        );
    }
}

#[test]
fn profile_policy_or_config_edit_revokes_pending_active_and_composite_output() {
    for change in 0..4 {
        let (registry, revision) = fixture();
        let (reservation, next) = attached(&registry);
        let grant = registry
            .mint(&player(), &request(&registry, &next))
            .unwrap();
        let mut updated = enrollment();
        match change {
            0 => updated.profile_uuid = Uuid::from_u128(2),
            1 => updated.config_revision = "config2".into(),
            2 => updated.policy_revision = "policy2".into(),
            _ => {
                updated.allowed = BTreeSet::from([SourcePrincipal {
                    subject: "other".into(),
                    installation_id: "tv".into(),
                }])
            }
        }
        registry
            .enroll(&manager(), updated, Some(&revision))
            .unwrap();
        assert!(reservation.revoked().load(Ordering::Acquire));
        assert!(publishes(&reservation).is_err());
        assert!(matches!(
            registry.redeem(&player(), &next, &grant.input_grant),
            Err(RegistryError::Expired)
        ));
        assert_eq!(
            registry.with_binding_authority(&player(), &next, &mut || panic!("output revoked")),
            Err(RegistryError::Revoked)
        );
    }
}

#[test]
fn cancellation_is_not_output_revocation_or_worker_reaping() {
    let (registry, _) = fixture();
    let (reservation, next) = attached(&registry);
    let pending = registry
        .mint(&player(), &request(&registry, &next))
        .unwrap();
    let receipt = registry.retire_slot(&player(), &next).unwrap().remove(0);
    assert!(receipt.cancellation_requested);
    assert!(!receipt.output_revoked);
    assert!(!receipt.reaped);
    assert_eq!(
        registry.rearm_output(&player(), &next),
        Err(RegistryError::Busy)
    );
    let grant = registry
        .mint(&player(), &request(&registry, &next))
        .unwrap();
    assert!(matches!(
        registry.redeem(&player(), &next, &grant.input_grant),
        Err(RegistryError::Busy)
    ));
    assert!(matches!(
        registry.redeem(&player(), &next, &pending.input_grant),
        Err(RegistryError::Expired)
    ));
    let receipt = registry
        .acknowledge_retirement(&player(), reservation.id(), RetirementProof::WorkerReaped)
        .unwrap();
    assert!(receipt.reaped);
    assert!(!receipt.output_revoked);
    assert!(matches!(
        registry.redeem(&player(), &next, &grant.input_grant),
        Err(RegistryError::Busy)
    ));
    let receipt = registry
        .acknowledge_retirement(&player(), reservation.id(), RetirementProof::OutputRevoked)
        .unwrap();
    assert!(receipt.reaped && receipt.output_revoked);
    registry
        .redeem(&player(), &next, &grant.input_grant)
        .unwrap();
    registry.rearm_output(&player(), &next).unwrap();
}

#[test]
fn credential_revocation_retires_all_sessions_and_cannot_be_undone_by_renew() {
    let (registry, _) = fixture();
    let (reservation, next) = attached(&registry);
    assert_eq!(
        registry
            .revoke_principal(&player(), &SourcePrincipal::from(&player()))
            .unwrap_err(),
        RegistryError::Forbidden
    );
    let receipts = registry
        .revoke_principal(&manager(), &SourcePrincipal::from(&player()))
        .unwrap();
    assert_eq!(receipts.len(), 1);
    assert!(reservation.revoked().load(Ordering::Acquire));
    assert_eq!(
        registry.renew(&player(), &next),
        Err(RegistryError::Revoked)
    );
}

#[test]
fn closed_session_id_cannot_resurrect_old_bindings() {
    let (registry, _) = fixture();
    registry.revoke_session(&player(), "session").unwrap();
    registry.close_session(&player(), "session").unwrap();
    assert_eq!(
        registry.create_session(&player(), &binding()),
        Err(RegistryError::Busy)
    );
    assert_eq!(
        registry.authorize(&player(), &binding()),
        Err(RegistryError::NotFound)
    );
}

#[test]
fn cached_grant_replay_is_live_bound_and_does_not_extend_deadline() {
    let (registry, revision) = fixture();
    let request = request(&registry, &binding());
    let response = registry.mint(&player(), &request).unwrap();
    registry
        .lock()
        .unwrap()
        .grants
        .get_mut(&response.input_grant)
        .unwrap()
        .expires = Instant::now() + Duration::from_secs(1);
    registry
        .with_cached_grant_authority(&player(), &request, &response, &mut |fresh| {
            assert!(registry.state.try_lock().is_err());
            assert!(fresh.expires_in_ms <= 1000);
            Ok(())
        })
        .unwrap();
    registry
        .enroll(&manager(), enrollment(), Some(&revision))
        .unwrap();
    assert!(registry
        .with_cached_grant_authority(&player(), &request, &response, &mut |_| panic!(
            "revoked grant"
        ))
        .is_err());
}

#[test]
fn consumed_grant_cannot_be_republished_from_cache() {
    let (registry, _) = fixture();
    let request = request(&registry, &binding());
    let response = registry.mint(&player(), &request).unwrap();
    registry
        .redeem(&player(), &binding(), &response.input_grant)
        .unwrap();
    assert_eq!(
        registry.validate_cached_grant(&player(), &request, &response),
        Err(RegistryError::Expired)
    );
}

#[test]
fn publication_and_revocation_share_the_same_mutex() {
    let (registry, _) = fixture();
    let (reservation, next) = attached(&registry);
    let mut count = 0;
    reservation
        .publication_authority()
        .publish(&reservation.decoder_context(), &mut || {
            assert!(registry.state.try_lock().is_err());
            count += 1;
            Ok(())
        })
        .unwrap();
    registry
        .with_binding_authority(&player(), &next, &mut || {
            assert!(registry.state.try_lock().is_err());
            count += 1;
            Ok(())
        })
        .unwrap();
    registry.revoke_session(&player(), "session").unwrap();
    assert!(reservation
        .publication_authority()
        .publish(&reservation.decoder_context(), &mut || {
            count += 1;
            Ok(())
        })
        .is_err());
    assert_eq!(count, 2);
}

#[test]
fn catalog_cursor_is_bounded_and_invalidated_on_catalog_change() {
    let (registry, revision) = fixture();
    let mut many = enrollment();
    let item = many.items[0].clone();
    many.items = (0..129)
        .map(|n| ItemEnrollment {
            item_ref: format!("item{n:04}"),
            ..item.clone()
        })
        .collect();
    let revision = registry
        .enroll(&manager(), many.clone(), Some(&revision))
        .unwrap();
    let first = registry
        .sources(
            &player(),
            &SourcesRequest {
                version: 1,
                context: binding(),
                cursor: None,
            },
        )
        .unwrap();
    assert_eq!(first.items.len(), 128);
    let cursor = first.next_cursor.unwrap();
    let last = registry
        .sources(
            &player(),
            &SourcesRequest {
                version: 1,
                context: binding(),
                cursor: Some(cursor.clone()),
            },
        )
        .unwrap();
    assert_eq!(last.items.len(), 1);
    assert!(last.next_cursor.is_none());
    let mut other = binding();
    other.session_id = "other".into();
    registry.create_session(&player(), &other).unwrap();
    assert_eq!(
        registry
            .sources(
                &player(),
                &SourcesRequest {
                    version: 1,
                    context: other,
                    cursor: Some(cursor.clone())
                }
            )
            .unwrap_err(),
        RegistryError::Stale
    );
    registry.enroll(&manager(), many, Some(&revision)).unwrap();
    assert_eq!(
        registry
            .sources(
                &player(),
                &SourcesRequest {
                    version: 1,
                    context: binding(),
                    cursor: Some(cursor)
                }
            )
            .unwrap_err(),
        RegistryError::Expired
    );
}

#[test]
fn registry_limits_reject_instead_of_evicting_existing_authority() {
    let (registry, revision) = fixture();
    let mut many = enrollment();
    let item = many.items[0].clone();
    many.items = (0..MAX_ITEMS)
        .map(|n| ItemEnrollment {
            item_ref: format!("item{n}"),
            ..item.clone()
        })
        .collect();
    registry.enroll(&manager(), many, Some(&revision)).unwrap();
    let mut extra = enrollment();
    extra.source_ref = "extra".into();
    assert_eq!(
        registry.enroll(&manager(), extra, None),
        Err(RegistryError::Limit)
    );
    assert_eq!(
        registry.lock().unwrap().sources["saved"].items.len(),
        MAX_ITEMS
    );
    for n in 1..MAX_SESSIONS {
        let mut b = binding();
        b.session_id = format!("session{n}");
        registry.create_session(&player(), &b).unwrap();
    }
    let mut b = binding();
    b.session_id = "excess".into();
    assert_eq!(
        registry.create_session(&player(), &b),
        Err(RegistryError::Limit)
    );
    registry.authorize(&player(), &binding()).unwrap();
}

#[test]
fn actual_granted_file_attach_uses_issue_context_and_registry_promotion_barrier() {
    use crate::multiview::decoder::GrantedFile;

    // A newly owned regular file is sufficient for the descriptor/authority seam;
    // this test never probes, decodes, opens a private source or spawns a process.
    struct FixtureDirectory(std::path::PathBuf);
    impl Drop for FixtureDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(self.0.join("fixture.bin"));
            let _ = std::fs::remove_dir(&self.0);
        }
    }
    let directory = FixtureDirectory(
        std::env::temp_dir().join(format!("ott-registry-attach-{}", Uuid::new_v4().simple())),
    );
    std::fs::create_dir(&directory.0).unwrap();
    let file = std::fs::File::create_new(directory.0.join("fixture.bin")).unwrap();
    let (registry, _) = fixture();
    let reservation = reserve(&registry, &binding());
    let issue = reservation.decoder_context();
    let granted = GrantedFile::from_authorized_file(
        file,
        issue,
        Instant::now() + Duration::from_secs(60),
        reservation.revoked(),
        reservation.publication_authority(),
    )
    .unwrap();

    let mut calls = 0;
    assert_eq!(
        granted.attach(&issue, &mut || {
            calls += 1;
            Ok(())
        }),
        Err(DecoderError::PublicationDenied)
    );
    let mut next = binding();
    next.backend_slot_revision += 1;
    registry
        .prepare_attachment(&player(), &binding(), &next, &reservation)
        .unwrap();
    let mut wrong = issue;
    wrong.source_revision = next.backend_slot_revision;
    assert_eq!(
        granted.attach(&wrong, &mut || {
            calls += 1;
            Ok(())
        }),
        Err(DecoderError::BindingMismatch)
    );
    assert_eq!(
        publishes(&reservation),
        Err(DecoderError::PublicationDenied)
    );
    granted
        .attach(&issue, &mut || {
            assert!(registry.state.try_lock().is_err());
            calls += 1;
            Ok(())
        })
        .unwrap();
    registry.authorize(&player(), &next).unwrap();
    assert_eq!(reservation.decoder_context(), issue);
    publishes(&reservation).unwrap();
    assert_eq!(
        granted.attach(&issue, &mut || {
            calls += 1;
            Ok(())
        }),
        Err(DecoderError::PublicationDenied)
    );
    registry.revoke_session(&player(), "session").unwrap();
    assert_eq!(
        granted.attach(&issue, &mut || {
            calls += 1;
            Ok(())
        }),
        Err(DecoderError::Revoked)
    );
    assert!(reservation
        .publication_authority()
        .publish(&issue, &mut || {
            calls += 1;
            Ok(())
        })
        .is_err());
    assert_eq!(calls, 1);
}

// Queue real public entry points behind the authority mutex. The worker is
// released only after the chosen monotonic deadline; no test changes its clock.
fn queued_past_deadline(
    registry: &Registry,
    deadline: Instant,
    operation: impl FnOnce() -> Result<()> + Send + 'static,
) -> Result<()> {
    use std::sync::mpsc::{channel, RecvTimeoutError};
    let locked = registry.lock().unwrap();
    let (started_tx, started_rx) = channel();
    let (finished_tx, finished_rx) = channel();
    let worker = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        finished_tx.send(operation()).unwrap();
    });
    started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(
        finished_rx.recv_timeout(
            deadline.saturating_duration_since(Instant::now()) + Duration::from_millis(20)
        ),
        Err(RecvTimeoutError::Timeout)
    );
    assert!(Instant::now() >= deadline);
    drop(locked);
    let result = finished_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    worker.join().unwrap();
    result
}

#[test]
fn queued_session_operations_recheck_expiry_after_authority_lock() {
    for operation in ["mint", "redeem", "renew", "sources"] {
        let (registry, revision) = fixture();
        if operation == "sources" {
            // More than one page makes a stale success observable as both a
            // returned catalog and a newly allocated cursor.
            let mut source = enrollment();
            let item = source.items[0].clone();
            for index in 1..129 {
                let mut next = item.clone();
                next.item_ref = format!("item-{index}");
                source.items.push(next);
            }
            registry
                .enroll(&manager(), source, Some(&revision))
                .unwrap();
        }
        let (active, context) = if operation == "renew" {
            let (active, context) = attached(&registry);
            (Some(active), context)
        } else {
            (None, binding())
        };
        let selection = if operation == "sources" {
            None
        } else {
            Some(request(&registry, &context))
        };
        let pending = if operation == "redeem" {
            Some(
                registry
                    .mint(&player(), selection.as_ref().unwrap())
                    .unwrap()
                    .input_grant,
            )
        } else {
            None
        };
        let deadline = Instant::now() + Duration::from_millis(200);
        registry
            .lock()
            .unwrap()
            .sessions
            .get_mut("session")
            .unwrap()
            .expires = deadline;
        let worker_registry = registry.clone();
        let worker_context = context.clone();
        let result = queued_past_deadline(&registry, deadline, move || match operation {
            "mint" => worker_registry
                .mint(&player(), selection.as_ref().unwrap())
                .map(|_| ()),
            "redeem" => worker_registry
                .redeem(&player(), &worker_context, pending.as_ref().unwrap())
                .map(|_| ()),
            "renew" => worker_registry.renew(&player(), &worker_context),
            "sources" => worker_registry
                .sources(
                    &player(),
                    &SourcesRequest {
                        version: 1,
                        context: worker_context,
                        cursor: None,
                    },
                )
                .map(|_| ()),
            _ => unreachable!(),
        });
        assert_eq!(result, Err(RegistryError::Expired), "{operation}");
        let state = registry.lock().unwrap();
        // Especially renew: expiry must not move forward and old authority must
        // not revive, even if active input existed before queuing.
        assert_eq!(state.sessions["session"].expires, deadline, "{operation}");
        assert_eq!(state.sessions["session"].slots[&0], context, "{operation}");
        assert!(state.cursors.is_empty(), "{operation}");
        if operation == "mint" {
            assert!(state.grants.is_empty());
        }
        if operation == "redeem" {
            assert!(state.leases.is_empty());
        }
        if let Some(active) = &active {
            assert!(active.revoked().load(Ordering::Acquire));
            assert!(state.sessions["session"].output_blocked);
            assert_eq!(state.leases[active.id()].phase, Phase::Retiring);
        }
        drop(state);
        assert_eq!(
            registry.authorize(&player(), &context),
            Err(RegistryError::Expired)
        );
        assert_eq!(
            registry.with_session_authority(&player(), "session", &mut || panic!(
                "expired authority revived"
            )),
            Err(RegistryError::Expired)
        );
        if let Some(active) = &active {
            assert!(publishes(active).is_err());
        }
    }
}

#[test]
fn queued_redemption_cannot_consume_a_grant_that_expired_while_session_lives() {
    let (registry, _) = fixture();
    let grant = registry
        .mint(&player(), &request(&registry, &binding()))
        .unwrap();
    let deadline = Instant::now() + Duration::from_millis(200);
    registry
        .lock()
        .unwrap()
        .grants
        .get_mut(&grant.input_grant)
        .unwrap()
        .expires = deadline;
    let worker_registry = registry.clone();
    let grant_id = grant.input_grant.clone();
    assert_eq!(
        queued_past_deadline(&registry, deadline, move || {
            worker_registry
                .redeem(&player(), &binding(), &grant_id)
                .map(|_| ())
        }),
        Err(RegistryError::Expired)
    );
    registry.authorize(&player(), &binding()).unwrap();
    let state = registry.lock().unwrap();
    assert!(!state.grants.contains_key(&grant.input_grant));
    assert!(state.leases.is_empty());
}

#[test]
fn queued_creation_starts_its_initial_lease_at_admission() {
    let (registry, _) = fixture();
    let mut context = binding();
    context.session_id = "queued-session".into();
    let worker_registry = registry.clone();
    let deadline = Instant::now() + Duration::from_millis(200);
    queued_past_deadline(&registry, deadline, move || {
        worker_registry.create_session(&player(), &context)
    })
    .unwrap();
    assert!(registry.lock().unwrap().sessions["queued-session"].expires >= deadline + SESSION_TTL);
}
