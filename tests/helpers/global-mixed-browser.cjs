// Synthetic transport only. Player, host, profile adapters and decoder remain production code.
const fs = require("node:fs"),
    path = require("node:path");
const fixture = require("../fixtures/global-mixed-sequence.json");
function movie() {
    const parts = [],
        segment = fs.readFileSync(
            path.resolve(__dirname, "../fixtures/media-runtime/segment00.ts")
        );
    for (let i = 0; i < 6; i++) {
        const mux = new (require("mux.js").mp4.Transmuxer)({
            baseMediaDecodeTime: i * 180000,
            remux: true,
        });
        mux.on("data", (d) => {
            if (!i) parts.push(Buffer.from(d.initSegment));
            parts.push(Buffer.from(d.data));
        });
        mux.push(new Uint8Array(segment));
        mux.flush();
    }
    return Buffer.concat(parts);
}
function scenarioTargets(name, scenario) {
    const all = JSON.parse(JSON.stringify(fixture.hosts[name].targets));
    if (!scenario) return all;
    const result = all.filter(
        (t) =>
            t.entry_index === 0 ||
            !scenario.omit_target_entries.includes(t.entry_index)
    );
    if (scenario.omit_target_entries.includes(0))
        result.find((t) => t.entry_index === 0).rootMissing = true;
    for (const index of scenario.duplicate_target_entries) {
        const copy = JSON.parse(JSON.stringify(all[index]));
        copy.profile_slot = index === 0 ? copy.profile_slot : 10;
        if (index !== 0) copy.private_profile_id += "-duplicate";
        if (index === 0) {
            copy.private_root_id += "-duplicate";
            copy.rootKey = "s1";
        }
        result.push(copy);
    }
    return result;
}
async function install(context, baseURL, name, scenario) {
    const origin = new URL(baseURL).origin,
        targets = fixture.hosts[name].targets,
        configured = scenarioTargets(name, scenario),
        bytes = movie();
    await context.route("**/*", async (route) => {
        const req = route.request(),
            u = new URL(req.url());
        if (u.origin !== origin) return route.abort();
        if (u.pathname === "/mixed/local")
            return route.fulfill({
                json: {
                    items: configured
                        .filter((t) => t.entry_index === 0 && !t.rootMissing)
                        .map((t) => ({
                            available: true,
                            id: "local-clip-" + t.private_root_id,
                            name: "Features/clip.mp4",
                            sourceId: t.private_root_id,
                            url: origin + "/mixed/media/local.mp4",
                        })),
                    scanning: false,
                    sources: configured
                        .filter((t) => t.entry_index === 0 && !t.rootMissing)
                        .map((t) => ({
                            available: true,
                            id: t.private_root_id,
                            kind: "folder",
                            name: "Local Videos",
                        })),
                },
            });
        if (/^\/mixed\/(one|two)\.m3u$/.test(u.pathname)) {
            const part = u.pathname.includes("one") ? "one" : "two";
            return route.fulfill({
                body: `#EXTM3U\n#EXTINF:-1 tvg-id="station-${part}",${part === "one" ? "One channel" : "Two channel"}\n${origin}/mixed/media/${part}.mp4\n`,
                contentType: "text/plain",
            });
        }
        if (u.pathname.endsWith("/vportal/api")) {
            const body = req.postDataJSON(),
                p = body.params || body;
            if (p.cmd === "play")
                return route.fulfill({
                    json: {
                        type: "stream",
                        url: origin + "/mixed/media/portal.mp4",
                    },
                });
            return route.fulfill({
                json:
                    p.cmd === "series"
                        ? {
                              items: [
                                  {
                                      id: "episode-17",
                                      request: {
                                          cmd: "play",
                                          id: "episode-17",
                                      },
                                      title: "Portal episode",
                                      type: "stream",
                                  },
                              ],
                              type: "category",
                          }
                        : {
                              items: [
                                  {
                                      request: { cmd: "series" },
                                      title: "Series",
                                      type: "category",
                                  },
                              ],
                              type: "category",
                          },
            });
        }
        if (u.pathname.startsWith("/mixed/plex/")) {
            const endpoint = u.pathname.slice(11);
            if (endpoint === "/identity")
                return route.fulfill({
                    json: {
                        MediaContainer: { machineIdentifier: "fixture-pms" },
                    },
                });
            if (endpoint === "/library/sections")
                return route.fulfill({
                    json: {
                        MediaContainer: {
                            Directory: [
                                { key: "1", title: "Films", type: "movie" },
                            ],
                        },
                    },
                });
            if (
                endpoint === "/library/sections/1/all" ||
                endpoint === "/library/metadata/42"
            )
                return route.fulfill({
                    json: {
                        MediaContainer: {
                            Metadata: [
                                {
                                    Media: [
                                        {
                                            audioCodec: "aac",
                                            container: "mp4",
                                            Part: [
                                                {
                                                    key: "/library/parts/42/file.mp4",
                                                },
                                            ],
                                            videoCodec: "h264",
                                        },
                                    ],
                                    ratingKey: "42",
                                    title: "Plex film",
                                    type: "movie",
                                },
                            ],
                            offset: 0,
                            size: 1,
                            totalSize: 1,
                        },
                    },
                });
            if (endpoint === "/library/parts/42/file.mp4")
                return route.fulfill({ body: bytes, contentType: "video/mp4" });
            if (endpoint.endsWith("/stop") || endpoint.endsWith("/ping"))
                return route.fulfill({ body: "" });
            return route.fulfill({
                body: "unknown synthetic route",
                status: 404,
            });
        }
        if (/^\/mixed\/media\/(local|one|two|portal)\.mp4$/.test(u.pathname))
            return route.fulfill({ body: bytes, contentType: "video/mp4" });
        return route.continue();
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.addInitScript(
        ({ origin, targets, name }) => {
            const m3us = Array.from({ length: 15 }, () => ({
                name: "",
                rechours: 0,
                www: "",
            }));
            for (const t of targets.filter(
                (t) => t.configured_origin.provider === "m3u"
            ))
                m3us[t.profile_slot] = {
                    name: t.configured_origin.profile,
                    rechours: 0,
                    www:
                        origin +
                        "/mixed/" +
                        (t.entry_index === 1 ? "one" : "two") +
                        ".m3u",
                };
            const portals = Array.from({ length: 15 }, () => ({
                link: "",
                name: "",
                sections: [],
            }));
            for (const t of targets.filter((t) => t.entry_index === 2))
                portals[t.profile_slot] = {
                    link: "portal::[key:synthetic]https://portal.fixture/api/",
                    name: t.configured_origin.profile,
                    sections: [],
                };
            const profiles = Array.from({ length: 15 }, () => null),
                bindings = {};
            for (const t of targets.filter((t) => t.entry_index === 0)) {
                if (profiles[t.profile_slot]) continue;
                const roots = targets.filter(
                        (r) =>
                            r.entry_index === 0 &&
                            r.profile_slot === t.profile_slot &&
                            !r.rootMissing
                    ),
                    sources = roots.map((r) => ({
                        key: r.rootKey || "s0",
                        kind: "folder",
                        name: "Local Videos",
                    })),
                    mapped = {};
                for (const root of roots)
                    mapped[root.rootKey || "s0"] = root.private_root_id;
                const binding =
                        "00000000-0000-4000-8000-" +
                        String(
                            (name === "origin" ? 100 : 200) + t.profile_slot
                        ).padStart(12, "0"),
                    profile = {
                        binding_id: binding,
                        name: t.configured_origin.profile,
                        provider: "offline",
                        selected: null,
                        sources,
                        version: 1,
                    };
                profiles[t.profile_slot] = profile;
                bindings[binding] = {
                    library: "browser:" + origin + "/mixed/local",
                    selected: null,
                    signature: JSON.stringify({ selected: null, sources }),
                    sources: mapped,
                };
            }
            const m3u = targets.find(
                    (t) => t.configured_origin.provider === "m3u"
                ),
                local = targets.find((t) => t.entry_index === 0),
                portal = targets.find((t) => t.entry_index === 2);
            const values = {
                localMediaEndpoint: origin + "/mixed/local",
                m3um3uArr: JSON.stringify({
                    active: m3u.profile_slot,
                    M3Us: m3us,
                }),
                m3usPlayers: "0",
                offlineProfileBindings: JSON.stringify(bindings),
                offlineProfiles: JSON.stringify({
                    active: local ? local.profile_slot : -1,
                    profiles,
                    version: 1,
                }),
                offlinesPlayers: "0",
                ottplaylang: "_eng",
                ottplayprov: "m3u",
                plexcfg: JSON.stringify({
                    account: {
                        connections: [
                            {
                                local: true,
                                relay: false,
                                secure: false,
                                url: origin + "/mixed/plex",
                            },
                        ],
                        id: "fixture-pms",
                    },
                    address: origin + "/mixed/plex",
                    playback: "original",
                    token: "synthetic",
                }),
                plexsPlayers: "0",
                vportalprofiles: JSON.stringify({
                    active: portal.profile_slot,
                    portals,
                }),
                vportalsPlayers: "0",
            };
            for (const key of Object.keys(values))
                localStorage.setItem(key, values[key]);
            const play = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function () {
                this.muted = true;
                return play.call(this);
            };
            window.__mixedObserved = [];
            document.addEventListener(
                "playing",
                (event) => {
                    if (event.target instanceof HTMLMediaElement)
                        window.__mixedObserved.push({
                            provider: window.__ottActiveProviderDriver?.id,
                            url: event.target.currentSrc,
                        });
                },
                true
            );
        },
        { name, origin, targets: configured }
    );
}
module.exports = { fixture, install, scenarioTargets };
async function ensure(page) {
    await page.waitForFunction(
        () => typeof window.__ottEnsureGlobalFavorites === "function"
    );
    await page.evaluate(
        () =>
            new Promise((resolve, reject) =>
                window.__ottEnsureGlobalFavorites((error) =>
                    error ? reject(Error(error)) : resolve()
                )
            )
    );
}
async function pair(page, targets) {
    for (const target of targets) {
        if (target.rootMissing) continue;
        const provider =
            target.configured_origin.provider === "local"
                ? "offline"
                : target.configured_origin.provider;
        await page.evaluate(
            (provider) =>
                window.selectProviderByIndex(
                    window.providerIds.indexOf(provider)
                ),
            provider
        );
        await page.waitForFunction(
            (provider) =>
                window.__ottActiveProviderDriver?.id === provider &&
                window.commandChannelsReady,
            provider
        );
        if (provider !== "plex") {
            await page.evaluate(
                async ({ provider, number }) => {
                    const request = { action: "profile", params: { number } },
                        result =
                            provider === "offline"
                                ? await window.__ottOfflineProfiles.request(
                                      request
                                  )
                                : await new Promise((resolve) =>
                                      window.handleRemoteProfiles(
                                          request,
                                          resolve
                                      )
                                  );
                    if (result.status !== "ok")
                        throw Error("fixture profile rejected");
                },
                { number: target.profile_slot + 1, provider }
            );
            await page.waitForFunction(() => window.commandChannelsReady);
        } else
            await page.waitForFunction(
                () => !!window.__ottActiveProviderDriver.favoritesSource?.()
            );
        await ensure(page);
        await page.evaluate(
            async (target) =>
                window.__ottGlobalFavorites.pair(
                    target.configured_origin,
                    target.configured_origin.provider === "plex"
                        ? null
                        : target.profile_slot,
                    target.private_root_id
                        ? {
                              alias: target.configured_root_alias,
                              id: target.private_root_id,
                              key: target.rootKey || "s0",
                          }
                        : undefined,
                    () => true
                ),
            target
        );
    }
}
module.exports.ensure = ensure;
module.exports.pair = pair;
async function importDocument(page, document) {
    return page.evaluate(async (document) => {
        const host = window.__ottGlobalFavorites,
            ports = window.__ottGlobalFavoritesPorts,
            runtime = ports.runtime();
        async function call(op, fields = {}) {
            const p = { op, runtime, ...fields },
                result = await host.protocol.execute(
                    p,
                    new TextEncoder().encode(JSON.stringify(p)).length,
                    Date.now() / 1000 + 30,
                    () => true
                );
            if (result.error) throw Error(op + ":" + result.error);
            return result;
        }
        const d = await call("describe"),
            bytes = new TextEncoder().encode(JSON.stringify(document)),
            hash = await ports.sha256(bytes),
            b = await call("begin", {
                budget_ms: 60000,
                chunk_count: 1,
                document_sha256: hash,
                expected_context_revision: d.context_revision,
                expected_revision: d.revision,
                mode: "merge",
                operation_id: d.admission.operation_id,
                required_kinds: host.codec.requiredLocatorKinds(document),
                size_bytes: bytes.length,
            });
        await call("append", {
            chunk_sha256: hash,
            data_base64: ports.base64Encode(bytes),
            offset: 0,
            seq: 0,
            transaction_id: b.transaction_id,
        });
        const p = await call("preview", {
            max_entries: 64,
            page_offset: 0,
            transaction_id: b.transaction_id,
        });
        if (!p.ready) throw Error("fixture preview not ready");
        await call("commit", {
            operation_id: b.operation_id,
            plan_digest: p.plan_digest,
            transaction_id: b.transaction_id,
        });
        return (await host.store.snapshot()).entries.map((row) => ({
            entry: {
                locator: row.locator,
                origin: row.origin,
                title: row.title,
            },
            id: row.id,
        }));
    }, document);
}
module.exports.importDocument = importDocument;

async function openFavorites(page, ids, selectedId = ids[0]) {
    const before = await page.evaluate(() => {
        const owner = window.__ottClassicScreenPort.screens.current();
        // biome-ignore assist/source/useSortedKeys: Capture the prior owner ID before invoking the open action.
        const result = {
            id: owner ? owner.id : null,
            accepted: window.openGlobalFavorites(),
        };
        return result;
    });
    if (before.accepted !== true)
        throw Error("global Favorites open was not admitted");
    await page.waitForFunction(
        ({ ids, selectedId, previous }) => {
            const owner = window.__ottClassicScreenPort?.screens.current(),
                list = document.getElementById("list");
            return (
                !!owner &&
                owner.id !== previous &&
                owner.kind === "list" &&
                owner.active() &&
                owner.foreground() &&
                window.isListVisible === true &&
                !!list &&
                list.getClientRects().length > 0 &&
                owner.model.items === window.listArray &&
                owner.model.handler === window.listKeyHandlerFn &&
                JSON.stringify(window.listArray) === JSON.stringify(ids) &&
                (selectedId == null ||
                    window.listArray[window.selIndex] === selectedId)
            );
        },
        { ids, previous: before.id, selectedId }
    );
}
module.exports.openFavorites = openFavorites;
