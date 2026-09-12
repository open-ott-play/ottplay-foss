# Legacy engine compatibility

The shared player is a classic ES5 script. Keep `tsconfig.json` target `ES5`,
Terser `ecma: 5` and `mangle: false`: device adapters and provider scripts use
its published global names.

Every Vite build (web, Capacitor and Tauri) parses the final bundle and shipped
JavaScript with Acorn's ES5 grammar. `npm run check:es5` repeats that check and
verifies that device, library and provider scripts are present and current in
both packaged web roots. A syntax failure or missing asset fails the build.
`npm run check:bundle` checks the required public identifiers and executes the
actual bundle in legacy, modern and Capacitor runtime profiles.

The compiler lowers syntax, not browser APIs. The first bundle module installs
runtime shims, including `Object.assign`, numeric helpers and string search.
Boot code runs before those shims and must only use available APIs or guarded
fallbacks. Native media calls and input events must support older implementations
where `video.play()` returns nothing and `event.key` / `new MouseEvent` are absent.

Device IDs used by remote text input are generated with WebCrypto or `msCrypto`.
Engines without those APIs still boot the player and retain existing IDs. New
installations on those engines need a provisioned client ID in `/local/swop.json`
to use remote text input; they never generate an access credential with
`Math.random`.

The vendored Shaka Player 3.3.19 retains its license and runtime polyfills. Its
six exponentiation expressions use `Math.pow` and its four object spreads use
its own polyfilled `Object.assign`, so the shared file parses as ES5. Replacing
vendor libraries must pass the same gate.

`npm test` includes port regression coverage for playback, VOD, EPG, native
bridges, polyfills and device initialization. Syntax checks and simulated old
APIs do not establish codec, DRM or native firmware support: those still require
playback on the corresponding physical devices.
