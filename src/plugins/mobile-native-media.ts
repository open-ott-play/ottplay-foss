/**
 * MobileNativeMedia — Capacitor 4.4 native media + 4.5 background audio bridges.
 *
 * Real native calls; WebPlugin fallback no-ops with console.warn.
 * Gate on `window.Capacitor` in src/index.ts so Mode A / Tauri stay untouched.
 * Inlined under src/ so tsc rootDir is satisfied.
 */

import { resolveNativePlugin } from "./native-bridge";

/** Metadata pushed into OS Now Playing / MediaSession (Mode B Cap only). */
export interface BackgroundAudioMeta {
    artist?: string;
    /** Optional channel logo / artwork URL (http/https or data:). Fetched when possible. */
    artworkUrl?: string;
    /** Duration in seconds when known (VOD/archive). Omit / non-finite for live. */
    durationSec?: number;
    /** Position in seconds when known. */
    positionSec?: number;
    /** When false/omitted, OS seek controls are disabled / no-op (live IPTV). */
    seekable?: boolean;
    title?: string;
}

export interface MobileNativeMediaPlugin {
    /** Release sleep prevention → device may idle/sleep. */
    allowSleep(): Promise<{ ok: boolean; unsupported?: boolean }>;
    /** Finish the native Activity / leave the Cap app. */
    exitApp(): Promise<{ ok: boolean; unsupported?: boolean; error?: string }>;
    /** Android only: minimize the current Activity into OS PiP, without changing its stream. */
    enterSystemPip(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }>;
    /** OS output volume 0–100. Fails loudly when platform cannot report. */
    getVolume(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        volume: number;
    }>;
    /** Pause background audio session / MediaSession (FGS may stay up). */
    pauseBackgroundAudio(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }>;
    /** iOS native second-channel PiP. Android OTT PiP uses the shared video element. */
    playPip(opts: { url: string }): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }>;
    /** Acquire sleep prevention → keep device awake. */
    preventSleep(): Promise<{ ok: boolean; unsupported?: boolean }>;
    /** Resume background audio after pause. */
    resumeBackgroundAudio(
        opts?: BackgroundAudioMeta
    ): Promise<{ ok: boolean; unsupported?: boolean; error?: string }>;
    /** Full-window fullscreen (immersive on Android). */
    setFullscreen(opts: { fullscreen: boolean }): Promise<{
        ok: boolean;
        unsupported?: boolean;
    }>;
    /** Set OS output volume 0–100. Fails loudly when platform cannot set. */
    setVolume(opts: { volume: number }): Promise<{
        ok: boolean;
        unsupported?: boolean;
        volume: number;
    }>;
    /**
     * Enable background playback: iOS AVAudioSession `.playback` + Now Playing;
     * Android mediaPlayback foreground service (real startForegroundService).
     */
    startBackgroundAudio(
        opts?: BackgroundAudioMeta
    ): Promise<{ ok: boolean; unsupported?: boolean; error?: string }>;
    /** Tear down background audio / stop mediaPlayback FGS. */
    stopBackgroundAudio(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }>;
    /** Stop iOS native second-channel PiP. System Android PiP uses OS controls. */
    stopPip(): Promise<{ ok: boolean; unsupported?: boolean }>;
    /**
     * Refresh Now Playing / MediaSession metadata + timeline without restarting
     * the session. Seekable=false keeps OS seek disabled (live).
     */
    updateBackgroundAudio(
        opts?: BackgroundAudioMeta
    ): Promise<{ ok: boolean; unsupported?: boolean; error?: string }>;
}

class MobileNativeMediaWeb implements MobileNativeMediaPlugin {
    async enterSystemPip(): Promise<{
        ok: boolean;
        unsupported?: boolean;
    }> {
        return { ok: false, unsupported: true };
    }
    async getVolume(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        volume: number;
    }> {
        console.warn("[MobileNativeMedia] web fallback: getVolume unsupported");
        return { ok: false, unsupported: true, volume: 0 };
    }

    async setVolume(_opts: { volume: number }): Promise<{
        ok: boolean;
        unsupported?: boolean;
        volume: number;
    }> {
        console.warn("[MobileNativeMedia] web fallback: setVolume unsupported");
        return { ok: false, unsupported: true, volume: 0 };
    }

    async playPip(_opts: { url: string }): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }> {
        console.warn("[MobileNativeMedia] web fallback: playPip unsupported");
        return { ok: false, unsupported: true };
    }

    async stopPip(): Promise<{ ok: boolean; unsupported?: boolean }> {
        console.warn("[MobileNativeMedia] web fallback: stopPip unsupported");
        return { ok: false, unsupported: true };
    }

    async setFullscreen(_opts: {
        fullscreen: boolean;
    }): Promise<{ ok: boolean; unsupported?: boolean }> {
        console.warn(
            "[MobileNativeMedia] web fallback: setFullscreen unsupported"
        );
        return { ok: false, unsupported: true };
    }

    async allowSleep(): Promise<{ ok: boolean; unsupported?: boolean }> {
        console.warn(
            "[MobileNativeMedia] web fallback: allowSleep unsupported"
        );
        return { ok: false, unsupported: true };
    }

    async exitApp(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }> {
        console.warn("[MobileNativeMedia] web fallback: exitApp unsupported");
        return { ok: false, unsupported: true };
    }

    async preventSleep(): Promise<{ ok: boolean; unsupported?: boolean }> {
        console.warn(
            "[MobileNativeMedia] web fallback: preventSleep unsupported"
        );
        return { ok: false, unsupported: true };
    }

    async startBackgroundAudio(
        _opts?: BackgroundAudioMeta
    ): Promise<{ ok: boolean; unsupported?: boolean; error?: string }> {
        console.warn(
            "[MobileNativeMedia] web fallback: startBackgroundAudio unsupported"
        );
        return { ok: false, unsupported: true };
    }

    async pauseBackgroundAudio(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }> {
        console.warn(
            "[MobileNativeMedia] web fallback: pauseBackgroundAudio unsupported"
        );
        return { ok: false, unsupported: true };
    }

    async resumeBackgroundAudio(
        _opts?: BackgroundAudioMeta
    ): Promise<{ ok: boolean; unsupported?: boolean; error?: string }> {
        console.warn(
            "[MobileNativeMedia] web fallback: resumeBackgroundAudio unsupported"
        );
        return { ok: false, unsupported: true };
    }

    async updateBackgroundAudio(
        _opts?: BackgroundAudioMeta
    ): Promise<{ ok: boolean; unsupported?: boolean; error?: string }> {
        console.warn(
            "[MobileNativeMedia] web fallback: updateBackgroundAudio unsupported"
        );
        return { ok: false, unsupported: true };
    }

    async stopBackgroundAudio(): Promise<{
        ok: boolean;
        unsupported?: boolean;
        error?: string;
    }> {
        console.warn(
            "[MobileNativeMedia] web fallback: stopBackgroundAudio unsupported"
        );
        return { ok: false, unsupported: true };
    }
}

export const MobileNativeMedia = resolveNativePlugin<MobileNativeMediaPlugin>(
    "MobileNativeMedia",
    () => new MobileNativeMediaWeb()
);
