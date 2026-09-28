# Protected media sources on iOS

The iOS app supports a source-specific Cloudflare Access sign-in through the
system browser (`ASWebAuthenticationSession`). It works with unsigned/AltServer
builds: no associated-domain entitlement, embedded client secret, or custom
passkey implementation is required. The identity provider owns passkey and
recovery verification.

When a playlist request receives an authentication failure, the app checks
`https://<source>/_ottplay/public/config`. Playback also performs discovery once
per HTTPS origin, including when the channel list was restored from a cache.
Sources without this endpoint keep their normal transport. Discovery failures
are cached for five minutes to avoid probing each channel on the same host.

After signing in, playback and native HTTP/EPG downloads share a native session.
Settings → Manage settings → **Source access** offers sign-in and local sign-out.
Local sign-out removes the app's credentials and stops its media listener; it
does not log the user out of Safari or revoke the identity provider's session.

## Server contract, version 1

The public discovery JSON contains:

```json
{
  "version": 1,
  "source_origin": "https://media.example.com",
  "media_origin": "https://mobile-media.example.com",
  "authorize_path": "/_ottplay/authorize",
  "exchange_path": "/_ottplay/public/exchange",
  "callback": "ottplay-access://callback"
}
```

Discovery must come from the configured source's HTTPS origin. A separate
mobile origin lets existing TV clients retain their network-based access.
The mobile origin must protect all media paths with Access and validate its
application audience at the origin/Tunnel. Only `/_ottplay/public/*` is public;
it must be served by the auth broker, with a fail-closed origin fallback.

The app opens `authorize_path` with independent 256-bit `state` and PKCE S256
challenge values. The authenticated broker returns a random single-use code
to the **fixed** callback scheme, plus the original state. Codes expire after
90 seconds. The native client POSTs `{code, verifier}` as JSON to the exchange
endpoint. The broker atomically consumes the code only after verifying PKCE.

The JSON response is `{token, expires_at, media_origin}`, where `token` is an
Access application JWT for that exact media origin, `expires_at` is its Unix
expiry, and the session has at most 24 hours remaining. The broker must validate
the Access signature, issuer, audience, expiry and permitted identity before
issuing a code. A binding cookie is incompatible with this cookie transfer;
keep HttpOnly enabled and disable binding cookies for this dedicated app.

## Native boundary

Credentials are kept in device-only Keychain storage and are never returned
to JavaScript, exported settings or playlist URLs. Protected requests use an
ephemeral URLSession without ambient cookies or credential storage; redirects
may stay only within the same HTTPS origin. Concurrent requests share login,
and expiry/rejection permits one renewal attempt. Interactive renewal requires
the app to be foregrounded; after a background expiry, open the app and reload
the channel.

The HTML5/AVPlayer HLS loaders use a random-port listener bound only to
`127.0.0.1`. Every URL contains a fresh per-launch random capability. Host,
Origin, method, headers and source origin are checked; the listener forwards
only to discovered source/media origins. Manifests rewrite relative and
same-source absolute URIs, including variants, audio, subtitles, keys, init
maps, parts and preload hints. Other HTTPS origins retain their original URLs
and never receive an Access cookie. Binary media is streamed with backpressure;
HEAD, byte ranges and content ranges are preserved. Manifest buffering is
bounded to 2 MiB. Loopback URLs are not saved as channel identities.

Native PiP uses the same preparation. EPG uses an injected native transport
while retaining original source/cache keys. Direct AirPlay receivers cannot
consume the phone's loopback URL; remote receiver playback needs a separate
authenticated transport. Web/Android/TV/desktop builds do not acquire iOS
source sessions.

## Verification

`python3 tests/test_ios_access_media.py` compiles the real Swift policy and
loopback transport and exercises PKCE/state validation, manifest/key/map
rewrites, chunk boundaries, binary streaming, Range, HEAD and unauthorized
loopback requests. Native parity CI runs it. Playback tests cover asynchronous
login completion after channel changes, stop and cancellation. Existing proxy,
EPG and native bridge suites still apply.

After deployment, verify a real device over cellular: load a protected playlist,
complete passkey login, play/switch/seek channels, exercise native PiP, restart
the app, sign out, cancel a login, and test the configured recovery path. Unit
fixtures and an unsigned build do not establish successful biometric login
or provider playback on an iPhone.
