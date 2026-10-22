const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
    checkGenerated,
    expectedReadmes,
    renderQuickStart,
} = require("../scripts/generate-readmes.cjs");
const {
    checkDocumentation,
    checkLinks,
} = require("../scripts/check-readme-docs.cjs");
const {
    languageAssets,
    readDictionary,
} = require("../scripts/localization-catalog.cjs");
const {
    checkManualContent,
    manualFiles,
    reconcileNavigation,
    sourceDigest,
} = require("../scripts/manual-documentation.cjs");
const root = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ottplay-readme-docs-"));
try {
    const english = readDictionary(path.join(root, "locales/english.js"));
    assert.throws(
        () => renderQuickStart({ ...english, "Load playlist": "" }),
        /Missing quick-start/
    );
    const escaped = renderQuickStart({
        ...english,
        lang: "Name [link](bad) <script>",
    });
    assert(escaped.includes("Name \\[link\\](bad) \\<script\\>"));
    assert(!escaped.includes("Name [link](bad)"));
    const generated = expectedReadmes(root);
    assert.equal(generated.size, Object.keys(languageAssets).length + 1);
    assert(
        generated
            .get("docs/readme/russian/README.md")
            .includes("Настройки → Сменить провайдера")
    );
    assert(generated.get("docs/readme/arabic/README.md").includes("العربية"));
    assert(
        generated
            .get("docs/readme/arabic/README.md")
            .includes('<div dir="rtl">')
    );
    assert(
        !generated
            .get("docs/readme/english/README.md")
            .includes('<div dir="rtl">')
    );
    for (const asset of Object.values(languageAssets)) {
        const output = path.join(fixture, asset);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.copyFileSync(path.join(root, asset), output);
    }
    for (const [file, content] of generated) {
        const output = path.join(fixture, file);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, content);
    }
    assert.deepEqual(checkGenerated(fixture), []);
    const guide = path.join(fixture, "docs/readme/english/README.md");
    fs.appendFileSync(guide, "drift\n");
    assert(
        checkGenerated(fixture).some((error) =>
            error.includes("english/README.md")
        )
    );
    fs.mkdirSync(path.join(fixture, "docs/readme/retired"));
    assert(
        checkGenerated(fixture).some((error) =>
            error.includes("Unknown locale")
        )
    );
    fs.writeFileSync(path.join(fixture, "README.md"), "# Title\n");
    fs.writeFileSync(path.join(fixture, "a file.md"), "# A\n");
    fs.writeFileSync(
        path.join(fixture, "links.md"),
        [
            "[exists](README.md#heading)",
            "[spaces](<a file.md>)",
            "[external](https://example.invalid/absent.md)",
            "[missing](missing.md)",
            "![missing image](image.svg)",
            "[escape](../outside.md)",
            '<a href="missing-language.md" lang="ja">日本語</a>',
            "```md\n[example](not-real.md)\n```",
        ].join("\n")
    );
    const errors = checkLinks(fixture, "links.md");
    assert.equal(errors.length, 4);
    assert(errors.some((error) => error.includes("missing.md")));
    assert(errors.some((error) => error.includes("image.svg")));
    assert(errors.some((error) => error.includes("escapes repository")));
    assert(errors.some((error) => error.includes("missing-language.md")));
    const contentRoot = path.join(fixture, "manual-content");
    fs.mkdirSync(contentRoot);
    const source =
        "# Guide\n\nUse `--check`.\n\n## Run\n\n```sh\nnpm run check\n```\n";
    const translated =
        "# ガイド\n\n`--check` を使用します。\n\n## 実行\n\n```sh\nnpm run check\n```\n";
    const manifest = {
        documents: ["README.md"],
        languages: [{ code: "en" }, { code: "ja" }],
        sourceSha256: { "README.md": sourceDigest(source) },
    };
    const sourceFile = path.join(contentRoot, "README.md");
    const translatedFile = path.join(contentRoot, "README.ja.md");
    fs.writeFileSync(sourceFile, source);
    fs.writeFileSync(translatedFile, translated);
    assert.deepEqual(checkManualContent(contentRoot, manifest), []);
    fs.writeFileSync(sourceFile, source.replace("Use", "Always use"));
    assert(
        checkManualContent(contentRoot, manifest).some((error) =>
            error.includes("source changed")
        )
    );
    fs.writeFileSync(sourceFile, source);
    fs.writeFileSync(
        translatedFile,
        translated.replace("npm run check", "npm run deploy")
    );
    assert(
        checkManualContent(contentRoot, manifest).some((error) =>
            error.includes("code differ")
        )
    );
    fs.writeFileSync(translatedFile, translated.replace("--check", "--write"));
    assert(
        checkManualContent(contentRoot, manifest).some((error) =>
            error.includes("literals differ")
        )
    );
    fs.writeFileSync(translatedFile, translated.replace("## 実行\n", ""));
    assert(
        checkManualContent(contentRoot, manifest).some((error) =>
            error.includes("headings differ")
        )
    );
    fs.writeFileSync(translatedFile, translated);
    fs.writeFileSync(
        sourceFile,
        source +
            "\n<!-- language-navigation:start -->\n<p>Updated navigation</p>\n<!-- language-navigation:end -->\n"
    );
    assert.deepEqual(
        checkManualContent(contentRoot, manifest),
        [],
        "navigation refresh must not invalidate reviewed source content"
    );
    const heredoc =
        "# Guide\n\n```sh\ncat <<EOF\nfirst\n\n\nsecond\nEOF\n```\n";
    const modifiedHeredoc = heredoc.replace(
        "first\n\n\nsecond",
        "first\n\nsecond"
    );
    manifest.sourceSha256["README.md"] = sourceDigest(heredoc);
    fs.writeFileSync(sourceFile, heredoc);
    fs.writeFileSync(translatedFile, modifiedHeredoc);
    assert.notEqual(
        sourceDigest(heredoc),
        sourceDigest(modifiedHeredoc),
        "blank lines in executable examples are meaningful"
    );
    assert(
        checkManualContent(contentRoot, manifest).some((error) =>
            error.includes("code differ")
        )
    );
    const manuals = path.join(fixture, "manual-navigation");
    for (const file of manualFiles()) {
        const absolute = path.join(manuals, file);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(
            absolute,
            "# Test\n\n<!-- language-navigation:start -->\n<!-- language-navigation:end -->\n"
        );
    }
    assert.equal(reconcileNavigation(manuals).length, manualFiles().length);
    assert.deepEqual(reconcileNavigation(manuals, true), []);
    assert.deepEqual(reconcileNavigation(manuals), []);
    const stale = path.join(manuals, "README.md");
    fs.writeFileSync(
        stale,
        fs.readFileSync(stale, "utf8").replace("العربية", "stale")
    );
    const before = fs.readFileSync(stale, "utf8");
    fs.rmSync(path.join(manuals, "README.ar.md"));
    assert(
        reconcileNavigation(manuals, true).some((error) =>
            error.includes("Missing complete manual")
        )
    );
    assert.equal(
        fs.readFileSync(stale, "utf8"),
        before,
        "a missing manual must prevent a partial rewrite"
    );
} finally {
    fs.rmSync(fixture, { force: true, recursive: true });
}
const errors = checkDocumentation(root);
assert.deepEqual(errors, [], errors.join("\n"));
console.log(
    "PASS README generation, locale parity, escaping, drift and file links"
);
