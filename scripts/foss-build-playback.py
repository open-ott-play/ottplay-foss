"""Build two diagnostic playback plugins from the same exact Ubuntu source/toolchain."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import urllib.request

DATA = Path(__file__).resolve().parents[1] / 'diagnostics/gstreamer'
OPTIONS = ['--buildtype=debugoptimized', '--wrap-mode=nodownload', '-Dauto_features=disabled',
           '-Dplayback=enabled', '-Dtests=disabled', '-Dexamples=disabled', '-Dtools=disabled',
           '-Dintrospection=disabled', '-Ddoc=disabled', '-Dpackage-origin=https://gstreamer.freedesktop.org/']


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def run(args, cwd=None, env=None):
    p = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True, timeout=600)
    print(p.stdout, end='', flush=True)
    print(p.stderr, end='', flush=True)
    p.check_returncode()
    return p.stdout


def unpack(archive, destination):
    with tarfile.open(archive) as tar:
        items = tar.getmembers()
        assert len(items) < 10000 and sum(i.size for i in items) < 100 * 1024 * 1024
        seen = set()
        for item in items:
            p = PurePosixPath(item.name)
            assert not p.is_absolute() and '..' not in p.parts and '\\' not in item.name
            assert item.isfile() or item.isdir()
            assert p.as_posix().rstrip('/') not in seen
            seen.add(p.as_posix().rstrip('/'))
        tar.extractall(destination, filter='data')


def inventory(root):
    result = {}
    for p in sorted(root.rglob('*')):
        assert not p.is_symlink()
        if p.is_file():
            result[p.relative_to(root).as_posix()] = sha(p)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--source-cache', type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    source = output / 'corresponding-source'
    source.mkdir()
    manifest = json.loads((DATA / 'provenance.json').read_text())
    for name in ['provenance.json', 'decodebin3-mr7605.patch', 'COPYING']:
        shutil.copyfile(DATA / name, source / name)
    shutil.copyfile(__file__, source / Path(__file__).name)
    for name, digest in manifest['files'].items():
        dest = source / name
        if args.source_cache:
            shutil.copyfile(args.source_cache / name, dest)
        else:
            with urllib.request.urlopen(manifest['archive_base'] + name, timeout=60) as response:
                data = response.read(8 * 1024 * 1024 + 1)
            assert len(data) <= 8 * 1024 * 1024
            dest.write_bytes(data)
        assert sha(dest) == digest, name
    dsc = (source / 'gst-plugins-base1.0_1.24.2-1ubuntu0.5.dsc').read_text()
    for name, digest in manifest['files'].items():
        if name.endswith('.tar.xz'):
            assert re.search(r'^ ' + digest + r' [0-9]+ ' + re.escape(name) + '$', dsc, re.M)
    work = output / 'work'
    work.mkdir()
    unpack(source / 'gst-plugins-base1.0_1.24.2.orig.tar.xz', work)
    stock = work / 'gst-plugins-base-1.24.2'
    unpack(source / 'gst-plugins-base1.0_1.24.2-1ubuntu0.5.debian.tar.xz', work)
    patch_dir = work / 'debian/patches'
    series = [x for x in (patch_dir / 'series').read_text().splitlines() if x and not x.startswith('#')]
    assert len(series) == 15 and all(re.fullmatch(r'[A-Za-z0-9_.-]+', x) for x in series)
    patch_records = []
    for name in series:
        text = run(['patch', '-p1', '--fuzz=0', '--batch', '--forward', '-i', str(patch_dir / name)], cwd=stock)
        assert 'fuzz' not in text.lower() and 'offset' not in text.lower()
        patch_records.append({'name': name, 'sha256': sha(patch_dir / name), 'application': text})
    before = inventory(stock)
    fixed = work / 'fixed'
    shutil.copytree(stock, fixed)
    text = run(['patch', '-p1', '--fuzz=0', '--batch', '--forward', '-i', str(source / 'decodebin3-mr7605.patch')], cwd=fixed)
    assert 'fuzz' not in text.lower() and 'offset' not in text.lower()
    after = inventory(fixed)
    assert before.keys() == after.keys()
    changed = [p for p in before if before[p] != after[p]]
    assert changed == ['gst/playback/gstdecodebin3-parse.c', 'gst/playback/gstdecodebin3.c']
    save(output / 'source-inventories.json', {'stock': before, 'fixed': after, 'changed': changed})
    save(output / 'ubuntu-security-patches.json', patch_records)
    environment = dict(os.environ, CFLAGS='-O2 -g -fstack-protector-strong -D_FORTIFY_SOURCE=2',
                       LDFLAGS='-Wl,-z,relro -Wl,-z,now -Wl,-z,defs')
    result = {'schema': 1, 'diagnosticOnly': True, 'source': manifest,
              'workflowSha': os.environ.get('GITHUB_SHA'), 'runId': os.environ.get('GITHUB_RUN_ID'),
              'runAttempt': os.environ.get('GITHUB_RUN_ATTEMPT'), 'driver_sha256': sha(__file__),
              'patch_sha256': sha(source / 'decodebin3-mr7605.patch'), 'options': OPTIONS,
              'flags': {x: environment[x] for x in ['CFLAGS', 'LDFLAGS']}, 'plugins': {},
              'packages': run(['dpkg-query', '-W']), 'toolchain': {x: run([x, '--version']) for x in ['cc', 'meson', 'ninja', 'patchelf']}}
    for variant, tree in [('stock', stock), ('fixed', fixed)]:
        build = work / ('build-' + variant)
        run(['meson', 'setup', str(build), str(tree), *OPTIONS], env=environment)
        run(['ninja', '-C', str(build), '-j2', 'gst/playback/libgstplayback.so'], env=environment)
        folder = output / variant
        folder.mkdir()
        plugin = folder / 'libgstplayback.so'
        shutil.copyfile(build / 'gst/playback/libgstplayback.so', plugin)
        # Meson embeds build-tree RPATHs. Remove for BOTH arms; only system runtime libraries may load.
        run(['patchelf', '--remove-rpath', str(plugin)])
        dynamic = run(['readelf', '--wide', '--dynamic', str(plugin)])
        assert '(RPATH)' not in dynamic and '(RUNPATH)' not in dynamic
        needed = re.findall(r'\(NEEDED\).*?\[(.*?)\]', dynamic)
        assert needed and all('/' not in x for x in needed)
        result['plugins'][variant] = {'sha256': sha(plugin), 'size': plugin.stat().st_size,
                                     'dynamic': dynamic, 'needed': needed,
                                     'notes': run(['readelf', '--wide', '--notes', str(plugin)]),
                                     'sections': run(['readelf', '--wide', '--section-headers', str(plugin)])}
    assert result['plugins']['stock']['needed'] == result['plugins']['fixed']['needed']
    assert result['plugins']['stock']['sha256'] != result['plugins']['fixed']['sha256']
    result['source_inventory_sha256'] = sha(output / 'source-inventories.json')
    result['corresponding_source_inventory'] = inventory(source)
    save(output / 'build.json', result)
    # Keep complete corresponding source archives; transient expanded/build trees are not artifacts.
    shutil.rmtree(work)


if __name__ == '__main__':
    main()
