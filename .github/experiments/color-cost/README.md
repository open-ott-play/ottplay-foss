# Hosted client color cost comparison

This is a prepared experiment, not a release workflow. It compares the same
pinned FOSS source with and without the complete, reviewed client color feature.
The baseline is `14ea5da80b20a8311bb55cee250f794ae278d310`. Do not substitute a
moving branch, a separately built baseline or an incomplete feature patch.

**The feature is bound; Main GO, publication and dispatch are still pending.**
The frozen 124-file `feature.patch` has SHA256
`693be0fe7ef5c8abd95703ae152c2c5a9927e02691e30e8c20fc134c2a4fb1ed`.
`source-manifest.json` retains Main's upstream source binding; `manifest.json`
uses the harness format with `status: "bound"`, the patch and upstream manifest
hashes, every touched file's before/after identity (including explicit absence
for added/deleted files), and the exact control helpers. Final control review
may regenerate the harness manifest hash; use that final hash for dispatch.

The validator still rejects missing, `unbound`, incomplete or mismatched input
before dependency installation or builds. Binding the packet is not approval
to publish or run it, and no measurement result exists yet.

## Ownership and preparation

Owner7 alone publishes the reviewed experiment files after Main GO. Owner9 alone
dispatches the hosted run after that approval and resource coordination. This
packet does not publish, dispatch, install or change a shared checkout.

The workflow checks out the control commit separately from the pinned source.
The publisher places these files together under
`.github/experiments/color-cost/` in the control revision:

- `compare.py`
- `manifest.json`
- `source-manifest.json`
- the final `feature.patch`
- `collect-assets.cjs`

The publication patch temporarily replaces the **existing**
`.github/workflows/webos-native.yml` only on
`diagnostic/client-color-cost-20261106`, based on the pinned commit above. This
retains the already registered workflow ID **402191938** (`Native webOS
candidate`, verified active through the GitHub API). Do not create a new
`color-cost-comparison.yml` workflow: this experiment must be dispatchable on
the temporary branch without first merging a new workflow into the default
branch. The comparison job also requires the exact diagnostic branch ref.

**Never merge the control branch, its workflow replacement or its experiment
files into main or the color-feature PR. Do not create a workflow PR merely to
run this measurement.** The ordinary native workflow remains intact there.
Owner7 publishes only this isolated diagnostic branch after Main GO; Owner9
dispatches its existing workflow ID once, using that branch. Retain the branch
and run evidence until reviewed, then retire the temporary branch through the
coordinator. The final product changes follow their separate feature PR.

The exact workflow preimage is the blob
`62d353fe31f57d67dbb42114eb0fa83aac5376b4` at the pinned base, SHA256
`937d912dfef07a65ee09c9a21577afac976bc660a6775fb4d1dcb716341c5e88`
(46,686 bytes). `workflow-preimage.json` and `webos-native.preimage.yml` retain
the identity and original bytes in this review packet. Owner7 must check that
preimage before applying `publication.patch`; do not force the replacement
onto a different workflow revision. The patch adds seven control files and
modifies this one existing workflow. `publication-map.json` binds each output
and records the workflow's required preimage.

Bind the complete color implementation, schema, codec, remote descriptor,
stylesheet and locale changes intended to ship. Record intentionally unchanged
inputs as such. Update the manifest whenever a bound feature or helper changes,
then review the new control commit.

Owner9 supplies the reviewed manifest file's SHA256 as the required dispatch
input `manifest_sha256`. It must be exactly 64 lowercase hexadecimal characters.
The workflow passes it through the `COLOR_COST_MANIFEST_SHA256` environment
variable, never as shell source. Before any build, the harness requires both
`status: "bound"` and equality with the actual `manifest.json` SHA256. Changing
the manifest requires a newly reviewed hash; the workflow itself does not need
editing for each candidate.

After Main GO and verification of Owner7's published control commit, Owner9 uses
workflow ID `402191938` with `--ref diagnostic/client-color-cost-20261106` and the
reviewed `manifest_sha256` input. Do not dispatch by a new workflow filename or
against `main`, the feature branch, or an unverified control commit. The job's
branch guard is an additional check, not permission to publish or dispatch.

## Execution contract

Only GitHub-hosted execution is permitted. The workflow uses one
`ubuntu-26.04` job, a 30-minute job limit, a 25-minute measurement-step limit,
Node `22.23.4`, full-SHA actions, read-only repository permissions and checkouts
without persisted credentials. It supplies no device/account secrets and does
not dump the environment. The harness uses a 23-minute total budget and
11-minute arm budgets inside the measurement-step limit, leaving time for
cleanup and evidence upload.

The workflow calls:

```sh
python3 control/.github/experiments/color-cost/compare.py "$GITHUB_WORKSPACE/source" "$RUNNER_TEMP/ott-color-cost"
```

This is the hosted invocation, **not a command to run on the local Mac**. The
harness validates its adjacent manifest and controls before measuring. Both arms
must retain the same source commit, lockfile and toolchain. Arm A is the baseline;
Arm B adds only the bound feature. Preserve each arm's actual dirty status,
source diff, build identity and any intentional inert measurement marker so a
clean-vs-dirty identity change cannot masquerade as feature cost. Reject unrelated
changes, a release plan or injected release configuration. Do not force a clean
identity, rewrite build IDs or relax size limits to make the pair pass.

## Evidence and interpretation

Keep original command exit codes, timeout/cleanup results, raw stdout/stderr,
source/hash evidence and available size/build reports for **both** arms. A failed
build or size gate remains a failure even when usable diagnostics exist; never
replace that outcome with a successful collector exit. Missing outputs make the
affected measurement unavailable, not zero. An invalid or uncleanly stopped arm
must not be treated as a comparable result.

The workflow creates a small, whitelisted run-context record before checkout,
captures harness stdout/stderr without masking its exit code, and attempts an
`always()` upload of `evidence/` with seven-day retention. Do not upload credentials,
private configuration or all of `$RUNNER_TEMP`. A forced runner/job termination
can still prevent upload; the internal deadlines should avoid exhausting the
outer job budget.

Report JavaScript bundle cost separately from CSS and locale asset cost. Retain
the collector's per-asset paths, hashes and measured sizes for both arms; only
compare like-for-like outputs and compression modes. A stylesheet or translated
string can increase shipped/downloaded bytes without appearing in the main JS
bundle. Likewise, optional/provider assets must not be silently folded into, or
omitted from, an initial-load claim. Show unavailable asset classes explicitly
and preserve unchanged-asset hashes rather than assuming a zero delta.

The collector discovers every immediate root JavaScript file dynamically. The
bound manifest separately asserts **78 baseline and 81 candidate root JS
files in total across the three output families**, including the new
`color-appearance.js` in each family. These are completeness assertions, not
collector limits or measured byte results. CSS is collected separately from
each family's final output tree; the exact 88 locale files per family are also
measured separately and do not count as root JS. Per-family/category totals
sum individual files; their gzip totals sum separately compressed files, not
a concatenated payload or one client's initial network transfer.

## Preparation evidence

The retained control log records nine tiny control tests passed. The collector
notes record eight synthetic regression groups passed. Source binding checked
all 124 patch paths and before/after hashes in a disposable fixture, which was
removed. These checks validate preparation only. No actual hosted paired build
or process-cleanup probe has run, and there are no measured feature-cost results
or release conclusions to report yet.

Once executed successfully, the paired measurement can establish source-bound
output cost under the recorded build conditions. It does not prove visual correctness, frame rate,
memory use, startup latency, device compatibility, a passing production size
gate or release qualification. Ordinary CI and the owning feature's acceptance
remain separate.
