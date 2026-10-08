# Optional webOS CLI bootstrap

The simulator helper downloads the official `@webos-tools/cli` 3.2.6 archive
from the npm registry only when an existing CLI cannot be found. Before npm can
read it, the helper checks the exact archive size (5,901,117 bytes) and SHA-512
recorded in `scripts/setup-webos-simulator.sh`. HTTPS redirects cannot downgrade
to HTTP. Corrupt, truncated, oversized or interrupted downloads are removed.
Installation uses a temporary directory and `--ignore-scripts`; the upstream
postinstall would otherwise make package-local configuration files mode 0666.
The existing working CLI is reused, and an incomplete destination is not erased.

The archive contains an upstream npm shrinkwrap. Its transitive dependency
versions and integrity hashes remain upstream-controlled. Verifying an archive
establishes which bytes were installed; it does not repair vulnerabilities in
those bytes. On 2026-10-08 the latest published CLI was still 3.2.6. Its isolated
`npm audit` reported ten affected package entries (including indirect entries):
one critical, seven high and two moderate. Notable unresolved upstream issues
include:

- [proxy-addr IP spoofing](https://github.com/advisories/GHSA-jqcg-44mw-7w3h),
  fixed upstream in 2.0.8 but still pinned to 2.0.7 by the CLI shrinkwrap.
- [braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
  with no patched published version at the time of the audit.
- [sprintf-js unbounded precision](https://github.com/advisories/GHSA-hp3w-g68c-fv3c),
  with no patched published version at the time of the audit.

Ordinary `npm audit fix` did not update the shrinkwrapped tree. The project does
not suppress these findings or claim that every CLI feature is safe. This
optional tool runs locally for simulator/device development and is not bundled
with the player. Use trusted local project directories and avoid exposing CLI
servers to untrusted networks. Full reachability across the upstream CLI is not
established by the player tests.

When adopting a fixed upstream CLI, review its release and shrinkwrap, replace
the archive version/size/SHA-512 together, rerun the integrity and simulator
launcher tests, then test `ares-launch --version` and `--help` in an isolated
home directory. Recheck the upstream advisories and this document. Do not remove
archive verification or enable lifecycle scripts to work around a failed check.
