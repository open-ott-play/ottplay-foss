# Remote search casing reference

`CaseFolding-17.0.0.txt` is the unchanged Unicode 17.0.0 reference from
<https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt>, downloaded on
2026-09-29. SHA-256:
`ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183`.
Copyright © 2025 Unicode, Inc. The data uses
[Unicode License V3](../../../js/licenses/Unicode-3.0.txt), SPDX `Unicode-3.0`.
It is test data and is not included in the player bundle.

Remote channel and programme searches use a comparison key, not a rewritten
display title. The ES5 helper uses native lowercase followed by uppercase,
preserving dotless `ı` before uppercase so it stays distinct from ASCII `i`.
Lowercasing first handles capital sharp S, and the final uppercase unifies the
contextual and ordinary forms of Greek sigma. Queries are prepared once.

The reference test checks the full default `C` and `F` pairs, excludes the
locale-specific `T` rules, and checks that the transform introduces no extra
case equivalences. It does not perform normalization, remove accents, or fold
unrelated compatibility characters. Substring searches still match substrings
of the resulting key. Credentials, provider IDs and channel IDs are unchanged.

Like the previous native `toLowerCase()` search, supported Unicode characters
depend on the engine's casing tables. Node 22.23.3 uses Unicode 17 and verifies
this reference completely; older TV engines can have older tables. ES5 syntax
and APIs do not require Unicode 17 support on those engines. The reference
table is intentionally not shipped as a runtime casing implementation.
