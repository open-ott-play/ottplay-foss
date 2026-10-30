# Local resolver packages

The native companion ships `direct-url.js` as the built-in `direct-url` resolver.
It accepts `{ "url": "https://media.example/video.mp4", "title": "Video" }`
and returns `{ "streams": [{ "url": "…", "title": "Video" }] }`.
The companion validates the result before returning it. A validated BitTorrent
v1 magnet may also be returned; the player resolves it through the companion's
torrent/file-selection path. No media is downloaded by the resolver itself.

`catalog-map/` is an installable example. It filters the caller's `items` by an
optional case-insensitive `query` and returns matching stream records. Replace
`media.example` in its manifest with the exact hosts used by your catalog.

`network-catalog/` demonstrates an explicitly network-enabled package. It reads
the public HTTPS `catalogUrl` supplied in its input and maps the response's
`items` into streams. Configure its exact catalog and playback hosts before use.
Example domains are placeholders; installing examples does not contact them.

Configure the companion's plugin directory to contain package subdirectories:

```text
resolvers/
  catalog-map/
    manifest.json
    resolve.js
```

Packages are loaded once at companion startup. Restart the companion after an
operator installs or updates a package. A malformed package rejects the
configured set at startup; it does not silently disappear. There is no HTTP
endpoint for uploading or executing arbitrary source code.

Each manifest has these fields, with optional `network` defaulting to `false`:

```json
{
  "id": "catalog-map",
  "name": "Catalog filter",
  "apiVersion": 1,
  "script": "resolve.js",
  "sha256": "SHA-256 OF THE EXACT SCRIPT BYTES",
  "allowedHosts": ["media.example"],
  "network": false
}
```

The ID must start with a lowercase letter and contain only lowercase ASCII
letters, digits and hyphens, up to 64 characters. `direct-url` is reserved.
The script is a filename inside the package, not a path. Symlinked packages,
manifests and scripts are rejected. The digest must be updated whenever script
bytes change; for example, use `shasum -a 256 resolve.js` on macOS.

The script defines `function resolve(input)` and returns an object containing
only `streams`. Each stream contains only `title` and `url`. Titles must be
nonempty, trimmed and at most 256 UTF-8 bytes. URLs must be absolute HTTP(S),
at most 8192 UTF-8 bytes, and cannot embed a username/password. The custom
resolver's output host must match an exact `allowedHosts` entry. Wildcards,
URLs, paths and ports are not accepted in that list. An empty list permits
an empty result or validated magnet only. The built-in resolver accepts the
caller's explicit HTTP(S) URL without a destination allowlist. Returned magnets
use the same validation and limits as directly submitted torrent sources;
their tracker configuration is handled by that separate transport.

There is no `fetch`, `require`, process, filesystem, environment, timer or browser
API. A package with `network: false` resolves only supplied data. Setting
`network: true` also requires a nonempty `allowedHosts` list and exposes one
function: `fetchText(url)`. This synchronous function returns UTF-8 text or
throws a fixed error code. It permits HTTPS on port 443 only, without embedded
credentials, custom headers or methods. Every destination must match the exact
host allowlist and resolve entirely to public addresses. Connections use those
checked addresses; system proxies, redirects and compressed responses are
disabled. Playlist proxy LAN exceptions do not apply.

At most two fetch attempts are allowed per execution, including failed or denied
attempts. Each response is capped at 512 KiB, so at most 1 MiB of response body is
accepted. The execution deadline includes DNS, connections and body reads;
cancellation also stops network waits. Blocking system DNS jobs retain bounded
shared admission slots until their actual completion. They cannot be forcibly
stopped by a JavaScript cancellation request.

Pure async functions can finish through the JavaScript microtask queue; a promise
waiting for unavailable external work fails. Capability responses report the
effective `network` permission and its call/byte quotas for each package.

Each execution uses a fresh QuickJS runtime: globals are not shared between
requests. Limits are 64 KiB input JSON, 128 KiB output JSON, 128 stream records,
16 MiB guest memory, a 256 KiB guest stack and a two-second execution deadline.
The service admits two active executions and rejects overflow immediately.
Cancellation and request disconnect interrupt the VM; its admission slot is
retained until the worker exits. These are guest/worker limits, not a promise
that the entire native process uses 32 MiB. Packages are trusted operator
installations; VM isolation is not a substitute for reviewing installed code.

Source loading is bounded to 32 custom packages, 64 KiB per script and 8 KiB
per manifest. Do not grant write access to the configured directory to remote
users. A digest verifies the configured script bytes; it is not a publisher
signature.
