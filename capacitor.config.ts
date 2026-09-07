import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
    android: {
        allowMixedContent: true,
        backgroundAudio: true,
        minSdkVersion: 24,
    },
    appId: "play.ott.foss",
    appName: "OTT-play FOSS",
    ios: {
        backgroundAudio: true,
        contentInset: "automatic",
    },
    plugins: {
        MobileCommandQueue: {
            // command queue auto-starts via plugin.load on native side
        },
    },
    server: {
        hostname: "localhost",
    },
    webDir: "dist",
};

export default config;
