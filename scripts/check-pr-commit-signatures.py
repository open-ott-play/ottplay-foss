#!/usr/bin/env python3
"""Fail a pull request before merge when any of its commits is not signed.

The main-branch ruleset rejects commits without a verified signature, but GitHub
only reports that as a blocked pull request, after the whole CI gate already
passed. Verifying the reviewed commits up front turns a late BLOCKED into a
named failure, and the GitHub API reports the same
``commit.verification.verified`` value the ruleset enforces.

Pull request mode reads the commits through the API, so no checkout is needed and
the result does not depend on the runner's key material. A local checkout can use
``--base``/``--head`` instead: it rejects missing and broken signatures, and it
still accepts a signature this checkout cannot verify because the signer key or
``gpg.ssh.allowedSignersFile`` is absent. Those commits are reported as
unverifiable locally and left to the API/ruleset proof.

The gate also runs for the merge queue, where the event carries no pull request
number. GitHub only queues pull requests whose commits already satisfy the
signature rule, so that entry reports the fact and passes instead of failing on
the missing number. Release validation calls the same gate from ``schedule`` and
``workflow_dispatch`` for its nightly and rc/stable profiles, where the main
ruleset already verified the validated ref and there is no pull request to list;
those entries report the fact and pass as well. Every other event without a pull
request still fails loudly.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

TIMEOUT_SECONDS = 20
PAGE_SIZE = 100

# Events the gate is called for with no pull request commit list. The merge queue
# merges a head GitHub already qualified, and release validation runs the nightly,
# rc and stable profiles from the default branch, which the main ruleset already
# guarded. Each entry explains why nothing is listed here.
NOT_APPLICABLE_EVENTS = {
    "merge_group": (
        "Merge queue: commit signatures were verified when the pull "
        "request ran; the queue merges that reviewed head. Nothing to "
        "list here."
    ),
    "schedule": (
        "Scheduled release validation has no pull request commit list; the "
        "main ruleset verified every commit of the validated ref. Nothing "
        "to list here."
    ),
    "workflow_dispatch": (
        "Dispatched release validation has no pull request commit list; the "
        "main ruleset verified every commit of the validated ref. Nothing "
        "to list here."
    ),
}


def _request(url: str, token: str) -> urllib.request.Request:
    return urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + token,
            "User-Agent": "ottplay-commit-signature-check",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )


def _read_json(request: urllib.request.Request, fetch=None):
    """Fetch one JSON page through an injectable opener for deterministic tests."""
    opener = fetch or urllib.request.urlopen
    with opener(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def pull_request_commits(repo: str, number: int, token: str, fetch=None):
    """Return every commit the pull request would merge, oldest page first."""
    commits = []
    page = 1
    while True:
        url = (
            "https://api.github.com/repos/"
            + repo
            + "/pulls/"
            + str(number)
            + "/commits?per_page="
            + str(PAGE_SIZE)
            + "&page="
            + str(page)
        )
        rows = _read_json(_request(url, token), fetch=fetch)
        if not isinstance(rows, list):
            raise RuntimeError("Pull request commit listing did not return a list")
        commits.extend(rows)
        if len(rows) < PAGE_SIZE:
            return commits
        page += 1


def subject(row) -> str:
    """First line of the commit message, without trailing whitespace."""
    message = str(((row.get("commit") or {}).get("message") or "")).splitlines()
    return message[0].strip() if message else ""


def signature_failures(rows):
    """Keep only commits whose signature the ruleset would refuse."""
    failures = []
    for row in rows:
        verification = (row.get("commit") or {}).get("verification") or {}
        if verification.get("verified") is True:
            continue
        failures.append(
            {
                "sha": str(row.get("sha") or ""),
                "reason": str(verification.get("reason") or "unsigned"),
                "subject": subject(row),
            }
        )
    return failures


def _git(root, *arguments) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *arguments],
        cwd=str(root),
        text=True,
        capture_output=True,
        check=False,
    )


def _has_signature(root, sha: str) -> bool:
    """A raw commit object carries a gpgsig header for GPG and SSH signatures."""
    raw = _git(root, "cat-file", "commit", sha)
    if raw.returncode != 0:
        return False
    return any(line.startswith("gpgsig") for line in raw.stdout.splitlines())


def git_signature_states(root, base: str, head: str):
    """Split ``base..head`` into refused commits and locally unverifiable ones.

    ``git show --format=%G?`` reports ``N`` for an unsigned commit but also for a
    signature whose key or ``gpg.ssh.allowedSignersFile`` is not configured on
    this checkout. Only a missing signature or a broken one is refused; the rest
    stays a note, because CI and the ruleset hold the authoritative proof.
    """
    listing = _git(root, "rev-list", "--reverse", base + ".." + head)
    if listing.returncode != 0:
        raise RuntimeError(listing.stderr.strip() or "Cannot list commits")
    failures = []
    unverifiable = []
    for sha in listing.stdout.split():
        state = _git(root, "show", "-s", "--format=%G?", sha).stdout.strip()
        if state == "G":
            continue
        message = _git(root, "show", "-s", "--format=%s", sha).stdout.strip()
        entry = {"sha": sha, "reason": state or "unsigned", "subject": message}
        if state == "B" or not _has_signature(root, sha):
            failures.append(entry)
        else:
            unverifiable.append(entry)
    return failures, unverifiable


def git_signature_failures(root, base: str, head: str):
    """Refused commits only, for callers that do not render the local note."""
    return git_signature_states(root, base, head)[0]


def _print_entries(title: str, entries) -> None:
    print(title)
    for entry in entries:
        print(
            "  "
            + entry["sha"][:12]
            + "  "
            + entry["reason"]
            + "  "
            + entry["subject"]
        )


def report(failures, unverifiable=(), base: str = "origin/main") -> int:
    if unverifiable:
        _print_entries(
            "Signed commits this checkout cannot verify without the signer key:", unverifiable
        )
        print(
            "Add the signer key to gpg.ssh.allowedSignersFile (or import the GPG "
            "public key) to verify them locally; the pull request check verifies "
            "them against GitHub's own record."
        )
    if not failures:
        print("Every reviewed commit has a verified or locally unverifiable signature")
        return 0
    _print_entries("Commits without a verified signature:", failures)
    print("")
    print(
        "The main ruleset refuses unsigned commits, so this pull request would "
        "merge as BLOCKED after the whole gate passed."
    )
    print("Re-sign the branch before pushing:")
    print('  git rebase --exec "git commit --amend --no-edit -S" ' + base)
    print("  git push --force-with-lease")
    return 1


def pull_request_number(arguments) -> int | None:
    # The gate passes github.event.pull_request.number whatever the event is, and
    # a merge queue entry has none, so an empty value must not reach int().
    explicit = str(arguments.pull_request or "").strip()
    if explicit:
        if not explicit.isdigit():
            raise ValueError("Expected a numeric pull request number, got: " + explicit)
        return int(explicit)
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path:
        return None
    try:
        event = json.loads(Path(event_path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    number = (event.get("pull_request") or {}).get("number")
    return int(number) if number else None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    parser.add_argument("--pull-request", default=None)
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--root", default=".")
    arguments = parser.parse_args(argv)

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    try:
        number = pull_request_number(arguments)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    event_name = os.environ.get("GITHUB_EVENT_NAME")
    if number is None and event_name:
        if event_name in NOT_APPLICABLE_EVENTS:
            # GitHub only queues pull requests whose commits already satisfy the
            # signature rule, and the release pipeline validates commits the main
            # ruleset already guarded. Neither event carries a pull request commit
            # list, so both pass with an explicit message instead of failing on
            # the missing number.
            print(NOT_APPLICABLE_EVENTS[event_name])
            return 0
        print(
            "No pull request in this " + event_name + " event; nothing to list.",
            file=sys.stderr,
        )
        return 2
    if number is not None:
        if not arguments.repo or not token:
            print(
                "Pull request mode needs --repo and GITHUB_TOKEN or GH_TOKEN; "
                "use --base/--head with a checkout instead",
                file=sys.stderr,
            )
            return 2
        try:
            rows = pull_request_commits(arguments.repo, number, token)
        except urllib.error.URLError as error:
            print("Cannot read pull request commits: " + str(error), file=sys.stderr)
            return 2
        return report(signature_failures(rows), base=arguments.base)

    try:
        failures, unverifiable = git_signature_states(
            arguments.root, arguments.base, arguments.head
        )
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 2
    return report(failures, unverifiable, arguments.base)


if __name__ == "__main__":
    sys.exit(main())
