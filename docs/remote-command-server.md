# Connect to a command server

The separate [OTT-play Control Server](https://github.com/open-ott-play/ottplay-control-server) provides per-player command queues, portable server binaries, Docker images for amd64/arm64, and Kubernetes/k3s packages. It follows the optional `local_proxy.py` example and adds separate administrator/device credentials and acknowledged delivery.

Open **Settings → Remote control → Command server**. Enter the server IP, hostname, or HTTP(S) address and the device access code from its configuration, then select **Connect**. A bare IP or hostname defaults to HTTP port 8081. Bracketed IPv6 and a reverse-proxy base path are accepted. An old full command endpoint is normalized to the new acknowledgement endpoint. Credentials belong in the separate masked access-code editor, never the address.

This connection is disabled by default and independent of the local HTTP listener. It works without WebCrypto because the server supplies the access code. The player stores the address, code and enablement on this device only. JSON exports, cloud exports and local backups omit them, including nested backups from older versions. Importing or restoring settings disconnects the connection and cannot grant consent or import another installation's credentials; the current device's address and code remain available for an explicit reconnect.

## Delivery behavior

The player polls about once per second with an 8-second transport timeout, non-overlapping requests and bounded retry backoff. Acknowledgement removes commands only after dispatch or explicit rejection. Repeated IDs are deduplicated during a running page session, including reconnects with the same server and access code; failed acknowledgements are retried without repeating the action. Changing the address/code or disconnecting cancels the active generation, so a delayed old response cannot control the player.

Commands that need channels wait while the provider is loading. The server supplies its current time and command expiry, so an incorrect TV clock does not extend command lifetime. Older compatible responses have a bounded local waiting period. Expired commands are retired without dispatch.

Volume, channel selection, notifications and provider selection use the existing player paths. Provider selection retains parental controls and Android Play restrictions. M3U playlist replacement updates the actual active M3U entry and reloads it; other providers report unsupported. Generic `change_provider_settings` has no shared provider schema and is explicitly unsupported. An acknowledgement reports handling/rejection, not confirmed playback, PIN approval or hardware state. Deduplication is not persistent across a player restart.

## Transport requirements

- Browser/TV: XMLHttpRequest uses the ES5 runtime loaded before the player. The server must allow the exact page origin. Packaged pages with a null Origin need the server's explicit device-only opt-in.
- Tauri: the existing native `proxy_http` bridge carries both polling and acknowledgement requests.
- Capacitor: the existing native HTTP bridge carries both methods. Android Play and iOS transport restrictions remain enforced.
- An HTTPS web page cannot poll a plain HTTP server. The UI explains the failure; use an HTTP player page on the trusted LAN or an HTTPS command-server endpoint.

The public player address is https://ott.2560801.xyz/. A browser loaded from that HTTPS address needs HTTPS for this connection. Local player installations use HTTP ports 8443–8446. The central OTT server's command routes remain disabled; the command server is a separate process/service.

## Compatibility maintenance

TypeScript uses descriptive English names. `src/compatibility/legacy-names.ts` declares the established provider-script globals, popup action IDs and version-1 backup fields. The classic linker preserves those external names, while live aliases let both interfaces observe provider hook replacement. Stored keys, DOM IDs, provider-specific fields and action identities retain their existing contracts.

Validate source behavior, emitted provider ABI, persisted settings, ES5 syntax and actual transport separately. `tests/test_english_naming.cjs` covers source names, shadowed bindings, classic emission, live aliases, action identity and backup round trips. The command-server and dispatcher suites cover retries, stale responses, boot readiness and provider restrictions. Physical TV/STB transport and playback remain device acceptance checks.
