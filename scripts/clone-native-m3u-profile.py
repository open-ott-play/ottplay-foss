#!/usr/bin/env python3
"""Prepare/review/apply one guarded native M3U slot clone; never print profile secrets."""
import argparse
from contextlib import contextmanager, closing
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import sqlite3
import subprocess

KEY = 'm3um3uArr'
IDS = ('ott_device_uuid', 'deviceId', 'sDeviceUuid')


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def fingerprint(db):
    return {suffix: digest(Path(str(db) + suffix)) for suffix in ('', '-wal')}


@contextmanager
def connect(db, readonly=False):
    connection = sqlite3.connect(db.as_uri() + ('?mode=ro' if readonly else '?mode=rw'), uri=True)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def rows(db):
    with connect(db, True) as connection:
        return dict(connection.execute('SELECT key,value FROM ItemTable'))


def decode(value):
    require(isinstance(value, bytes), 'Expected native UTF-16 BLOB value')
    return value.decode('utf-16-le')


def validate_identity(values, expected):
    require(all(decode(values.get(key)) == expected for key in IDS), 'Device identity does not match')


def candidate(values, source, target, url, name):
    old = values[KEY]
    config = json.loads(decode(old))
    slots = config.get('M3Us')
    require(isinstance(slots, list) and len(slots) == 15, 'Expected fifteen M3U slots')
    require(1 <= source <= 15 and 1 <= target <= 15 and source != target, 'Invalid slot numbers')
    require(config.get('active') != target - 1, 'Target slot must be inactive')
    require(isinstance(slots[target-1], dict) and not any(slots[target-1].get(k) for k in ('www', 'medUrl', 'medSourceId', 'name')), 'Target slot is not empty')
    from urllib.parse import urlsplit
    endpoint = urlsplit(url)
    require(endpoint.scheme == 'http' and endpoint.hostname in ('127.0.0.1', '::1') and not endpoint.username and not endpoint.password and not endpoint.query and not endpoint.fragment, 'Expected a private loopback profile URL')
    require(not any(c.isspace() for c in url), 'Invalid profile URL')
    import re
    require(re.fullmatch(r'/normalize/profile/[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{32,128}/index\.m3u', endpoint.path), 'Expected a fixed authenticated profile URL')
    clone = json.loads(json.dumps(slots[source-1]))
    clone.update(name=name, www=url)
    slots[target-1] = clone
    return old, json.dumps(config, ensure_ascii=False, separators=(',', ':')).encode('utf-16-le')


def private_file(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(content)


def validate_app(app, bundle):
    require(app.is_dir(), 'App bundle is missing')
    with (app / 'Contents/Info.plist').open('rb') as stream:
        require(plistlib.load(stream).get('CFBundleIdentifier') == bundle, 'App bundle identity mismatch')


def closed(app, db):
    commands = subprocess.run(['ps', '-axo', 'comm='], check=True, capture_output=True, text=True).stdout.splitlines()
    require(not any(line.strip().startswith(str(app) + '/') for line in commands), 'Close the target player first')
    for path in (db, Path(str(db)+'-wal'), Path(str(db)+'-shm')):
        if not path.exists():
            continue
        result = subprocess.run(['lsof', '-t', '--', str(path)], capture_output=True, text=True)
        require(result.returncode in (0, 1), 'Cannot verify database file ownership')
        require(not result.stdout.strip(), 'A process still holds the target database')


def backup(db, destination):
    private_file(destination, b'')
    with connect(db, True) as source, closing(sqlite3.connect(destination)) as target:
        source.backup(target)
    os.chmod(destination, 0o600)


def verify_edit(before, after, old, new):
    require(before[KEY] == old and after[KEY] == new, 'Profile value verification failed')
    require({k:v for k,v in before.items() if k != KEY} == {k:v for k,v in after.items() if k != KEY}, 'Unrelated storage rows changed')
    a, b = json.loads(decode(old)), json.loads(decode(new))
    changed = [i for i, pair in enumerate(zip(a['M3Us'], b['M3Us'])) if pair[0] != pair[1]]
    require(len(changed) == 1 and {k:v for k,v in a.items() if k != 'M3Us'} == {k:v for k,v in b.items() if k != 'M3Us'}, 'Unexpected profile slots or selection changed')


def prepare(args):
    db, app, work = args.database.resolve(), args.app.resolve(), args.work.resolve()
    validate_app(app, args.bundle)
    require(not work.exists(), 'Use a new private work directory')
    url = args.url_file.read_text().strip()
    require(args.url_file.stat().st_mode & 0o077 == 0, 'URL file must be private')
    work.mkdir(mode=0o700, parents=True)
    baseline = fingerprint(db)
    backup(db, work/'original.sqlite3')
    require(fingerprint(db) == baseline, 'Database changed during snapshot; prepare again')
    before = rows(work/'original.sqlite3')
    validate_identity(before, args.uuid)
    old, new = candidate(before, args.source, args.target, url, args.name)
    shutil.copyfile(work/'original.sqlite3', work/'candidate.sqlite3')
    os.chmod(work/'candidate.sqlite3', 0o600)
    with connect(work/'candidate.sqlite3') as connection:
        require(connection.execute('UPDATE ItemTable SET value=? WHERE key=? AND value=?', (new,KEY,old)).rowcount == 1, 'Candidate update failed')
    verify_edit(before, rows(work/'candidate.sqlite3'), old, new)
    with connect(work/'candidate.sqlite3') as connection:
        require(connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'Candidate integrity failed')
        connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    plan = dict(version=1, database=str(db), app=str(app), bundle=args.bundle, uuid=args.uuid, source=args.source, target=args.target, fingerprint=baseline, original_sha256=digest(work/'original.sqlite3'), candidate_sha256=digest(work/'candidate.sqlite3'))
    private_file(work/'plan.json', (json.dumps(plan, indent=2)+'\n').encode())
    print(f'Prepared and verified slot {args.source} → {args.target}; active selection and other rows unchanged. Plan: {work / "plan.json"}')


def apply(args):
    work = args.plan.resolve().parent
    require(args.plan.stat().st_mode & 0o077 == 0 and work.stat().st_mode & 0o077 == 0, 'Plan directory must remain private')
    plan = json.loads(args.plan.read_text())
    require(plan.get('version') == 1, 'Unsupported plan')
    db, app = Path(plan['database']), Path(plan['app'])
    validate_app(app, plan['bundle'])
    closed(app, db)
    require(fingerprint(db) == plan['fingerprint'], 'Database changed since prepare; prepare again')
    require(digest(work/'original.sqlite3') == plan['original_sha256'] and digest(work/'candidate.sqlite3') == plan['candidate_sha256'], 'Review artifacts changed')
    original, proposed = rows(work/'original.sqlite3'), rows(work/'candidate.sqlite3')
    validate_identity(original, plan['uuid'])
    old, new = original[KEY], proposed[KEY]
    verify_edit(original, proposed, old, new)
    old_config, new_config = json.loads(decode(old)), json.loads(decode(new))
    require([i for i in range(15) if old_config['M3Us'][i] != new_config['M3Us'][i]] == [plan['target']-1], 'Planned target mismatch')
    require(json.loads(decode(old))['M3Us'][plan['source']-1] == json.loads(decode(new))['M3Us'][plan['source']-1], 'Source profile changed')
    backup(db, work/'before-apply.sqlite3')
    require(rows(work/'before-apply.sqlite3') == original, 'Live storage changed before transaction')
    closed(app, db)
    with connect(db) as connection:
        connection.execute('BEGIN IMMEDIATE')
        live = dict(connection.execute('SELECT key,value FROM ItemTable'))
        require(live == original, 'Storage changed before write')
        require(connection.execute('UPDATE ItemTable SET value=? WHERE key=? AND value=?', (new,KEY,old)).rowcount == 1, 'Conditional update failed')
        after = dict(connection.execute('SELECT key,value FROM ItemTable'))
        verify_edit(original, after, old, new)
        require(connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'Database integrity failed')
    require(rows(db) == proposed, 'Committed storage verification failed')
    private_file(work/'applied.json', (json.dumps({'applied': True, 'source':plan['source'],'target':plan['target']})+'\n').encode())
    print(f'Applied slot {plan["target"]}; original slot and active selection unchanged. Rollback snapshot: {work / "before-apply.sqlite3"}')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    subs=parser.add_subparsers(dest='command',required=True)
    p=subs.add_parser('prepare')
    p.add_argument('--database',type=Path,required=True);p.add_argument('--app',type=Path,required=True)
    p.add_argument('--bundle',default='com.ottplay.foss.inst4');p.add_argument('--uuid',required=True)
    p.add_argument('--source',type=int,default=1);p.add_argument('--target',type=int,default=3)
    p.add_argument('--name',default='Local 3');p.add_argument('--url-file',type=Path,required=True);p.add_argument('--work',type=Path,required=True)
    p=subs.add_parser('apply');p.add_argument('--plan',type=Path,required=True)
    args=parser.parse_args()
    try:
        (prepare if args.command=='prepare' else apply)(args)
    except (RuntimeError, OSError, ValueError, sqlite3.Error, KeyError, TypeError):
        raise SystemExit('Migration stopped: validation, storage, identity or closed-player guard failed; no secret values printed.') from None


if __name__=='__main__':
    main()
