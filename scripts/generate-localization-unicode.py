#!/usr/bin/env python3
"""Generate pinned ES5 Unicode 17 normalization, graphemes and case folding.

Requires Python unicodedata 16.0.0 plus the checked-in Unicode 17 CCC overlay.
Canonical decompositions/compositions are unchanged and verified by hashes.
Unicode data license: js/licenses/Unicode-3.0.txt. No network is used.

ASCII varints use a base64 alphabet, five payload bits and a continuation bit.
Canonical records encode (codepoint delta * 2 + mapping length - 1), followed
by zigzag-signed target deltas from the previous target at the same mapping
position. Composition entries are
codepoint deltas. CCC ranges encode start delta from previous end, length-1,
then class. Grapheme property ranges use that same layout; pictographic
ranges have no property field. The checked-in, source-hashed grapheme input
is extracted from the official Unicode 17 files; regeneration is offline.
Use --verify-graphemes to re-fetch its three pinned sources and compare all
extracted ranges before generating (SHA256 mismatch is an error).
"""
import hashlib
import json
import sys
from pathlib import Path
import unicodedata

VERSION, BASE_VERSION = "17.0.0", "16.0.0"
if unicodedata.unidata_version != BASE_VERSION:
    raise SystemExit("Expected unicodedata " + BASE_VERSION + ", got " + unicodedata.unidata_version)
normalization_input = json.loads(Path(__file__).with_name("localization-unicode-normalization.json").read_text())
assert normalization_input["version"] == VERSION and normalization_input["baseVersion"] == BASE_VERSION
ccc_overlay = {int(cp, 16): order for cp, order in normalization_input["combiningClassOverlay"].items()}

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def encode(value):
    result = ""
    while value >= 32:
        result += ALPHABET[(value & 31) | 32]
        value >>= 5
    return result + ALPHABET[value]


def signed(value):
    return 2 * value if value >= 0 else -2 * value - 1


decompositions, compositions, classes = [], [], []
for cp in range(0x110000):
    char = chr(cp)
    decomposition = unicodedata.decomposition(char)
    if decomposition and not decomposition.startswith("<") and not 0xAC00 <= cp <= 0xD7A3:
        points = [int(n, 16) for n in decomposition.split()]
        assert len(points) in (1, 2)
        decompositions.append((cp, points))
        if len(points) == 2 and unicodedata.normalize("NFC", "".join(map(chr, points))) == char:
            compositions.append(cp)
    order = ccc_overlay.get(cp, unicodedata.combining(char))
    if order:
        if classes and classes[-1][1] == cp - 1 and classes[-1][2] == order:
            classes[-1][1] = cp
        else:
            classes.append([cp, cp, order])

def digest(data):
    return hashlib.sha256(json.dumps(data, separators=(",", ":")).encode()).hexdigest()


assert digest(decompositions) == normalization_input["canonicalDecompositionSha256"]
assert digest(compositions) == normalization_input["compositionSha256"]
assert sum(end - start + 1 for start, end, _ in classes) == normalization_input["combiningClassCount"]

if "--verify-normalization" in sys.argv:
    from urllib.request import urlopen
    sources = {}
    for name, source in normalization_input["sources"].items():
        raw = urlopen(source["url"]).read()
        assert hashlib.sha256(raw).hexdigest() == source["sha256"]
        sources[name] = raw.decode()
    expected_decompositions, expected_classes, excluded = [], {}, set()
    for line in sources["ucd"].splitlines():
        parts = line.split(";")
        cp, order, decomposition = int(parts[0], 16), int(parts[3]), parts[5]
        if order:
            expected_classes[cp] = order
        if decomposition and not decomposition.startswith("<"):
            expected_decompositions.append((cp, [int(n, 16) for n in decomposition.split()]))
    for line in sources["norm"].splitlines():
        parts = [part.strip() for part in line.split("#")[0].split(";")]
        if len(parts) < 2 or parts[1] != "Full_Composition_Exclusion":
            continue
        bounds = parts[0].split("..")
        excluded.update(range(int(bounds[0], 16), int(bounds[-1], 16) + 1))
    assert expected_decompositions == decompositions
    assert [cp for cp, points in decompositions if len(points) == 2 and cp not in excluded] == compositions
    assert expected_classes == {cp: order for start, end, order in classes for cp in range(start, end + 1)}
    print("Verified all pinned Unicode 17 normalization data")

canonical, composition, combining = "", "", ""
previous = 0
previous_targets = [0, 0]
for cp, points in decompositions:
    canonical += encode((cp - previous) * 2 + len(points) - 1)
    for index, point in enumerate(points):
        canonical += encode(signed(point - previous_targets[index]))
        previous_targets[index] = point
    previous = cp
previous = 0
for cp in compositions:
    composition += encode(cp - previous)
    previous = cp
previous = 0
for start, end, order in classes:
    combining += encode(start - previous) + encode(end - start) + encode(order)
    previous = end
grapheme_input = json.loads(Path(__file__).with_name("localization-unicode-graphemes.json").read_text())
assert grapheme_input["version"] == VERSION

if "--verify-graphemes" in sys.argv:
    from urllib.request import urlopen
    for group, source in grapheme_input["sources"].items():
        raw = urlopen(source["url"]).read()
        assert hashlib.sha256(raw).hexdigest() == source["sha256"]
        properties = {}
        for line in raw.decode().splitlines():
            parts = [part.strip() for part in line.split("#")[0].split(";")]
            if len(parts) < 2:
                continue
            name = parts[1]
            if group == "ep" and name != "Extended_Pictographic":
                continue
            if group == "incb":
                if len(parts) < 3 or name != "InCB":
                    continue
                name = parts[2]
            if group == "gcb" and name in ("LV", "LVT"):
                continue
            bounds = parts[0].split("..")
            start, end = int(bounds[0], 16), int(bounds[-1], 16)
            ranges = properties.setdefault(name, [])
            if ranges and ranges[-1][1] == start - 1:
                ranges[-1][1] = end
            else:
                ranges.append([start, end])
        extracted = {name: ";".join(f"{start:x}-{end:x}" for start, end in ranges)
                     for name, ranges in properties.items()}
        assert extracted == grapheme_input["properties"][group]
    print("Verified all pinned Unicode 17 grapheme sources and ranges")


def property_data(group, names, with_property=True):
    ranges = []
    for index, name in enumerate(names, 1):
        for record in grapheme_input["properties"][group][name].split(";"):
            start, end = (int(n, 16) for n in record.split("-"))
            ranges.append((start, end, index))
    previous, result = 0, ""
    for start, end, value in sorted(ranges):
        assert start >= previous
        result += encode(start - previous) + encode(end - start)
        if with_property:
            result += encode(value)
        previous = end
    return result


grapheme = property_data("gcb", ["CR", "LF", "Control", "Extend", "ZWJ", "Regional_Indicator", "Prepend", "SpacingMark", "L", "V", "T"])
pictographic = property_data("ep", ["Extended_Pictographic"], False)
conjunct = property_data("incb", ["Linker", "Consonant", "Extend"])

# Keep the project's full default C+F17 contract independent of the host engine.
fold_source = Path(__file__).resolve().parents[1] / "tests/fixtures/unicode/CaseFolding-17.0.0.txt"
fold_bytes = fold_source.read_bytes()
assert hashlib.sha256(fold_bytes).hexdigest() == "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183"
fold_records = []
for line in fold_bytes.decode().splitlines():
    parts = [part.strip() for part in line.split("#")[0].split(";")]
    if len(parts) >= 3 and parts[1] in ("C", "F"):
        fold_records.append((int(parts[0], 16), [int(n, 16) for n in parts[2].split()]))
assert len(fold_records) == 1585
folding, previous, previous_targets = "", 0, [0, 0, 0]
for cp, points in sorted(fold_records):
    assert 1 <= len(points) <= 3
    # Two length bits; canonical decomposition records above need only one.
    folding += encode((cp - previous) * 4 + len(points) - 1)
    previous = cp
    for index, point in enumerate(points):
        folding += encode(signed(point - previous_targets[index]))
        previous_targets[index] = point

output = "// Generated by scripts/generate-localization-unicode.py.\n"
output += "// Normalization, graphemes and default case folding C+F: Unicode 17.0.0.\n"
output += "// Unicode-3.0: js/licenses/Unicode-3.0.txt. Hangul is algorithmic.\n"
output += "// ASCII delta varints: five payload bits; bit 5 continues. See generator for record schemas.\n"
for name, value in [
    ("unicodeCanonicalData", canonical),
    ("unicodeCompositionData", composition),
    ("unicodeCombiningData", combining),
    ("unicodeGraphemeData", grapheme),
    ("unicodePictographicData", pictographic),
    ("unicodeConjunctData", conjunct),
    ("unicodeCaseFoldData", folding),
]:
    output += f"export var {name} =\n"
    output += " +\n".join("    " + json.dumps(value[i:i + 120]) for i in range(0, len(value), 120)) + ";\n"
(Path(__file__).resolve().parents[1] / "src/localization/unicode-data.ts").write_text(output)
