/**
 * DashExoPlayer — Capacitor native DASH/HLS player bridge.
 *
 * Android: Media3/ExoPlayer with PlayerView overlay.
 * iOS: honest {ok:false, unsupported:true} (WKWebView has no MSE; no AVPlayer DASH).
 * WebPlugin fallback for non-Cap builds only.
 */

import { registerPlugin, WebPlugin } from "@capacitor/core";

export interface DashExoPlayerPlugin {
    isDashSupported(): Promise<{ ok: boolean; unsupported?: boolean }>;
    pauseDash(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }>;
    playDash(opts: {
        url: string;
        position?: number;
    }): Promise<{ ok: boolean; unsupported?: boolean; error?: string }>;
    resumeDash(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }>;
    stopDash(): Promise<{ ok: boolean; unsupported?: boolean; error?: string }>;
}

class DashExoPlayerWeb extends WebPlugin implements DashExoPlayerPlugin {
    async isDashSupported(): Promise<{ ok: boolean; unsupported?: boolean }> {
        console.warn(
            "[DashExoPlayer] web fallback: isDashSupported unsupported"
        );
        return { ok: false, unsupported: true };
    }

    async playDash(_opts: {
        url: string;
        position?: number;
    }): Promise<{ ok: boolean; unsupported?: boolean; error?: string }> {
        console.warn("[DashExoPlayer] web fallback: playDash unsupported");
        return { ok: false, unsupported: true };
    }

    async pauseDash(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }> {
        console.warn("[DashExoPlayer] web fallback: pauseDash unsupported");
        return { ok: false, unsupported: true };
    }

    async resumeDash(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }> {
        console.warn("[DashExoPlayer] web fallback: resumeDash unsupported");
        return { ok: false, unsupported: true };
    }

    async stopDash(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }> {
        console.warn("[DashExoPlayer] web fallback: stopDash unsupported");
        return { ok: false, unsupported: true };
    }
}

export const DashExoPlayer = registerPlugin<DashExoPlayerPlugin>(
    "DashExoPlayer",
    {
        web: () => new DashExoPlayerWeb(),
    }
);
