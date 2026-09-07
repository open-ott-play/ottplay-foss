import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
    android: {
        allowMixedContent: true,
        backgroundAudio: true,
        minSdkVersion: 22,
    },
    appId: "play.ott.foss",
    appName: "OTT-play FOSS",
    ios: {
        backgroundAudio: true,
        contentInset: "automatic",
    },
    plugins: {},
    server: {
        hostname: "localhost",
    },
    webDir: "dist",
};

export default config;
