/** Preserve the companion shims' callback order and Deferred return contract. */
export function nativePromiseToJq<T>(
    $: any,
    promise: PromiseLike<T>,
    opts: any,
    fallbackMessage: string
): any {
    const dfd = $.Deferred();
    // Subscribe directly: native Promises stay asynchronous, while an existing
    // synchronous thenable retains its original timing and thrown errors.
    promise.then(
        (value: T) => {
            try {
                if (typeof opts.success === "function") {
                    opts.success(value, "success", dfd);
                }
            } catch (_error) {}
            try {
                if (typeof opts.complete === "function") {
                    opts.complete(dfd, "success");
                }
            } catch (_error) {}
            dfd.resolve(value);
        },
        (error: any) => {
            const message = error != null ? String(error) : fallbackMessage;
            try {
                if (typeof opts.error === "function") {
                    opts.error(
                        { responseText: message, status: 0 },
                        "error",
                        message
                    );
                }
            } catch (_error) {}
            try {
                if (typeof opts.complete === "function") {
                    opts.complete(dfd, "error");
                }
            } catch (_error) {}
            dfd.reject(message);
        }
    );
    return dfd.promise(dfd);
}
