/**
 * Mobile command queue — Capacitor plugin + web fallback.
 *
 * Native: starts a real HTTP server preferring 127.0.0.1:18081 (iOS/Android),
 * falling back through 18082..=18090 when busy. Pin with OTTPLAY_QUEUE_PORT.
 * Web:    no-op fallback; web layer polls a configurable URL instead.
 */
import { registerPlugin, WebPlugin } from "@capacitor/core";

export interface QueueListenInfo {
    port: number;
    running: boolean;
}

export interface CommandQueuePlugin {
    /** Drain pending commands. `deviceId` for routing. */
    get(deviceId?: string): Promise<{ commands: unknown[] }>;
    /** Return whether the native server is running and which port it bound. */
    isRunning(): Promise<QueueListenInfo>;
    /** Enqueue a command. `command` is any JSON-serializable value; `deviceId` for routing. */
    post(command: unknown, deviceId?: string): Promise<{ queued: number }>;
    /** Start the native HTTP server (prefer :18081, fallback :18082+). */
    start(): Promise<QueueListenInfo>;
    /** Stop the native HTTP server. */
    stop(): Promise<void>;
}

class MobileCommandQueueWeb extends WebPlugin implements CommandQueuePlugin {
    async start(): Promise<QueueListenInfo> {
        console.warn("[MobileCommandQueue] web fallback: no native server");
        return { running: false, port: 0 };
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

    async isRunning(): Promise<QueueListenInfo> {
        return { running: false, port: 0 };
    }
}

const MobileCommandQueue = registerPlugin<CommandQueuePlugin>(
    "MobileCommandQueue",
    MobileCommandQueueWeb
);

export { MobileCommandQueue };
