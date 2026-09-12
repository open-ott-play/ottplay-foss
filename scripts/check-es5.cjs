#!/usr/bin/env node
// Parse every shared browser/STB asset with an ES5 grammar, including boot HTML.
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('acorn');
const root = path.resolve(__dirname, '..');
let checked = 0;
const failures = [];
function check(code, name) {
    try {
        parse(code, { ecmaVersion: 5, sourceType: 'script' });
        checked++;
    } catch (error) {
        failures.push(name + ': ' + error.message);
    }
}
function tree(directory) {
    for (const name of fs.readdirSync(directory)) {
        const file = path.join(directory, name);
        if (fs.statSync(file).isDirectory()) tree(file);
        else if (file.endsWith('.js')) check(fs.readFileSync(file, 'utf8'), path.relative(root, file));
    }
}
const bundle = path.join(root, 'dist/stbPlayer.js');
if (!fs.existsSync(bundle)) {
    console.error('Missing dist/stbPlayer.js; run the build first.');
    process.exit(1);
}
check(fs.readFileSync(bundle, 'utf8'), 'dist/stbPlayer.js');
for (const directory of ['stb', 'prov', 'js', 'stbPlayer']) tree(path.join(root, directory));
for (const html of ['index.html', 'dist/index.html']) {
    const text = fs.readFileSync(path.join(root, html), 'utf8');
    const scripts = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let number = 0;
    while ((match = scripts.exec(text))) {
        if (match[1].trim()) check(match[1], html + ' inline script ' + (++number));
    }
}
if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('OK: ES5 grammar for ' + checked + ' shared player, device, provider, library and boot scripts');
