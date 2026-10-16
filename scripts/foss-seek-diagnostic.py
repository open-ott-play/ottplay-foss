"""Temporary diagnostic transformation; never merge into the product branch."""
import hashlib
import json
import os
from pathlib import Path
import sys

SOURCE_HASH = 'e78f7848e690d39375ff9969b9fb18b609f05d19ef4dab3eb17e02e5c631729e'


def transform(source, variant):
    assert hashlib.sha256(source.encode()).hexdigest() == SOURCE_HASH
    assert variant in {'baseline', 'natural-resume', 'await-seeked'}
    original = 'const ending = await page.evaluate(() => {'
    assert source.count(original) == 1
    source = source.replace(original, 'const ending = await page.evaluate(async () => {')
    original = '                    media.currentTime = duration - 0.3;\n                    window.stbResume();'
    assert source.count(original) == 1
    diagnostic = '''                    const seekSnapshot = (phase) => console.info(
                        "FOSS_SEEK_DIAGNOSTIC " + JSON.stringify({
                            phase, variant: VARIANT, at: performance.now(),
                            position: media.currentTime, duration: media.duration,
                            seeking: media.seeking, paused: media.paused,
                            ended: media.ended, readyState: media.readyState,
                            error: media.error && {code: media.error.code, message: media.error.message},
                        })
                    );
                    seekSnapshot("before");
                    media.addEventListener("error", () => seekSnapshot("error"), {once: true});
                    media.addEventListener("seeked", () => seekSnapshot("seeked"), {once: true});
'''.replace('VARIANT', json.dumps(variant))
    if variant == 'await-seeked':
        diagnostic += '''                    const completedSeek = new Promise((resolve, reject) => {
                        media.addEventListener("seeked", resolve, {once: true});
                        media.addEventListener("error", () => reject(new Error("Diagnostic seek failed")), {once: true});
                    });
                    media.currentTime = duration - 0.3;
                    seekSnapshot("seek-assigned");
                    await completedSeek;
'''
    elif variant == 'baseline':
        diagnostic += '''                    media.currentTime = duration - 0.3;
                    seekSnapshot("seek-assigned");
'''
    diagnostic += '''                    window.stbResume();
                    seekSnapshot("resumed");'''
    return source.replace(original, diagnostic)


def main():
    variant = sys.argv[1]
    path = Path('tests/browser/plex-provider.spec.cjs')
    original = path.read_text()
    changed = transform(original, variant)
    path.write_text(changed)
    output = Path(os.environ['CI_BROWSER_DIAGNOSTICS']) / 'seek-variant.json'
    output.write_text(json.dumps({
        'diagnosticOnly': True, 'variant': variant,
        'original_spec_sha256': SOURCE_HASH,
        'transformed_spec_sha256': hashlib.sha256(changed.encode()).hexdigest(),
        'transform_driver_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'unchanged': ['five scenario names', 'all assertions', 'trusted ended event',
                      'queue advance', 'reload persistence', 'retries=0', 'all deadlines'],
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
