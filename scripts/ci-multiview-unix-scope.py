#!/usr/bin/env python3
"""Select isolated Unix fixtures; only a complete unrelated diff may skip.

Event/range handling follows the repository's scripts/change_scope.py. This
separate selector narrows the expensive native fixture scope, not the existing
Windows validation policy. Git reads are bounded and never fetch missing data.
"""

import argparse
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import time


REVISION = re.compile(r"[0-9a-f]{40}\Z")
ZERO = "0" * 40
MAX_DIFF_BYTES = 8 * 1024 * 1024
MAX_STDERR_BYTES = 64 * 1024
GIT_TIMEOUT_SECONDS = 30
PREFIXES = (
    "src-rs/core/",
    "src-rs/server/",
    ".cargo/",
    "vendor/",
    "scripts/ci-multiview-unix",
    "tests/test_multiview_unix",
    "tests/test_ci_multiview_unix",
    ".github/workflow-tests/test_multiview",
)
EXACT = frozenset({
    "Cargo.toml", "Cargo.lock", "rust-toolchain", "rust-toolchain.toml",
    ".release-policy.json",
    ".github/workflows/windows-validation.yml",
    ".github/workflows/quality-gate.yml",
    ".github/workflows/native-parity.yml",
    ".github/workflows/ci.yml",
    "scripts/ci-native-favorites.py",
    "scripts/ci-apt-mirror.py",
})


class GitReadError(Exception):
    """An incomplete Git read can request execution, never authorize skipping."""


def decision(run, reason):
    return {"run": run, "reason": reason}


def relevant(path):
    return path in EXACT or path.startswith(PREFIXES)


def literal_path(path):
    return (
        bool(path) and not path.startswith("/") and "\\" not in path
        and all(part not in {"", ".", ".."} for part in path.split("/"))
        and not any(ord(char) < 32 or ord(char) == 127 for char in path)
    )


def classify_diff(raw):
    """Validate the full NUL-delimited raw diff, including deleted paths."""
    if not raw:
        return decision(True, "empty-diff")
    if not isinstance(raw, bytes) or len(raw) > MAX_DIFF_BYTES or not raw.endswith(b"\0"):
        return decision(True, "invalid-diff")
    records = raw[:-1].split(b"\0")
    if len(records) % 2:
        return decision(True, "invalid-diff")
    seen = set()
    related = False
    for index in range(0, len(records), 2):
        try:
            fields = records[index].decode("ascii").split()
            path = records[index + 1].decode("utf-8")
        except UnicodeError:
            return decision(True, "invalid-diff")
        if len(fields) != 5 or not fields[0].startswith(":"):
            return decision(True, "invalid-diff")
        before, after, old, new, status = fields
        before = before[1:]
        if not all(REVISION.fullmatch(value) for value in (old, new)):
            return decision(True, "invalid-diff")
        regular = {"100644", "100755"}
        valid = (
            (status == "A" and before == "000000" and after in regular
             and old == ZERO and new != ZERO)
            or (status == "D" and before in regular and after == "000000"
                and old != ZERO and new == ZERO)
            or (status == "M" and before == after and before in regular
                and old != ZERO and new != ZERO)
        )
        if not valid:
            return decision(True, "non-regular-or-ambiguous-diff")
        if not literal_path(path) or path in seen:
            return decision(True, "invalid-path")
        seen.add(path)
        related = related or relevant(path)
    return decision(related, "related-path-change" if related else "complete-unrelated-diff")


def event_revisions(kind, event):
    if not isinstance(event, dict):
        raise ValueError("Expected an event object")
    if kind == "pull_request":
        pull = event["pull_request"]
        base, head, separator = pull["base"]["sha"], pull["head"]["sha"], "..."
    elif kind == "merge_group":
        group = event["merge_group"]
        base, head, separator = group["base_sha"], group["head_sha"], ".."
    else:
        base, head, separator = event["before"], event["after"], ".."
    if any(not isinstance(sha, str) or not REVISION.fullmatch(sha) or sha == ZERO
           for sha in (base, head)):
        raise ValueError("Expected nonzero full commit SHAs")
    return base, head, separator


def bounded_git(repo, arguments):
    """Read Git with finite time/output, without a shell or lazy network fetch."""
    environment = dict(os.environ, GIT_OPTIONAL_LOCKS="0", GIT_NO_REPLACE_OBJECTS="1",
                       GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0")
    process = None
    selector = selectors.DefaultSelector()
    buffers = {"stdout": bytearray(), "stderr": bytearray()}
    try:
        process = subprocess.Popen(
            ["git", "--no-pager", *arguments], cwd=repo, env=environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        selector.register(process.stdout, selectors.EVENT_READ, "stdout")
        selector.register(process.stderr, selectors.EVENT_READ, "stderr")
        deadline = time.monotonic() + GIT_TIMEOUT_SECONDS
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise GitReadError("Git read timed out")
            for key, _ in selector.select(min(remaining, 0.2)):
                chunk = os.read(key.fileobj.fileno(), 64 * 1024)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                limit = MAX_DIFF_BYTES if key.data == "stdout" else MAX_STDERR_BYTES
                if len(buffers[key.data]) + len(chunk) > limit:
                    raise GitReadError("Git read exceeded output limit")
                buffers[key.data].extend(chunk)
        remaining = deadline - time.monotonic()
        if remaining <= 0 or process.wait(timeout=remaining) != 0:
            raise GitReadError("Git read failed")
        return bytes(buffers["stdout"])
    finally:
        selector.close()
        if process is not None:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=2)
            process.stdout.close()
            process.stderr.close()


def classify(repo, kind, event, *, force=False, reader=bounded_git):
    if force:
        return decision(True, "forced-by-caller")
    if kind not in {"pull_request", "merge_group", "push"}:
        return decision(True, "unknown-or-manual-event")
    try:
        base, head, separator = event_revisions(kind, event)
    except (KeyError, TypeError, ValueError):
        return decision(True, "invalid-revisions")
    try:
        if reader(repo, ["rev-parse", "--is-shallow-repository"]).strip() != b"false":
            return decision(True, "incomplete-history")
        for sha in (base, head):
            if reader(repo, ["cat-file", "-t", "--", sha]).strip() != b"commit":
                return decision(True, "unresolvable-revisions")
        raw = reader(repo, [
            "diff", "--raw", "--no-abbrev", "-z", "--no-renames", "--no-ext-diff",
            "--no-textconv", "--no-relative", "--ignore-submodules=none",
            "--end-of-options", f"{base}{separator}{head}", "--",
        ])
        return classify_diff(raw)
    except (GitReadError, OSError, ValueError, subprocess.SubprocessError):
        return decision(True, "git-read-incomplete")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--event-name", default=os.environ.get("GITHUB_EVENT_NAME", ""))
    parser.add_argument("--event-path", default=os.environ.get("GITHUB_EVENT_PATH", ""))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)
    if args.force or args.event_name not in {"pull_request", "merge_group", "push"}:
        result = classify(args.repo, args.event_name, None, force=args.force)
    else:
        try:
            event_path = Path(args.event_path)
            if event_path.stat().st_size > MAX_DIFF_BYTES:
                raise ValueError("Event exceeds size limit")
            with event_path.open(encoding="utf-8") as source:
                event = json.load(source)
        except (OSError, ValueError, TypeError):
            result = decision(True, "unreadable-event")
        else:
            result = classify(args.repo, args.event_name, event)
    print(json.dumps(result, sort_keys=True))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(f"run={str(result['run']).lower()}\nreason={result['reason']}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
