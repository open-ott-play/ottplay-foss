/**
 * Localization/translation system.
 *
 * Translations are loaded from external JS files (e.g. `_eng.js`, `_rus.js`)
 * which populate the `translations` dictionary at runtime. Supports
 * positional argument substitution (`%1`, `%2`, ...) and optional graphical
 * icon replacement for "yes" / "no" / "off".
 */

/**
 * Translation dictionary — populated by language-specific script files
 * (e.g. `_eng.js`, `_rus.js`) that set `window.keyStrings`.
 */
export var translations: Record<string, string> = {};

/**
 * When `true`, the `translate` function returns graphical icon HTML
 * (Fontello spans) for the keys `"yes"`, `"no"`, and `"off"` instead
 * of textual translations.
 */
export var useGraphicIcons = false;

/**
 * Translate a key string with optional positional argument substitution.
 *
 * @param key  - The translation key to look up.
 * @param args - Optional positional values to substitute for `%1`, `%2`,
 *               etc. in the translated string.
 * @returns The translated string, or the original key if no translation is
 *          found.
 *
 * @remarks
 * When `useGraphicIcons` is `true`, the keys `"yes"`, `"no"`, and `"off"`
 * return Fontello icon HTML (`&#xf205;`, `&#xf204;`) instead of text.
 *
 * Substitution uses a global regex replace for each argument in order
 * (e.g. `%1` → args[0], `%2` → args[1], ...).
 */
export function translate(key: string, ...args: any[]): string {
    if (useGraphicIcons) {
        switch (key) {
            case "off":
            case "no":
                return '<span class="fontello">&#xf204;</span>';
            case "yes":
                return '<span class="fontello">&#xf205;</span>';
        }
    }
    var text = translations[key] !== undefined ? translations[key] : key;
    for (var i = 0; i < args.length; i++) {
        text = text.replace(new RegExp("%" + (i + 1), "g"), args[i]);
    }
    return text;
}

/**
 * Shorthand alias for `translate` (backward compatibility).
 *
 * @see translate
 */
export var _ = translate;

/**
 * Load a language file by injecting a `<script>` tag into the document.
 *
 * The language file is expected to populate `window.keyStrings`, which
 * is then assigned to the `translations` dictionary.
 *
 * @param langCode        - The language code (e.g. `'_eng'`, `'_rus'`).
 * @param successCallback - Called after the script loads and translations
 *                          are assigned.
 * @param errorCallback   - Called if the script fails to load.
 *
 * @sideEffects
 * - Creates and appends a `<script>` element to `document.body`.
 * - Sets `crossOrigin = 'anonymous'` if supported.
 * - Mutates the module-level `translations` variable on success.
 *
 * @remarks
 * The script URL is constructed as:
 * `{host}/stbPlayer/{langCode}.js?{version}` where `host` and `version`
 * come from `window.__host` and `window.__cv` (defaults: `''` and `'local'`).
 */
export function loadLanguage(
    langCode: string,
    successCallback: () => void,
    errorCallback?: () => void
): void {
    var host = (window as any).__host || "";
    var version = (window as any).__cv || "local";
    var scriptUrl = host + "/stbPlayer/" + langCode + ".js?" + version;

    var script = document.createElement("script");
    script.src = scriptUrl;
    script.type = "text/javascript";
    if (typeof (script as any).crossOrigin !== "undefined") {
        (script as any).crossOrigin = "anonymous";
    }
    script.onload = function () {
        // Language file should have populated window.keyStrings
        if ((window as any).keyStrings) {
            translations = (window as any).keyStrings;
        }
        if (successCallback) successCallback();
    };
    script.onerror = function (e) {
        console.error("Error loading language:", scriptUrl);
        if (errorCallback) errorCallback();
    };
    document.body.appendChild(script);
}
