#!/usr/bin/env python3
"""Check the local release-test environment before the suite can fail for it.

`.github/release-tests` is written for the CI runners: a POSIX host, Python 3.12
(or 3.13 on macOS), PyYAML installed in the running interpreter, and bash 5.
A macOS workstation usually lacks the last three, so running the suite directly
reports dozens of failures that read exactly like real regressions.

This wrapper checks those prerequisites first and stops with exit status 78
(EX_CONFIG) when the machine cannot run the suite at all, keeping exit status 1
for genuine test failures.

    python3 .github/release-tests/run_local.py
    python3 .github/release-tests/run_local.py --check-only
    python3 .github/release-tests/run_local.py --json
    python3 .github/release-tests/run_local.py -v

Any argument this wrapper does not recognise is forwarded to unittest.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUITE = ".github/release-tests"
# Mirrors scripts/async_process.py:444, which gates the POSIX process runner.
PYTHON_FLOOR = {"linux": (3, 12), "darwin": (3, 13)}
# Below 4.4, "${array[@]}" under `set -u` fails when the array is empty, which
# breaks the release-build step exercised by test_macos_release_signing.py.
BASH_FLOOR = (4, 4)
UNSUPPORTED_ENVIRONMENT = 78
BASH_VERSION = re.compile(r"version (\d+)\.(\d+)")


def check(name, requirement, actual, ok, fix):
    return {
        "name": name,
        "requirement": requirement,
        "actual": actual,
        "ok": ok,
        "fix": fix,
    }


def python_check():
    floor = PYTHON_FLOOR.get(sys.platform)
    version = ".".join(str(part) for part in sys.version_info[:3])
    fix = (
        "install Python 3.13 or newer (brew install python@3.13) and run this "
        "wrapper with it; add PyYAML to that interpreter with "
        f"{sys.executable} -m pip install pyyaml"
    )
    if floor is None:
        return check(
            "Python",
            "a supported POSIX platform (linux, darwin)",
            sys.platform,
            False,
            "the release tests only run on linux and macOS",
        )
    minimum = ".".join(str(part) for part in floor)
    return check(
        "Python",
        f">= {minimum} on {sys.platform}",
        f"{version} ({sys.executable})",
        sys.version_info[:2] >= floor,
        fix,
    )


def yaml_check():
    try:
        found = importlib.util.find_spec("yaml") is not None
    except (ImportError, ValueError):
        found = False
    return check(
        "PyYAML",
        "importable by the interpreter that runs the suite",
        "available" if found else "missing",
        found,
        f"{sys.executable} -m pip install pyyaml",
    )


def bash_check():
    path = shutil.which("bash")
    if not path:
        return check("bash", ">= 4.4 on PATH", "not found", False, "brew install bash")
    try:
        result = subprocess.run(
            [path, "--version"],
            capture_output=True,
            check=False,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        result = None
    match = BASH_VERSION.search(result.stdout) if result and result.returncode == 0 else None
    if not match:
        return check("bash", ">= 4.4 on PATH", f"unreadable at {path}", False, "brew install bash")
    version = (int(match.group(1)), int(match.group(2)))
    return check(
        "bash",
        ">= 4.4 on PATH",
        f"{version[0]}.{version[1]} at {path}",
        version >= BASH_FLOOR,
        'brew install bash, then run PATH="$(brew --prefix)/bin:$PATH" python3 ' + SUITE + "/run_local.py",
    )


def preflight():
    checks = [python_check(), yaml_check(), bash_check()]
    missing = [item for item in checks if not item["ok"]]
    return {
        "status": "unsupported-environment" if missing else "ready",
        "suite": SUITE,
        "checks": checks,
        "missing": [item["name"] for item in missing],
        "next_action": (
            "; ".join(item["fix"] for item in missing) if missing else f"run `python3 {SUITE}/run_local.py`"
        ),
    }


def report_human(report):
    print(f"release-test preflight on {sys.platform} (Python {sys.version.split()[0]})")
    for item in report["checks"]:
        mark = "ok  " if item["ok"] else "FAIL"
        print(f"  {mark}  {item['name']} {item['requirement']}: {item['actual']}")
    if report["status"] != "ready":
        print()
        print("This machine cannot run .github/release-tests as written, so a failure")
        print("here would not be a regression. Fix the environment first:")
        for item in report["checks"]:
            if not item["ok"]:
                print(f"  {item['name']}: {item['fix']}")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Check the local environment, then run the release tests.",
        epilog=f"Exit {UNSUPPORTED_ENVIRONMENT} means the environment is unsupported, not that a test failed.",
    )
    parser.add_argument("--check-only", action="store_true", help="report, never run")
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    options, forwarded = parser.parse_known_args(argv)

    report = preflight()
    if options.json:
        print(json.dumps(report, indent=2))
    else:
        report_human(report)
    if report["status"] != "ready":
        return UNSUPPORTED_ENVIRONMENT
    if options.check_only:
        return 0
    if not options.json:
        print()
    command = [
        sys.executable,
        "-m",
        "unittest",
        "discover",
        "-s",
        SUITE,
        "-p",
        "test_*.py",
        *forwarded,
    ]
    return subprocess.run(command, cwd=ROOT, check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
