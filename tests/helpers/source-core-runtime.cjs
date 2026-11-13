/* Load only the shipped bundle for source modules that delegate portable policy. */
const assert = require("node:assert/strict");
const vm = require("node:vm");
const required = {
    "src/channels/channel-references.ts": "createClassicChannelReferences",
    "src/channels/library.ts": "classicChannelLibraryApiVersion",
    "src/guide/reminders.ts": "classicReminderValid",
    "src/offline/playback-selection.ts": "localSourceScanStatus",
    "src/playback/live-recovery.ts": "classicLiveStallLimits",
    "src/provider/source-identity.ts": "utf16Dual32Fingerprint",
    "src/settings/cloud-codec.ts": "readClassicCloudStorage",
    "src/settings/global-favorites-portable.ts":
        "createClassicGlobalFavoritesPortableCodec",
};

module.exports = function prepareSourceRealm(context, relativeFile) {
    const exportName = required[relativeFile];
    if (!exportName) return context;
    if (!vm.isContext(context)) vm.createContext(context);
    if (!context.window) context.window = context;
    let core = context["play.ott:ottplay-shared-core"];
    if (!core) {
        core = require("./shared-core-runtime.cjs")(context, {
            vendorOnly: true,
        });
    } else {
        context.window.OttPlayCore = core;
    }
    assert.equal(
        typeof core[exportName],
        "function",
        "The shipped vendor bundle must supply " +
            exportName +
            " for " +
            relativeFile
    );
    return context;
};
