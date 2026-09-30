# Synology library through Plex

The optional NAS library uses the existing Plex Media Server index and media
files on Synology. OTT-play's server reads Plex over the LAN and serves the
catalog and video through its own HTTP or HTTPS listener. A browser never needs
the Plex token, a mounted SMB share, or a second media server.

When configured, **Synology** appears as a separate library in the player.
Browse libraries, shows, seasons, albums and tracks, or search the catalog.
The existing television playlist and provider library remain available. NAS
history and favorites have their own identity and storage. Video starts using
Plex's compatible HLS stream; the VPortal API also offers the original file.
Stopping or switching videos releases the associated Plex conversion session.
Original files support HTTP byte ranges for seeking. Plex handles container,
audio and video conversion subject to the NAS's capabilities.

## Server configuration

Set these private environment variables on `ottplay-server`:

```sh
OTTPLAY_PLEX_URL=http://NAS_LAN_IP:32400
OTTPLAY_PLEX_TOKEN=YOUR_SERVER_TOKEN
OTTPLAY_NAS_KEY=YOUR_RANDOM_KEY_AT_LEAST_32_CHARACTERS
```

With no configuration the feature is disabled. Partial or invalid configuration
fails at startup. Keep the token and key in private service configuration, never
in the web root or repository. The Docker image can receive these variables
through its normal deployment secret/environment configuration; it does not
need a media volume mount.

For the installed macOS launchd service, configure it without printing secrets:

```sh
python3 scripts/configure-nas-library.py \
  --plex-url http://NAS_LAN_IP:32400 \
  --synology YOUR_EXISTING_SSH_ALIAS \
  --player-url http://PLAYER_LAN_IP:8443
```

This reads the existing DSM Plex preferences through SSH, preserves the service
arguments and environment, and writes mode-0600 service configuration and client
links. It makes no changes to Plex or the NAS files. Alternatively pass
`--token-file /private/path/to/token` instead of `--synology`. Deploy the updated
player and server before restarting the service. `--restart` explicitly restarts
an already updated service.

On macOS, the first connection made by the launchd service can display
**Allow “ottplay-server” to find devices on local networks?** The user must allow
that system request before the background service can contact Synology. A
successful shell or staging test does not imply this permission has been granted
to the installed service. If `/nas/config` works but `/nas/api` reports Plex
unavailable, verify this permission and repeat the live smoke on the installed
ports. The setup script does not change macOS privacy databases or global
firewall settings.

Client links are saved in `~/.config/ottplay/nas-library.json`, outside the web
root. The file contains an access key and must be kept private. Re-running the
configuration command preserves the key. To revoke existing client links,
replace `OTTPLAY_NAS_KEY` and restart the server.

## Other players

- OTT-play installations with VPortal support: use the file's `vportal` link in
  **VPortal link**, then open **Show Media Library**. The link has the form
  `portal::[key:YOUR_KEY]http://PLAYER_LAN_IP:8443/nas/api`.
- VLC, Kodi and other M3U players: open the file's `playlist` URL as a network
  playlist. It is a separate source; it does not replace an IPTV playlist.
- The server's browser player discovers `/nas/config` automatically and uses
  `/nas/api` directly. It does not need either private key in browser settings.

Use an address reachable from the device. `localhost` only works on the server
computer. HTTPS clients require the server's HTTPS address and a trusted
certificate; media URLs retain the scheme and port of the requested listener.
A public static player cannot reach a LAN service through its cloud API relay.

## Protocol and access

`POST /nas/api` accepts the existing VPortal JSON protocol: root navigation,
`browse`, `search`, and `play`, with bounded pagination. Automatic browser access is intended for a trusted local network: the browser
must use a local host and a matching Origin or Referer. Origin checks prevent
cross-site browser requests; they are not a login boundary. Native clients use
the NAS access key. Keep a public reverse proxy from forwarding these local
routes unless access is authenticated. `OTTPLAY_NAS_BROWSER_HOSTS` can explicitly
allow additional browser hostnames for an access-protected installation. `GET /nas/playlist.m3u?key=...` exports a portable playlist.

The server alone authenticates to Plex. Media links carry signed, expiring
capabilities. Playlist rewrites keep HLS manifests and segments on the player's
origin. No endpoint accepts an arbitrary upstream URL. The existing generic
VPortal proxy and its LAN destination restrictions are unchanged.

## Verification

```sh
python3 tests/test_nas_configuration.py
node tests/test_nas_library.cjs
cargo test -p ottplay-server nas_library
npm run typecheck
npm run build:server
```

`scripts/nas-live-smoke.py` performs opt-in checks against a configured server.
It reads credentials privately and reports status, formats and counts without
printing media titles, connection keys or signed URLs. Offline tests do not
claim validation on physical TVs or mobile devices.
