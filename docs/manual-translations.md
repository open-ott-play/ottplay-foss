# Complete manual translations

The main manual and the eleven feature guides listed in
[`manual-languages.json`](manual-languages.json) have complete editions in the
24 documentation languages used by [ha-homelab](https://github.com/ha-homelab).
Choose a language at the top of any of these pages. English is the canonical
source; translations preserve the procedures, platform boundaries, limitations,
commands and recorded results. They describe the documented revision, not a
promise that every installed release has the same capabilities.

These complete editions are separate from the [88 UI-language quick
starts](readme/README.md). The quick starts use the player's shipped UI captions.
Other engineering references retain their existing languages. Translating a
manual does not add a new application locale or a new platform qualification.

## Updating a manual

1. Update the English source and every corresponding translation in the same
   change. Do not replace a complete guide with an abbreviated overview.
2. Keep executable code, identifiers, paths, URLs, version numbers and measured
   values unchanged unless the underlying behavior or evidence has changed.
   Translate prose, link labels, and diagram labels; preserve diagram structure.
3. When a linked guide belongs to the complete set, prefer its matching-language
   edition. Leave references to other guides intact. Recheck translated heading
   fragments when changing a title.
4. Keep one `language-navigation` marker pair directly after the title. Arabic,
   Persian and Hebrew prose uses `dir="rtl"`; commands and navigation use LTR.
5. After reviewing every translation against the changed English source, update
   that source's `sourceSha256` entry in `docs/manual-languages.json`. Calculate
   it with the exported `sourceDigest` function in
   `scripts/manual-documentation.cjs`; it excludes generated navigation. The
   digest is an explicit review acknowledgement, not an automatic translation.
6. Run `npm run docs:manuals` to refresh all language switchers, then
   `npm run check:docs` and `node tests/test_readme_docs.cjs`.

The existing documentation check covers all complete editions, all generated
quick starts, relative Markdown and HTML link destinations and language-switcher
consistency. It rejects changed English sources until their translation review
is acknowledged, and compares executable fenced examples, inline code literals
and heading structure with the English edition. Mermaid labels are translated
and need a separate diagram review.
It does not establish linguistic accuracy, remote website availability or
physical-device compatibility. Review the changed prose and rendered pages,
including RTL pages, alongside these automated checks.

`docs/manual-languages.json` is the single inventory for complete editions.
`scripts/manual-documentation.cjs` renders navigation only; it does not generate
or overwrite translations. Quick starts remain owned by
`scripts/generate-readmes.cjs` and their UI catalogs.
