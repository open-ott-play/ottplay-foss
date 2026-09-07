/**
 * mobile-command-queue — Capacitor plugin stub.
 *
 * Native implementation TODO (Phase 3):
 *   - iOS: Swift plugin (src/ios/MobileCommandQueue.swift)
 *   - Android: Kotlin plugin (src/android/.../MobileCommandQueue.kt)
 *
 * For now this exposes a no-op JS interface.
 * The web layer polls a configurable command URL from player settings.
 */
import { registerPlugin, WebPlugin } from "@capacitor/core";

export interface CommandQueuePlugin {
    get(deviceId?: string): Promise<unknown[]>;
    isRunning(): Promise<{ running: boolean }>;
    post(command: unknown): Promise<{ queued: number }>;
    start(): Promise<void>;
    stop(): Promise<void>;
}

class MobileCommandQueueWeb extends WebPlugin implements CommandQueuePlugin {
    async start(): Promise<void> {
        console.warn(
            "[MobileCommandQueue] start() — native impl not available"
        );
    }

    async stop(): Promise<void> {
        console.warn("[MobileCommandQueue] stop() — native impl not available");
    }

    async post(command: unknown): Promise<{ queued: number }> {
        console.warn(
            "[MobileCommandQueue] post() — native impl not available",
            command
        );
        return { queued: 0 };
    }

    async get(deviceId?: string): Promise<unknown[]> {
        console.warn("[MobileCommandQueue] get() — native impl not available", {
            deviceId,
        });
        return [];
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
