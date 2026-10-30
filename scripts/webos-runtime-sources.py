#!/usr/bin/env python3
"""Collect native runtime sources and bind linker evidence to the shipped IPK."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import subprocess
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "webos-runtime-sources.json"
SYSTEM = re.compile(
    r"^(?:lib(?:c|m|dl|rt|pthread|gcc_s|stdc\+\+|z|curl|glib-2\.0|gobject-2\.0|gthread-2\.0|gio-2\.0|gmodule-2\.0|luna-service2|wayland-client|SDL2(?:_ttf)?(?:-2\.0)?|GLESv2|EGL|playerAPIs|pf-1\.0|AcbAPI|freetype)\.so(?:\.[0-9]+)*|ld-linux\.so\.3)$"
)
RUNTIME = {
    "libc_nonshared.a": "glibc-runtime",
    "libpthread_nonshared.a": "glibc-runtime",
    "libc.a": "glibc-runtime",
    "libm.a": "glibc-runtime",
    "libgcc.a": "gcc-runtime",
    "libgcc_eh.a": "gcc-runtime",
    "libstdc++.a": "gcc-runtime",
    "libatomic.a": "gcc-runtime",
}


def digest(path, algorithm="sha256"):
    h = hashlib.new(algorithm)
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, indent=2).encode() + b"\n"


def fail(message):
    raise ValueError(message)


def fetch(row, cache):
    path = cache / row["file"]
    algorithm = "sha512" if "sha512" in row else "sha256"
    if path.exists():
        if digest(path, algorithm) != row[algorithm]:
            fail("Cached source digest mismatch: " + path.name)
        return path
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=path.name + ".", dir=cache, delete=False) as stream:
        temporary = Path(stream.name)
    try:
        subprocess.run(
            [
                "curl",
                "--fail",
                "--location",
                "--retry",
                "2",
                "--connect-timeout",
                "15",
                "--max-time",
                "600",
                "--silent",
                "--show-error",
                "--output",
                str(temporary),
                row["url"],
            ],
            check=True,
        )
        if digest(temporary, algorithm) != row[algorithm]:
            fail("Downloaded source digest mismatch: " + path.name)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def safe_name(name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts or "\\" in name:
        fail("Unsafe archive member")
    return path.as_posix()


def package_elfs(ipk):
    data = ipk.read_bytes()
    if not data.startswith(b"!<arch>\n"):
        fail("Not an IPK")
    offset, payload, seen = 8, None, set()
    while offset < len(data):
        header = data[offset : offset + 60]
        if len(header) != 60 or header[58:] != b"`\n":
            fail("Malformed IPK")
        name = header[:16].decode().strip().rstrip("/")
        size = int(header[48:58])
        if size < 0 or name in seen or offset + 60 + size > len(data):
            fail("Invalid IPK member")
        seen.add(name)
        if name == "data.tar.gz":
            payload = data[offset + 60 : offset + 60 + size]
        offset += 60 + size + size % 2
    if offset != len(data):
        fail("Truncated IPK alignment")
    if payload is None:
        fail("IPK payload missing")
    result = {}
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        for member in archive:
            name = safe_name(member.name)
            if member.isfile():
                content = archive.extractfile(member).read()
                if content.startswith(b"\x7fELF"):
                    base = PurePosixPath(name).name
                    if base in result:
                        fail("Ambiguous ELF basename")
                    result[base] = content
    if not result:
        fail("No native ELF in IPK")
    return result


def runtime_inputs(text, source, sdk):
    rows = set()

    def relative_sdk(path):
        try:
            return Path(path).resolve().relative_to(sdk.resolve()).as_posix()
        except ValueError:
            fail("Runtime input is outside the recorded SDK: " + path)

    for archive, member in re.findall(r"([^\s()]+\.a)\(([^\s()]+)\)", text):
        base = PurePosixPath(archive).name
        if base in RUNTIME:
            rows.add((RUNTIME[base], base, member, relative_sdk(archive)))
        elif str(sdk) in archive or "/sysroot/" in archive:
            fail("Unclassified static SDK archive: " + base)
        elif not (str(source) in archive or archive.startswith(("src/", "vendor/", "rust-modules/"))):
            fail("Unclassified static archive: " + base)
    for obj in re.findall(r"(?:^|\s)([^\s()]+/[^/\s()]+\.o)(?=\s|$)", text, re.MULTILINE):
        base = PurePosixPath(obj).name
        is_startup = base.startswith(("crt", "Scrt"))
        if not is_startup and str(sdk) not in obj and "/sysroot/" not in obj:
            continue
        if base in {"crt1.o", "Scrt1.o", "crti.o", "crtn.o"}:
            rows.add(("glibc-runtime", base, "", relative_sdk(obj)))
        elif re.fullmatch(r"crt(?:begin|end|fastmath)[A-Za-z]*\.o", base):
            rows.add(("gcc-runtime", base, "", relative_sdk(obj)))
        else:
            fail("Unclassified static SDK object: " + base)
    return [{"source": a, "archive_or_object": b, "member": c, "sdk_path": d} for a, b, c, d in sorted(rows)]


def attest_sdk(args, evidence):
    spec = json.loads((args.source / "ci/ottplay-integration/upstream.json").read_text())["sdk"]
    allowed = {v["sha256"]: host for host, v in spec["assets"].items()}
    candidates = (
        [args.sdk_archive]
        if args.sdk_archive
        else sorted(
            set((args.source.parent / "downloads").glob("**/*.tar.bz2"))
            | set((args.sdk.parent / "downloads").glob("**/*.tar.bz2"))
        )
    )
    archive_path = None
    for candidate in candidates:
        archive_hash = digest(candidate)
        if archive_hash in allowed:
            archive_path = candidate
            break
    if archive_path is None:
        fail("Pinned SDK archive required: pass --sdk-archive or preserve bootstrap downloads")
    inputs = {row["sdk_path"] for item in evidence.values() for row in item["runtime_inputs"]}
    if not inputs:
        fail("No SDK runtime inputs were identified in the final link evidence")
    hashes = {path: digest(args.sdk / path) for path in inputs}
    pending = set(inputs)
    prefix = spec["directory"] + "/"
    with tarfile.open(archive_path, "r|*") as archive:
        for member in archive:
            name = member.name.removeprefix("./")
            if not name.startswith(prefix) or name[len(prefix) :] not in pending:
                continue
            path = name[len(prefix) :]
            if not member.isfile():
                fail("SDK runtime archive member is not a regular file: " + path)
            if hashlib.sha256(archive.extractfile(member).read()).hexdigest() != hashes[path]:
                fail("Linked SDK runtime differs from pinned archive: " + path)
            pending.remove(path)
            if not pending:
                break
    if pending:
        fail("SDK runtime input absent from pinned archive: " + ", ".join(sorted(pending)))
    return {
        "version": spec["version"],
        "host": allowed[archive_hash],
        "archive_sha256": archive_hash,
        "runtime_files_sha256": hashes,
        "runtime_archive_match": "PASS",
    }


def link_evidence(elfs, source, sdk):
    result, files, needed = {}, {}, set()
    readelf = sdk / "bin/arm-webos-linux-gnueabi-readelf"
    with tempfile.TemporaryDirectory(prefix="webos-elf-evidence-") as directory:
        for name, binary in sorted(elfs.items()):
            base = source / "pkg/link-evidence/stable" / name
            record = json.loads(Path(str(base) + ".link.json").read_text())
            link_map = Path(str(base) + ".link.map").read_bytes()
            trace = Path(str(base) + ".link.trace").read_bytes()
            for key, data in (("elf_sha256", binary), ("map_sha256", link_map), ("trace_sha256", trace)):
                if record.get(key) != hashlib.sha256(data).hexdigest():
                    fail("Link evidence differs from shipped ELF: " + name)
            if not record.get("archive_excluded") or b"libglibc_polyfills" in link_map + trace:
                fail("Unlicensed runtime archive was not excluded")
            path = Path(directory) / name
            path.write_bytes(binary)
            dynamic = subprocess.check_output([str(readelf), "-dW", str(path)], text=True)
            headers = subprocess.check_output([str(readelf), "-lW", str(path)], text=True)
            dependencies = re.findall(r"\(NEEDED\).*?\[([^\]]+)\]", dynamic)
            needed.update(dependencies)
            record["needed"] = dependencies
            record["interpreter"] = re.findall(r"Requesting program interpreter: ([^\]]+)", headers)
            record["runtime_inputs"] = runtime_inputs((link_map + trace).decode(errors="replace"), source, sdk)
            for suffix, content in (("map", link_map), ("trace", trace)):
                for old, new in (
                    (str(source), "/build/ottplay-native"),
                    (str(sdk), "/build/webos-sdk"),
                    (str(Path.home()), "/home/build"),
                ):
                    content = content.replace(old.encode(), new.encode())
                files["evidence/" + name + ".link." + suffix] = content
                record["distributed_" + suffix + "_sha256"] = hashlib.sha256(content).hexdigest()
            record["evidence_transformation"] = (
                "source, SDK and user-home paths normalized; original byte digests retained"
            )
            result[name] = record
            files["evidence/" + name + ".readelf.txt"] = (dynamic + "\n" + headers).encode()
    unknown = sorted(name for name in needed if name not in elfs and not SYSTEM.fullmatch(name))
    if unknown:
        fail("Unclassified runtime shared libraries: " + ", ".join(unknown))
    return result, files, sorted(needed - elfs.keys())


def append_file(archive, name, data):
    entry = tarfile.TarInfo(safe_name(name))
    entry.size = len(data)
    entry.mode = 0o644
    entry.mtime = 0
    archive.addfile(entry, io.BytesIO(data))


def collect(args):
    spec = json.loads(MANIFEST.read_text())
    metadata = json.loads(args.metadata.read_text())
    ipk = args.metadata.with_suffix(".ipk")
    primary = args.metadata.parent / metadata["corresponding_source"]["file"]
    if digest(ipk) != metadata["sha256"] or digest(primary) != metadata["corresponding_source"]["sha256"]:
        fail("IPK or primary source changed after validation")
    evidence, extra, system = link_evidence(package_elfs(ipk), args.source, args.sdk)
    sdk_attestation = attest_sdk(args, evidence)
    sources = []
    for row in spec["inputs"]:
        path = fetch(row, args.cache)
        sources.append(dict(row, sha256=digest(path), bytes=path.stat().st_size))
        with tarfile.open(path, "r:*") as archive:
            root = archive.getmembers()[0].name.split("/")[0]
            for license_name in row["licenses"]:
                content = archive.extractfile(root + "/" + license_name).read()
                extra["licenses/" + row["id"] + "/" + license_name] = content
    closure = {
        "schema": 1,
        "ipk": {"file": ipk.name, "sha256": digest(ipk)},
        "primary_source": {
            "file": primary.name,
            "sha256": digest(primary),
            "snapshot_sha256": metadata["corresponding_source"]["snapshot_sha256"],
        },
        "source_inputs": sources,
        "sdk_recipe_reference": spec["sdk_recipe_reference"],
        "sdk_attestation": sdk_attestation,
        "application_build": metadata["build"],
        "shipped_elfs": evidence,
        "system_libraries": {
            "sonames": system,
            "distribution": "not copied into IPK or source supplement",
            "classification": "firmware OS graphics, media, window, C/C++ and loader interfaces; upstream GPL section 1 System Library basis",
            "basis": "Primary source LICENSING.md and THIRD-PARTY-NOTICES.md, GNU GPL v3 section 1. This is an explicit distribution classification, not a new license grant.",
        },
        "runtime_source_coverage": "PASS",
        "link_evidence_binding": "PASS",
        "primary_scope_gaps": {
            "glibc/GCC runtime source closure": "Sources and exact Buildroot recipes supplied in this supplement, bound to linked inputs",
            "LG firmware/sysroot": "Referenced, not redistributed; explicit firmware System Library classification recorded",
        },
        "independent_rebuild": "NOT_RUN",
        "bit_identical_rebuild": "NOT_PROVEN",
    }
    extra["RUNTIME-SOURCE-MANIFEST.json"] = canonical(closure)
    extra["tools/webos-runtime-sources.py"] = Path(__file__).read_bytes()
    extra["tools/webos-runtime-sources.json"] = MANIFEST.read_bytes()
    extra["README.txt"] = (HERE / "webos-runtime-sources.README.txt").read_bytes()
    extra["tools/webos-runtime-sources.README.txt"] = extra["README.txt"]
    output = args.metadata.with_name(args.metadata.stem + "-runtime-source.tar.gz")
    with (
        output.open("wb") as raw,
        gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0) as compressed,
        tarfile.open(fileobj=compressed, mode="w|") as archive,
    ):
        for name, content in sorted(extra.items()):
            append_file(archive, name, content)
        for row in sources:
            path = args.cache / row["file"]
            entry = tarfile.TarInfo("sources/" + path.name)
            entry.size, entry.mode, entry.mtime = path.stat().st_size, 0o644, 0
            with path.open("rb") as stream:
                archive.addfile(entry, stream)
    source_set = {
        "schema": 1,
        "ipk": closure["ipk"],
        "source_archives": [closure["primary_source"], {"file": output.name, "sha256": digest(output)}],
        "runtime_source_coverage": "PASS",
        "link_evidence_binding": "PASS",
        "independent_rebuild": "NOT_RUN",
    }
    receipt = args.metadata.with_name(args.metadata.stem + "-source-set.json")
    receipt.write_bytes(canonical(source_set))
    print(receipt)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--metadata", required=True, type=Path, help="Native IPK metadata after primary source collection"
    )
    parser.add_argument("--source", required=True, type=Path, help="Exact native source holding link evidence")
    parser.add_argument("--sdk", required=True, type=Path)
    parser.add_argument("--sdk-archive", type=Path, help="Original pinned SDK archive, if outside bootstrap downloads")
    parser.add_argument("--cache", type=Path)
    args = parser.parse_args()
    args.metadata = args.metadata.resolve()
    args.source, args.sdk = args.source.resolve(), args.sdk.resolve()
    args.cache = (args.cache or args.source.parent / "runtime-sources-cache").resolve()
    collect(args)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit("Runtime source collection failed: " + str(error)) from error
