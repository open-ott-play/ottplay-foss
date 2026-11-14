# Dependency media follow-up

The root npm update branch can receive one generated follow-up commit in the
same pull request. This does not enable repository scripts in the privileged
Renovate runner. Existing review, media audit and product CI remain mandatory;
the automation neither approves nor merges a pull request.

An independent, tokenless generation job in the existing Auto Approve PRs
maintenance workflow admits only the designated bot's same-repository
`renovate/npm-lockfile` branch when it includes current main and changes only
`package.json` and `package-lock.json`. Package scripts and other non-dependency
metadata must be unchanged. The installed package tarballs must be registry.npmjs.org
HTTPS URLs with locked SHA-512 integrity. A modified workflow, generator, other
source file, renamed input or unreviewed repository is not eligible.
The existing approval job and its credentials are unchanged and run in a
different VM. The generation job has only read permissions, receives no approval
secrets and runs only for `pull_request`, never `pull_request_target`.

Only trusted coordinator code from the base runs on the host. A digest-pinned
Node container installs with `npm ci --ignore-scripts`, using its own bounded
tmpfs and no host cache, home directory, Docker socket, secrets or credentials.
The container runs as an unprivileged user with a read-only root, dropped
capabilities, no-new-privileges and explicit memory/process/CPU limits. Its network
is disconnected and checked before running the media generator and audit. Source
files are a dedicated read-only mount. Three direct `/bin/tar` calls inside the
offline container export the exact 13 output files and their directory ancestors
with individual and aggregate byte limits. The streams remain untrusted: this
does not claim a quiescent filesystem, and a failed TAR operation fails the job.
The owned container is reconciled and removed before any captured stream is
parsed, validated or returned, including after a lost creation acknowledgement.
Only private bytes already held by the parent remain. Links, extra files and
nonregular entries fail validation. No archive is extracted onto the host.

The trusted `workflow_run` publisher never checks out or executes the PR. It
rechecks the exact maintenance workflow, completed run and attempt, current
source/base/tree, raw lock hash and trusted coordinator revision. Only one artifact
with the exact media name qualifies; unrelated approval receipts are not inputs.
The exact named generation job must have succeeded in that server-reported run
attempt with matching source identity. A failed approval job does not imply a
generation failure or full CI success; an operator-cancelled run is a stale no-op. It
downloads the bounded raw ZIP, checks the service digest and validates every ZIP
entry before reading file contents. No archive is extracted. Signed object-store
redirects receive no GitHub Authorization header. The publisher reconstructs the
media input manifest, verifies every output digest and requires each HTML file to
change only its one runtime bootstrap version. It independently derives documented
native/media notice version spans from the locked dependency changes; historical
Shaka and retained artwork references stay unchanged. An update that needs a new
version-specific license file, such as Capacitor App, fails for manual review.

Only the final trusted step receives `BOT_PAT`. It qualifies the designated bot
and creates one ordinary commit with GitHub's `createCommitOnBranch` API and an
exact `expectedHeadOid`. GitHub signs supported commits; the publisher checks the
returned parent, complete resulting file tree and verified signature. It records
an exclusive intent before the request and retains the acknowledgement. An
ambiguous API result fails for reconciliation and is never blindly retried.
No force push, branch deletion, approval or merge occurs. A normal branch/main
advance before publication is a recorded stale no-op; already-current outputs
also produce no commit. The generated follow-up is outside the dependency-only
profile, so it cannot create a publication loop.

The test module uses the existing hash-locked workflow-test dependencies and is
discovered by the required `.github/workflow-tests` suite. A workflow-call-only
sandbox validator is called unconditionally by the existing required Windows
validation workflow. Inside that validator, ordinary non-Renovate PR changes to
the coordinator, related workflows or its tests run one real isolated
generation/exec-tar/cleanup exercise on hosted Ubuntu, without publisher
credentials. The PR merge diff selects those changes; diff errors fail rather
than silently skip. The pure tests cover admission, ZIP/TAR hostility, source
and artifact identity, notice preservation, cleanup after a lost creation ACK,
no-op handling and one-commit CAS. Pure mock results do not qualify the actual
Docker/npm path. That hosted job must pass before adopting the automation; native
builds, application behavior, upstream license changes and dependency safety still
need their existing checks and review.

GitHub documents the privilege boundary of
[`workflow_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
and the signed, expected-head commit API in
[`createCommitOnBranch`](https://docs.github.com/en/graphql/reference/commits#createcommitonbranch).
