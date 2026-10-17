# Parental PIN storage and migration

New or changed four-digit PINs are stored as one versioned
`pbkdf2-sha256$600000$<salt>$<digest>` record in the existing `parentPIN` setting.
The salt contains 128 random bits from the platform CSPRNG and the derived value
is 256 bits. PBKDF2-HMAC-SHA256 uses 600,000 iterations. The four-digit interface
is unchanged; its small search space means this is a local parental-control
barrier, not protection against an administrator or an attacker controlling the
player code, files or device. Keep device accounts and backups private.

Web Crypto performs ordinary derivation. The ES5 fallback uses the pinned SJCL
1.0.9 SHA256/HMAC primitives, scheduling the same single-block PBKDF2 loop in
bounded chunks so input events can continue. The chunk scheduler and PBKDF2 loop
are project-maintained adaptations, not an unchanged asynchronous SJCL API;
matching test vectors do not replace independent cryptographic review. Only one asynchronous derivation
runs at a time. Neither implementation uses `Math.random`, clock values or the
SJCL pseudorandom generator for salts. New PIN creation fails if the platform
has no working `crypto.getRandomValues` or `msCrypto.getRandomValues`.

Existing readable four-digit values remain a read-only compatibility format.
After a successful legacy unlock the player attempts a background upgrade using
the settings store's source-bound write and read-back checks. This upgrade can
preserve an existing authorization; it cannot grant new access after cancellation,
source/PIN/policy changes, a new challenge, page hiding or a failed write. A failed
upgrade can leave the old plaintext value on disk until a later successful unlock
or settings save. This limitation must not be represented as completed migration.

Settings saves and old JSON/XML/local-backup imports convert plaintext values
before writing. A transaction that changes a legacy PIN also prepares a protected
rollback value before its first write, so later failure cannot write plaintext
back to storage. Exports convert legacy PINs and preserve existing versioned
records exactly. The existing synchronous backup APIs use the same full work
factor synchronously for a legacy value: conversion pauses the interface until
derivation completes and can take substantially longer on an older TV. Preparing
legacy rollback bytes currently has the same synchronous cost, including during
a background upgrade. Cancel
before confirmation to avoid changing settings. Invalid records and
unreadable PIN storage lock protection instead of silently selecting `1234`.
Recovery requires restoring a valid private backup or explicitly resetting the
installation; the player does not guess or recover a damaged PIN.

Close other player tabs before upgrading. Do not run an older version against
upgraded settings: older versions do not understand these records and some
restore their historical default `1234` when parsing fails. The new release
cannot correct already-running or downgraded code. Backups containing the new
record likewise require this version or later.

The native and fallback tests compare results with Node's independent PBKDF2
and unchanged SJCL PBKDF2, exercise wrong PINs, malformed/high-work records,
missing randomness, cancellation and real settings-store write failures. Local
Apple-silicon Node measurements are host evidence, not TV/device acceptance:
a sample creation took about 53 ms with Web Crypto and 1.6 s with the chunked
fallback. Target-device performance remains to be measured. No physical device
was modified by these tests.

Local backup restore verifies the protected PIN before replacing other keys and
never clears that credential between writes. A rejected PIN write aborts the
restore; a later ordinary-setting failure retains the protected PIN. This is not
a cross-key transaction guarantee for every preference.
