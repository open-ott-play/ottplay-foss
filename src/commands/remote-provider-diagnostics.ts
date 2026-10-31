/** Project provider-owned observations without exporting configuration or media. */
function providerInteger(value: any): boolean {
    return (
        typeof value === "number" &&
        isFinite(value) &&
        value >= 0 &&
        value <= 9007199254740991 &&
        Math.floor(value) === value
    );
}

function providerNullableInteger(value: any): boolean {
    return value === null || providerInteger(value);
}

function providerBoolean(value: any): boolean {
    return typeof value === "boolean";
}

function providerEnum(values: string): (value: any) => boolean {
    var allowed = values.split(" ");
    return function (value) {
        return allowed.indexOf(value) >= 0;
    };
}

function providerRecord(value: any, fields: any): any {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("invalid_observation");
    var projected: any = {};
    Object.keys(fields).forEach(function (key) {
        var item = value[key];
        if (!fields[key](item)) throw new Error("invalid_observation");
        projected[key] = item;
    });
    return projected;
}

function providerAddonCount(value: any): boolean {
    return providerInteger(value) && value <= 8;
}

export function providerDiagnosticsSnapshot(w: any, runtime: string): any {
    var empty = {
        available: false,
        capturedAt: Date.now(),
        catalog: null,
        lookup: null,
        provider: null,
        requests: [],
        requestsDropped: 0,
        runtime: runtime,
        version: 1,
    };
    try {
        var driver = w.__ottActiveProviderDriver;
        var browser = driver && driver.catalogBrowser;
        if (
            !driver ||
            driver.id !== "torrent" ||
            !browser ||
            typeof browser.diagnostics !== "function"
        )
            return empty;
        var value = browser.diagnostics();
        if (!value || driver !== w.__ottActiveProviderDriver) return empty;
        var catalogValue = value.catalog;
        var lookupValue = value.lookup;
        var requestValues = value.requests;
        var requestsDropped = value.requestsDropped;
        var catalog =
            catalogValue === null
                ? null
                : providerRecord(catalogValue, {
                      autoPages: providerBoolean,
                      busy: providerBoolean,
                      loadedCount: providerInteger,
                      nextCursor: providerNullableInteger,
                      selectedIndex: providerNullableInteger,
                      view: providerEnum("channels categories streams"),
                  });
        var lookup =
            lookupValue === null
                ? null
                : providerRecord(lookupValue, {
                      addonCount: providerAddonCount,
                      ageMs: providerInteger,
                      failedAddons: providerAddonCount,
                      id: providerInteger,
                      movieIdKind: providerEnum("imdb tmdb custom unknown"),
                      playableCount: providerInteger,
                      skippedAddons: providerAddonCount,
                      state: providerEnum(
                          "pending ready empty failed unsupported cancelled"
                      ),
                      unsupportedCount: providerInteger,
                  });
        if (
            !Array.isArray(requestValues) ||
            requestValues.length > 16 ||
            !providerInteger(requestsDropped) ||
            (!lookup && (requestValues.length || requestsDropped))
        )
            return empty;
        var requestCount = requestValues.length;
        var previousId = -1;
        var requests: any[] = [];
        for (var i = 0; i < requestCount; i++) {
            var projected = providerRecord(requestValues[i], {
                addonIndex: function (index: any) {
                    return providerInteger(index) && index < 8;
                },
                ageMs: providerInteger,
                durationMs: providerNullableInteger,
                httpStatus: function (status: any) {
                    return (
                        status === null ||
                        (providerInteger(status) &&
                            status >= 100 &&
                            status <= 599)
                    );
                },
                id: providerInteger,
                lookupId: providerInteger,
                outcome: providerEnum(
                    "pending ok http_error transport_error timeout invalid_response cancelled"
                ),
                responseBytes: providerNullableInteger,
                stage: providerEnum("manifest stream"),
            });
            if (
                !lookup ||
                projected.lookupId !== lookup.id ||
                projected.id <= previousId ||
                projected.addonIndex >= lookup.addonCount
            )
                throw new Error("invalid_observation");
            previousId = projected.id;
            requests.push(projected);
        }
        if (
            driver !== w.__ottActiveProviderDriver ||
            browser !== driver.catalogBrowser
        )
            return empty;
        return {
            available: true,
            capturedAt: empty.capturedAt,
            catalog: catalog,
            lookup: lookup,
            provider: "torrent",
            requests: requests,
            requestsDropped: requestsDropped,
            runtime: runtime,
            version: 1,
        };
    } catch (_) {
        return empty;
    }
}
