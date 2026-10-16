"""Read-only process mapping probe and bounded post-run evidence archive."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def watch(output):
    output.parent.mkdir(parents=True, exist_ok=True)
    seen = set()
    deadline = time.monotonic() + 200
    with output.open("w") as stream:
        stream.write(json.dumps({"kind": "monitor-start", "intervalSeconds": 1,
                                 "durationLimitSeconds": 200, "recordLimit": 256}) + "\n")
        stream.flush()
        while time.monotonic() < deadline and len(seen) < 256:
            for process in Path("/proc").iterdir():
                if not process.name.isdigit():
                    continue
                try:
                    executable = os.readlink(process / "exe")
                    if not any(name in executable for name in (
                        "WebKitWebProcess", "WebKitNetworkProcess", "MiniBrowser"
                    )):
                        continue
                    for line in (process / "maps").read_text().splitlines():
                        fields = line.split(maxsplit=5)
                        if len(fields) < 6 or not fields[5].startswith("/"):
                            continue
                        library = Path(fields[5])
                        if not re.search(r"lib(?:gst|webkit|WPEWebKit)", library.name, re.I):
                            continue
                        key = (executable, str(library))
                        if key in seen or len(seen) >= 256:
                            continue
                        seen.add(key)
                        record = {
                            "time": time.time(), "pid": int(process.name),
                            "executable": executable, "library": str(library),
                            "sha256": sha256(library),
                        }
                        stream.write(json.dumps(record) + "\n")
                        stream.flush()
                except (OSError, ValueError):
                    continue
            time.sleep(1)
        stream.write(json.dumps({"kind": "monitor-end", "records": len(seen),
                                 "limitReached": len(seen) >= 256}) + "\n")
        stream.flush()


def collect(evidence, results):
    output = evidence / "upload"
    output.mkdir(parents=True, exist_ok=True)
    manifest = []
    total = 0
    file_limit = 8 * 1024 * 1024
    total_limit = 64 * 1024 * 1024
    candidates = []
    for source, prefix in ((evidence / "raw", "runtime"), (results, "results")):
        if source.exists():
            candidates.extend((p, Path(prefix) / p.relative_to(source))
                              for p in sorted(source.rglob("*"))
                              if p.is_file() and not p.is_symlink())
    for index, (source, relative) in enumerate(candidates):
        size = source.stat().st_size
        record = {"path": str(relative), "bytes": size}
        if index >= 128 or total >= total_limit:
            record["omitted"] = "archive count or byte limit"
        else:
            record["sha256"] = sha256(source)
            target = output / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            allowed = min(file_limit, total_limit - total)
            if size <= allowed:
                shutil.copyfile(source, target)
                record["retainedBytes"] = size
                total += size
            elif source.suffix in (".log", ".jsonl", ".txt", ".md"):
                half = allowed // 2
                with source.open("rb") as stream:
                    target.with_name(target.name + ".head").write_bytes(stream.read(half))
                    stream.seek(-half, os.SEEK_END)
                    target.with_name(target.name + ".tail").write_bytes(stream.read(half))
                record.update(truncated=True, retainedBytes=half * 2)
                total += half * 2
            else:
                record["omitted"] = "oversized binary; no corrupt partial archive"
        manifest.append(record)
    (output / "manifest.json").write_text(json.dumps({
        "source": "7ac602c081d2cfac87e5808b7ea21673dc363938",
        "singleInstrumentedDiagnostic": True,
        "passingDoesNotDemonstrateAFix": True,
        "retainedBytes": total, "files": manifest,
    }, indent=2) + "\n")


if __name__ == "__main__":
    if sys.argv[1] == "watch":
        watch(Path(sys.argv[2]))
    elif sys.argv[1] == "collect":
        collect(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        raise SystemExit("expected watch or collect")
