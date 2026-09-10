# Privacy Policy — OTT-play FOSS

**Last updated:** 2026-09-10

This is a short privacy stub for store listings and users of **OTT-play FOSS** (`play.ott.foss`), an open-source IPTV/OTT player. It is not legal advice. A fuller policy may replace this page later; until then, this describes how the app is intended to work.

## Who we are

OTT-play FOSS is a free and open-source project ([open-ott-play/ottplay-foss](https://github.com/open-ott-play/ottplay-foss)). The maintainers of this repository publish the app builds described here. We do not operate an IPTV service or host video content.

## What the app does

- Plays media **on your device** from playlists and streams **you** configure (for example M3U / Xtream / Stalker-style endpoints you enter).
- Optionally loads an Electronic Program Guide (EPG / XMLTV) from **URLs you configure**.
- Keeps settings, favorites, and similar preferences in **on-device** storage (for example local storage / app preferences).

The app does **not** include Mag middleware DRM, proprietary Mag client/VOD stacks, or any requirement to use a particular commercial operator. Classic Mag JsHttpRequest client / VOD paths are out of scope for FOSS builds.

## Data we collect

**We do not operate a baked-in analytics, advertising, crash-reporting, or tracking SDK** in the FOSS client as shipped from this repository.

In particular, store / Capacitor builds are documented as collecting **no personal data** for nutrition-label purposes: no tracking, no analytics product, and no device-info exfiltration to the project maintainers.

Optional debug / feedback helpers may send diagnostic messages only to a **companion host you run or configure** (for example a local `ottplay-server`), not to a third-party analytics vendor baked into the app.

## Where streams and EPG go

When you play a channel or refresh a guide:

- Playlist, stream, logo, portal, and EPG requests go to the **endpoints you (or your operator) configured**.
- Those operators / hosts receive whatever is normal for that request (for example IP address, User-Agent, cookies or tokens you supplied for that portal).
- The OTT-play FOSS project maintainers do **not** sit in the middle of your playback unless you deliberately point a URL at infrastructure they run.

If you use an optional remote-control / webhook / “swop” style feature, traffic goes only to the services **you** enable and configure.

## Children

The app is a general-purpose media player. It is not directed at children under 13 (or the equivalent age in your region). Do not use it to collect personal information from children.

## Permissions (mobile)

Depending on platform, the app may request permissions needed for playback (for example network access, background audio, and on Android notifications for media controls). It does not require camera, contacts, microphone, or photo-library access for core playback.

## Third parties

- **Content / IPTV operators** you configure — see above.
- **Apple App Store / Google Play** — subject to their own privacy policies when you download or update the app through those stores.
- **GitHub** (source, issues, releases) — subject to GitHub’s privacy policy if you interact with the project there.

There are **no in-app ads** and **no sold user profiles** in the FOSS client as shipped.

## Your choices

- Do not enter playlists, credentials, or EPG URLs you do not trust.
- Clear app data / reinstall to remove on-device settings and favorites.
- Prefer HTTPS endpoints where your operator supports them.
- Review this repository’s source if you need to verify network behavior.

## Changes

We may update this stub as the project evolves (for example when a fuller policy is published). The “Last updated” date at the top will change when we do. Continued use of store builds after an update means you should re-read this page.

## Contact

- Project issues: [https://github.com/open-ott-play/ottplay-foss/issues](https://github.com/open-ott-play/ottplay-foss/issues)
- Source: [https://github.com/open-ott-play/ottplay-foss](https://github.com/open-ott-play/ottplay-foss)

For store listing fields, use this document’s stable URL:

`https://github.com/open-ott-play/ottplay-foss/blob/main/docs/privacy-policy.md`
