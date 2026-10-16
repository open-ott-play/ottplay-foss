# OpenSSF Passing evidence

This is a source-backed work record for the [OpenSSF Best Practices Passing
criteria](https://www.bestpractices.dev/en/criteria/0). It does not assert that a
badge has been awarded. The partial [machine-readable assessment](../.bestpractices.json)
leaves unverified criteria unknown.

## Available evidence

- Purpose, installation and operating limitations: [README](../README.md).
- Public Git source, commit history and change proposals: [open-ott-play/ottplay-foss](https://github.com/open-ott-play/ottplay-foss).
- Bug reports and retained discussion: [issues](https://github.com/open-ott-play/ottplay-foss/issues).
- Contribution requirements, test policy and test invocation: [CONTRIBUTING](../CONTRIBUTING.md).
- Private reporting process and response policy: [SECURITY](../SECURITY.md).
- Trust boundaries, source references and negative-test evidence: [security design](security-design.md).
- Build/test automation: [workflow](../.github/workflows/ci.yml) and [actual run results](https://github.com/open-ott-play/ottplay-foss/actions).
- Project license: [MIT](../LICENSE); third-party terms still apply.

## Initial scanner inventory — 2026-10-08

The authenticated GitHub inventory found 15 open code-scanning alerts
(including Scorecard policy findings) and 0 open Dependabot alerts.
This is a dated baseline, not a statement about the post-merge state. A scanner
configuration error or disabled scanner must not be recorded as zero findings.
Check [Code scanning](https://github.com/open-ott-play/ottplay-foss/security/code-scanning) and
[Dependabot](https://github.com/open-ott-play/ottplay-foss/security/dependabot) after the changed default branch is
analyzed.

## Unresolved criteria and applicability

Complete language-by-language cryptography and dynamic memory-safety review, assess tracked vendor binaries with provenance, and verify release notes/security history before asserting full Passing.

On 2026-10-16 the maintainer explicitly confirmed knowledge of secure-design
principles and common implementation/network vulnerabilities, and confirmed
that no bug, enhancement or vulnerability reports arrived outside GitHub during
the preceding 12 months. The same date's GitHub inventory found no non-PR issues,
private vulnerability reporting enabled, 13 open Scorecard findings and zero
open Dependabot alerts. The latter is not a complete dependency audit or a
claim that all 13 findings are resolved.

[Governance](../GOVERNANCE.md), [conduct](../CODE_OF_CONDUCT.md) and the
[roadmap](../ROADMAP.md) identify responsibility and reporting channels. There
is no designated backup or tested recovery mechanism within a week; continuity
and bus-factor criteria remain unmet.

The reviewed browser qualification PR 782 still has a failing Linux WebKit
scenario, while its other platform checks and review have passed. Neither that
partial result nor a successful RC fuzz campaign establishes complete release
acceptance. Existing platform/release fixes remain separate from this evidence
update. Full outbound/native/platform cryptography, third-party provider scope,
source coverage and dependency closure remain to be demonstrated.

Record each completed analysis with its source SHA, commands/tool versions,
result and material limitations. Add the repository's actual badge only after
its own public assessment is saved and verified.
