# Settings ownership and editor lifecycle

`src/settings/store.ts` owns the current preferences. The schema in
`src/settings/index.ts` defines stable IDs, existing storage keys, application
or provider scope, validation, defaults and post-commit effects. `settings`
and the retained `window.s*` properties are ES5 accessors into that one store;
there is no apply/pull copy. Array reads return detached values. The legacy
`sNextCount` offset is a storage codec; `nextCount` is a derived view.

Each row editor binds a `settingId` to a private draft. Filtering, translating
or reordering rows does not change the saved key. Save validates and commits
the draft, then runs each declared effect once. Cancel has no storage or
runtime effects. Nested colour and PIN editors retain the enclosing draft.
The screen ownership port, when present, disposes the draft with its list.
Callbacks also check draft, source and row ownership before committing.
Command URL and command-server value dialogs use the same draft lifecycle;
the existing network controllers keep their explicit consent transitions.

Provider changes and reloads retire open drafts. A fresh draft hydrates the
current provider scope if catalog loading has not yet done so. Provider storage
ports capture the active driver's absolute key, including M3U playlist slots.
Application preferences survive provider-only hydration. A concurrent change
to a field being edited rejects that commit; unrelated changes are preserved.

Commit captures old values, verifies every write by reading it back, and only
then publishes the new runtime values. On failure it attempts to restore the
captured keys and reports failure without publishing effects. Legacy storage
does not provide transactions: rollback can itself fail, and persistence may
then be partially written until a subsequent reload. The implementation does
not claim stronger atomicity than the backing storage supplies.

Existing backup keys, version-1 aliases, provider scoping and installation-only
credential exclusions remain at the compatibility boundary. Import reports
failure if settings cannot be persisted. Existing raw cloud/backup payloads
continue through their retained storage codecs and subsequent hydration.
Attribution and historical source fixtures remain unchanged.

Verification covers draft cancellation, malformed values, storage rejection,
scope changes, M3U slots, row reorder/filtering, colour and PIN callbacks,
timezone behavior, old backups and the existing settings UI parity suite.
The Full and Play player artifacts retain ES5 syntax and are exercised by the
bundle boot/device fixtures. These fixtures are not physical-device testing.
