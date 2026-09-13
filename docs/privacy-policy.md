# Privacy Policy — OTT-play FOSS

**Last updated:** 2026-09-12

Published by **alvit**. For privacy or support questions, contact [alvit.work@gmail.com](mailto:alvit.work@gmail.com).

This policy describes **OTT-play FOSS** (`play.ott.foss.play`, Android Play distribution) and **OTT-play FOSS Full** (`play.ott.foss`, Android sideload distribution), as well as the project's web and desktop players.

## About this app

OTT-play FOSS is an open-source player for playlists, media streams and programme guides that you configure. The project does not operate an IPTV subscription service. We publish an original synthetic video test pattern on here.now for the optional Demo mode; we do not host the television or provider content you configure.

Project source and support: [OTT-play FOSS](https://github.com/open-ott-play/ottplay-foss), [support issues](https://github.com/open-ott-play/ottplay-foss/issues).

Connections use your configured services or the optional hosted Demo described below. The Play distribution has no bundled commercial provider catalog, dealer activation, or automatic fallback XMLTV service. Full retains provider integrations and a fallback guide source; selecting an integration can contact that provider's services, and using the default guide can contact its operator. Those services have their own policies.

## Information used by the app

**Playlists, providers and programme guides.** The app uses playlist, provider, stream, logo and programme-guide addresses to load channel information and play media. Where your provider requires authentication, requests can include usernames, passwords, cookies, tokens or a MAC-style portal identifier you entered. A provider may also receive the channel or programme requested and ordinary network metadata such as your IP address and User-Agent.

**Local settings.** The app stores preferences, favorites, configured endpoints and related settings on your device. Settings may contain access information embedded in provider or playlist addresses. Where settings export is available, exported JSON can include such information. Review it before copying it, sharing it or posting it for support. Importing settings changes local configuration only after your confirmation. Local HTTP control credentials and permission are not exported or granted by imported settings.

**Optional remote control and text entry.** Distributions that provide remote integrations can contact a configured command URL or Swop remote text-entry service when enabled or used. The app creates or uses a persistent app device identifier for remote-service identification; this identifier can be sent as `X-Swop-Client-Id` to the selected Swop service. Swop sessions exchange session information and text that you enter, which may itself contain private information or credentials. The configured service operator can receive this information. Leave these features disabled if you do not want to use them. These integrations are not required for Play Demo playback.

**Local HTTP control.** The Capacitor Android and iOS apps' inbound HTTP command listener is disabled by default. Enabling **Local HTTP remote control** in player Settings creates a random device code required for authenticated command requests on the local device interface. The code persists on this device across normal restarts. Disabling HTTP control revokes access; enabling it again creates a new code. Settings exports do not include the code or consent, and imports cannot grant HTTP access. Command integrations can process playback commands and routing identifiers. If you configure remote command polling, requests go to that configured endpoint.

**Diagnostics and support.** Technical messages may describe playback or connection failures. Optional companion-host debug and feedback functions depend on the host and features you configure. If you share diagnostics, screenshots or settings for support, remove credentials, private URLs and other sensitive information first. GitHub issues are public. In the Android Play distribution, opening About displays local diagnostic information and does not request your public IP address from an external lookup service.

There is no baked-in analytics, advertising, crash-reporting or tracking SDK deliberately configured in this client. Network requests still disclose connection information to the receiving service. Store Data safety declarations must reflect the actual distribution and hosting arrangements; the absence of analytics does not mean that no data is transmitted.

## Destinations and purposes

Configured providers and services receive requests so they can supply playlists, authentication, programme information, media, remote commands or remote text entry. Their handling of requests, logs and account information depends on their own policies and your arrangement with them. An endpoint may be operated by a third party or by you; choosing the endpoint does not mean no information leaves your device. Project maintainers do not sit in the middle of provider playback unless you deliberately configure infrastructure they run.

Opening a project or support link contacts the selected website through your browser; that website's privacy practices apply.

## Optional hosted demo

Selecting **Try demo** loads our synthetic MP4 or HLS test video from `https://liminal-sketch-vv8r.here.now/demo/`. The media is hosted by here.now; it is not television or a paid subscription. A fresh installation does not download this video until you choose Demo. If Demo remains selected, it may resume on the next launch.

The hosting service receives the requesting IP address, requested file, request time, and normal HTTP connection headers such as User-Agent. The demo adapter does not attach your IPTV credentials, playlists, account identifiers, or the player's generated device ID to these requests. Requests use HTTPS. Hosting infrastructure may keep operational/security logs under its own policies; the app does not control their retention. Contact the publisher for demo privacy or deletion inquiries. Choosing Manual setup instead avoids the demo media service.

## Network security

The Android Play distribution requires HTTPS for remote media and provider requests; an unsupported HTTP source produces an error rather than silently sending credentials over that connection. The hosted demo uses HTTPS. Full and other distributions can support user-configured HTTP sources: HTTP does not encrypt requests, credentials or returned media. Enter credentials and private text only for services you trust. The player does not guarantee the retention practices of a service you configure.

## Local retention and deletion

Provider credentials, preferences, favorites, and caches remain on your device until you change or remove them or clear the app's local data. The Android app excludes its app-private settings, files, databases and preferences, including WebView credentials and cookies, from Android cloud backup and device-to-device transfer. These exclusions do not delete existing on-device data. A backup made with an earlier release can still be subject to your system's existing backup retention; manage those older backups through the system's settings. Other platforms' backups, if enabled, follow their platform settings.

Temporary display state and diagnostic buffers can be replaced as the app runs. Native diagnostic files, exported files and copied JSON may remain separately. Manage these through the app or operating system and remove any copies you shared when no longer needed. This policy does not set retention periods for services operated by others.

Use **Clear settings** in the app to reset its saved configuration. To remove all app-private settings and caches, use Android Settings → Apps → OTT-play FOSS → Storage → Clear storage, or the corresponding controls on your platform. Removing local data or uninstalling the app does not delete information already received by a provider, remote service, hosting service or support website. Ask the applicable operator about its retention and deletion practices. Provider accounts remain with those providers; account-deletion requests should be directed to them. The player does not create a publisher-operated user account.

## Permissions

Android uses network access, a media-playback foreground service and a wake lock as needed to continue playback. Its media-session controls do not request notification permission; their visibility follows Android's media and notification settings. Playback information, such as a channel title and artwork supplied by your source, can appear in Android media controls or on the lock screen according to your system settings. Stop ends the playback service. The app does not require location, camera, contacts, microphone or photo-library permission for core playback.

## Third parties

- **Content / IPTV operators and optional remote-service operators** you configure — see above.
- **Apple App Store / Google Play** — subject to their own privacy policies when you download or update the app through those stores.
- **GitHub** (source, issues, releases) — subject to GitHub's privacy policy if you interact with the project there.
- **here.now** — hosts the optional synthetic demo media, receiving the connection data described above.

## Your choices

- Do not enter playlists, credentials, private text or EPG URLs into services you do not trust.
- Change or remove configured providers, guides and optional remote-service settings at any time.
- Use the app or operating system's data controls to remove local information; delete exported copies separately.
- Prefer HTTPS endpoints where your operator supports them.
- Review this repository's source if you need to verify network behavior.

## Changes

We may update this policy as the project evolves. The “Last updated” date changes with material revisions.

## Contact

- Publisher / privacy inquiries: [alvit.work@gmail.com](mailto:alvit.work@gmail.com)
- Project issues: [OTT-play FOSS support](https://github.com/open-ott-play/ottplay-foss/issues)
- Source: [open-ott-play/ottplay-foss](https://github.com/open-ott-play/ottplay-foss)

For store listing fields, use this document's stable URL:

`https://github.com/open-ott-play/ottplay-foss/blob/main/docs/privacy-policy.md`
