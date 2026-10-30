#!/usr/bin/env python3
"""Cross-build the loopback companion with an explicitly supplied webOS SDK."""
import argparse
import os
from pathlib import Path
import shlex
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", type=Path, required=True)
    parser.add_argument("--libclang", type=Path)
    parser.add_argument("--target-dir", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    sdk = args.sdk.resolve(strict=True)
    sysroot = (sdk / "arm-webos-linux-gnueabi/sysroot").resolve(strict=True)
    output = (args.target_dir or root / "target").resolve()
    target = "armv7-unknown-linux-gnueabi"
    key = target.replace("-", "_")
    environment = os.environ.copy()
    for name, tool in (("CC", "gcc"), ("CXX", "g++"), ("AR", "ar")):
        executable = sdk / ("bin/arm-webos-linux-gnueabi-" + tool)
        if not executable.is_file():
            parser.error("SDK compiler or archiver is missing")
        environment[name + "_" + key] = str(executable)
    environment["CARGO_TARGET_DIR"] = str(output)
    environment["CARGO_TARGET_ARMV7_UNKNOWN_LINUX_GNUEABI_LINKER"] = environment["CC_" + key]
    environment["CFLAGS_" + key] = shlex.join(["--sysroot=" + str(sysroot)])
    environment["CXXFLAGS_" + key] = environment["CFLAGS_" + key]
    environment["BINDGEN_EXTRA_CLANG_ARGS_" + key] = environment["CFLAGS_" + key]
    if args.libclang:
        environment["LIBCLANG_PATH"] = str(args.libclang.resolve(strict=True))
    binary = output / target / "release/ottplay-companion"
    linkmap = binary.with_suffix(".link.map")
    flags = [
        "-C", "target-cpu=cortex-a9", "-C", "target-feature=-neon,-soft-float",
        "-C", "force-frame-pointers=yes", "-C", "link-arg=--sysroot=" + str(sysroot),
        "-C", "link-arg=-Wl,-Map=" + str(linkmap),
    ]
    # Encoded flags preserve SDK and output paths containing spaces and override
    # ambient Rust flags for this explicit target build. Host builds are separate.
    environment["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(flags)
    subprocess.run([
        "cargo", "build", "--locked", "--release", "-p", "ottplay-companion",
        "--features", "webos-legacy-glibc", "--target", target,
    ], cwd=root, env=environment, check=True)
    if "libglibc_polyfills" in linkmap.read_text():
        raise RuntimeError("Unexpected SDK compatibility archive in final link map")
    evidence = subprocess.run([
        str(sdk / "bin/arm-webos-linux-gnueabi-readelf"), "--wide", "--file-header",
        "--program-headers", "--dynamic", "--version-info", str(binary),
    ], check=True, capture_output=True, text=True).stdout
    binary.with_suffix(".elf.txt").write_text(evidence)
    print(binary)
    print(evidence)


if __name__ == "__main__":
    main()
