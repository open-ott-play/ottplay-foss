"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    ts = require("typescript");
const root = path.resolve(__dirname, "../..");
function actualModule(name, window, overrides = {}) {
    const exports = {};
    const code = ts.transpileModule(
        fs.readFileSync(path.join(root, name), "utf8"),
        {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText;
    vm.runInNewContext(code, {
        exports,
        window,
        URL,
        console,
        require(relative) {
            if (Object.prototype.hasOwnProperty.call(overrides, relative))
                return overrides[relative];
            return actualModule(
                path.posix.normalize(
                    path.posix.join(path.posix.dirname(name), relative + ".ts")
                ),
                window
            );
        },
    });
    return exports;
}
function actualFunctions(file, names) {
    const ast = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(root, file), "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const selected = ast.statements.filter(
        (n) =>
            (ts.isFunctionDeclaration(n) && names.includes(n.name?.text)) ||
            (ts.isVariableStatement(n) &&
                n.declarationList.declarations.some((d) =>
                    names.includes(d.name.getText(ast))
                ))
    );
    for (const name of names)
        assert(
            selected.some((n) =>
                ts.isFunctionDeclaration(n)
                    ? n.name?.text === name
                    : n.declarationList.declarations.some(
                          (d) => d.name.getText(ast) === name
                      )
            ),
            "Missing actual MAIN function " + name
        );
    return ts.transpileModule(
        selected
            .map((n) => n.getText(ast).replace(/^export\s+/, ""))
            .join("\n"),
        { compilerOptions: { target: ts.ScriptTarget.ES5 } }
    ).outputText;
}
function createMainPorts(w) {
    function call(name, args) {
        if (typeof w[name] !== "function")
            throw Error("Fixture has no actual host port: " + name);
        return w[name].apply(w, args);
    }
    const context = vm.createContext({
        window: w,
        URL,
        console,
        alert: (...args) => call("alert", args),
        _: (...args) => call("_", args),
        stbGetItem: (...args) => call("stbGetItem", args),
        stbSetItem: (...args) => call("stbSetItem", args),
        loadProv: (...args) => call("loadProv", args),
        enterPinAndSetAccess: (...args) => call("enterPinAndSetAccess", args),
    });
    vm.runInContext(
        actualFunctions("src/provider/index.ts", [
            "providerDistribution",
            "providerIds",
            "isPlayDistribution",
            "isProviderAllowed",
            "checkProviderUrl",
            "selectProviderByIndex",
        ]),
        context
    );
    vm.runInContext(
        actualFunctions("src/commands/remote-restart.ts", ["remoteCheckpoint"]),
        context
    );
    const provider = {
        isProviderAllowed: context.isProviderAllowed,
        checkProviderUrl: context.checkProviderUrl,
        selectProviderByIndex: context.selectProviderByIndex,
    };
    Object.defineProperty(provider, "providerIds", {
        get: () => context.providerIds,
    });
    const profiles = actualModule("src/commands/remote-profiles.ts", w, {
        "../provider": provider,
    });
    const caseless = actualModule("src/utils/caseless.ts", w);
    return {
        caselessKey: caseless.caselessKey,
        remoteCheckpoint: context.remoteCheckpoint,
        handleRemoteProfiles: profiles.handleRemoteProfiles,
        selectMediaProfile: profiles.selectGlobalMediaProfile,
        isProviderAllowed: provider.isProviderAllowed,
        providerIds: () => provider.providerIds,
        selectProviderByIndex: provider.selectProviderByIndex,
        providerModule: provider,
        profilesModule: profiles,
    };
}
module.exports = { createMainPorts, actualModule };
