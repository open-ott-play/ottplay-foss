// No Storage, LockManager, location or native methods are replaced by this fixture.
(function () {
    "use strict";
    const state = { entered: false, settled: false };
    const key = "ottplay-native-qualification-only";
    let grant = null,
        mainStorage = null,
        bareGrant = null,
        storage = null,
        failure = null;
    try {
        storage = window.localStorage;
        bareGrant = window
            .nativeFixtureLoad("favorites-physical-storage")
            .createFavoritesPhysicalStorageGrant(window, storage, () => true);
        const lz = window.nativeFixtureLoad("lzstring");
        window.compress = lz.compress;
        window.decompress = lz.decompress;
        mainStorage = window.nativeFixtureLoad("storage-main");
        window.stbGetItem = mainStorage.stbGetItem;
        window.stbSetItem = mainStorage.stbSetItem;
        window.stbDelItem = mainStorage.stbDelItem;
        window.stbGetPersistedItem = mainStorage.stbGetPersistedItem;
        mainStorage.setProviderPrefix("plex");
        grant = mainStorage.captureFavoritesPhysicalStorage();
    } catch (error) {
        failure = error.name;
    }
    const api = {
        async acquired() {
            try {
                return await grant.exclusive(() => true);
            } catch (error) {
                if (error.message === "busy") return false;
                throw error;
            }
        },
        beginHold() {
            if (!grant || state.entered)
                throw Error("Actual grant unavailable or already held");
            state.work = grant
                .exclusive(async () => {
                    state.entered = true;
                    await new Promise((resolve) => {
                        state.release = resolve;
                    });
                })
                .then(
                    () => {
                        state.settled = true;
                    },
                    (error) => {
                        state.error = error.message;
                        throw error;
                    }
                );
            return true;
        },
        capabilities() {
            return {
                actualLocks: !!(
                    navigator.locks &&
                    typeof navigator.locks.request === "function"
                ),
                barePhysicalGrant: !!bareGrant,
                current: !!grant && grant.current(),
                failure,
                grant: !!grant,
                href: window.location.href,
                origin: window.location.origin,
                productionCapture: !!grant,
                secureContext: window.isSecureContext,
                settingsRecoveryRequired: mainStorage
                    ? mainStorage.settingsRecoveryRequired()
                    : null,
                storage: !!storage,
            };
        },
        async finalCompare() {
            storage.setItem(key, "before");
            let calls = 0;
            const outcome = await grant.exclusive(() =>
                grant.compareAndSwap(key, "before", "after", () => {
                    calls++;
                    if (calls === 2) storage.setItem(key, "competing");
                    return true;
                })
            );
            return {
                admissionCalls: calls,
                outcome,
                value: storage.getItem(key),
            };
        },
        get() {
            return storage.getItem(key);
        },
        release() {
            state.release();
            return true;
        },
        set(value) {
            storage.setItem(key, value);
            return storage.getItem(key);
        },
        state,
    };
    const tv = "favoritesLibrary:native-channel-source";
    const media = "mediaJournal.v1:native-source";
    Object.defineProperty(window, "nativeStorageFacade", {
        value: {
            capture: () => mainStorage.captureFavoritesPhysicalStorage(),
            raw(key) {
                const value = mainStorage.stbGetItem(key);
                if (
                    mainStorage.stbGetPersistedItem(key) !== value ||
                    mainStorage.captureFavoritesPhysicalRead().read(key) !==
                        value
                )
                    throw Error(
                        "Production reader/persisted/physical mismatch"
                    );
                return value;
            },
            reader: () => mainStorage.captureFavoritesPhysicalRead(),
            readTargets() {
                const tvDecoded = mainStorage.providerGetItem(tv);
                const mediaDecoded = mainStorage.providerGetItem(media);
                const tvRaw = this.raw("plex" + tv);
                const mediaRaw = this.raw("plex" + media);
                const validation = window.nativeProviderTargetValidation;
                validation.validate("tv", tvDecoded, tvRaw);
                validation.validate("media", mediaDecoded, mediaRaw);
                return {
                    aliasesMatch:
                        window.stbGetItem === mainStorage.storage.get &&
                        window.stbSetItem === mainStorage.storage.set,
                    ledgerRaw: this.raw("favorites-receipts.v1"),
                    media: mediaDecoded,
                    mediaRawUnits: Array.from(
                        { length: mediaRaw.length },
                        (_, i) => mediaRaw.charCodeAt(i)
                    ),
                    tv: tvDecoded,
                    tvRawUnits: Array.from({ length: tvRaw.length }, (_, i) =>
                        tvRaw.charCodeAt(i)
                    ),
                };
            },
            writeTargets() {
                const expected = window.nativeProviderTargetValidation.expected;
                mainStorage.providerSetItem(tv, expected.tv);
                mainStorage.providerSetItem(media, expected.media);
                return this.readTargets();
            },
        },
    });
    Object.defineProperty(window, "nativeFavoritesSmoke", {
        value: Object.freeze(api),
    });
})();
