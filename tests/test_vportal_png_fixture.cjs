"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const filename =
    process.argv[2] ||
    path.join(__dirname, "browser/vportal-provider.spec.cjs");
const source = fs.readFileSync(filename, "utf8");
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++)
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
let count = 0;
for (const match of source.matchAll(
    /Buffer\.from\(\s*"([A-Za-z0-9+/=]+)"\s*,\s*"base64"\s*\)/g
)) {
    const png = Buffer.from(match[1], "base64");
    if (!png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
        continue;
    count++;
    let offset = 8;
    const chunks = [];
    const imageData = [];
    while (offset < png.length) {
        assert(offset + 12 <= png.length, "PNG chunk header/trailer truncated");
        const length = png.readUInt32BE(offset);
        assert(
            offset + 12 + length <= png.length,
            "PNG chunk payload truncated"
        );
        const kind = png.toString("ascii", offset + 4, offset + 8);
        const chunk = png.subarray(offset + 4, offset + 8 + length);
        assert.equal(
            png.readUInt32BE(offset + 8 + length),
            crc32(chunk),
            kind + " CRC mismatch"
        );
        chunks.push(kind);
        if (kind === "IDAT")
            imageData.push(png.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
    }
    assert.equal(chunks[0], "IHDR");
    assert.equal(chunks.at(-1), "IEND");
    assert.equal(offset, png.length);
    assert(imageData.length > 0);
    assert(
        zlib.inflateSync(Buffer.concat(imageData)).length > 0,
        "PNG pixels must decode"
    );
}
assert(count > 0, "At least one embedded PNG fixture must be checked");
console.log("PASS VPortal PNG fixture integrity: " + count);
