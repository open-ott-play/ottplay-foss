/** Run a synchronous fallback with the same Promise boundary as an async method. */
export function nativeWebFallback<T>(
    action: () => T | PromiseLike<T>
): Promise<T> {
    // The executor runs now, catches thrown errors, and adopts returned thenables.
    return new Promise<T>(function (resolve) {
        resolve(action());
    });
}
