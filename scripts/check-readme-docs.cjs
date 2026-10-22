#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { checkGenerated, expectedReadmes } = require("./generate-readmes.cjs");
const {
    manualFiles,
    checkManualContent,
    reconcileNavigation,
} = require("./manual-documentation.cjs");
const root = path.resolve(__dirname, "..");

function checkLinks(repository, file) {
    const absolute = path.resolve(repository, file);
    if (!fs.existsSync(absolute)) return [`Missing document: ${file}`];
    const text = fs
        .readFileSync(absolute, "utf8")
        .replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, "");
    const link =
        /!?\[(?:\\.|[^\]\\])*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*)?\)/g;
    const errors = [];
    const destinations = [...text.matchAll(link)].map(
        (match) => match[1] || match[2]
    );
    destinations.push(
        ...[...text.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)].map(
            (match) => match[1]
        )
    );
    for (const url of destinations) {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;
        const target = decodeURIComponent(url.split(/[?#]/)[0]);
        if (!target) continue;
        const resolved = path.resolve(path.dirname(absolute), target);
        const relative = path.relative(repository, resolved);
        if (
            relative === ".." ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
        )
            errors.push(`${file}: link escapes repository: ${url}`);
        else if (!fs.existsSync(resolved))
            errors.push(`${file}: missing link target: ${url}`);
    }
    return errors;
}

function checkDocumentation(repository = root) {
    const generated = expectedReadmes(repository);
    const readme = path.join(repository, "README.md");
    const countErrors =
        fs.existsSync(readme) &&
        !fs
            .readFileSync(readme, "utf8")
            .includes(`**${generated.size - 1} interface languages**`)
            ? [
                  "README.md: interface language count differs from shipped catalogs",
              ]
            : [];
    const files = [
        "README.md",
        "README.ru.md",
        "android/README.md",
        "docs/android-distributions.md",
        "docs/android-autostart-RU.md",
        "docs/wiki/Home.md",
        "docs/wiki/Home.ru.md",
        "docs/wiki/_Sidebar.md",
        ...[
            "audio-video-check",
            "browser-compatibility",
            "guide-binding-accessibility",
            "implementation-report",
            "playback-stream-policy",
            "remote-handoff",
            "roadmap-delivery",
            "roadmap-size",
            "settings-recovery",
            "xtream-media",
        ].flatMap((name) => [`docs/${name}.md`, `docs/${name}.ru.md`]),
        ...generated.keys(),
        ...manualFiles(),
    ];
    return [
        ...countErrors,
        ...reconcileNavigation(repository),
        ...checkManualContent(repository),
        ...checkGenerated(repository),
        ...[...new Set(files)].flatMap((file) => checkLinks(repository, file)),
    ];
}

if (require.main === module) {
    const errors = checkDocumentation();
    if (errors.length) {
        console.error(errors.join("\n"));
        process.exitCode = 1;
    } else
        console.log("PASS localized quick starts and README/wiki file links");
}
module.exports = { checkDocumentation, checkLinks };
