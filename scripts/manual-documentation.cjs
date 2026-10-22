#!/usr/bin/env node
// Inventory and navigation for the complete manuals, independent of UI locales.
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");
const inventory = require("../docs/manual-languages.json");
const root = path.resolve(__dirname, "..");
const start = "<!-- language-navigation:start -->";
const end = "<!-- language-navigation:end -->";

function localizedFile(source, language) {
    return language === "en"
        ? source
        : source.replace(/\.md$/, `.${language}.md`);
}

function manualFiles() {
    return inventory.documents.flatMap((source) =>
        inventory.languages.map(({ code }) => localizedFile(source, code))
    );
}

function navigation(source) {
    const links = inventory.languages.map(
        ({ code, label, dir }) =>
            `<a href="${path.posix.basename(localizedFile(source, code))}" lang="${code}" dir="${dir || "ltr"}">${label}</a>`
    );
    const rows = [];
    for (let offset = 0; offset < links.length; offset += 8)
        rows.push(links.slice(offset, offset + 8).join(" · "));
    return `${start}\n<p dir="ltr">\n${rows.join("\n<br>\n")}\n</p>\n${end}`;
}

function manualContent(text) {
    return text
        .replace(
            /\n*<!-- language-navigation:start -->[\s\S]*?<!-- language-navigation:end -->\n*/g,
            "\n\n"
        )
        .trim();
}

function sourceDigest(text) {
    return createHash("sha256").update(manualContent(text)).digest("hex");
}

function contentContract(text) {
    const code = [];
    const prose = manualContent(text).replace(
        /^```([^\n]*)\n([\s\S]*?)^```[^\n]*$/gm,
        (block, language) => {
            // Diagram labels are translated, while executable samples must remain exact.
            if (language.trim() !== "mermaid") code.push(block);
            return "";
        }
    );
    return {
        code,
        headings: [...prose.matchAll(/^(#{1,6}) /gm)].map((match) => match[1]),
        literals: [...prose.matchAll(/`([^`\n]+)`/g)]
            .map((match) => match[1])
            .sort(),
    };
}

function checkManualContent(repository = root, manifest = inventory) {
    const errors = [];
    for (const source of manifest.documents) {
        const absolute = path.join(repository, source);
        if (!fs.existsSync(absolute)) continue; // Navigation reports missing pages.
        const text = fs.readFileSync(absolute, "utf8");
        if (sourceDigest(text) !== manifest.sourceSha256?.[source])
            errors.push(
                `${source}: source changed; review all translations and update sourceSha256`
            );
        const expected = contentContract(text);
        for (const { code } of manifest.languages) {
            if (code === "en") continue;
            const file = localizedFile(source, code);
            if (!fs.existsSync(path.join(repository, file))) continue;
            const translated = contentContract(
                fs.readFileSync(path.join(repository, file), "utf8")
            );
            for (const property of ["code", "literals", "headings"])
                if (
                    JSON.stringify(expected[property]) !==
                    JSON.stringify(translated[property])
                )
                    errors.push(
                        `${file}: ${property} differ from the complete English manual`
                    );
        }
    }
    return errors;
}

function reconcileNavigation(repository = root, write = false) {
    const errors = [];
    const updates = [];
    for (const source of inventory.documents) {
        const expected = navigation(source);
        for (const { code } of inventory.languages) {
            const file = localizedFile(source, code);
            const absolute = path.join(repository, file);
            if (!fs.existsSync(absolute)) {
                errors.push(`Missing complete manual: ${file}`);
                continue;
            }
            const text = fs.readFileSync(absolute, "utf8");
            if (
                text.split(start).length !== 2 ||
                text.split(end).length !== 2 ||
                text.indexOf(start) > text.indexOf(end)
            ) {
                errors.push(
                    `${file}: expected one ordered language navigation block`
                );
                continue;
            }
            const before = text.slice(0, text.indexOf(start));
            const after = text.slice(text.indexOf(end) + end.length);
            const updated = before + expected + after;
            if (updated !== text) {
                if (write) updates.push([absolute, updated]);
                else
                    errors.push(
                        `${file}: stale language navigation (run npm run docs:manuals)`
                    );
            }
        }
    }
    // Validate the complete set before writing any page.
    if (errors.length === 0)
        for (const [file, text] of updates) fs.writeFileSync(file, text);
    return errors;
}

if (require.main === module) {
    const unknown = process.argv.slice(2).filter((arg) => arg !== "--check");
    const errors = unknown.length
        ? [`Unknown arguments: ${unknown.join(" ")}`]
        : reconcileNavigation(root, !process.argv.includes("--check"));
    if (errors.length) {
        console.error(errors.join("\n"));
        process.exitCode = 1;
    } else
        console.log(
            `PASS ${manualFiles().length} complete manual pages and language navigation`
        );
}
module.exports = {
    checkManualContent,
    localizedFile,
    manualFiles,
    navigation,
    reconcileNavigation,
    sourceDigest,
};
