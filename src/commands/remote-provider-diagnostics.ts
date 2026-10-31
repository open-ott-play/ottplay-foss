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

function providerCompanion(value: any): any {
    return providerRecord(value, {
        active: providerBoolean,
        downloaded: providerNullableInteger,
        error: function (code: any) {
            return (
                code === "" ||
                (typeof code === "string" &&
                    /^(?:companion_(?:access_denied|endpoint_invalid|transport_unavailable|not_configured|timeout|request_failed|source_invalid|selection_invalid|receipt_invalid|too_many_files|no_playable_files|torrent_unavailable|unavailable)|torznab_(?:invalid_(?:source|link|query|category|xml|page)|local_only|search_unavailable|source_(?:missing|changed|limit)|reference_missing|busy|cancelled|timeout|network_error|http_error|response_limit|xml_limit|api_error|store_(?:unavailable|busy|limit))|busy|cleanup_pending|cache_(?:limit|unavailable)|service_stopped|session_(?:missing|stopped|busy|limit)|stream_(?:limit|timeout)|webseed_(?:unavailable|timeout|invalid_range|hash_mismatch|network_denied)|invalid_(?:request|source|file|metadata|tracker)|tracker_limit|file_(?:selection_required|limit)|engine_unavailable|metadata_(?:failed|timeout|limit)|no_files|torrent_failed|initialization_timeout|range_failed|plugin_(?:invalid_manifest|invalid_script|not_found|invalid_input|invalid_output|busy|cancelled|timed_out|execution_failed|network_denied|network_failed|network_limit))$/.test(
                        code
                    ))
            );
        },
        state: providerEnum("metadata select preparing ready error unknown"),
        total: providerNullableInteger,
    });
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

/** Separate wire schema keeps provider v1 compatible with strict consumers. */
export function companionDiagnosticsSnapshot(w: any, runtime: string): any {
    var snapshot: any = {
        capturedAt: Date.now(),
        runtime: runtime,
        session: null,
        version: 1,
    };
    try {
        var companion = w.__ottMediaCompanion;
        var read = companion && companion.diagnostics;
        if (typeof read !== "function") return snapshot;
        var session = providerCompanion(read.call(companion));
        if (companion === w.__ottMediaCompanion) snapshot.session = session;
    } catch (_) {}
    return snapshot;
}
