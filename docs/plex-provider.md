# Plex on each player

Choose **Plex** in the provider list, then **Sign in with Plex**. The official Plex sign-in page opens in a browser. On a TV, open `plex.tv/link` on a phone or computer and enter the displayed code. Choose an available Plex server after signing in; the player checks its connection and opens the library. **Back** cancels sign-in or server connection.

For a manual connection, enter the Plex server address (for example `http://192.168.1.25:32400`) and its access token, then choose **Save and open library**. The token is masked in the settings screen. Prefer an HTTPS Plex endpoint for an HTTPS browser player: access to local HTTP endpoints depends on the browser's local-network permissions and mixed-content policy. Native players can use the transport supported by their build. The Play distribution retains its HTTPS policy.

Plex is a library provider: it opens library sections, search, folders and media. It does not flatten the collection into TV channels. Switching to Plex preserves other providers' saved connections, playlists and favorites.

The **Playback** setting offers:

- **Automatic** — original files when the current device reports support; compatible HLS when conversion is needed.
- **Original file** — direct playback, using the device's own decoder.
- **Compatible HLS** — Plex prepares a stream for the player. Conversion speed depends on the Plex server and source format.

When the device supports HEVC through Media Source Extensions, compatible HLS uses fragmented MP4, preserves HEVC video at its source resolution and requests AAC audio. For HEVC/Opus files this avoids unnecessary video encoding on the NAS while adapting audio for WebKit.

The selected server address, its access token and playback preference are stored in the current device's provider profile as `plexcfg`. Account sign-in also saves that server's identity and connection candidates. Each time the provider opens, it checks which connection is reachable, so a laptop can move between home Wi-Fi and the internet without signing in again. Browsing history stays associated with the same server and server credential. Editing the address or token manually clears these account connection candidates.

Account sign-in tokens remain in memory during server discovery. No environment variables, central player-server configuration or NAS deployment are required. A settings backup containing this profile also contains its server credential.

For access away from home, the selected Plex server must have a reachable remote connection. Plex may impose account or subscription requirements for remote personal-media playback; see [Plex remote playback requirements](https://support.plex.tv/articles/requirements-for-remote-playback-of-personal-media/).

Developer checks:

```sh
node tests/test_plex_provider.cjs
npx tsc --noEmit
```

The provider tests cover local profile isolation, masked token editing, authenticated readiness, cancellation of stale connection callbacks, account sign-in, server choice and cancellation after switching providers. Transport and account-service protocol tests live alongside their respective Plex plugin tests.
