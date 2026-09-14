# VPortal with an M3U TV playlist

The M3U provider can use a VPortal media library independently of its TV
playlist. In the selected playlist's settings, enter the ordinary M3U/M3U8
channel URL in **Playlist URL** and the full portal value in **VPortal link**:

```text
portal::[key:YOUR_KEY]http://your-portal.example/api/v1/
```

Save it, return to the player menu, and open **Show Media Library**. The portal
provides its categories, videos, search, filters, and subsequent pages. Videos
with multiple quality variants offer a selection before playback. Portal content
does not become TV channels.

The link is stored separately for each M3U slot using the existing `medUrl`
setting. Previously saved VPortal links in that setting work without re-entry.
The key is masked in the playlist summary; the editor still shows the full
value. Entering a portal value in **Playlist URL** displays an explanation
instead of trying to fetch it as a playlist.

Existing ordinary media catalogs on Dune are retained for compatibility. The
new setting accepts VPortal links or an empty value; it does not advertise a
general catalog editor.

## OTT server and native apps

Browser clients send portal API requests through `POST /vportal/api` on their
OTT server. Update the server and frontend together. Native apps use their
existing native HTTP transport. API calls are asynchronous; leaving the view,
changing the source/provider, cancelling, or selecting another video retires
pending work.

The server route accepts JSON `{ "url": "...", "params": { "app": "ott-play",
"key": "..." } }` and returns the upstream JSON/status. It uses the existing
bounded proxy and destination policy; it does not forward keys to another
origin on redirect. Request bodies and portal keys are not logged.

Media URLs returned by the portal still need to be reachable and playable on
the client. This integration does not transcode video or proxy its media bytes.
In particular, an HTTPS browser page needs usable HTTPS media URLs. A local
fixture verifies the integration, but an actual subscription, its streams, and
physical TV devices require separate playback validation.
