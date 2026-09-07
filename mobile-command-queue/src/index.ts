/**
 * Mobile command queue — Capacitor plugin + web fallback.
 *
 * Native: starts a real HTTP server on 127.0.0.1:18081 (iOS/Android).
 * Web:    no-op fallback; web layer polls a configurable URL instead.
 */
import { registerPlugin, WebPlugin } from "@capacitor/core";

export interface CommandQueuePlugin {
    /** Drain pending commands. `deviceId` for routing. */
    get(deviceId?: string): Promise<{ commands: unknown[] }>;
    /** Return whether the native server is running. */
    isRunning(): Promise<{ running: boolean }>;
    /** Enqueue a command. `command` is any JSON-serializable value; `deviceId` for routing. */
    post(command: unknown, deviceId?: string): Promise<{ queued: number }>;
    /** Start the native HTTP server on localhost:18081. */
    start(): Promise<void>;
    /** Stop the native HTTP server. */
    stop(): Promise<void>;
}

class MobileCommandQueueWeb extends WebPlugin implements CommandQueuePlugin {
    async start(): Promise<void> {
        console.warn("[MobileCommandQueue] web fallback: no native server");
    }

    async stop(): Promise<void> {}

    async post(
        command: unknown,
        _deviceId?: string
    ): Promise<{ queued: number }> {
        console.warn("[MobileCommandQueue] web fallback: post no-op", command);
        return { queued: 0 };
    }

    async get(_deviceId?: string): Promise<{ commands: unknown[] }> {
        console.warn("[MobileCommandQueue] web fallback: get no-op");
        return { commands: [] };
    }

    async isRunning(): Promise<{ running: boolean }> {
        return { running: false };
    }
}

const MobileCommandQueue = registerPlugin<CommandQueuePlugin>(
    "MobileCommandQueue",
    MobileCommandQueueWeb
);

export { MobileCommandQueue };
