# Security design and verification

## Scope and trust boundaries

The project provides the browser/STB player, native wrappers and local media/control companions.

Provider URLs, playlists, XMLTV data, artwork, subtitles and remote commands cross trust boundaries. Credentials can be embedded in URLs and headers; redact diagnostics and exports before sharing. Keep backend authentication independent of browser origin checks, validate redirects, and preserve bounds and cancellation for network parsing. Browser parental controls do not authenticate an operating-system owner.

## Source and operating documentation

- [docs/architecture.md](../docs/architecture.md)
- [docs/diagnostic-security.md](../docs/diagnostic-security.md)
- [docs/playback-session-architecture.md](../docs/playback-session-architecture.md)

## Regression evidence

- [tests](../tests)

Run the documented commands in [CONTRIBUTING.md](../CONTRIBUTING.md) and the
[CI workflow](../.github/workflows/ci.yml). Preserve negative tests for rejected inputs,
unavailable dependencies, authorization failures and cancellation. A passing
test run describes its fixtures and environment; it does not certify every
upstream service, hardware model or production deployment.

## Static-analysis scope

The [CodeQL workflow](../.github/workflows/codeql.yml) analyzes JavaScript/TypeScript,
Python tooling, GitHub Actions and Rust source. Swift extraction uses the actual
unsigned iOS App build on macOS. A successful run covers the extracted code and
enabled queries; it does not establish that every vulnerability is absent.

The archived [Android source](../android/README.md) has no application build in
this repository and is not claimed as Kotlin CodeQL coverage. The maintained
Android application and shared Kotlin core have separate analyses in
[ottplay-android](https://github.com/open-ott-play/ottplay-android) and
[ottplay-core](https://github.com/open-ott-play/ottplay-core). The Objective-C drag
regression fixture is exercised by its native test; CodeQL does not support that
language. The existing [CodeQL configuration](../.github/codeql/codeql-config.yml)
excludes third-party provider scripts, so provider behavior still needs its own
review and integration tests.

## Remaining security assessment

Complete language-by-language cryptography and dynamic memory-safety review, assess tracked vendor binaries with provenance, and verify release notes/security history before asserting full Passing.

Report new issues through [SECURITY.md](../SECURITY.md). An OpenSSF assessment
records evidence and applicability; it is not a guarantee that a system is safe.
