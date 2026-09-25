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
    // Legacy stbPlayer.js reads keyStrings directly. Lang scripts loaded via
    // getScriptDOM set window.keyStrings but do not update `translations`, so
    // prefer the live keyStrings table (needed for _("alhabet") / OSK Lang).
    var ks = (window as any).keyStrings;
    var text =
        ks && ks[key] !== undefined
            ? ks[key]
            : translations[key] !== undefined
              ? translations[key]
              : key;
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

/** Update the fallback ESM dictionary after an optional loader completes. */
export function setTranslations(value: Record<string, string>): void {
    translations = value;
}
