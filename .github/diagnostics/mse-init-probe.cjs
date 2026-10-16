// Temporary diagnostic only: no product or release acceptance verdict.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createHlsAspectFixture } = require('../../tests/helpers/hls-aspect-fixture.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const expected = {
    'video-init.mp4': '46d9bc9c21d142afde6c25a97c7ece81c90499c3c8b776d1874a0a05d05a1ca1',
    'video-segment.m4s': 'f46ca4238205b07c05931712a784ab960e232cf2e8903a5a4a5c68e92cc1cd07',
    'audio-init.mp4': '5d71449f615a0da956d1f67d9dd3bbb388671d47359074d7779ef37b8515c021',
    'audio-segment.m4s': 'e97ddc9b160d84a8b2f096ff6bd5fe75d1434b918f5314fc190958223e56ed63',
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function probe(playwright, output, fixture, tracks, mode, variant = 'normalized') {
    const name = tracks.join('-') + '-' + mode + '-' + variant;
    fixture = { ...fixture, 'video-init.mp4': Buffer.from(fixture['video-init.mp4']) };
    const videoInit = fixture['video-init.mp4'];
    if (variant === 'avcc-reserved' || variant === 'both-reserved') {
        assert.equal(videoInit[512], 0x01); videoInit[512] = 0xe1;
    }
    if (variant === 'visual-predefined' || variant === 'both-reserved') {
        assert.equal(videoInit.readUInt16BE(497), 0x1111); videoInit.writeUInt16BE(0xffff, 497);
    }
    const events = [];
    let signal;
    const done = new Promise(resolve => { signal = resolve; });
    const server = await playwright.webkit.launchServer({ headless: true });
    const browserProcess = server.process();
    const exit = new Promise(resolve => browserProcess.once('exit', (code, signal) => resolve({ code, signal })));
    const record = { name, mode, variant, tracks, constructor: 'MediaSource', pid: browserProcess.pid, events };
    const append = event => {
        assert(events.length < 200, 'Unexpected diagnostic event volume');
        events.push(event);
        fs.appendFileSync(path.join(output, 'mse-events.ndjson'), JSON.stringify({ probe: name, event }) + '\n');
        if (['complete', 'probe-error'].includes(event.kind)) signal(event);
    };
    try {
        const browser = await playwright.webkit.connect(server.wsEndpoint());
        assert.equal(browser.version(), process.env.BROWSER_VERSION);
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', route => route.request().url() === 'http://127.0.0.1:4179/'
            ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><video muted playsinline></video>' })
            : route.abort());
        const page = await context.newPage();
        page.on('console', message => {
            const text = message.text();
            if (text.startsWith('MSE_INIT_DIAGNOSTIC ')) append(JSON.parse(text.slice(20)));
        });
        page.on('crash', () => { append({ kind: 'page-crash' }); signal({ kind: 'page-crash' }); });
        page.on('pageerror', error => { append({ kind: 'page-error', message: String(error.message) }); signal({ kind: 'page-error' }); });
        await page.goto('http://127.0.0.1:4179/');
        const inputs = tracks.map(track => {
            const bytes = mode === 'init' ? fixture[track + '-init.mp4']
                : Buffer.concat([fixture[track + '-init.mp4'], fixture[track + '-segment.m4s']]);
            return { track, mime: track === 'video' ? (fixture.videoMime || 'video/mp4;codecs="avc1.42C01E"') : 'audio/mp4;codecs="mp4a.40.2"',
                base64: bytes.toString('base64'), bytes: bytes.length, sha256: hash(bytes) };
        });
        record.inputs = inputs.map(({ base64, ...metadata }) => metadata);
        const started = page.evaluate(inputs => {
            const emit = (kind, extra = {}) => console.debug('MSE_INIT_DIAGNOSTIC ' + JSON.stringify({ time: performance.now(), kind, ...extra }));
            try {
                if (typeof window.MediaSource !== 'function') throw new Error('Expected explicit MediaSource constructor');
                const video = document.querySelector('video');
                video.muted = true;
                for (const event of ['loadedmetadata', 'loadeddata', 'playing', 'waiting', 'error'])
                    video.addEventListener(event, () => {
                        emit('media-' + event);
                        if (event === 'error') emit('probe-error', { message: 'Native media element error' });
                    });
                const source = new window.MediaSource();
                video.src = URL.createObjectURL(source);
                source.addEventListener('sourceopen', () => {
                    try {
                        emit('sourceopen'); source.duration = 2;
                        const completed = new Set();
                        const buffers = inputs.map(input => {
                            if (!MediaSource.isTypeSupported(input.mime)) throw new Error('Unsupported ' + input.mime);
                            const buffer = source.addSourceBuffer(input.mime);
                            emit('created', { track: input.track, mime: input.mime });
                            for (const event of ['updatestart', 'update', 'updateend', 'error', 'abort'])
                                buffer.addEventListener(event, () => {
                                    emit(event, { track: input.track });
                                    if (event === 'error' || event === 'abort') emit('probe-error', { track: input.track, event });
                                    if (event === 'updateend') {
                                        if (completed.has(input.track)) emit('probe-error', { message: 'Duplicate updateend' });
                                        completed.add(input.track);
                                        if (completed.size === inputs.length) emit('complete');
                                    }
                                });
                            return buffer;
                        });
                        inputs.forEach((input, index) => {
                            const bytes = Uint8Array.from(atob(input.base64), ch => ch.charCodeAt(0));
                            emit('append-enter', { track: input.track, bytes: bytes.length });
                            buffers[index].appendBuffer(bytes);
                            emit('append-return', { track: input.track });
                        });
                    } catch (error) { emit('probe-error', { name: error.name, message: error.message }); }
                }, { once: true });
                video.play().catch(error => emit('play-rejected', { name: error.name }));
            } catch (error) { emit('probe-error', { name: error.name, message: error.message }); }
        }, inputs).catch(error => { append({ kind: 'evaluate-error', message: String(error.message) }); signal({ kind: 'evaluate-error' }); });
        // Use a host timer: a stuck media subprocess must not block diagnostics.
        const result = await Promise.race([done, delay(12000).then(() => ({ kind: 'timeout' }))]);
        record.outcome = result.kind;
        append({ kind: 'host-outcome', outcome: record.outcome });
        // Do not wait for page.evaluate after a browser hang; kill only this owned server below.
        void started;
    } finally {
        const cleanup = server.kill().then(() => exit);
        const termination = await Promise.race([cleanup, delay(5000).then(() => null)]);
        assert(termination, 'Owned browser did not terminate');
        record.termination = termination;
        fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(record, null, 2) + '\n');
    }
    return record;
}

async function main() {
    const output = process.env.CI_BROWSER_DIAGNOSTICS;
    assert(output && process.env.CI_PLAYWRIGHT_MODULE && process.env.BROWSER_VERSION);
    const fixture = createHlsAspectFixture(fs.readFileSync('tests/fixtures/media-runtime/segment00.ts'));
    for (const [name, digest] of Object.entries(expected)) assert.equal(hash(fixture[name]), digest, name);
    const playwright = require(process.env.CI_PLAYWRIGHT_MODULE);
    const records = [];
    const referenceBytes = fs.readFileSync(path.join(__dirname, 'mse-references.json'));
    const referenceBundleSha256 = hash(referenceBytes);
    assert.equal(referenceBundleSha256, '7eaec145b720e2f246acb7aaf09ac8aa186ab94edae0ac447a86e964f5a71d02');
    const references = JSON.parse(referenceBytes).references;
    assert.deepEqual(references.map(value => value.name), ['ffmpeg', 'aligned', 'core']);
    records.push(await probe(playwright, output, fixture, ['video'], 'init'));
    for (const reference of references) {
        const init = Buffer.from(reference.init.base64, 'base64');
        const fragment = Buffer.from(reference.fragment.base64, 'base64');
        assert.equal(init.length, reference.init.size); assert.equal(hash(init), reference.init.sha256);
        assert.equal(fragment.length, reference.fragment.size); assert.equal(hash(fragment), reference.fragment.sha256);
        const input = { ...fixture, 'video-init.mp4': init, 'video-segment.m4s': fragment, videoMime: reference.mime };
        for (const mode of ['init', 'combined']) records.push(await probe(playwright, output, input, ['video'], mode, reference.name));
    }
    const result = { diagnosticOnly: true, assertion: 'observe native append completion; not application acceptance',
        driverSha256: hash(fs.readFileSync(__filename)), referenceBundleSha256, fixture: expected,
        sourceSha: process.env.SOURCE_SHA, fixtureSourceSha: process.env.FIXTURE_SHA,
        workflowSha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        target: process.env.CI_BROWSER_TARGET_ID, playwrightVersion: require(path.join(process.env.CI_PLAYWRIGHT_MODULE, 'package.json')).version,
        browserVersion: process.env.BROWSER_VERSION, records };
    fs.writeFileSync(path.join(output, 'mse-result.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(records.map(({ name, outcome }) => ({ name, outcome })), null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
