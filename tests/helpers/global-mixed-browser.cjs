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
                    scanning: false,
                    items: configured
                        .filter((t) => t.entry_index === 0 && !t.rootMissing)
                        .map((t) => ({
                            id: "local-clip-" + t.private_root_id,
                            sourceId: t.private_root_id,
                            name: "Features/clip.mp4",
                            available: true,
                            url: origin + "/mixed/media/local.mp4",
                        })),
                    sources: configured
                        .filter((t) => t.entry_index === 0 && !t.rootMissing)
                        .map((t) => ({
                            id: t.private_root_id,
                            name: "Local Videos",
                            kind: "folder",
                            available: true,
                        })),
                },
            });
        if (/^\/mixed\/(one|two)\.m3u$/.test(u.pathname)) {
            const part = u.pathname.includes("one") ? "one" : "two";
            return route.fulfill({
                contentType: "text/plain",
                body: `#EXTM3U\n#EXTINF:-1 tvg-id="station-${part}",${part === "one" ? "One channel" : "Two channel"}\n${origin}/mixed/media/${part}.mp4\n`,
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
                              type: "category",
                              items: [
                                  {
                                      id: "episode-17",
                                      title: "Portal episode",
                                      type: "stream",
                                      request: {
                                          cmd: "play",
                                          id: "episode-17",
                                      },
                                  },
                              ],
                          }
                        : {
                              type: "category",
                              items: [
                                  {
                                      title: "Series",
                                      type: "category",
                                      request: { cmd: "series" },
                                  },
                              ],
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
                                    ratingKey: "42",
                                    title: "Plex film",
                                    type: "movie",
                                    Media: [
                                        {
                                            container: "mp4",
                                            videoCodec: "h264",
                                            audioCodec: "aac",
                                            Part: [
                                                {
                                                    key: "/library/parts/42/file.mp4",
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                            size: 1,
                            totalSize: 1,
                            offset: 0,
                        },
                    },
                });
            if (endpoint === "/library/parts/42/file.mp4")
                return route.fulfill({ body: bytes, contentType: "video/mp4" });
            if (endpoint.endsWith("/stop") || endpoint.endsWith("/ping"))
                return route.fulfill({ body: "" });
            return route.fulfill({
                status: 404,
                body: "unknown synthetic route",
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
                www: "",
                rechours: 0,
            }));
            for (const t of targets.filter(
                (t) => t.configured_origin.provider === "m3u"
            ))
                m3us[t.profile_slot] = {
                    name: t.configured_origin.profile,
                    www:
                        origin +
                        "/mixed/" +
                        (t.entry_index === 1 ? "one" : "two") +
                        ".m3u",
                    rechours: 0,
                };
            const portals = Array.from({ length: 15 }, () => ({
                name: "",
                link: "",
                sections: [],
            }));
            for (const t of targets.filter((t) => t.entry_index === 2))
                portals[t.profile_slot] = {
                    name: t.configured_origin.profile,
                    link: "portal::[key:synthetic]https://portal.fixture/api/",
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
                        version: 1,
                        provider: "offline",
                        binding_id: binding,
                        name: t.configured_origin.profile,
                        selected: null,
                        sources,
                    };
                profiles[t.profile_slot] = profile;
                bindings[binding] = {
                    library: "browser:" + origin + "/mixed/local",
                    signature: JSON.stringify({ selected: null, sources }),
                    sources: mapped,
                    selected: null,
                };
            }
            const m3u = targets.find(
                    (t) => t.configured_origin.provider === "m3u"
                ),
                local = targets.find((t) => t.entry_index === 0),
                portal = targets.find((t) => t.entry_index === 2);
            const values = {
                ottplaylang: "_eng",
                ottplayprov: "m3u",
                m3um3uArr: JSON.stringify({
                    active: m3u.profile_slot,
                    M3Us: m3us,
                }),
                vportalprofiles: JSON.stringify({
                    active: portal.profile_slot,
                    portals,
                }),
                localMediaEndpoint: origin + "/mixed/local",
                offlineProfiles: JSON.stringify({
                    version: 1,
                    active: local ? local.profile_slot : -1,
                    profiles,
                }),
                offlineProfileBindings: JSON.stringify(bindings),
                plexcfg: JSON.stringify({
                    address: origin + "/mixed/plex",
                    token: "synthetic",
                    playback: "original",
                    account: {
                        id: "fixture-pms",
                        connections: [
                            {
                                url: origin + "/mixed/plex",
                                local: true,
                                secure: false,
                                relay: false,
                            },
                        ],
                    },
                }),
                m3usPlayers: "0",
                vportalsPlayers: "0",
                plexsPlayers: "0",
                offlinesPlayers: "0",
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
        { origin, targets: configured, name }
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
                { provider, number: target.profile_slot + 1 }
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
                operation_id: d.admission.operation_id,
                mode: "merge",
                expected_revision: d.revision,
                expected_context_revision: d.context_revision,
                document_sha256: hash,
                size_bytes: bytes.length,
                chunk_count: 1,
                budget_ms: 60000,
                required_kinds: host.codec.requiredLocatorKinds(document),
            });
        await call("append", {
            transaction_id: b.transaction_id,
            seq: 0,
            offset: 0,
            chunk_sha256: hash,
            data_base64: ports.base64Encode(bytes),
        });
        const p = await call("preview", {
            transaction_id: b.transaction_id,
            page_offset: 0,
            max_entries: 64,
        });
        if (!p.ready) throw Error("fixture preview not ready");
        await call("commit", {
            transaction_id: b.transaction_id,
            operation_id: b.operation_id,
            plan_digest: p.plan_digest,
        });
        return (await host.store.snapshot()).entries.map((row) => ({
            id: row.id,
            entry: {
                title: row.title,
                origin: row.origin,
                locator: row.locator,
            },
        }));
    }, document);
}
module.exports.importDocument = importDocument;

async function openFavorites(page, ids, selectedId = ids[0]) {
    const before = await page.evaluate(() => {
        const owner = window.__ottClassicScreenPort.screens.current();
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
        { ids, selectedId, previous: before.id }
    );
}
module.exports.openFavorites = openFavorites;
