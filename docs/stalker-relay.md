# Stalker relay for a hosted player

The ordinary OTT server exposes `POST /stalker/api` for its browser client.
Stalker VOD requires the server and frontend to contain the same VOD allowlist.
Updating only the web bundle does not update this Rust route. Native clients
continue to use their existing direct transport.

A hosted site must not publish the ordinary arbitrary-destination route. Use
the **same `ottplay-server` product** in its optional dedicated mode:

```sh
ottplay-server --stalker-relay-only \
  --stalker-relay-config /run/secrets/stalker/relay.json \
  --port 8080
```

The default bind address in this mode is `127.0.0.1`. A container deployment
must explicitly select its listener, for example `--host 0.0.0.0`, behind its
approved HTTPS ingress. The normal server's bind default and repeatable
HTTP/HTTPS port options are unchanged. The configuration flag requires the
dedicated mode, which cannot be combined with offline-media, normalization or
hosted-EPG service modes. Invalid configuration fails before listeners open.

The dedicated router exposes only `GET /health` and configured
`POST /stalker/<name>` endpoints. It does not mount `/stalker/api`, assets,
other provider proxies, control, normalization, import or media endpoints.
It does not start background EPG refresh. Health returning `OK` proves
liveness, not that a particular provider, account or stream works.

## Private operator configuration

The file uses this shape; the credential placeholder is deliberately invalid:

```json
{
  "version": 1,
  "routes": [
    {
      "name": "provider-1",
      "upstream": "https://configured-provider.example/server/load.php",
      "credential": "<generate a separate random operator credential>"
    }
  ]
}
```

The operator chooses an endpoint for an already configured, authorized provider.
Use the exact queryless API endpoint produced by the client's existing portal
normalization, such as `/server/load.php` or `/portal.php`, not its `/c/` landing
page. There is no discovery, account checking or provider fallback.

Configuration is limited to 64 KiB and 1–32 routes. Each name has 1–64 lowercase
ASCII letters/digits separated by single hyphens; `api` is reserved. Upstreams
must be canonical HTTP(S) URLs of at most 2,048 bytes with no userinfo, query or
fragment, ending in `/load.php` or `/portal.php`. Names, upstreams and
credentials must each be unique. Unknown fields and duplicate JSON struct
fields are rejected. Credentials contain 32–256 ASCII letters/digits, `_` or
`-`; generate them randomly and keep them separate from provider credentials.

The absolute configuration path must refer to a regular file. On Unix,
0400/0600 are supported, as are 0440/0640 for a trusted Secret `fsGroup`.
Group write/execute and every permission for other users are rejected.
The server rejects non-regular or oversized files before opening, then checks
the opened handle's type, size and permissions and bounds the read if it grows.
Projected Secret symlinks are supported. These are checks against accidental
misconfiguration of an operator-owned path, not atomic protection against
an adversary replacing that path concurrently.
Configuration is read once at startup; rotation requires a controlled restart.
Never put this file under a published web root.

## Request boundary

The browser sends the existing JSON envelope `{ "url": "...", "headers": {} }`
to its configured same-origin route. The trusted hosting proxy injects
`X-OTT-Stalker-Relay` from its private service variable. The browser must not
receive or store this operator credential. Missing, incorrect or duplicate
relay headers receive 403. The credential uses the same constant-time HMAC
verification pattern as the existing normalization service.

The named route checks the **initial** requested URL's scheme, host, effective
port and path against its fixed upstream, then applies shared core validation.
Only the query varies. Userinfo, fragments and query parameters on the outer
relay URL are rejected. A mismatched destination is never silently rewritten.

The 32 KiB request limit, inner header allowlist, same-origin Referer check,
duplicate action/type checks and protocol allowlist remain in force. VOD
allows `get_categories`, `get_ordered_list` and `create_link` under `type=vod`;
separate `type=series` is not supported. Nested series use the core's VOD
operations. Inner Cookie/Authorization belong to the provider. The outer
operator credential is never forwarded to the provider and is not accepted
as an inner provider header.

Outbound requests retain the core's checked DNS destinations, pinned
connections, global concurrency bound, deadlines, response-size limits and
same-origin redirect policy. Redirects may change the path within that same
origin; every destination is checked again. Configuration does not exempt an
upstream from these protections. Errors never echo URLs, credentials or
upstream response details. API responses/errors are `no-store`; the dedicated
router does not grant permissive browser CORS.

## Hosted configuration and publication

The public hosted profile associates the already selected API endpoint with
exactly one route. Merge this into the profile, retaining other integrations:

```json
{
  "version": 1,
  "stalker": {
    "routes": [
      {
        "upstream": "https://configured-provider.example/server/load.php",
        "path": "/stalker/provider-1"
      }
    ]
  }
}
```

An absent, duplicate or invalid hosted route must fail closed rather than
fall back to a generic relay. Normal current-source guards and cancellation
still apply.

For here.now, merge an exact route into the **current owner-read**
`.herenow/proxy.json`; preserve all its existing routes:

```json
{
  "proxies": {
    "/stalker/provider-1": {
      "upstream": "https://approved-rust-ingress.example/stalker/provider-1",
      "method": "POST",
      "headers": {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-OTT-Stalker-Relay": "${OTT_STALKER_PROVIDER_1}"
      },
      "rateLimit": "12000/hour/ip"
    }
  }
}
```

The upstream is a placeholder, not an installed service. Confirm the Rust
image/binary digest, HTTPS ingress, route name and fixed provider endpoint
with the deployment owner. Pin the here.now variable to that ingress hostname
with `allowedUpstreams`. Never point this route at ordinary `/stalker/api`,
an unverified control server or a user's local port.

The example rate permits two maximum-size 5,000-request scans plus some
foreground traffic per hour per IP. The client still stops a scan after 120
seconds and applies its other catalog bounds. Set an explicit rate budget:
the default 100/hour/IP can stop a normal catalog scan. Shared NAT users share
the IP budget. Verify platform acceptance of the chosen limit and surface
429 as a bounded failure; do not add unlimited retries. This proxies API
responses, not media bytes: an HTTPS player still needs playable HTTPS media.

here.now resolves variable headers server-side and hides its proxy manifest
from visitors. A publish can succeed with an invalid proxy configuration:
check finalize warnings and re-read the manifest. Preserve protected files
and use `baseVersionId` to reject concurrent publication. See the
[proxy documentation](https://here.now/docs#proxy-routes) and
[variable documentation](https://here.now/docs#variables).

## Verification and release receipt

Run the scoped Rust tests in an isolated Cargo target:

```sh
CARGO_TARGET_DIR=/absolute/isolated/stalker-target \
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=2 \
cargo +1.96.1 test --locked -p ottplay-core -p ottplay-server stalker
```

Record source revision, Cargo.lock hash, toolchain, target triple,
binary/image digest, test result and configuration fingerprint. Do not record
credentials or raw configuration. The deployment receipt must identify the
ingress, named routes, fixed upstreams, here.now version and manifest hash.
Verify missing authentication, mismatched destinations and generic paths fail
before using a synthetic provider fixture to verify live/VOD, playback,
cancellation and Favorites through the real hosted path. A mocked browser
route does not verify the deployed relay.

On a local Mac, update the ordinary server binary with its frontend while
preserving the LaunchAgent, environment and TLS configuration. Do not use the
general local installer blindly: it regenerates an HTTP-only argument list
and can remove an operator's existing HTTPS listener. Keep a hash-identified
rollback binary and compare the plist before/after. A separate
normalization-only listener is not a Stalker relay and does not need a
Stalker-specific update.
