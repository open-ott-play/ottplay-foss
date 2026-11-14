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
        next_native: None,
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

fn changed_source(context: &Binding) -> NativeExpected {
    let mut next = context.native_expected.clone();
    next.slot_generation = "next-generation".into();
    next.source_revision = "next-source".into();
    next
}

#[test]
fn grant_source_transition_commits_only_target_and_redeems_returned_context() {
    let (registry, _) = fixture();
    let old = binding();
    let mut other = old.clone();
    other.native_expected.slot_id = 1;
    other.native_expected.slot_generation = "other-generation".into();
    other.native_expected.source_revision = "other-source".into();
    registry.add_slot(&player(), &other).unwrap();
    let mut request = request(&registry, &old);
    request.next_native = Some(changed_source(&old));
    let mut calls = 0;
    let response = registry
        .mint_with_commit(&player(), &request, &mut |staged| {
            calls += 1;
            assert!(registry.state.try_lock().is_err());
            assert_eq!(staged.context.native_expected, changed_source(&old));
            Ok(())
        })
        .unwrap();
    assert_eq!(calls, 1);
    let mut expected = old.clone();
    expected.native_expected = changed_source(&old);
    assert_eq!(response.context, expected);
    assert_eq!(
        registry.current_binding(&player(), "session", 0).unwrap(),
        expected
    );
    assert_eq!(
        registry.current_binding(&player(), "session", 1).unwrap(),
        other
    );
    assert_eq!(
        registry.authorize(&player(), &old),
        Err(RegistryError::Stale)
    );
    assert!(matches!(
        registry.redeem(&player(), &old, &response.input_grant),
        Err(RegistryError::Stale)
    ));
    let reservation = registry
        .redeem(&player(), &response.context, &response.input_grant)
        .unwrap();
    assert_eq!(
        reservation.decoder_context(),
        decoder_context(&response.context)
    );
    assert!(matches!(
        registry.redeem(&player(), &response.context, &response.input_grant),
        Err(RegistryError::Expired)
    ));
}

#[test]
fn grant_source_transition_rejects_scene_runtime_slot_and_invalid_identity_changes() {
    for mutation in 0..8 {
        let (registry, _) = fixture();
        let mut request = request(&registry, &binding());
        let mut next = changed_source(&binding());
        match mutation {
            0 => next.runtime = "other-runtime".into(),
            1 => next.expected.scene = "other-scene".into(),
            2 => next.expected.layout_revision = "other-layout".into(),
            3 => next.expected.focus_revision = "other-focus".into(),
            4 => next.expected.audio_revision = "other-audio".into(),
            5 => next.slot_id = 1,
            6 => next.slot_generation.clear(),
            _ => next.source_revision = "invalid/source".into(),
        }
        request.next_native = Some(next);
        assert_eq!(
            registry.mint_with_commit(&player(), &request, &mut |_| panic!(
                "invalid transition reached commit"
            )),
            Err(RegistryError::InvalidRequest)
        );
        assert_eq!(
            registry.current_binding(&player(), "session", 0).unwrap(),
            binding()
        );
        assert!(registry.lock().unwrap().grants.is_empty());
    }
}

#[test]
fn invalid_selection_or_stale_prior_never_publishes_or_advances_native_intent() {
    for mutation in 0..7 {
        let (registry, _) = fixture();
        let mut request = request(&registry, &binding());
        request.next_native = Some(changed_source(&binding()));
        match mutation {
            0 => request.source_ref = "missing".into(),
            1 => request.item_ref = "missing".into(),
            2 => request.item_revision = "stale".into(),
            3 => request.favorite_sha256 = "b".repeat(64),
            4 => request.catalog_revision = "stale".into(),
            5 => request.context.backend_slot_revision += 1,
            _ => request.identity_version += 1,
        }
        assert!(registry
            .mint_with_commit(&player(), &request, &mut |_| panic!(
                "invalid selection reached commit"
            ))
            .is_err());
        assert_eq!(
            registry.current_binding(&player(), "session", 0).unwrap(),
            binding()
        );
        assert!(registry.lock().unwrap().grants.is_empty());
    }
}

#[test]
fn source_transition_checks_session_capacity_before_commit() {
    let (registry, _) = fixture();
    let original = request(&registry, &binding());
    for _ in 0..MAX_PENDING {
        registry.mint(&player(), &original).unwrap();
    }
    let mut other = binding();
    other.native_expected.slot_id = 1;
    registry.add_slot(&player(), &other).unwrap();
    let mut transition = request(&registry, &other);
    transition.next_native = Some(changed_source(&other));
    assert_eq!(
        registry.mint_with_commit(&player(), &transition, &mut |_| panic!(
            "full session reached commit"
        )),
        Err(RegistryError::Limit)
    );
    assert_eq!(
        registry.current_binding(&player(), "session", 1).unwrap(),
        other
    );
    assert_eq!(registry.lock().unwrap().grants.len(), MAX_PENDING);
}

#[test]
fn changed_source_intent_never_replaces_pending_grant() {
    let (registry, _) = fixture();
    let original = request(&registry, &binding());
    let pending = registry.mint(&player(), &original).unwrap();
    let mut transition = original.clone();
    transition.next_native = Some(changed_source(&binding()));
    assert_eq!(
        registry.mint_with_commit(&player(), &transition, &mut |_| panic!(
            "pending target reached commit"
        )),
        Err(RegistryError::Busy)
    );
    assert_eq!(
        registry.current_binding(&player(), "session", 0).unwrap(),
        binding()
    );
    assert_eq!(registry.lock().unwrap().grants.len(), 1);
    registry
        .redeem(&player(), &binding(), &pending.input_grant)
        .unwrap();
}

#[test]
fn changed_source_intent_requires_every_lease_phase_to_finish_retirement() {
    for phase in [
        Phase::Preparing,
        Phase::Attaching,
        Phase::Active,
        Phase::Retiring,
    ] {
        let (registry, _) = fixture();
        let mut current = binding();
        let reservation = reserve(&registry, &current);
        if matches!(phase, Phase::Attaching | Phase::Active) {
            let mut next = current.clone();
            next.backend_slot_revision += 1;
            registry
                .prepare_attachment(&player(), &current, &next, &reservation)
                .unwrap();
            if phase == Phase::Active {
                reservation
                    .publication_authority()
                    .attach(&reservation.decoder_context(), &mut || Ok(()))
                    .unwrap();
                current = next;
            }
        } else if phase == Phase::Retiring {
            registry
                .retire_reservation(&player(), &reservation)
                .unwrap();
        }
        let was_revoked = reservation.revoked().load(Ordering::Acquire);
        let mut transition = request(&registry, &current);
        transition.next_native = Some(changed_source(&current));
        assert_eq!(
            registry.mint_with_commit(&player(), &transition, &mut |_| panic!(
                "occupied target reached commit"
            )),
            Err(RegistryError::Busy)
        );
        assert_eq!(
            registry.current_binding(&player(), "session", 0).unwrap(),
            current
        );
        assert_eq!(reservation.revoked().load(Ordering::Acquire), was_revoked);
        assert_eq!(
            registry.lock().unwrap().leases[reservation.id()].phase,
            phase
        );
        if phase == Phase::Active {
            assert!(publishes(&reservation).is_ok());
        }
    }
}

#[test]
fn expired_pending_grant_does_not_block_a_fresh_source_intent() {
    let (registry, _) = fixture();
    let mut request = request(&registry, &binding());
    let pending = registry.mint(&player(), &request).unwrap();
    registry
        .lock()
        .unwrap()
        .grants
        .get_mut(&pending.input_grant)
        .unwrap()
        .expires = Instant::now();
    request.next_native = Some(changed_source(&binding()));
    let fresh = registry.mint(&player(), &request).unwrap();
    let s = registry.lock().unwrap();
    assert!(!s.grants.contains_key(&pending.input_grant));
    assert!(s.grants.contains_key(&fresh.input_grant));
    assert_eq!(s.sessions["session"].slots[&0], fresh.context);
}

#[test]
fn grant_cache_commit_failure_leaves_native_and_grants_unchanged() {
    let (registry, _) = fixture();
    let mut request = request(&registry, &binding());
    request.next_native = Some(changed_source(&binding()));
    let mut unpublished = None;
    assert_eq!(
        registry.mint_with_commit(&player(), &request, &mut |staged| {
            assert!(registry.state.try_lock().is_err());
            unpublished = Some(staged.clone());
            Err(RegistryError::Unavailable)
        }),
        Err(RegistryError::Unavailable)
    );
    assert_eq!(
        registry.current_binding(&player(), "session", 0).unwrap(),
        binding()
    );
    assert!(registry.lock().unwrap().grants.is_empty());
    let response = registry.mint(&player(), &request).unwrap();
    assert_ne!(unpublished.unwrap().input_grant, response.input_grant);
    assert_eq!(registry.lock().unwrap().grants.len(), 1);
}

#[test]
fn queued_mutations_recheck_session_expiry_after_acquiring_authority() {
    for mint in [true, false] {
        let (registry, _) = fixture();
        let mut request = request(&registry, &binding());
        request.next_native = Some(changed_source(&binding()));
        let callback_called = Arc::new(AtomicBool::new(false));
        let called = Arc::clone(&callback_called);
        let worker_registry = registry.clone();
        let expiry = Instant::now() + Duration::from_millis(200);
        registry
            .lock()
            .unwrap()
            .sessions
            .get_mut("session")
            .unwrap()
            .expires = expiry;
        let result = queued_past_deadline(&registry, expiry, move || {
            if mint {
                worker_registry
                    .mint_with_commit(&player(), &request, &mut |_| {
                        called.store(true, Ordering::Release);
                        Ok(())
                    })
                    .map(|_| ())
            } else {
                let mut next = binding();
                next.backend_expected.focus_revision += 1;
                next.native_expected.expected.focus_revision = "queued-focus".into();
                worker_registry.commit_binding(&player(), &binding(), &next, &mut || {
                    called.store(true, Ordering::Release);
                    Ok(())
                })
            }
        });
        assert_eq!(result, Err(RegistryError::Expired));
        assert!(!callback_called.load(Ordering::Acquire));
        let state = registry.lock().unwrap();
        assert_eq!(state.sessions["session"].slots[&0], binding());
        assert!(state.grants.is_empty());
    }
}

#[test]
fn transitioned_grant_replay_binds_exact_original_request_and_committed_state() {
    let (registry, _) = fixture();
    let mut original = request(&registry, &binding());
    original.next_native = Some(changed_source(&binding()));
    let response = registry.mint(&player(), &original).unwrap();
    assert_eq!(
        registry.mint_with_commit(&player(), &original, &mut |_| panic!(
            "stale prior reached commit"
        )),
        Err(RegistryError::Stale)
    );
    registry
        .validate_cached_grant(&player(), &original, &response)
        .unwrap();
    registry
        .lock()
        .unwrap()
        .grants
        .get_mut(&response.input_grant)
        .unwrap()
        .expires = Instant::now() + Duration::from_secs(1);
    registry
        .with_cached_grant_authority(&player(), &original, &response, &mut |cached| {
            assert!(registry.state.try_lock().is_err());
            assert!(cached.expires_in_ms <= 1000);
            assert_eq!(cached.context, response.context);
            Ok(())
        })
        .unwrap();
    for mutation in 0..4 {
        let mut forged = original.clone();
        match mutation {
            // Same committed context is insufficient: the real prior request
            // and the explicit/absent transition must also match the receipt.
            0 => forged.context.native_expected.source_revision = "different-prior".into(),
            1 => {
                forged.context = response.context.clone();
                forged.next_native = None;
            }
            2 => forged.remaining_budget_ms -= 1,
            _ => forged.favorite_sha256 = "b".repeat(64),
        }
        assert_eq!(
            registry.validate_cached_grant(&player(), &forged, &response),
            Err(RegistryError::Stale)
        );
    }
    registry
        .redeem(&player(), &response.context, &response.input_grant)
        .unwrap();
    assert_eq!(
        registry.validate_cached_grant(&player(), &original, &response),
        Err(RegistryError::Expired)
    );
}

#[test]
fn absent_or_unchanged_next_native_preserves_existing_grant_admission() {
    let (registry, _) = fixture();
    let mut request = request(&registry, &binding());
    let first = registry.mint(&player(), &request).unwrap();
    request.next_native = Some(binding().native_expected);
    let second = registry.mint(&player(), &request).unwrap();
    assert_eq!(first.context, binding());
    assert_eq!(second.context, binding());
    registry
        .redeem(&player(), &binding(), &first.input_grant)
        .unwrap();
    // The legacy path may still mint while a target is occupied; redemption
    // enforces its existing busy rule. Only changed intent has stricter admission.
    assert_eq!(
        registry.mint(&player(), &request).unwrap().context,
        binding()
    );
    assert!(matches!(
        registry.redeem(&player(), &binding(), &second.input_grant),
        Err(RegistryError::Busy)
    ));
}

#[test]
fn committed_source_intent_attachment_preserves_later_focus_and_audio() {
    let (registry, _) = fixture();
    let mut request = request(&registry, &binding());
    request.next_native = Some(changed_source(&binding()));
    let grant = registry.mint(&player(), &request).unwrap();
    let issued = grant.context;
    let reservation = registry
        .redeem(&player(), &issued, &grant.input_grant)
        .unwrap();
    let mut latest = issued.clone();
    latest.backend_expected.focus_revision += 1;
    latest.backend_expected.audio_revision += 1;
    latest.native_expected.expected.focus_revision = "later-focus".into();
    latest.native_expected.expected.audio_revision = "later-audio".into();
    registry
        .commit_binding(&player(), &issued, &latest, &mut || Ok(()))
        .unwrap();
    let mut promoted = issued.clone();
    promoted.backend_slot_revision += 1;
    registry
        .prepare_attachment(&player(), &issued, &promoted, &reservation)
        .unwrap();
    reservation
        .publication_authority()
        .attach(&reservation.decoder_context(), &mut || Ok(()))
        .unwrap();
    latest.backend_slot_revision = promoted.backend_slot_revision;
    assert_eq!(
        registry.current_binding(&player(), "session", 0).unwrap(),
        latest
    );
    assert_eq!(reservation.decoder_context(), decoder_context(&issued));
    assert!(publishes(&reservation).is_ok());
}

#[test]
fn current_binding_is_owner_scoped_and_never_creates_unknown_slots() {
    let (registry, _) = fixture();
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
            registry.current_binding(&foreign, "session", 0),
            Err(RegistryError::Forbidden)
        );
    }
    assert_eq!(
        registry.current_binding(&player(), "missing", 0),
        Err(RegistryError::NotFound)
    );
    assert_eq!(
        registry.current_binding(&player(), "session", 1),
        Err(RegistryError::NotFound)
    );
    assert_eq!(
        registry.current_binding(&player(), "session", 9),
        Err(RegistryError::InvalidRequest)
    );
    registry
        .lock()
        .unwrap()
        .sessions
        .get_mut("session")
        .unwrap()
        .output_blocked = true;
    assert_eq!(
        registry.current_binding(&player(), "session", 0).unwrap(),
        binding()
    );
    registry
        .lock()
        .unwrap()
        .sessions
        .get_mut("session")
        .unwrap()
        .expires = Instant::now();
    assert_eq!(
        registry.current_binding(&player(), "session", 0),
        Err(RegistryError::Expired)
    );
    assert_eq!(registry.lock().unwrap().sessions["session"].slots.len(), 1);
}

#[test]
fn commit_binding_checks_cas_before_callback_and_preserves_state_on_callback_error() {
    let (registry, _) = fixture();
    let (reservation, old) = attached(&registry);
    let original = request(&registry, &old);
    let pending = registry.mint(&player(), &original).unwrap();
    let mut next = old.clone();
    next.backend_expected.focus_revision += 1;
    next.native_expected.expected.focus_revision = "next-focus".into();
    let mut invalid = next.clone();
    invalid.session_id = "different-session".into();
    assert_eq!(
        registry.commit_binding(&player(), &old, &invalid, &mut || panic!(
            "invalid next reached callback"
        )),
        Err(RegistryError::InvalidRequest)
    );
    assert_eq!(
        registry.commit_binding(&player(), &binding(), &next, &mut || panic!(
            "stale prior reached callback"
        )),
        Err(RegistryError::Stale)
    );
    let foreign = Principal {
        installation_id: "other".into(),
        ..player()
    };
    assert_eq!(
        registry.commit_binding(&foreign, &old, &next, &mut || panic!(
            "foreign owner reached callback"
        )),
        Err(RegistryError::Forbidden)
    );
    assert_eq!(
        registry.commit_binding(&player(), &old, &next, &mut || {
            assert!(registry.state.try_lock().is_err());
            Err(RegistryError::Unavailable)
        }),
        Err(RegistryError::Unavailable)
    );
    assert_eq!(
        registry.current_binding(&player(), "session", 0).unwrap(),
        old
    );
    registry
        .validate_cached_grant(&player(), &original, &pending)
        .unwrap();
    assert!(publishes(&reservation).is_ok());
    let mut calls = 0;
    registry
        .commit_binding(&player(), &old, &next, &mut || {
            assert!(registry.state.try_lock().is_err());
            calls += 1;
            Ok(())
        })
        .unwrap();
    assert_eq!(calls, 1);
    assert_eq!(
        registry.current_binding(&player(), "session", 0).unwrap(),
        next
    );
    assert!(registry.lock().unwrap().grants.is_empty());
    assert!(publishes(&reservation).is_ok());
    assert_eq!(
        registry.commit_binding(&player(), &old, &next, &mut || panic!(
            "replayed CAS reached callback"
        )),
        Err(RegistryError::Stale)
    );
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
            next_native: Some(changed_source(&binding())),
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
        assert_eq!(
            registry.current_binding(&player(), "session", 0).unwrap(),
            binding()
        );
        assert!(registry.lock().unwrap().grants.is_empty());
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
fn atomic_revocation_retires_every_live_phase_before_output_authority() {
    for phase in [Phase::Preparing, Phase::Attaching, Phase::Active] {
        for session_authority in [true, false] {
            let (registry, _) = fixture();
            let issued = binding();
            let reservation = reserve(&registry, &issued);
            let mut current = issued.clone();
            if matches!(phase, Phase::Attaching | Phase::Active) {
                let mut next = issued.clone();
                next.backend_slot_revision += 1;
                registry
                    .prepare_attachment(&player(), &issued, &next, &reservation)
                    .unwrap();
                if phase == Phase::Active {
                    reservation
                        .publication_authority()
                        .attach(&reservation.decoder_context(), &mut || Ok(()))
                        .unwrap();
                    current = next;
                    publishes(&reservation).unwrap();
                }
            }
            registry
                .with_session_authority(&player(), "session", &mut || Ok(()))
                .unwrap();
            registry
                .with_binding_authority(&player(), &current, &mut || Ok(()))
                .unwrap();
            {
                let state = registry.lock().unwrap();
                let lease = &state.leases[reservation.id()];
                assert_eq!(lease.phase, phase);
                assert!(selected_current(&state, &lease.owner, &lease.selection));
                assert!(lease.prepare_deadline > Instant::now());
                assert!(!state.sessions["session"].output_blocked);
            }

            // Exercise the public cancellation handle alone. Do not call a
            // retirement/decoder/status helper before the output guard: those
            // could sweep first and mask which entrypoint admitted old bytes.
            reservation.revoked().store(true, Ordering::Release);
            let mut delivered = false;
            let mut deliver = || {
                delivered = true;
                Ok(())
            };
            let result = if session_authority {
                registry.with_session_authority(&player(), "session", &mut deliver)
            } else {
                registry.with_binding_authority(&player(), &current, &mut deliver)
            };
            assert_eq!(result, Err(RegistryError::Revoked));
            assert!(!delivered, "revoked input must not authorize output bytes");
            let receipt = registry.retirements(&player(), "session").unwrap();
            assert_eq!(receipt.len(), 1);
            assert_eq!(receipt[0].reservation_id, reservation.id());
            assert!(receipt[0].cancellation_requested);
            assert!(!receipt[0].output_revoked && !receipt[0].reaped);
            assert_eq!(
                registry.lock().unwrap().leases[reservation.id()].phase,
                Phase::Retiring
            );
            assert_eq!(
                registry.validate_reservation(&player(), &issued, &reservation),
                Err(RegistryError::Revoked)
            );
            assert_eq!(
                registry
                    .slot_source_refs(&player(), &current, current.backend_slot_revision)
                    .unwrap(),
                None
            );
            assert_eq!(
                publishes(&reservation),
                Err(DecoderError::PublicationDenied)
            );
        }
    }
}

#[test]
fn atomic_revocation_keeps_slot_custody_until_both_retirement_proofs() {
    for first_proof in [
        RetirementProof::WorkerReaped,
        RetirementProof::OutputRevoked,
    ] {
        let (registry, _) = fixture();
        let (reservation, current) = attached(&registry);
        let grant = registry
            .mint(&player(), &request(&registry, &current))
            .unwrap();
        reservation.revoked().store(true, Ordering::Release);
        let receipts = registry.retirements(&player(), "session").unwrap();
        assert_eq!(receipts.len(), 1);
        assert!(receipts[0].cancellation_requested);
        assert!(!receipts[0].output_revoked && !receipts[0].reaped);
        let foreign = Principal {
            subject: "other-owner".into(),
            ..player()
        };
        assert_eq!(
            registry.acknowledge_retirement(&foreign, reservation.id(), first_proof),
            Err(RegistryError::Forbidden)
        );
        assert!(matches!(
            registry.redeem(&player(), &current, &grant.input_grant),
            Err(RegistryError::Busy)
        ));
        let receipt = registry
            .acknowledge_retirement(&player(), reservation.id(), first_proof)
            .unwrap();
        assert_eq!(receipt.reaped, first_proof == RetirementProof::WorkerReaped);
        assert_eq!(
            receipt.output_revoked,
            first_proof == RetirementProof::OutputRevoked
        );
        assert!(registry
            .lock()
            .unwrap()
            .leases
            .contains_key(reservation.id()));
        assert!(matches!(
            registry.redeem(&player(), &current, &grant.input_grant),
            Err(RegistryError::Busy)
        ));
        assert!(registry
            .lock()
            .unwrap()
            .grants
            .contains_key(&grant.input_grant));
        assert_eq!(
            registry.rearm_output(&player(), &current),
            Err(RegistryError::Busy)
        );
        let second_proof = match first_proof {
            RetirementProof::WorkerReaped => RetirementProof::OutputRevoked,
            RetirementProof::OutputRevoked => RetirementProof::WorkerReaped,
        };
        let receipt = registry
            .acknowledge_retirement(&player(), reservation.id(), second_proof)
            .unwrap();
        assert!(receipt.output_revoked && receipt.reaped);
        assert!(!registry
            .lock()
            .unwrap()
            .leases
            .contains_key(reservation.id()));
        assert_eq!(
            registry.with_session_authority(&player(), "session", &mut || panic!(
                "cleanup alone must not rearm an old output generation"
            )),
            Err(RegistryError::Revoked)
        );
        let replacement = registry
            .redeem(&player(), &current, &grant.input_grant)
            .unwrap();
        assert_ne!(replacement.id(), reservation.id());
        assert!(!replacement.revoked().load(Ordering::Acquire));
        assert!(reservation.revoked().load(Ordering::Acquire));
        assert_eq!(publishes(&reservation), Err(DecoderError::Revoked));
        registry.rearm_output(&player(), &current).unwrap();
        registry
            .with_session_authority(&player(), "session", &mut || Ok(()))
            .unwrap();
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

fn selected_refs(source: &str, item: &str) -> Option<SlotSourceRefs> {
    Some(SlotSourceRefs {
        source_ref: source.into(),
        item_ref: item.into(),
    })
}

fn selection_request(
    registry: &Registry,
    context: &Binding,
    source_ref: &str,
    item_ref: &str,
) -> GrantRequest {
    let state = registry.lock().unwrap();
    let item = &state.sources[source_ref].items[item_ref].catalog;
    GrantRequest {
        version: 1,
        context: context.clone(),
        next_native: None,
        source_ref: item.source_ref.clone(),
        item_ref: item.item_ref.clone(),
        item_revision: item.item_revision.clone(),
        identity_version: item.identity_version,
        favorite_sha256: item.favorite_sha256.clone(),
        catalog_revision: state.catalog.clone(),
        remaining_budget_ms: 30_000,
    }
}

#[test]
fn slot_refs_require_redemption_and_follow_exact_attachment_revision() {
    let (registry, _) = fixture();
    let old = binding();
    let read = |context: &Binding| {
        registry.slot_source_refs(&player(), context, context.backend_slot_revision)
    };
    assert_eq!(read(&old).unwrap(), None);
    let grant = registry.mint(&player(), &request(&registry, &old)).unwrap();
    assert_eq!(read(&old).unwrap(), None);
    let reservation = registry
        .redeem(&player(), &old, &grant.input_grant)
        .unwrap();
    assert_eq!(read(&old).unwrap(), selected_refs("saved", "item"));
    let mut next = old.clone();
    next.backend_slot_revision += 1;
    registry
        .prepare_attachment(&player(), &old, &next, &reservation)
        .unwrap();
    assert_eq!(read(&old).unwrap(), selected_refs("saved", "item"));
    assert_eq!(read(&next), Err(RegistryError::Stale));
    assert_eq!(
        registry.slot_source_refs(&player(), &old, next.backend_slot_revision),
        Err(RegistryError::Stale)
    );
    reservation
        .publication_authority()
        .attach(&reservation.decoder_context(), &mut || Ok(()))
        .unwrap();
    assert_eq!(read(&next).unwrap(), selected_refs("saved", "item"));
    assert_eq!(read(&old), Err(RegistryError::Stale));
    assert_eq!(
        registry.slot_source_refs(&player(), &next, old.backend_slot_revision),
        Err(RegistryError::Stale)
    );
}

#[test]
fn slot_refs_fail_closed_for_foreign_or_stale_host_snapshots() {
    let (registry, _) = fixture();
    let (_reservation, current) = attached(&registry);
    for foreign in [
        Principal {
            subject: "other".into(),
            ..player()
        },
        Principal {
            installation_id: "other".into(),
            ..player()
        },
        Principal {
            permissions: BTreeSet::new(),
            ..player()
        },
    ] {
        assert_eq!(
            registry.slot_source_refs(&foreign, &current, current.backend_slot_revision),
            Err(RegistryError::Forbidden)
        );
    }
    for field in 0..7 {
        let mut stale = current.clone();
        match field {
            0 => stale.backend_expected.focus_revision += 1,
            1 => stale.native_expected.source_revision = "other-source".into(),
            2 => stale.native_expected.slot_id = 1,
            3 => stale.native_expected.runtime = "other-runtime".into(),
            4 => stale.backend_expected.scene = "other-scene".into(),
            5 => stale.server_epoch = "other-epoch".into(),
            _ => stale.session_id = "other-session".into(),
        }
        assert!(registry
            .slot_source_refs(&player(), &stale, stale.backend_slot_revision)
            .is_err());
    }
    assert_eq!(
        registry
            .slot_source_refs(&player(), &current, current.backend_slot_revision)
            .unwrap(),
        selected_refs("saved", "item")
    );
}

#[test]
fn slot_refs_clear_on_retirement_atomic_revocation_and_expiry() {
    for cause in [
        "retire",
        "revocation",
        "prepare-expiry",
        "session-expiry",
        "session-revoke",
    ] {
        let (registry, _) = fixture();
        let reservation = reserve(&registry, &binding());
        match cause {
            "retire" => {
                registry
                    .retire_reservation(&player(), &reservation)
                    .unwrap();
            }
            "revocation" => reservation.revoked().store(true, Ordering::Release),
            "prepare-expiry" => {
                registry
                    .lock()
                    .unwrap()
                    .leases
                    .get_mut(reservation.id())
                    .unwrap()
                    .prepare_deadline = Instant::now()
            }
            "session-expiry" => {
                registry
                    .lock()
                    .unwrap()
                    .sessions
                    .get_mut("session")
                    .unwrap()
                    .expires = Instant::now()
            }
            "session-revoke" => {
                registry.revoke_session(&player(), "session").unwrap();
            }
            _ => unreachable!(),
        }
        let result =
            registry.slot_source_refs(&player(), &binding(), binding().backend_slot_revision);
        if cause == "session-expiry" {
            assert_eq!(result, Err(RegistryError::Expired));
        } else if cause == "session-revoke" {
            assert_eq!(result, Err(RegistryError::Revoked));
        } else {
            assert_eq!(result.unwrap(), None, "{cause}");
        }
    }
}

#[test]
fn slot_refs_obey_phase_specific_focus_audio_and_layout_fences() {
    for active in [false, true] {
        let (registry, _) = fixture();
        let (_reservation, old) = if active {
            attached(&registry)
        } else {
            (reserve(&registry, &binding()), binding())
        };
        let mut focused = old.clone();
        focused.backend_expected.focus_revision += 1;
        focused.backend_expected.audio_revision += 1;
        focused.native_expected.expected.focus_revision = "new-focus".into();
        focused.native_expected.expected.audio_revision = "new-audio".into();
        registry.update_binding(&player(), &old, &focused).unwrap();
        assert_eq!(
            registry.slot_source_refs(&player(), &old, old.backend_slot_revision),
            Err(RegistryError::Stale)
        );
        assert_eq!(
            registry
                .slot_source_refs(&player(), &focused, focused.backend_slot_revision)
                .unwrap(),
            selected_refs("saved", "item")
        );
        let mut laid_out = focused.clone();
        laid_out.backend_expected.geometry_revision += 1;
        laid_out.native_expected.expected.layout_revision = "new-layout".into();
        registry
            .update_binding(&player(), &focused, &laid_out)
            .unwrap();
        assert_eq!(
            registry
                .slot_source_refs(&player(), &laid_out, laid_out.backend_slot_revision)
                .unwrap(),
            if active {
                selected_refs("saved", "item")
            } else {
                None
            }
        );
    }
}

#[test]
fn slot_refs_never_resurrect_after_same_source_same_item_reenrollment() {
    let (registry, revision) = fixture();
    let (reservation, context) = attached(&registry);
    assert_eq!(
        registry
            .slot_source_refs(&player(), &context, context.backend_slot_revision)
            .unwrap(),
        selected_refs("saved", "item")
    );
    // Refs, input index and digest are identical, but enrollment revisions are
    // fresh authority. An old lease must not appear to represent the new source.
    let changed = registry
        .enroll(&manager(), enrollment(), Some(&revision))
        .unwrap();
    assert!(reservation.revoked().load(Ordering::Acquire));
    assert_eq!(
        registry
            .slot_source_refs(&player(), &context, context.backend_slot_revision)
            .unwrap(),
        None
    );
    registry
        .remove_source(&manager(), "saved", &changed)
        .unwrap();
    registry.enroll(&manager(), enrollment(), None).unwrap();
    assert_eq!(
        registry
            .slot_source_refs(&player(), &context, context.backend_slot_revision)
            .unwrap(),
        None
    );
}

#[test]
fn slot_refs_replace_same_source_different_item_without_mixing_revisions() {
    let (registry, revision) = fixture();
    let mut source = enrollment();
    let mut second = source.items[0].clone();
    second.item_ref = "item2".into();
    second.favorite_sha256 = "b".repeat(64);
    source.items.push(second);
    registry
        .enroll(&manager(), source, Some(&revision))
        .unwrap();
    let (old_reservation, old) = attached(&registry);
    assert_eq!(
        registry
            .slot_source_refs(&player(), &old, old.backend_slot_revision)
            .unwrap(),
        selected_refs("saved", "item")
    );
    registry
        .retire_reservation(&player(), &old_reservation)
        .unwrap();
    for proof in [
        RetirementProof::OutputRevoked,
        RetirementProof::WorkerReaped,
    ] {
        registry
            .acknowledge_retirement(&player(), old_reservation.id(), proof)
            .unwrap();
    }
    let mut replacement = old.clone();
    replacement.backend_slot_revision += 1;
    replacement.native_expected = changed_source(&old);
    registry
        .update_binding(&player(), &old, &replacement)
        .unwrap();
    let read = |context: &Binding| {
        registry.slot_source_refs(&player(), context, context.backend_slot_revision)
    };
    assert_eq!(read(&replacement).unwrap(), None);
    assert_eq!(read(&old), Err(RegistryError::Stale));
    let grant = registry
        .mint(
            &player(),
            &selection_request(&registry, &replacement, "saved", "item2"),
        )
        .unwrap();
    assert_eq!(read(&replacement).unwrap(), None);
    let new_reservation = registry
        .redeem(&player(), &replacement, &grant.input_grant)
        .unwrap();
    assert_eq!(read(&replacement).unwrap(), selected_refs("saved", "item2"));
    let mut attached = replacement.clone();
    attached.backend_slot_revision += 1;
    registry
        .prepare_attachment(&player(), &replacement, &attached, &new_reservation)
        .unwrap();
    new_reservation
        .publication_authority()
        .attach(&new_reservation.decoder_context(), &mut || Ok(()))
        .unwrap();
    assert_eq!(read(&attached).unwrap(), selected_refs("saved", "item2"));
    assert_eq!(read(&replacement), Err(RegistryError::Stale));
    assert_eq!(
        registry.slot_source_refs(&player(), &attached, old.backend_slot_revision),
        Err(RegistryError::Stale)
    );
}

#[test]
fn slot_refs_remain_isolated_when_another_slot_is_replaced() {
    let (registry, _) = fixture();
    let (_active, first) = attached(&registry);
    let mut second_source = enrollment();
    second_source.source_ref = "second-source".into();
    second_source.items[0].item_ref = "second-item".into();
    registry.enroll(&manager(), second_source, None).unwrap();
    let mut second = first.clone();
    second.native_expected.slot_id = 1;
    second.native_expected.source_revision = "second-source-intent".into();
    second.backend_slot_revision = 0;
    registry.add_slot(&player(), &second).unwrap();
    let grant = registry
        .mint(
            &player(),
            &selection_request(&registry, &second, "second-source", "second-item"),
        )
        .unwrap();
    let reservation = registry
        .redeem(&player(), &second, &grant.input_grant)
        .unwrap();
    assert_eq!(
        registry.slot_source_refs(&player(), &second, 0).unwrap(),
        selected_refs("second-source", "second-item")
    );
    let mut replacement = second.clone();
    replacement.native_expected.source_revision = "third-source-intent".into();
    replacement.backend_slot_revision = 1;
    registry
        .update_binding(&player(), &second, &replacement)
        .unwrap();
    assert!(reservation.revoked().load(Ordering::Acquire));
    assert_eq!(
        registry
            .slot_source_refs(&player(), &replacement, 1)
            .unwrap(),
        None
    );
    // Output is blocked by slot1's retirement, but slot0's current selection is
    // still valid metadata; it must not follow the other slot or global focus.
    assert_eq!(
        registry
            .slot_source_refs(&player(), &first, first.backend_slot_revision)
            .unwrap(),
        selected_refs("saved", "item")
    );
}

#[test]
fn slot_refs_refuse_ambiguous_duplicate_target_leases() {
    let (registry, _) = fixture();
    let reservation = reserve(&registry, &binding());
    let mut state = registry.lock().unwrap();
    let original = &state.leases[reservation.id()];
    let duplicate = Lease {
        owner: original.owner.clone(),
        issue_context: original.issue_context.clone(),
        context: original.context.clone(),
        selection: original.selection.clone(),
        prepare_deadline: original.prepare_deadline,
        phase: Phase::Retiring,
        promotion: None,
        revoked: Arc::new(AtomicBool::new(true)),
        output_revoked: false,
        reaped: false,
    };
    state.leases.insert("ambiguous-target".into(), duplicate);
    drop(state);
    assert_eq!(
        registry
            .slot_source_refs(&player(), &binding(), binding().backend_slot_revision)
            .unwrap(),
        None
    );
}
