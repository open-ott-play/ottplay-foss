const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "fixtures/windows-video-geometry");
const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "hls/manifest.json"), "utf8")
);

function sha256(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

function mdatPayload(file) {
    const bytes = fs.readFileSync(file);
    const payloads = [];
    let offset = 0;
    while (offset + 8 <= bytes.length) {
        let size = bytes.readUInt32BE(offset);
        const type = bytes.toString("ascii", offset + 4, offset + 8);
        let header = 8;
        if (size === 1) {
            assert.ok(
                offset + 16 <= bytes.length,
                `truncated large box: ${file}`
            );
            const large = bytes.readBigUInt64BE(offset + 8);
            assert.ok(large <= BigInt(Number.MAX_SAFE_INTEGER));
            size = Number(large);
            header = 16;
        } else if (size === 0) size = bytes.length - offset;
        assert.ok(
            size >= header && offset + size <= bytes.length,
            `invalid BMFF box: ${file}`
        );
        if (type === "mdat")
            payloads.push(bytes.subarray(offset + header, offset + size));
        offset += size;
    }
    assert.equal(offset, bytes.length, `unparsed trailing bytes: ${file}`);
    return Buffer.concat(payloads);
}

test("native HLS fixtures are local, bounded, and preserve MP4 sample bytes", () => {
    assert.equal(manifest.ffmpeg_version, "9.0.2");
    assert.deepEqual(Object.keys(manifest.sources).sort(), [
        "standard",
        "wide",
    ]);

    for (const [name, expected] of Object.entries(manifest.sources)) {
        const sourcePath = path.join(root, `${name}.mp4`);
        const playlistPath = path.join(root, "hls", name, "index.m3u8");
        const initPath = path.join(root, "hls", name, "init.mp4");
        const source = fs.readFileSync(sourcePath);
        const playlist = fs.readFileSync(playlistPath);
        const text = playlist.toString("utf8");
        assert.equal(
            sha256(source),
            expected.source_sha256,
            `${name} source changed`
        );
        const phasePalette = [
            [
                [220, 40, 40],
                [40, 220, 40],
                [40, 40, 220],
                [220, 220, 40],
            ],
            [
                [40, 220, 40],
                [40, 40, 220],
                [220, 220, 40],
                [220, 40, 40],
            ],
        ];
        assert.equal(expected.phase_samples_rgb.length, phasePalette.length);
        for (const [phase, quadrants] of phasePalette.entries())
            for (const [quadrant, color] of quadrants.entries())
                assert.ok(
                    color.every(
                        (value, channel) =>
                            Math.abs(
                                value -
                                    expected.phase_samples_rgb[phase][quadrant][
                                        channel
                                    ]
                            ) <= 2
                    ),
                    `${name} phase ${phase} quadrant ${quadrant} color mismatch`
                );
        assert.equal(sha256(playlist), expected.hls.playlist_sha256);
        assert.equal(
            sha256(fs.readFileSync(initPath)),
            expected.hls.init_sha256
        );
        assert.match(text, /^#EXTM3U\n/);
        assert.match(text, /#EXT-X-VERSION:7/);
        assert.match(text, /#EXT-X-PLAYLIST-TYPE:VOD/);
        assert.match(text, /#EXT-X-INDEPENDENT-SEGMENTS/);
        assert.match(text, /#EXT-X-MAP:URI="init\.mp4"/);
        assert.match(text, /#EXT-X-ENDLIST\s*$/);
        assert.doesNotMatch(text, /(?:https?:|\/\/|\.\.\/)/i);

        const segments = text
            .split(/\r?\n/)
            .filter((line) => /^segment\d{3}\.m4s$/.test(line));
        const durations = text
            .split(/\r?\n/)
            .filter((line) => line.startsWith("#EXTINF:"));
        assert.equal(segments.length, 8);
        assert.deepEqual(durations, Array(8).fill("#EXTINF:1.500000,"));
        assert.deepEqual(
            segments,
            expected.hls.segments.map((segment) => segment.name)
        );

        let totalBytes =
            source.length + playlist.length + fs.statSync(initPath).size;
        const segmentPayloads = [];
        for (const [index, segment] of segments.entries()) {
            const segmentPath = path.join(path.dirname(playlistPath), segment);
            const bytes = fs.readFileSync(segmentPath);
            assert.equal(sha256(bytes), expected.hls.segments[index].sha256);
            totalBytes += bytes.length;
            segmentPayloads.push(mdatPayload(segmentPath));
        }
        assert.ok(
            totalBytes < 40 * 1024,
            `${name} HLS fixture grew unexpectedly`
        );

        const originalSamples = mdatPayload(sourcePath);
        const remuxedSamples = Buffer.concat([
            mdatPayload(initPath),
            ...segmentPayloads,
        ]);
        assert.equal(sha256(originalSamples), expected.mdat_sha256);
        assert.deepEqual(
            remuxedSamples,
            originalSamples,
            `${name} HLS remux changed encoded video sample bytes`
        );
    }
});
