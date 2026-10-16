// Temporary diagnostic fixture only. No playback preferences or deadlines change.
const fs = require('node:fs');
const path = require('node:path');
function installMediaDiagnostics() {
    const prefix = 'FOSS_MEDIA_DIAGNOSTIC ';
    let count = 0, nextId = 0;
    const ids = new WeakMap();
    const bufferTypes = new WeakMap();
    const id = object => {
        if (!ids.has(object)) ids.set(object, ++nextId);
        return ids.get(object);
    };
    function emit(kind, fields = {}) {
        if (++count === 2001) console.debug(prefix + JSON.stringify({kind:'browser-event-limit'}));
        if (count > 2000) return;
        console.debug(prefix + JSON.stringify({time: performance.now(), kind, ...fields}));
    }
    const errorName = error => String(error?.name || 'Error');
    const summarize = value => ({
        cmd: typeof value?.cmd === 'string' ? value.cmd.slice(0, 100) : null,
        event: typeof value?.event === 'string' ? value.event.slice(0, 100) : null,
        type: typeof value?.type === 'string' ? value.type.slice(0, 100) : null,
    });
    const patched = new Set();
    function wrap(proto, name, before, after) {
        if (!proto || typeof proto[name] !== 'function') return;
        const original = proto[name];
        const key = proto.constructor?.name + '.' + name;
        if (patched.has(original)) return;
        patched.add(original);
        proto[name] = function(...args) {
            emit(key + '.enter', {id: id(this), bufferType: bufferTypes.get(this), ...before?.(args)});
            try {
                const result = Reflect.apply(original, this, args);
                after?.(this, result, args);
                emit(key + '.return', {id: id(this)});
                return result;
            } catch (error) {
                emit(key + '.throw', {id: id(this), error: errorName(error)});
                throw error;
            }
        };
        patched.add(proto[name]);
    }
    const observed = new WeakSet();
    function observeBuffer(buffer, mime) {
        bufferTypes.set(buffer, mime);
        if (observed.has(buffer)) return;
        observed.add(buffer);
        for (const type of ['updatestart','update','updateend','error','abort']) {
            buffer.addEventListener(type, () => emit('SourceBuffer.' + type, {id: id(buffer), bufferType: bufferTypes.get(buffer)}));
        }
    }
    for (const ctor of [window.MediaSource, window.ManagedMediaSource, window.WebKitMediaSource]) {
        wrap(ctor?.prototype, 'addSourceBuffer', args => ({mime: String(args[0]).slice(0, 160)}), (owner, buffer, args) => {
            emit('SourceBuffer.created', {source: id(owner), buffer: id(buffer)});
            observeBuffer(buffer, String(args[0]).slice(0, 160));
        });
        const duration = ctor && Object.getOwnPropertyDescriptor(ctor.prototype, 'duration');
        if (duration?.set && !patched.has(duration.set)) {
            patched.add(duration.set);
            Object.defineProperty(ctor.prototype, 'duration', {...duration, set(value) {
                emit('MediaSource.duration.enter', {id: id(this), value});
                const result = Reflect.apply(duration.set, this, [value]);
                emit('MediaSource.duration.return', {id: id(this)});
                return result;
            }});
        }
        wrap(ctor?.prototype, 'endOfStream', args => ({error: args[0] || null}));
        wrap(ctor?.prototype, 'removeSourceBuffer', args => ({buffer: id(args[0])}));
    }
    function describeBytes(value) {
        const bytes = ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            : new Uint8Array(value);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const boxes = [];
        for (let offset = 0; offset + 8 <= bytes.length && boxes.length < 8; ) {
            const size = view.getUint32(offset);
            if (size < 8 || size > bytes.length - offset) break;
            boxes.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)));
            offset += size;
        }
        return {bytes: bytes.length, boxes};
    }
    wrap(window.SourceBuffer?.prototype, 'appendBuffer', args => describeBytes(args[0]));
    wrap(window.SourceBuffer?.prototype, 'abort');
    wrap(window.SourceBuffer?.prototype, 'remove', args => ({start: args[0], end: args[1]}));
    for (const type of ['loadstart','loadedmetadata','loadeddata','canplay','play','playing','waiting','seeking','seeked','stalled','error','ended','emptied']) {
        document.addEventListener(type, event => {
            if (event.target instanceof HTMLMediaElement) emit('media.' + type, {id: id(event.target)});
        }, true);
    }
    if (window.Worker) {
        const Worker = window.Worker;
        wrap(Worker.prototype, 'postMessage', args => summarize(args[0]));
        wrap(Worker.prototype, 'terminate');
        window.Worker = new Proxy(Worker, {
            construct(target, args, newTarget) {
                const worker = Reflect.construct(target, args, newTarget);
                let pathname = 'unparsed';
                try { pathname = new URL(String(args[0]), location.href).pathname; } catch (_) {}
                emit('Worker.created', {id: id(worker), pathname});
                worker.addEventListener('message', event => emit('Worker.message', {id: id(worker), ...summarize(event.data)}));
                worker.addEventListener('error', event => emit('Worker.error', {id: id(worker), message: String(event.message).slice(0, 160)}));
                return worker;
            },
        });
    }
    let Hls;
    Object.defineProperty(window, 'Hls', {
        configurable: true,
        get() { return Hls; },
        set(value) {
            if (typeof value !== 'function') { Hls = value; return; }
            Hls = new Proxy(value, {
                construct(target, args, newTarget) {
                    const instance = Reflect.construct(target, args, newTarget);
                    emit('Hls.created', {id: id(instance), preferManagedMediaSource: instance.config.preferManagedMediaSource, enableWorker: instance.config.enableWorker});
                    for (const name of ['MEDIA_ATTACHING','MEDIA_ATTACHED','MEDIA_DETACHING','MEDIA_DETACHED','BUFFER_CODECS','BUFFER_CREATED','BUFFER_APPENDING','BUFFER_APPENDED','FRAG_PARSING_INIT_SEGMENT','FRAG_PARSED','FRAG_BUFFERED','ERROR']) {
                        instance.on(value.Events[name], (event, data) => emit('Hls.' + name, {
                            id: id(instance), ...summarize(data), fatal: data?.fatal === true,
                            details: typeof data?.details === 'string' ? data.details : null,
                            bytes: data?.data?.byteLength, sn: data?.frag?.sn,
                        }));
                    }
                    return instance;
                },
            });
        },
    });
    emit('installed');
}
const fixtures = {
    mediaDiagnostics: [async ({context}, use, testInfo) => {
        const file = path.join(process.env.CI_BROWSER_DIAGNOSTICS, 'media-events.ndjson');
        let count = 0;
        const write = fields => {
            if (++count === 5001) fs.appendFileSync(file, JSON.stringify({test:testInfo.title, source:'host-event-limit'})+'\n');
            if (count <= 5000) fs.appendFileSync(file, JSON.stringify({test: testInfo.title, ...fields}) + '\n');
        };
        const listen = page => {
            page.on('console', message => {
                const text = message.text();
                if (text.startsWith('FOSS_MEDIA_DIAGNOSTIC ')) {
                    write({source:'browser', event:JSON.parse(text.slice('FOSS_MEDIA_DIAGNOSTIC '.length))});
                }
            });
            page.on('pageerror', error => write({source:'pageerror', message:String(error.message).slice(0,300)}));
            page.on('crash', () => write({source:'crash'}));
            page.on('close', () => write({source:'close'}));
        };
        context.on('page', listen);
        for (const page of context.pages()) listen(page);
        await context.addInitScript(installMediaDiagnostics);
        write({source:'test-start'});
        try { await use(); } finally { write({source:'test-end'}); }
    }, {auto:true}],
};
module.exports = {fixtures, installMediaDiagnostics};
