/** Resolve typed native proxies without importing an SDK into the classic STB bundle. */
interface NativePluginRegistry {
    Plugins?: Record<string, unknown>;
    registerPlugin?<T>(name: string, options: { web: () => T }): T;
}

export function resolveNativePlugin<T>(name: string, createWeb: () => T): T {
    const capacitor: NativePluginRegistry | undefined =
        typeof window === "undefined" ? undefined : window.Capacitor;
    const registered = capacitor?.Plugins?.[name];
    if (registered) return registered as T;
    if (typeof capacitor?.registerPlugin === "function") {
        return capacitor.registerPlugin<T>(name, { web: createWeb });
    }
    return createWeb();
}
