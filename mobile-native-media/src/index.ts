/**
 * MobileNativeMedia — Capacitor 4.4 native media bridges.
 *
 * Real native calls; WebPlugin fallback no-ops with console.warn.
 * Gate on `window.Capacitor` in src/index.ts so Mode A / Tauri stay untouched.
 */

import { registerPlugin, WebPlugin } from "@capacitor/core";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MobileNativeMediaPlugin {
    /** Release sleep prevention → device may idle/sleep. */
    allowSleep(): Promise<{ ok: boolean }>;
    /** OS output volume 0–100. Fails loudly when platform cannot report. */
    getVolume(): Promise<{
        ok: boolean;
        volume: number;
        unsupported?: boolean;
    }>;
    /** Enter picture-in-picture. Fails loudly when unavailable. */
    playPip(): Promise<{ ok: boolean }>;
    /** Acquire sleep prevention → keep device awake. */
    preventSleep(): Promise<{ ok: boolean }>;
    /** Full-window fullscreen (immersive on Android, VC on iOS). */
    setFullscreen(fullscreen: boolean): Promise<{ ok: boolean }>;
    /** Set OS output volume 0–100. Fails loudly when platform cannot set. */
    setVolume(volume: number): Promise<{
        ok: boolean;
        volume: number;
        unsupported?: boolean;
    }>;
    /** Exit picture-in-picture. */
    stopPip(): Promise<{ ok: boolean }>;
}

/* ------------------------------------------------------------------ */
/*  Web fallback (Mode A / non-Cap build)                              */
/* ------------------------------------------------------------------ */

class MobileNativeMediaWeb
    extends WebPlugin
    implements MobileNativeMediaPlugin
{
    async getVolume(): Promise<{
        ok: boolean;
        volume: number;
        unsupported?: boolean;
    }> {
        console.warn("[MobileNativeMedia] web fallback: getVolume unsupported");
        return { ok: false, volume: 0, unsupported: true };
    }

    async setVolume(_volume: number): Promise<{
        ok: boolean;
        volume: number;
        unsupported?: boolean;
    }> {
        console.warn("[MobileNativeMedia] web fallback: setVolume unsupported");
        return { ok: false, volume: 0, unsupported: true };
    }

    async playPip(): Promise<{ ok: boolean }> {
        console.warn("[MobileNativeMedia] web fallback: playPip unsupported");
        return { ok: false };
    }

    async stopPip(): Promise<{ ok: boolean }> {
        console.warn("[MobileNativeMedia] web fallback: stopPip unsupported");
        return { ok: false };
    }

    async setFullscreen(_fullscreen: boolean): Promise<{ ok: boolean }> {
        console.warn(
            "[MobileNativeMedia] web fallback: setFullscreen unsupported"
        );
        return { ok: false };
    }

    async allowSleep(): Promise<{ ok: boolean }> {
        console.warn("[MobileNativeMedia] web fallback: allowSleep no-op");
        return { ok: true };
    }

    async preventSleep(): Promise<{ ok: boolean }> {
        console.warn("[MobileNativeMedia] web fallback: preventSleep no-op");
        return { ok: true };
    }
}

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */

export const MobileNativeMedia = registerPlugin<MobileNativeMediaPlugin>(
    "MobileNativeMedia",
    MobileNativeMediaWeb
);
