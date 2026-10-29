# Desktop Favorites key

On PC and PC2, **F** toggles Favorites for the focused TV channel or video, or
the currently playing item when no list is open. After a confirmed save, the
standard notification shows **Favorites: + Name** when added and
**Favorites: − Name** when removed. A failed or uncertain save does not show a
success confirmation. One press has one notification owner.

On a player with global Favorites available, open **Category → Favorites** for
one ordered list containing channels and videos from different configured
providers and profiles. The category remains available when empty. Entries show
their source context; unavailable entries remain visible rather than silently
playing another item. An explicitly disabled Favorites editing setting still
prevents adding or removing entries.

The list can contain a Local video, a channel from one M3U profile, a VPortal
video, a Plex video, and a channel from another M3U profile. Selecting an entry
resolves its configured profile and content identity before starting playback.
Channel numbers and list positions are not identities. See
[Mixed Favorites](mixed-favorites.md) for transfer and source requirements.

Fast forward is **PageDown**; rewind is **PageUp**. **R** selects a random item,
and Alt/Ctrl+Left/Right seek. Ctrl/Cmd+F keeps browser Find. Typing,
contenteditable fields, modal or PIN dialogs, kiosk mode and held-key repeats
do not toggle Favorites. Internal reference capture without an explicit toggle
does not emit an F notification.

Global editing requires qualified persistent storage and serialization support
from the host. When that support is unavailable, the existing per-source
Favorites behavior remains in place; the player does not advertise global write
operations. This fallback is not a global mixed list.

Per-source UI fallback does not guarantee legacy CLI editing. An updated host
without Web Locks can advertise list/play only, with add/remove unavailable.
