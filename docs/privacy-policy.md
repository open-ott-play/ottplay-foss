# Privacy Policy — OTT-play FOSS

Last updated: 2026-09-12

Published by **alvit**. For privacy or support questions, contact [alvit.work@gmail.com](mailto:alvit.work@gmail.com).

## About this app

OTT-play FOSS is an open-source player for playlists, media streams and programme guides that you configure. The project does not operate an IPTV service or host the video content you choose to play.

Project source and support: [OTT-play FOSS](https://github.com/open-ott-play/ottplay-foss), [support issues](https://github.com/open-ott-play/ottplay-foss/issues).

Public Android builds do not use developer-operated servers by default. Connections described below use the services you configure.

## Information used by the app

**Playlists, providers and programme guides.** The app uses playlist, provider, stream, logo and programme-guide addresses to load channel information and play media. Where your provider requires authentication, requests can include usernames, passwords, cookies, tokens or other account information supplied for that provider. A provider may also receive the channel or programme requested and ordinary network metadata such as your IP address and User-Agent.

**Local settings.** The app stores preferences, favorites, configured endpoints and related settings on your device. Settings may contain access information embedded in provider or playlist addresses. Exported settings can include such information. Review exported JSON before copying it, sharing it or posting it for support. Importing settings changes local configuration only after your confirmation.

**Optional remote control and text entry.** You can configure a local command URL or a Swop remote text-entry service. These features contact the configured service when enabled or used. The app creates or uses a persistent app device identifier for remote-service identification; this identifier can be sent as `X-Swop-Client-Id` to the selected Swop service. Swop sessions exchange session information and text that you enter, which may itself contain private information or credentials. The configured service operator can receive this information. Leave these features disabled if you do not want to use them.

**Diagnostics and support.** Technical messages may describe playback or connection failures. Optional companion-host debug and feedback functions depend on the host and features you configure. If you share diagnostics, screenshots or settings for support, remove credentials, private URLs and other sensitive information first. GitHub issues are public.

## Destinations and purposes

Configured providers and services receive requests so they can supply playlists, authentication, programme information, media, remote commands or remote text entry. Their handling of requests, logs and account information depends on their own policies and your arrangement with them. An endpoint may be operated by a third party or by you; choosing the endpoint does not mean no information leaves your device.

Provider requests and optional remote features transmit the information described above. Your content providers and configured service operators may have their own logging or analytics practices.

## Network security

Security depends on the configured endpoint and supported protocol. Prefer HTTPS and trusted services. The app can work with endpoints that do not provide encryption, so it does not promise that every stream, playlist or authentication request is encrypted. Do not enter credentials or private text into an untrusted service.

Opening a project or support link contacts the selected website through your browser; that website's privacy practices apply.

## Permissions

The Android app uses network access for playback and configured services. Foreground media playback, wake-lock and notification capabilities support playback and media controls. These permissions do not grant the project access to your contacts, microphone or phone camera.

## Local retention

Saved settings remain on your device until you change or remove them or clear the app's local data. Temporary display state and diagnostic buffers can be replaced as the app runs. Native diagnostic files, exported files and operating-system backups may remain separately; manage those through the app or operating system and remove any copies you shared when no longer needed. This policy does not set retention periods for services operated by others.

## Your choices and deletion

You can change or remove configured providers, guides and optional remote-service settings. You can remove local app information through your operating system's app-data controls. An exported settings file or copied JSON remains wherever you saved or shared it until you remove it there. Platform backups, if enabled, follow your platform settings.

Removing local data or uninstalling the app does not delete information already received by a provider, remote service or support website. Ask the applicable operator about its retention and deletion practices. Provider accounts remain with those providers; account-deletion requests should be directed to them.
