# Local HTTP player deployment

The local macOS player runs one `ottplay-server` process with four HTTP
listeners bound to `127.0.0.1`:

- `http://127.0.0.1:8443/`
- `http://127.0.0.1:8444/`
- `http://127.0.0.1:8445/`
- `http://127.0.0.1:8446/`

The port numbers do not imply TLS. These endpoints deliberately use HTTP so
legacy portals and media sources can be requested without HTTPS mixed-content
blocking. Port 8095 is retired. The HLS proxy remains on HTTP port 8090.
Browser CORS restrictions and provider authorization still apply.

Run `scripts/install-local-stack.sh` for a full local stack installation or
`scripts/update-local-stack.sh` to rebuild an existing stack. Use
`SKIP_HLS_RELOAD=1 scripts/update-local-stack.sh` to leave the running HLS proxy
alone while updating the player. The installer archives old instance plists
outside `LaunchAgents`, so legacy listeners do not restart at the next login.

`OTTPLAY_HTTP_PORTS` can override the space-separated HTTP port list. Port 8095,
empty lists, duplicates and invalid ports are rejected before installation.
The old `OTTPLAY_PORT` and `OTTPLAY_HTTPS_PORTS` overrides are rejected with a
migration message. Certificates and existing keychain trust are preserved;
the HTTP installation does not generate, trust, or remove certificates.

Each scheme, hostname and port defines a separate browser origin. Switching
from HTTPS to HTTP creates a different storage context: existing HTTPS player
settings remain in the browser but are not automatically copied to HTTP.
Likewise, use either `localhost` or `127.0.0.1` consistently for a given profile.
An exported player configuration can be imported into the chosen HTTP origin.

The server CLI accepts repeated `--port` arguments for these listeners. Its
general default remains HTTP port 8080 when no port is supplied; explicitly
configured TLS and remote Docker/NAS mappings are unaffected. Desktop debug
launchers and local smoke tests default to HTTP 8443. Embedded native builds
retain their existing application URL schemes.
