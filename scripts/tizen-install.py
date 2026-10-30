#!/usr/bin/env python3
"""Verify, locally sign and explicitly install an OTT-play Samsung TV package.

Uses only Python's standard library and an existing official Tizen CLI. The
published WGT is unsigned; a Samsung certificate profile remains on this PC.
Verification is portable. Signing and installation support macOS and Linux;
on Windows use the official Tizen Studio and Samsung Certificate Manager.
"""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

APP_ID = 'OttPlayFss.Player'
PACKAGE_ID = 'OttPlayFss'
PROFILE = 'tv-samsung'
REQUIRED_VERSION = '5.5'
UNSIGNED_NAME = 'ottplay-foss-tizen-unsigned.wgt'
METADATA_NAME = 'ottplay-foss-tizen.json'
CHECKSUM_NAME = 'ottplay-foss-tizen.sha256'
SIGNED_NAME = 'ottplay-foss-tizen-signed.wgt'
RECEIPT_NAME = 'ottplay-foss-tizen-signed.json'
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_UNPACKED = 128 * 1024 * 1024
MAX_ENTRIES = 10000
IDENTITY_KEYS = ('buildNumber', 'local', 'packageVersion', 'planSha256',
                 'releaseTag', 'source', 'tizenVersion')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_regular(path, limit=MAX_ARCHIVE):
    path = Path(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink(),
            'Expected a regular file: ' + str(path))
    require(0 < info.st_size <= limit, 'File exceeds bounded size: ' + str(path))
    data = path.read_bytes()
    require(len(data) == info.st_size, 'File changed while reading')
    return data


def safe_name(name):
    require(isinstance(name, str) and 0 < len(name) <= 512,
            'Invalid package path')
    require(re.fullmatch(r'[A-Za-z0-9@._/-]+', name) is not None,
            'Nonportable package path')
    require(not name.startswith('/') and all(
        part not in ('', '.', '..') and not part.endswith(('.', ' '))
        for part in name.split('/')), 'Unsafe package path')
    require(PurePosixPath(name).as_posix() == name, 'Unnormalized package path')
    return name


def private_name(name):
    parts = name.lower().split('/')
    return (any(part.startswith('.') for part in parts)
            or name.lower().endswith(('.p12', '.pfx', '.pem', '.key', '.csr', '.crt', '.cer'))
            or parts[-1] in ('profiles.xml', 'author.xml', 'distributor.xml'))


def signature_name(name):
    return name == 'author-signature.xml' or re.fullmatch(r'signature[1-9][0-9]*\.xml', name) is not None


def zip_files(data):
    require(len(data) <= MAX_ARCHIVE, 'Package exceeds size limit')
    result, seen, total = {}, set(), 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        require(0 < len(infos) <= MAX_ENTRIES, 'Invalid archive entry count')
        for info in infos:
            require(info.orig_filename == info.filename, 'NUL in package path')
            directory = info.is_dir()
            name = safe_name(info.filename[:-1] if directory else info.filename)
            require(name.casefold() not in seen, 'Duplicate package path')
            seen.add(name.casefold())
            kind = stat.S_IFMT(info.external_attr >> 16)
            require(kind in ((0, stat.S_IFDIR) if directory else (0, stat.S_IFREG)),
                    'Links and special files are not allowed')
            require(not info.flag_bits & 1, 'Encrypted archives are not supported')
            require(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                    'Unsupported ZIP compression')
            total += info.file_size
            require(0 <= info.file_size <= MAX_UNPACKED and total <= MAX_UNPACKED,
                    'Unpacked package exceeds size limit')
            if directory:
                require(info.file_size == 0, 'Directory entry contains data')
            else:
                require(not private_name(name), 'Private signing/configuration file in package')
                with archive.open(info) as source:
                    payload = source.read(info.file_size + 1)
                require(len(payload) == info.file_size, 'Incorrect ZIP entry length')
                result[name] = payload
    return result


def write_zip(files):
    """Deterministic unsigned ZIP writer shared with the repository packager."""
    require(0 < len(files) <= MAX_ENTRIES, 'Invalid package file count')
    output, total, seen = io.BytesIO(), 0, set()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED,
                         compresslevel=9, allowZip64=False) as archive:
        for name, payload in sorted(files.items()):
            safe_name(name)
            require(name.casefold() not in seen and not private_name(name),
                    'Invalid or private package path')
            require(not signature_name(name), 'Unsigned package contains a signature')
            seen.add(name.casefold())
            total += len(payload)
            require(total <= MAX_UNPACKED, 'Unpacked package exceeds size limit')
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, payload, compresslevel=9)
    data = output.getvalue()
    require(len(data) <= MAX_ARCHIVE, 'Package exceeds size limit')
    return data


def version_for(build):
    require(type(build) is int and 0 <= build <= 999999999, 'Invalid build number')
    return '{}.{}.{}'.format(1 + build // 16777216, (build // 65536) % 256, build % 65536)


def verify_identity(meta):
    require(type(meta.get('local')) is bool, 'Missing package identity')
    require(re.fullmatch(r'[0-9a-f]{40}', meta.get('source', '')) is not None,
            'Invalid source revision')
    require(re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?', meta.get('packageVersion', '')) is not None,
            'Invalid package version')
    require(meta.get('tizenVersion') == version_for(meta.get('buildNumber')), 'Invalid Tizen version')
    if meta['local']:
        require(meta['buildNumber'] == 0 and meta.get('planSha256') == ''
                and meta.get('releaseTag') == '', 'Invalid local identity')
    else:
        require(meta['buildNumber'] > 0 and re.fullmatch(r'[0-9a-f]{64}', meta.get('planSha256', '')) is not None,
                'Invalid release plan identity')
        require(re.fullmatch(r'v\d+\.\d+\.\d+(?:-(?:beta|rc)\.[1-9]\d*|-nightly\.\d{14}\.[1-9]\d*\.[1-9]\d*)?', meta.get('releaseTag', '')) is not None,
                'Invalid release tag')


def verify_config(files, meta):
    require('config.xml' in files and len(files['config.xml']) <= 16384,
            'Missing or oversized application configuration')
    xml = files['config.xml']
    require(b'<!DOCTYPE' not in xml.upper() and b'<!ENTITY' not in xml.upper(), 'XML declarations are not allowed')
    config = ET.fromstring(xml)
    widget = '{http://www.w3.org/ns/widgets}'
    tizen = '{http://tizen.org/ns/widgets}'
    require(config.tag == widget + 'widget' and config.get('version') == meta['tizenVersion'],
            'Invalid widget identity')
    app = config.findall(tizen + 'application')
    require(len(app) == 1 and app[0].get('id') == APP_ID and app[0].get('package') == PACKAGE_ID
            and app[0].get('required_version') == REQUIRED_VERSION, 'Invalid TV application identity')
    require([item.get('name') for item in config.findall(tizen + 'profile')] == [PROFILE],
            'Package is not a Samsung TV profile')
    require([item.get('src') for item in config.findall(widget + 'content')] == ['index.html'],
            'Application must use the bundled entry point')
    require([item.get('src') for item in config.findall(widget + 'icon')] == ['icon.png'],
            'Invalid application icon')
    privileges = sorted(item.get('name', '') for item in config.findall(tizen + 'privilege'))
    require(privileges == ['http://tizen.org/privilege/internet', 'http://tizen.org/privilege/tv.inputdevice'],
            'Unexpected application privileges')


def verify_unsigned(package, metadata, checksum=None):
    data = read_regular(package)
    meta = json.loads(read_regular(metadata, 4 * 1024 * 1024))
    verify_identity(meta)
    require(meta.get('schema') == 1 and meta.get('unsigned') is True,
            'Not an unsigned OTT-play release package')
    require(meta.get('appId') == APP_ID and meta.get('packageId') == PACKAGE_ID
            and meta.get('profile') == PROFILE and meta.get('requiredVersion') == REQUIRED_VERSION,
            'Unexpected TV package')
    require(meta.get('sha256') == digest(data) and meta.get('bytes') == len(data),
            'WGT differs from release metadata')
    require(meta.get('installerSha256') == digest(read_regular(__file__, 1024 * 1024)),
            'Installer helper differs from the release metadata')
    if checksum is not None:
        require(read_regular(checksum, 1024).decode('ascii').strip() == digest(data) + '  ' + UNSIGNED_NAME,
                'WGT differs from checksum')
    files = zip_files(data)
    require(not any(signature_name(name) for name in files), 'Published WGT must be unsigned')
    require(data.startswith(b'PK\x03\x04') and data[-22:-18] == b'PK\x05\x06'
            and data[-2:] == b'\x00\x00', 'Unsigned package has unexpected archive framing')
    entries = meta.get('entries')
    require(isinstance(entries, list) and len(entries) == len(files), 'Incorrect file inventory')
    expected = [{'path': name, 'bytes': len(payload), 'sha256': digest(payload)}
                for name, payload in sorted(files.items())]
    require(entries == expected, 'WGT payload differs from inventory')
    require({'index.html', 'icon.png', 'config.xml', 'build-info.json', 'tizen-build-info.json',
             'dist/player.js', 'js/runtime-polyfills.js'}.issubset(files), 'Incomplete player package')
    build = json.loads(files['tizen-build-info.json'])
    require(build == {key: meta[key] for key in IDENTITY_KEYS}, 'Embedded release identity mismatch')
    classic = json.loads(files['build-info.json'])
    require(classic.get('revision') == meta['source'] and classic.get('version') == meta['packageVersion'],
            'Bundled player source/version mismatch')
    require(classic.get('bundleSha256') == digest(files['dist/player.js']), 'Bundled player hash mismatch')
    for field in ('providerBundles', 'optionalBundles'):
        require(isinstance(classic.get(field), dict), 'Missing classic bundle inventory')
        for entry in classic[field].values():
            require(isinstance(entry, dict) and entry.get('file') in files, 'Missing classic bundle')
            require(entry.get('sha256') == digest(files[entry['file']]), 'Classic bundle hash mismatch')
    verify_config(files, meta)
    return meta, files


def verify_signed(unsigned_files, signed):
    data = read_regular(signed)
    files = zip_files(data)
    signatures = {name: value for name, value in files.items() if signature_name(name)}
    require('author-signature.xml' in signatures and 'signature1.xml' in signatures
            and len(signatures) <= 17, 'Samsung author/distributor signatures are missing')
    for payload in signatures.values():
        require(0 < len(payload) <= 1024 * 1024 and b'<!DOCTYPE' not in payload.upper()
                and b'<!ENTITY' not in payload.upper(), 'Invalid signature document')
        require(ET.fromstring(payload).tag == '{http://www.w3.org/2000/09/xmldsig#}Signature',
                'Invalid signature XML')
    require({name: value for name, value in files.items() if name not in signatures} == unsigned_files,
            'Signing changed the verified player payload')
    return data


def tool_path(value):
    found = shutil.which(value)
    require(found is not None, 'Tizen CLI not found; install the official SDK and configure a Samsung certificate profile')
    return found


def require_sdk_host():
    require(os.name == 'posix' and sys.platform in ('darwin', 'linux'),
            'This helper supports signing and installation on macOS and Linux only. '
            'On Windows use official Tizen Studio and Samsung Certificate Manager; '
            'the verify command remains available.')


def run_tool(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, encoding='utf-8',
                                errors='replace', timeout=180, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ValueError('Tizen CLI timed out; no successful installation was recorded') from exc
    guidance = ('check the author/distributor profile and target DUID in Samsung Certificate Manager'
                if args[1] == 'package' else
                'check the selected target connection in Device Manager and the certificate/DUID match')
    require(result.returncode == 0,
            'Tizen CLI failed (exit {}); {}. Use the official SDK for detailed diagnostics.'.format(
                result.returncode, guidance))
    return result.stdout + '\n' + result.stderr


def sign_package(package, metadata, checksum, output, profile, tizen='tizen'):
    require_sdk_host()
    require(isinstance(profile, str) and 0 < len(profile) <= 128 and not profile.startswith('-')
            and not any(ord(c) < 32 for c in profile),
            'Invalid certificate profile name')
    meta, files = verify_unsigned(package, metadata, checksum)
    output = Path(output)
    require(not output.exists() and not output.is_symlink(), 'Signed output directory already exists')
    require(output.parent.is_dir(), 'Signed output parent directory must exist')
    cli = tool_path(tizen)
    with tempfile.TemporaryDirectory(prefix='ottplay-tizen-sign-') as temporary:
        stage, packaged = Path(temporary) / 'app', Path(temporary) / 'signed'
        stage.mkdir()
        packaged.mkdir()
        for name, payload in files.items():
            destination = stage.joinpath(*PurePosixPath(name).parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('xb') as handle:
                handle.write(payload)
        run_tool([cli, 'package', '-t', 'wgt', '-s', profile, '-o', str(packaged), '--', str(stage)])
        candidates = list(packaged.glob('*.wgt'))
        require(len(candidates) == 1, 'Tizen CLI must produce exactly one signed WGT')
        signed = verify_signed(files, candidates[0])
        receipt = {'schema': 1, 'appId': APP_ID, 'source': meta['source'],
                   'packageVersion': meta['packageVersion'], 'tizenVersion': meta['tizenVersion'],
                   'unsignedSha256': meta['sha256'], 'signedSha256': digest(signed),
                   'signedBytes': len(signed), 'profile': profile,
                   'verification': 'Payload unchanged; signature presence checked. The device validates certificate trust.'}
        output.mkdir(mode=0o700)
        try:
            with (output / SIGNED_NAME).open('xb') as handle:
                handle.write(signed)
            with (output / RECEIPT_NAME).open('x', encoding='utf-8') as handle:
                json.dump(receipt, handle, indent=2)
                handle.write('\n')
        except BaseException:
            shutil.rmtree(output)
            raise
    return receipt


def install_package(package, metadata, checksum, signed, target, tizen='tizen'):
    require_sdk_host()
    require(isinstance(target, str) and 0 < len(target) <= 128 and not target.startswith('-')
            and not any(ord(c) < 32 for c in target), 'Invalid explicit device target')
    meta, files = verify_unsigned(package, metadata, checksum)
    signed = Path(signed)
    require(signed.is_dir() and not signed.is_symlink(), 'Expected signed output directory')
    data = verify_signed(files, signed / SIGNED_NAME)
    receipt = json.loads(read_regular(signed / RECEIPT_NAME, 16384))
    require(receipt.get('schema') == 1 and receipt.get('appId') == APP_ID
            and receipt.get('source') == meta['source']
            and receipt.get('packageVersion') == meta['packageVersion']
            and receipt.get('tizenVersion') == meta['tizenVersion']
            and receipt.get('unsignedSha256') == meta['sha256']
            and receipt.get('signedSha256') == digest(data)
            and receipt.get('signedBytes') == len(data), 'Signed receipt does not match these packages')
    # Install the bytes just verified, even if the user's signed directory is
    # subsequently replaced by another build while the SDK command is running.
    with tempfile.TemporaryDirectory(prefix='ottplay-tizen-install-') as temporary:
        verified = Path(temporary) / SIGNED_NAME
        with verified.open('xb') as handle:
            handle.write(data)
        text = run_tool([tool_path(tizen), 'install', '-n', SIGNED_NAME, '-t', target, '--', temporary])
    require(re.search(r'\b(?:error|failed|failure)\b', text, re.I) is None
            and re.search(r'\b(?:install(?:ation)?\s+(?:is\s+)?completed|successfully\s+installed|installed\s+successfully)\b', text, re.I) is not None,
            'Tizen CLI did not confirm successful installation. Check the TV state and use '
            'the official SDK installation operation for detailed diagnostics.')
    return {'appId': APP_ID, 'target': target, 'tizenVersion': meta['tizenVersion'], 'installed': True}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', default=str(Path(__file__).resolve().parent / UNSIGNED_NAME))
    parser.add_argument('--metadata', default=str(Path(__file__).resolve().parent / METADATA_NAME))
    parser.add_argument('--checksum', default=str(Path(__file__).resolve().parent / CHECKSUM_NAME))
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('verify', help='Verify the downloaded unsigned release payload')
    sign = commands.add_parser('sign', help='Use an existing Samsung certificate profile locally (macOS/Linux)')
    sign.add_argument('--profile', required=True)
    sign.add_argument('--output', required=True, help='New directory for the signed WGT and local receipt')
    sign.add_argument('--tizen', default='tizen')
    install = commands.add_parser('install', help='Install a verified signed payload to one selected TV (macOS/Linux)')
    install.add_argument('--signed', required=True)
    install.add_argument('--target', required=True)
    install.add_argument('--tizen', default='tizen')
    args = parser.parse_args(argv)
    if args.command == 'verify':
        meta, _ = verify_unsigned(args.package, args.metadata, args.checksum)
        result = {key: meta[key] for key in ('appId', 'source', 'packageVersion', 'tizenVersion', 'unsigned', 'sha256')}
    elif args.command == 'sign':
        result = sign_package(args.package, args.metadata, args.checksum, args.output, args.profile, args.tizen)
    else:
        result = install_package(args.package, args.metadata, args.checksum, args.signed, args.target, args.tizen)
    print(json.dumps(result, indent=2))
    return result


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        print('Tizen delivery failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
