import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
    appId: "play.ott.foss",
    appName: "OTT-play FOSS",
    // Bridge debug logs include native call options/results (SWOP drafts/tokens).
    loggingBehavior: "none",
    ios: {
        backgroundAudio: true,
        contentInset: "automatic",
    },
    plugins: {
        MobileCommandQueue: {
            // Internal queue only by default; HTTP requires explicit opt-in and a token.
        },
    },
    server: {
        hostname: "localhost",
    },
    webDir: "dist-mobile",
};

export default config;
