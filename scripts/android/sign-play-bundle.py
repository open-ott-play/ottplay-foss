#!/usr/bin/env python3
"""Sign a copy of an unsigned AAB with a separately configured Play upload key."""

import argparse
import base64
import binascii
import hashlib
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path

SECRETS = (
    "PLAY_UPLOAD_KEYSTORE_BASE64",
    "PLAY_UPLOAD_STORE_PASSWORD",
    "PLAY_UPLOAD_KEY_ALIAS",
    "PLAY_UPLOAD_KEY_PASSWORD",
)


def run(command, **kwargs):
    """Keep tool diagnostics private: keystore paths/aliases are not CI output."""
    child_env = dict(os.environ)
    child_env.pop("PLAY_UPLOAD_KEYSTORE_BASE64", None)
    result = subprocess.run(command, capture_output=True, check=False, env=child_env, **kwargs)
    if result.returncode:
        raise ValueError(f"{Path(command[0]).name} failed; check the upload key and bundle")
    return result.stdout


def sign(source: Path, destination: Path):
    if any(not os.environ.get(name) for name in SECRETS):
        raise ValueError("All four PLAY_UPLOAD signing secrets must be configured")
    if destination.exists():
        raise ValueError("Output already exists; refusing to replace it")
    with zipfile.ZipFile(source) as bundle:
        names = bundle.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate bundle entries")
        if not {"BundleConfig.pb", "base/manifest/AndroidManifest.xml"}.issubset(names):
            raise ValueError("Input is missing the Android App Bundle payload")
        if any(
            name.upper().startswith("META-INF/") and name.upper().endswith((".SF", ".RSA", ".DSA", ".EC"))
            for name in names
        ):
            raise ValueError("Input must be unsigned; do not reuse the direct APK signing key")
    try:
        keystore = base64.b64decode(os.environ[SECRETS[0]], validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Upload keystore is not valid base64") from error
    if not keystore:
        raise ValueError("Upload keystore is empty")
    # TemporaryDirectory is private (0700); no key or certificate is uploaded.
    with tempfile.TemporaryDirectory(prefix="ott-play-upload-", dir=os.environ.get("RUNNER_TEMP")) as temp:
        directory = Path(temp)
        key = directory / "upload.keystore"
        key.write_bytes(keystore)
        key.chmod(0o600)
        certificate = directory / "upload.der"
        certificate.write_bytes(
            run(
                [
                    "keytool",
                    "-exportcert",
                    "-keystore",
                    str(key),
                    "-storepass:env",
                    "PLAY_UPLOAD_STORE_PASSWORD",
                    "-alias",
                    os.environ["PLAY_UPLOAD_KEY_ALIAS"],
                ]
            )
        )
        output = directory / "signed.aab"
        run(
            [
                "jarsigner",
                "-keystore",
                str(key),
                "-storepass:env",
                "PLAY_UPLOAD_STORE_PASSWORD",
                "-keypass:env",
                "PLAY_UPLOAD_KEY_PASSWORD",
                "-digestalg",
                "SHA-256",
                "-signedjar",
                str(output),
                str(source),
                os.environ["PLAY_UPLOAD_KEY_ALIAS"],
            ]
        )
        run(["java", str(Path(__file__).with_name("VerifyUploadBundle.java")), str(output), str(certificate)])
        # Only publish output after every entry's signature and signer match.
        with destination.open("xb") as target:
            target.write(output.read_bytes())
        print("Verified Play upload bundle; certificate SHA256 " + hashlib.sha256(certificate.read_bytes()).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        sign(args.source, args.destination)
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Signing failed: {error}\n")


if __name__ == "__main__":
    main()
