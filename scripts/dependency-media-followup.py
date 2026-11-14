#!/usr/bin/env python3
"""Generate in a secretless container; publish only a validated same-PR delta."""

import argparse
import base64
import hashlib
import io
import json
import os
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

REPOSITORY = "open-ott-play/ottplay-foss"
BOT_ID = 319626568
BOT_LOGIN = "californiantiramisu"
BRANCH = "renovate/npm-lockfile"
WORKFLOW = ".github/workflows/auto-approve.yml"
GENERATOR_JOB = "Generate dependency media"
IMAGE = "node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5"
ASSETS = ("runtime-polyfills.js", "hls.min.js", "hls.worker.js", "video.min.js")
PACKAGES = (
    "core-js",
    "hls.js",
    "video.js",
    "@videojs/http-streaming",
    "typescript",
    "rollup",
    "terser",
    "@rollup/plugin-commonjs",
    "@rollup/plugin-node-resolve",
)
NOTICE_PACKAGES = tuple(
    sorted(
        {
            "jquery",
            "hls.js",
            "shaka-player",
            "core-js",
            "video.js",
            "@videojs/http-streaming",
            "@capacitor/core",
            "@capacitor/android",
            "@capacitor/ios",
            "@capacitor/cli",
            "@capacitor/app",
            "@tauri-apps/plugin-updater",
        }
    )
)
LICENSES = (
    "core-js-LICENSE.txt",
    "hls.js-LICENSE.txt",
    "video.js-LICENSE.txt",
    "@videojs-http-streaming-LICENSE.txt",
    "project-LICENSE.txt",
    "Apache-2.0.txt",
)
HTML = ("index.html", "src-tauri/pip/pip.html")
OUTPUTS = tuple(
    sorted(
        ["js/" + name for name in ASSETS]
        + ["js/licenses/" + name for name in LICENSES]
        + ["js/media-runtime.json", *HTML]
    )
)
INPUTS = tuple(
    sorted(
        set(OUTPUTS)
        | {
            "package.json",
            "package-lock.json",
            "scripts/media-runtime.cjs",
            "src/polyfills/runtime.ts",
            "LICENSE",
            "licenses/android/Apache-2.0.txt",
            "THIRD-PARTY-NOTICES.md",
        }
    )
)
FILE_LIMIT = 4 * 1024 * 1024
TOTAL_LIMIT = 16 * 1024 * 1024
JSON_LIMIT = 16 * 1024 * 1024
BOOTSTRAP = re.compile(rb'(<script src="(?:\./|/)js/runtime-polyfills\.js)(?:\?v=[a-f0-9]+)?("[^>]*></script>)')


def require(condition, message):
    if not condition:
        raise ValueError(message)


class Ineligible(ValueError):
    """An ordinary/manual follow-up is outside the automatic dependency profile."""


class StaleContext(ValueError):
    """A valid source/run moved before publication; no mutation was attempted."""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def positive(value):
    require(type(value) is int and value > 0, "Expected positive integer identity")
    return value


def oid(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value), "Invalid Git identity")
    return value


def parse(data):
    require(len(data) <= JSON_LIMIT, "JSON too large")

    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "Duplicate JSON field")
            result[key] = value
        return result

    def invalid(_):
        raise ValueError("Non-integral or non-finite JSON number")

    return json.loads(data, object_pairs_hook=pairs, parse_float=invalid, parse_constant=invalid)


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def fresh_json(path, value):
    with Path(path).open("xb") as handle:
        os.chmod(path, 0o600)
        handle.write(json_bytes(value))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        # urllib converts an unhandled redirect into HTTPError(302), allowing
        # the artifact caller to inspect exactly one Location without following it.
        return None


class Api:
    def __init__(self, token, trusted_base=None):
        require(bool(token), "Missing scoped API credential")
        self.token = token
        self.trusted_base = trusted_base

    def request(self, path, payload=None):
        require(path.startswith("/") and not path.startswith("//"), "Invalid API path")
        request = urllib.request.Request(
            "https://api.github.com" + path,
            data=None if payload is None else json_bytes(payload),
            headers={
                "Authorization": "Bearer " + self.token,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
            },
            method="GET" if payload is None else "POST",
        )
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
                return parse(response.read(JSON_LIMIT + 1))
        except urllib.error.HTTPError as error:
            raise ValueError("GitHub API HTTP " + str(error.code)) from None

    def repo(self, path):
        return self.request("/repos/" + REPOSITORY + path)

    def artifact(self, plan):
        # The authenticated API redirects to a signed object-store URL. Never
        # forward Authorization to that origin, or follow a second redirect.
        url = (
            "https://api.github.com/repos/"
            + REPOSITORY
            + "/actions/artifacts/"
            + str(positive(plan["artifactId"]))
            + "/zip"
        )
        request = urllib.request.Request(
            url, headers={"Authorization": "Bearer " + self.token, "Accept": "application/vnd.github+json"}
        )
        opener = urllib.request.build_opener(NoRedirect)
        try:
            opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            require(error.code == 302, "Artifact API did not return the signed download redirect")
            location = error.headers.get("Location", "")
            error.close()
        else:
            raise ValueError("Artifact API redirect was absent")
        target = urllib.parse.urlsplit(location)
        require(
            target.scheme == "https"
            and target.username is None
            and target.password is None
            and target.port is None
            and not target.fragment
            and target.hostname is not None
            and re.fullmatch(
                r"[a-z0-9-]+\.(?:blob\.core\.windows\.net|actions\.githubusercontent\.com)", target.hostname
            ),
            "Untrusted artifact redirect origin",
        )
        deadline = time.monotonic() + 120
        content = bytearray()
        with opener.open(urllib.request.Request(location), timeout=30) as response:
            while True:
                require(time.monotonic() < deadline, "Artifact download deadline")
                chunk = response.read(65536)
                if not chunk:
                    break
                content.extend(chunk)
                require(len(content) <= 32 * 1024**2, "Artifact download byte bound")
        require("sha256:" + sha(content) == plan["artifactDigest"], "Artifact service digest mismatch")
        return bytes(content)


def tree(api, commit):
    obj = api.repo("/git/commits/" + oid(commit))
    require(obj["sha"] == commit, "Commit identity mismatch")
    tree_id = oid(obj["tree"]["sha"])
    result = api.repo("/git/trees/" + tree_id + "?recursive=1")
    require(result["sha"] == tree_id and result.get("truncated") is False, "Incomplete Git tree")
    entries = result["tree"]
    require(isinstance(entries, list) and len(entries) <= 20000, "Git tree inventory bound")
    index = {item["path"]: item for item in entries}
    require(len(index) == len(entries), "Duplicate Git tree path")
    return tree_id, index


def blob(api, entry):
    require(entry["mode"] == "100644" and entry["type"] == "blob", "Input must be a regular source file")
    require(type(entry["size"]) is int and 0 < entry["size"] <= FILE_LIMIT, "Input file bound")
    result = api.repo("/git/blobs/" + oid(entry["sha"]))
    require(result["sha"] == entry["sha"] and result["encoding"] == "base64", "Blob identity mismatch")
    data = base64.b64decode("".join(result["content"].split()), validate=True)
    require(len(data) == entry["size"] == result["size"] and git_blob(data) == entry["sha"], "Blob content mismatch")
    return data


def package_policy(base_package, package, lock):
    for field in set(base_package) | set(package):
        if field not in {"dependencies", "devDependencies", "overrides"}:
            require(base_package.get(field) == package.get(field), "Dependency update changed package metadata/scripts")
    require(lock.get("lockfileVersion") == 3, "Expected npm lockfile v3")
    packages = lock.get("packages")
    require(isinstance(packages, dict) and 1 < len(packages) <= 4096, "Lock package inventory bound")
    for name, item in packages.items():
        require(name.isascii() and isinstance(item, dict), "Invalid package entry")
        if name:
            require(name.startswith("node_modules/") and ".." not in name.split("/"), "Invalid package path")
            require(
                re.fullmatch(r"https://registry\.npmjs\.org/[^?#\s]+", item.get("resolved", "")),
                "Only registry tarballs are eligible",
            )
            require(
                re.fullmatch(r"sha512-[A-Za-z0-9+/]+={0,2}", item.get("integrity", "")),
                "Missing SHA-512 package integrity",
            )
            require(item.get("link") is not True, "Linked packages are ineligible")


def admission(api, pr_number, expected_head, expected_base=None):
    main = oid(api.repo("/git/ref/heads/main")["object"]["sha"])
    trusted_base = getattr(api, "trusted_base", None)
    if trusted_base is not None and main != trusted_base:
        raise StaleContext("Main moved beyond the checked-out trusted coordinator")
    if expected_base is not None and main != expected_base:
        raise StaleContext("Main moved since source admission")
    pr = api.repo("/pulls/" + str(positive(pr_number)))
    if pr["state"] == "closed":
        raise StaleContext("Dependency PR is now closed")
    require(pr["state"] == "open" and not pr["draft"], "PR is not open for dependency follow-up")
    require(pr["user"]["id"] == BOT_ID and pr["user"]["login"] == BOT_LOGIN, "Unexpected dependency author")
    require(
        pr["head"]["repo"]["full_name"] == REPOSITORY and pr["base"]["repo"]["full_name"] == REPOSITORY,
        "Fork or repository mismatch",
    )
    require(pr["head"]["ref"] == BRANCH and pr["base"]["ref"] == "main", "Unexpected dependency branch")
    head = oid(pr["head"]["sha"])
    oid(pr["base"]["sha"])
    if head != expected_head or pr["base"]["sha"] != main:
        raise StaleContext("PR source changed")
    comparison = api.repo("/compare/" + main + "..." + head)
    if oid(comparison["merge_base_commit"]["sha"]) != main:
        raise StaleContext("Dependency branch no longer includes current main")
    require(comparison["status"] == "ahead", "Dependency branch must be ahead of current main")
    require(0 < comparison["total_commits"] <= 20, "Dependency commit inventory bound")
    files = comparison["files"]
    names = [item["filename"] for item in files]
    if not (
        1 <= len(names) <= 2
        and len(set(names)) == len(names)
        and set(names) <= {"package.json", "package-lock.json"}
        and "package-lock.json" in names
    ):
        raise Ineligible("Only dependency input changes are eligible")
    require(
        all(item["status"] == "modified" and "previous_filename" not in item for item in files),
        "Renamed/added/deleted inputs are ineligible",
    )
    tree_id, entries = tree(api, head)
    _, base_entries = tree(api, main)
    data = {name: blob(api, entries[name]) for name in INPUTS}
    require(sum(map(len, data.values())) <= TOTAL_LIMIT, "Source input byte bound")
    package_policy(
        parse(blob(api, base_entries["package.json"])), parse(data["package.json"]), parse(data["package-lock.json"])
    )
    base_lock = parse(blob(api, base_entries["package-lock.json"]))
    context = {
        "repository": REPOSITORY,
        "pr": pr_number,
        "head": head,
        "base": main,
        "tree": tree_id,
        "lockSha256": sha(data["package-lock.json"]),
        "image": IMAGE,
        "inputs": {name: entries[name]["sha"] for name in INPUTS},
        "baseVersions": {
            name: base_lock["packages"].get("node_modules/" + name, {}).get("version") for name in NOTICE_PACKAGES
        },
    }
    return context, data, entries


def expected_manifest(data):
    lock = parse(data["package-lock.json"])
    if "version" in lock:
        lock["version"] = ""
    if "version" in lock["packages"][""]:
        lock["packages"][""]["version"] = ""
    # npm lockfile property names are ASCII; this matches the existing JS canonicalizer.
    canonical = json.dumps(lock, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    expected = {
        "builderSha256": sha(data["scripts/media-runtime.cjs"]),
        "lockInputsSha256": sha(canonical),
        "packages": {
            name: {
                "integrity": lock["packages"]["node_modules/" + name]["integrity"],
                "version": lock["packages"]["node_modules/" + name]["version"],
            }
            for name in PACKAGES
        },
        "webPolyfillsSha256": sha(data["src/polyfills/runtime.ts"]),
    }
    version = sha(json.dumps(expected, separators=(",", ":"), ensure_ascii=False).encode())[:16]
    return expected, version


def validate_outputs(data, output):
    require(set(output) == set(OUTPUTS), "Output path allowlist mismatch")
    require(
        all(0 < len(value) <= FILE_LIMIT for value in output.values())
        and sum(map(len, output.values())) <= TOTAL_LIMIT,
        "Output byte bound",
    )
    manifest = parse(output["js/media-runtime.json"])
    expected, version = expected_manifest(data)
    require(set(manifest) == {"schema", "runtimeVersion", "assets", *expected}, "Unexpected media manifest fields")
    require(manifest["schema"] == 2 and manifest["runtimeVersion"] == version, "Media source version mismatch")
    require(all(manifest[key] == value for key, value in expected.items()), "Media input provenance mismatch")
    require(manifest["assets"] == {name: sha(output["js/" + name]) for name in ASSETS}, "Media asset digest mismatch")
    for name in HTML:
        require(len(BOOTSTRAP.findall(data[name])) == 1, "Ambiguous original HTML bootstrap")
        updated = BOOTSTRAP.sub(lambda match: match[1] + b"?v=" + version.encode() + match[2], data[name])
        require(output[name] == updated, "HTML changed outside the bootstrap version")
    for name, original in (("project-LICENSE.txt", "LICENSE"), ("Apache-2.0.txt", "licenses/android/Apache-2.0.txt")):
        require(output["js/licenses/" + name] == data[original], "Project license changed")


def update_notices(data, base_versions):
    """Only the trusted publisher derives reviewed version spans, never the artifact."""
    lock = parse(data["package-lock.json"])["packages"]
    versions = {name: item.get("version") for name, item in lock.items()}

    def changed(name):
        return versions.get("node_modules/" + name) != base_versions.get(name)

    # These entries cite retained, version-specific license files. Updating a
    # label alone would incorrectly claim that an old license belongs to a new package.
    require(
        not changed("@capacitor/app"),
        "Capacitor App changed: review/copy its versioned license before automatic media follow-up",
    )
    text = data["THIRD-PARTY-NOTICES.md"].decode("utf8")
    sections = {match[1]: (match.start(), match.end()) for match in re.finditer(r"^## ([^\n]+)\n", text, re.MULTILINE)}
    edits = []

    def replace(section, name, prefix, suffix, count):
        if not changed(name):
            return
        version = versions.get("node_modules/" + name, "")
        require(
            isinstance(version, str) and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", version),
            "Unsupported notice version",
        )
        require(section in sections, "Notice section changed; manual review required")
        start = sections[section][1]
        end = min((value[0] for value in sections.values() if value[0] > start), default=len(text))
        pattern = re.compile(re.escape(prefix) + r"([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)" + re.escape(suffix))
        matches = list(pattern.finditer(text, start, end))
        require(len(matches) == count, "Notice template changed; manual review required")
        for match in matches:
            edits.append((match.start(1), match.end(1), version))

    native = "Native runtime: Tauri and Capacitor"
    for name, label, url in (
        ("jquery", "jQuery", "https://github.com/jquery/jquery/blob/"),
        ("hls.js", "hls.js", "https://github.com/video-dev/hls.js/blob/v"),
        ("shaka-player", "Shaka Player", "https://github.com/shaka-project/shaka-player/blob/v"),
    ):
        replace(native, name, "**" + label + " ", "**", 1)
        replace(native, name, "**" + label + " ", ":**", 1)
        replace(native, name, url, "/LICENSE.txt" if name == "jquery" else "/LICENSE", 1)
    capacitor = ("@capacitor/core", "@capacitor/android", "@capacitor/ios", "@capacitor/cli")
    if any(changed(name) for name in capacitor):
        require(
            len({versions.get("node_modules/" + name) for name in capacitor}) == 1,
            "Capacitor notice requires one aligned core/Android/iOS/CLI release",
        )
        # All four align, even when one input was already at the requested version.
        base_versions = dict(base_versions, **{"@capacitor/core": None})
        replace(native, "@capacitor/core", "**Capacitor core, Android, iOS and CLI/template ", ":**", 1)
        replace(native, "@capacitor/core", "https://github.com/ionic-team/capacitor/blob/", "/LICENSE", 1)
    replace(native, "@tauri-apps/plugin-updater", "**Tauri JavaScript updater plugin ", ":**", 1)
    replace("Shared ES5 media runtime", "hls.js", "**hls.js ", "**", 1)
    replace("Shared ES5 media runtime", "core-js", "**core-js ", "**", 1)
    replace("Web and legacy player libraries", "hls.js", "**hls.js ", "**", 1)
    replace("Optional PC2 streaming engine", "video.js", "**Video.js ", "**", 1)
    replace("Optional PC2 streaming engine", "@videojs/http-streaming", "**VHS ", "**", 1)
    for start, end, replacement in sorted(edits, reverse=True):
        text = text[:start] + replacement + text[end:]
    return text.encode()


CONTAINER_OPERATIONS = frozenset(
    (
        "pull",
        "create",
        "install",
        "offline",
        "offline-check",
        "build",
        "export-js",
        "export-index.html",
        "export-src-tauri",
        "cleanup-inspect",
        "cleanup",
    )
)


def stderr_tail(value):
    """Redact before truncating, so a tail cannot expose half of a credential."""
    text = bytes(value).decode("utf-8", errors="replace")

    def public_url(match):
        try:
            url = urllib.parse.urlsplit(match[0])
            host = url.hostname
            require(host is not None, "URL host")
            if ":" in host:
                host = "[" + host + "]"
            if url.port is not None:
                host += ":" + str(url.port)
            return urllib.parse.urlunsplit((url.scheme, host, url.path, "", ""))
        except ValueError:
            return "[redacted-url]"

    text = re.sub(r"https?://[^\s\"'<>]+", public_url, text, flags=re.IGNORECASE)
    text = re.sub(r"(?im)((?:proxy-)?authorization\s*:)\s*[^\r\n]+", r"\1 [redacted]", text)
    text = re.sub(r"(?i)\b(?:bearer|basic)\s+[\w.+/=-]+", "[redacted-auth]", text)
    text = re.sub(
        r"(?i)(\b[\w-]*(?:token|password|passwd|secret|api[_-]?key)\b[\"']?\s*[=:]\s*)"
        r"(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s\"',;]+)",
        r"\1[redacted]",
        text,
    )
    text = re.sub(r"\b(?:gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)\b", "[redacted-token]", text)
    return text[-2048:]


def bounded_command(args, timeout, limit=1024 * 1024, *, operation):
    """No shell, inherited credentials, unbounded stdout or surviving child group."""
    require(operation in CONTAINER_OPERATIONS, "Unknown container operation")
    print(
        "Container operation " + json.dumps({"operation": operation, "status": "started"}), file=sys.stderr, flush=True
    )
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"}
    child = None
    chunks = {"out": bytearray(), "err": bytearray()}
    deadline = time.monotonic() + timeout
    failure = None
    try:
        child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, start_new_session=True)
        with selectors.DefaultSelector() as poll:
            poll.register(child.stdout, selectors.EVENT_READ, "out")
            poll.register(child.stderr, selectors.EVENT_READ, "err")
            while poll.get_map():
                require(time.monotonic() < deadline, "Container operation deadline")
                for key, _ in poll.select(min(0.1, max(0, deadline - time.monotonic()))):
                    part = os.read(key.fileobj.fileno(), 65536)
                    if not part:
                        poll.unregister(key.fileobj)
                    else:
                        chunks[key.data].extend(part)
                        require(len(chunks[key.data]) <= limit, "Container output bound")
        require(child.wait(timeout=max(0.1, deadline - time.monotonic())) == 0, "Container operation failed")
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        failure = error
    finally:
        if child is not None:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=10)
            child.stdout.close()
            child.stderr.close()
    if failure is not None:
        # Never include argv, the inherited environment, or raw terminal/workflow commands.
        reason = str(failure) if isinstance(failure, ValueError) else type(failure).__name__
        detail = {
            "operation": operation,
            "reason": reason,
            "exitCode": child.returncode if child else None,
            "stderrTail": stderr_tail(chunks["err"]),
        }
        raise ValueError("Container operation failed: " + json.dumps(detail, ensure_ascii=True)) from None
    return bytes(chunks["out"])


def container_command(name, source):
    return [
        "docker",
        "run",
        "--detach",
        "--name",
        name,
        "--label",
        "ottplay.media-followup-owner=" + name,
        "--read-only",
        "--user",
        "65532:65532",
        "--cap-drop=ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "128",
        "--memory",
        "2g",
        "--cpus",
        "2",
        "--network",
        "bridge",
        "--restart",
        "no",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777",
        "--tmpfs",
        "/work:rw,exec,nosuid,nodev,size=1536m,mode=1777",
        "--mount",
        "type=bind,src=" + str(source) + ",dst=/source,readonly",
        "--workdir",
        "/work",
        "--env",
        "HOME=/tmp",
        IMAGE,
        "sleep",
        "900",
    ]


def container_tree(archive, group):
    expected_files = {name for name in OUTPUTS if name == group or name.startswith(group + "/")}
    expected_dirs = {str(parent) for name in expected_files for parent in Path(name).parents if str(parent) != "."}
    require(len(archive) <= TOTAL_LIMIT + 65536, "Container TAR byte bound")
    actual_dirs = set()
    result = {}
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as payload:
        for member in payload:
            name = member.name.rstrip("/") if member.isdir() else member.name
            require(name not in seen and len(seen) < 32, "Duplicate/excess container TAR entries")
            seen.add(name)
            if member.isdir():
                require(name in expected_dirs, "Unexpected container output directory")
                actual_dirs.add(name)
            else:
                require(
                    member.isfile()
                    and not member.issym()
                    and not member.islnk()
                    and name in expected_files
                    and 0 < member.size <= FILE_LIMIT,
                    "Nonregular/unexpected container output",
                )
                result[name] = payload.extractfile(member).read(FILE_LIMIT + 1)
                require(len(result[name]) == member.size, "Container output size mismatch")
                require(sum(map(len, result.values())) <= TOTAL_LIMIT, "Container TAR expansion bound")
    require(set(result) == expected_files and actual_dirs == expected_dirs, "Incomplete container output tree")
    return result


def remove_owned_container(name, run):
    value = parse(run(["docker", "inspect", "--format", "{{json .}}", name], 15, operation="cleanup-inspect"))
    require(
        value["Name"] == "/" + name
        and value["Config"]["Image"] == IMAGE
        and value["Config"]["Labels"].get("ottplay.media-followup-owner") == name,
        "Container ownership mismatch; refusing cleanup",
    )
    run(["docker", "rm", "--force", name], 20, operation="cleanup")


def generate_container(data, temp_root, run=bounded_command):
    require(shutil.disk_usage(temp_root).free >= 4 * 1024**3, "Insufficient private generation space")
    archives = {}
    with tempfile.TemporaryDirectory(prefix="media-source-", dir=temp_root) as temporary:
        source = Path(temporary) / "source"
        source.mkdir(mode=0o755)
        for name, content in data.items():
            destination = source / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
            destination.chmod(0o444)
        name = "ottplay-media-" + os.urandom(16).hex()
        creation_attempted = False
        try:
            run(["docker", "pull", IMAGE], 120, operation="pull")
            # Reconcile by random identity even if the CLI loses the creation ACK.
            creation_attempted = True
            run(container_command(name, source), 30, operation="create")
            run(
                [
                    "docker",
                    "exec",
                    name,
                    "sh",
                    "-ceu",
                    (
                        "cp /source/package.json /source/package-lock.json /work/; "
                        "chmod u+w /work/package.json /work/package-lock.json; "
                        "npm ci --ignore-scripts --no-audit --no-fund --cache /work/.npm-cache; rm -rf /work/.npm-cache"
                    ),
                ],
                300,
                operation="install",
            )
            # No network remains when any repository generator/dependency code is executed.
            run(["docker", "network", "disconnect", "bridge", name], 15, operation="offline")
            networks = parse(
                run(
                    ["docker", "inspect", "--format", "{{json .NetworkSettings.Networks}}", name],
                    15,
                    operation="offline-check",
                )
            )
            require(networks == {}, "Generation container still has network access")
            run(
                [
                    "docker",
                    "exec",
                    name,
                    "sh",
                    "-ceu",
                    (
                        "cp -R /source/. /work/; chmod -R u+w /work/js; "
                        "chmod u+w /work/index.html /work/src-tauri/pip/pip.html; "
                        "node /work/scripts/media-runtime.cjs build; "
                        "node /work/scripts/media-runtime.cjs check"
                    ),
                ],
                420,
                operation="build",
            )
            # docker cp does not support tmpfs. The immutable image's tar emits
            # untrusted bytes while offline; no claim of filesystem quiescence.
            captured = 0
            aggregate_limit = TOTAL_LIMIT + 3 * 65536
            for group in ("js", "index.html", "src-tauri"):
                archive = run(
                    ["docker", "exec", name, "/bin/tar", "-C", "/work", "-cf", "-", group],
                    15,
                    min(TOTAL_LIMIT + 65536, aggregate_limit - captured),
                    operation="export-" + group,
                )
                captured += len(archive)
                require(captured <= aggregate_limit, "Aggregate container TAR byte bound")
                archives[group] = archive
        finally:
            if creation_attempted:
                original = sys.exc_info()[1]
                try:
                    remove_owned_container(name, run)
                except (ValueError, OSError, subprocess.SubprocessError) as cleanup:
                    detail = "Owned container cleanup was not confirmed: " + str(cleanup)
                    if original is not None:
                        detail = str(original) + "; " + detail
                    raise ValueError(detail) from original
    # Only parent-owned bytes remain. Cleanup must succeed before any parsing,
    # validation, artifact emission or return; the container cannot mutate them.
    result = {}
    for group, archive in archives.items():
        result.update(container_tree(archive, group))
    validate_outputs(data, result)
    return result


def run_identity(api, event):
    claimed = event["workflow_run"]
    run = api.repo("/actions/runs/" + str(positive(claimed["id"])))
    if positive(run["run_attempt"]) > positive(claimed["run_attempt"]):
        raise StaleContext("Workflow attempt moved")
    require(run["run_attempt"] == claimed["run_attempt"], "Invalid workflow attempt")
    require(
        run["event"] == "pull_request" and run["status"] == "completed",
        "Maintenance workflow has not completed as a pull_request run",
    )
    if run["conclusion"] == "cancelled":
        raise StaleContext("Maintenance run was cancelled; do not publish its artifact")
    require(run["path"] == WORKFLOW and run["head_branch"] == BRANCH, "Unexpected generator workflow")
    require(
        run["repository"]["full_name"] == REPOSITORY and run["head_repository"]["full_name"] == REPOSITORY,
        "Generator repository mismatch",
    )
    workflow = api.repo("/actions/workflows/" + str(positive(run["workflow_id"])))
    require(workflow["path"] == WORKFLOW and workflow["state"] == "active", "Generator workflow identity mismatch")
    require(len(run["pull_requests"]) == 1, "Ambiguous generator PR")
    return run


def publisher_context(api, event):
    run = run_identity(api, event)
    artifacts = api.repo("/actions/runs/" + str(run["id"]) + "/artifacts?per_page=100")
    require(
        artifacts["total_count"] == len(artifacts["artifacts"]) <= 100,
        "Incomplete or oversized maintenance artifact inventory",
    )
    expected_name = "dependency-media-" + str(run["id"]) + "-" + str(run["run_attempt"])
    selected = [artifact for artifact in artifacts["artifacts"] if artifact["name"] == expected_name]
    if not selected:
        return None, None, None
    require(len(selected) == 1, "Duplicate generator artifact")
    # Approval runs in a different VM and can fail independently. Only the exact
    # producer job in this immutable attempt qualifies this artifact, not the
    # aggregate maintenance workflow's conclusion or an approval receipt.
    jobs = api.repo("/actions/runs/" + str(run["id"]) + "/attempts/" + str(run["run_attempt"]) + "/jobs?per_page=100")
    require(jobs["total_count"] == len(jobs["jobs"]) <= 100, "Incomplete or oversized maintenance job inventory")
    producers = [job for job in jobs["jobs"] if job["name"] == GENERATOR_JOB]
    require(len(producers) == 1, "Missing or ambiguous media producer job")
    producer = producers[0]
    require(
        producer["run_id"] == run["id"]
        and producer["run_attempt"] == run["run_attempt"]
        and producer["head_sha"] == run["head_sha"]
        and producer["status"] == "completed"
        and producer["conclusion"] == "success",
        "Current-attempt media producer did not succeed",
    )
    context, data, entries = admission(api, run["pull_requests"][0]["number"], oid(run["head_sha"]))
    context.update(run=run["id"], attempt=run["run_attempt"], workflow=WORKFLOW)
    artifact = selected[0]
    require(
        artifact["name"] == "dependency-media-" + str(run["id"]) + "-" + str(run["run_attempt"]),
        "Wrong artifact name/attempt",
    )
    require(not artifact["expired"] and 0 < artifact["size_in_bytes"] <= 32 * 1024**2, "Artifact expired or oversized")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", artifact.get("digest", "")), "Missing artifact service digest")
    binding = artifact["workflow_run"]
    require(binding["id"] == run["id"] and binding["head_sha"] == context["head"], "Artifact source mismatch")
    plan = {
        "context": context,
        "artifactId": positive(artifact["id"]),
        "artifactDigest": artifact["digest"],
        "producerJobId": positive(producer["id"]),
    }
    return plan, data, entries


def read_artifact(archive, context):
    require(len(archive) <= 32 * 1024**2, "Artifact ZIP byte bound")
    expected = {"receipt.json", *("files/" + name for name in OUTPUTS)}
    actual = {}
    expected_dirs = {str(Path(name).parent) for name in expected}
    expected_dirs |= {str(parent) for name in expected for parent in Path(name).parents}
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        members = zipped.infolist()
        require(
            len(members) <= 40 and len({item.filename for item in members}) == len(members),
            "Duplicate/excess artifact ZIP entries",
        )
        total = 0
        for item in members:
            name = item.filename
            mode = item.external_attr >> 16
            require(
                "\\" not in name
                and not name.startswith("/")
                and ".." not in name.split("/")
                and not (item.flag_bits & 1),
                "Unsafe ZIP entry name/encryption",
            )
            if item.is_dir():
                require(
                    name[:-1] in expected_dirs and (not stat.S_IFMT(mode) or stat.S_ISDIR(mode)),
                    "Unexpected ZIP directory",
                )
                continue
            require(
                name in expected and (not stat.S_IFMT(mode) or stat.S_ISREG(mode)),
                "Unexpected/nonregular artifact ZIP entry",
            )
            limit = 65536 if name == "receipt.json" else FILE_LIMIT
            require(0 < item.file_size <= limit, "Artifact ZIP member size bound")
            total += item.file_size
            require(total <= TOTAL_LIMIT + 65536, "Artifact ZIP expansion bound")
            with zipped.open(item) as member:
                value = member.read(limit + 1)
            require(len(value) == item.file_size, "Artifact ZIP member size mismatch")
            actual[name] = value
    require(
        set(actual) == expected and sum(map(len, actual.values())) <= TOTAL_LIMIT + 65536, "Incomplete artifact tree"
    )
    receipt = parse(actual["receipt.json"])
    require(receipt["schema"] == 1 and receipt["context"] == context, "Artifact receipt source/run mismatch")
    output = {name: actual["files/" + name] for name in OUTPUTS}
    require(
        receipt["files"] == {name: {"sha256": sha(value), "bytes": len(value)} for name, value in output.items()},
        "Artifact file digest mismatch",
    )
    return output


def read_private_archive(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(
            stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= 32 * 1024**2,
            "Invalid downloaded ZIP file",
        )
        with os.fdopen(fd, "rb", closefd=False) as handle:
            data = handle.read(32 * 1024**2 + 1)
        after = os.fstat(fd)
        require(
            before.st_size == len(data) == after.st_size
            and before.st_mtime_ns == after.st_mtime_ns
            and before.st_ctime_ns == after.st_ctime_ns,
            "Downloaded ZIP changed while reading",
        )
        return data
    finally:
        os.close(fd)


def publish(read_api, bot_factory, event, plan, artifact, intent):
    fresh, data, old_tree = publisher_context(read_api, event)
    require(fresh == plan, "Source/run/artifact changed after download admission")
    archive = read_private_archive(artifact)
    require("sha256:" + sha(archive) == plan["artifactDigest"], "Downloaded ZIP digest mismatch")
    output = read_artifact(archive, plan["context"])
    validate_outputs(data, output)
    changes = {name: value for name, value in output.items() if value != data[name]}
    notices = update_notices(data, plan["context"]["baseVersions"])
    if notices != data["THIRD-PARTY-NOTICES.md"]:
        changes["THIRD-PARTY-NOTICES.md"] = notices
    if not changes:
        return {"status": "already-current", "context": plan["context"]}
    bot_api = bot_factory()
    actor = bot_api.request("/user")
    require(actor["id"] == BOT_ID and actor["login"] == BOT_LOGIN, "Publisher credential is not the designated bot")
    # Fresh head CAS is enforced by GitHub atomically. A later main advance only
    # makes the PR behind; this operation cannot merge or modify main.
    context, _, _ = admission(read_api, plan["context"]["pr"], plan["context"]["head"], plan["context"]["base"])
    require(
        context == {key: value for key, value in plan["context"].items() if key not in {"run", "attempt", "workflow"}},
        "Final source custody mismatch",
    )
    fresh_json(intent, {"status": "intended", "plan": plan, "paths": sorted(changes)})
    query = """mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid url parents(first:2){nodes{oid}}}}}"""
    result = bot_api.request(
        "/graphql",
        {
            "query": query,
            "variables": {
                "input": {
                    "branch": {"repositoryNameWithOwner": REPOSITORY, "branchName": BRANCH},
                    "expectedHeadOid": context["head"],
                    "message": {"headline": "chore: synchronize committed media for dependency update"},
                    "fileChanges": {
                        "additions": [
                            {"path": name, "contents": base64.b64encode(value).decode()}
                            for name, value in sorted(changes.items())
                        ]
                    },
                }
            },
        },
    )
    require(not result.get("errors"), "Publication API returned errors; reconcile intent before retry")
    commit = result["data"]["createCommitOnBranch"]["commit"]
    require(commit["parents"]["nodes"] == [{"oid": context["head"]}], "Published parent mismatch")
    new_head = oid(commit["oid"])
    _, new_tree = tree(read_api, new_head)
    old_files = {
        key: (value["mode"], value["type"], value["sha"]) for key, value in old_tree.items() if value["type"] != "tree"
    }
    new_files = {
        key: (value["mode"], value["type"], value["sha"]) for key, value in new_tree.items() if value["type"] != "tree"
    }
    for name, value in changes.items():
        old_files[name] = ("100644", "blob", git_blob(value))
    require(new_files == old_files, "Published tree did not match the exact output delta")
    commit_record = read_api.repo("/commits/" + new_head)
    require(commit_record["commit"]["verification"]["verified"] is True, "Published signature was not verified")
    return {
        "status": "published",
        "head": new_head,
        "parent": context["head"],
        "paths": sorted(changes),
        "context": plan["context"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("generate", "prepare", "download", "publish", "sandbox-test"))
    parser.add_argument("--event")
    parser.add_argument("--output")
    parser.add_argument("--plan")
    parser.add_argument("--artifact")
    parser.add_argument("--intent")
    args = parser.parse_args()
    if args.action == "sandbox-test":
        require(
            os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and os.environ.get("RUNNER_OS") == "Linux",
            "Sandbox test requires hosted Linux",
        )
        source = Path(__file__).resolve().parents[1]
        data = {}
        for name in INPUTS:
            path = source / name
            require(
                not path.is_symlink() and path.is_file() and path.stat().st_size <= FILE_LIMIT,
                "Invalid sandbox source input",
            )
            data[name] = path.read_bytes()
        result = generate_container(data, os.environ["RUNNER_TEMP"])
        validate_outputs(data, result)
        print("Hosted secretless generation/exec-tar/cleanup/audit passed for", len(result), "files")
        return
    require(args.event is not None, "Event file is required")
    event = parse(Path(args.event).read_bytes())
    api = Api(os.environ.get("READ_TOKEN"), oid(os.environ.get("TRUSTED_SOURCE")))
    if args.action == "generate":
        require(
            os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and os.environ.get("RUNNER_OS") == "Linux",
            "Generation requires the hosted Linux sandbox",
        )
        try:
            context, data, _ = admission(
                api,
                positive(event["number"]),
                event["pull_request"]["head"]["sha"],
                event["pull_request"]["base"]["sha"],
            )
        except (Ineligible, StaleContext) as reason:
            print("No automatic media follow-up:", reason)
            return
        context.update(
            run=positive(int(os.environ["GITHUB_RUN_ID"])),
            attempt=positive(int(os.environ["GITHUB_RUN_ATTEMPT"])),
            workflow=WORKFLOW,
        )
        output = Path(args.output)
        require(not output.exists(), "Output must be fresh")
        result = generate_container(data, os.environ["RUNNER_TEMP"])
        output.mkdir(mode=0o700)
        for name, value in result.items():
            file = output / "files" / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(value)
        fresh_json(
            output / "receipt.json",
            {
                "schema": 1,
                "context": context,
                "files": {name: {"sha256": sha(value), "bytes": len(value)} for name, value in result.items()},
            },
        )
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as handle:
            handle.write("eligible=true\n")
    elif args.action == "prepare":
        try:
            plan, _, _ = publisher_context(api, event)
        except StaleContext as reason:
            fresh_json(args.plan, {"status": "stale-noop", "reason": str(reason)})
            print("No publication:", reason)
            return
        if plan is None:
            print("No generated artifact; no publication")
            return
        fresh_json(args.plan, plan)
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as handle:
            handle.write("artifact_id=" + str(plan["artifactId"]) + "\n")
    elif args.action == "download":
        plan = parse(Path(args.plan).read_bytes())
        archive = api.artifact(plan)
        read_artifact(archive, plan["context"])
        with Path(args.output).open("xb") as handle:
            os.chmod(args.output, 0o600)
            handle.write(archive)
    else:
        plan = parse(Path(args.plan).read_bytes())
        try:
            result = publish(api, lambda: Api(os.environ.get("BOT_TOKEN")), event, plan, args.artifact, args.intent)
        except StaleContext as reason:
            result = {"status": "stale-noop", "reason": str(reason)}
        fresh_json(args.output, result)
    print("Dependency media follow-up completed:", args.action)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError, tarfile.TarError, zipfile.BadZipFile) as error:
        raise SystemExit("Dependency media follow-up rejected: " + str(error)) from None
