/**
 * DashExoPlayer — explicit native DASH/HLS bridge, outside normal OTT playback.
 *
 * Android: Media3/ExoPlayer with PlayerView overlay.
 * iOS: honest {ok:false, unsupported:true} (WKWebView has no MSE; no AVPlayer DASH).
 * WebPlugin fallback for non-Cap builds only.
 * The main player never selects this plugin automatically: the native overlay
 * does not implement the complete TS player state, controls and layout contract.
 */

import { resolveNativePlugin } from "./native-bridge";

export interface DashPlaybackState {
    duration: number;
    ended: boolean;
    error?: string;
    ok: boolean;
    playing: boolean;
    position: number;
    unsupported?: boolean;
}

export interface DashExoPlayerPlugin {
    getPlaybackState(): Promise<DashPlaybackState>;
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
    seekDash(opts: {
        position: number;
    }): Promise<{ ok: boolean; unsupported?: boolean; error?: string }>;
    stopDash(): Promise<{ ok: boolean; unsupported?: boolean; error?: string }>;
}

class DashExoPlayerWeb implements DashExoPlayerPlugin {
    async getPlaybackState(): Promise<DashPlaybackState> {
        return {
            duration: 0,
            ended: false,
            ok: false,
            playing: false,
            position: 0,
            unsupported: true,
        };
    }

    async seekDash(_opts: {
        position: number;
    }): Promise<{ ok: boolean; unsupported?: boolean }> {
        return { ok: false, unsupported: true };
    }

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

export const DashExoPlayer = resolveNativePlugin<DashExoPlayerPlugin>(
    "DashExoPlayer",
    () => new DashExoPlayerWeb()
);
