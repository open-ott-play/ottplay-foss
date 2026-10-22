# Xtream movies and series

<!-- language-navigation:start -->
<p dir="ltr">
<a href="xtream-media.md" lang="en" dir="ltr">English</a> · <a href="xtream-media.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="xtream-media.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="xtream-media.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="xtream-media.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="xtream-media.es.md" lang="es" dir="ltr">Español</a> · <a href="xtream-media.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="xtream-media.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="xtream-media.he.md" lang="he" dir="rtl">עברית</a> · <a href="xtream-media.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="xtream-media.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="xtream-media.it.md" lang="it" dir="ltr">Italiano</a> · <a href="xtream-media.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="xtream-media.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="xtream-media.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="xtream-media.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="xtream-media.pt.md" lang="pt" dir="ltr">Português</a> · <a href="xtream-media.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="xtream-media.th.md" lang="th" dir="ltr">ไทย</a> · <a href="xtream-media.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="xtream-media.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="xtream-media.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="xtream-media.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="xtream-media.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Improvements](roadmap-delivery.md)

Configure the Xtream provider and load its live catalogue, then open Media
Library. **Movies** and **Series** are separate lazy roots: opening the library
does not download both catalogues. Opening a series loads its episode details.
The existing shared-core Xtream parser creates identities and stream URLs;
the classic adapter only handles presentation and request lifetime.

Each selection resolves its stable request again against the current account.
Saved items omit the authenticated stream URL. A removed item cannot be revived
from the adapter's prior resolved row. Replacing credentials/provider or closing
the owner cancels outstanding work; stale responses cannot populate the next
account's screen. Provider-supplied names and artwork remain provider data.

```mermaid
sequenceDiagram
  actor Viewer
  participant Library
  participant Adapter
  participant API as Xtream API
  Viewer->>Library: Movies / Series
  Library->>Adapter: Load selected root
  Adapter->>API: Authenticate + selected catalogue
  API-->>Library: Stable item metadata
  Viewer->>Library: Play item / episode
  Library->>Adapter: Resolve current item reference
  Adapter->>API: Current catalogue / series details
  API-->>Adapter: Current playable item
  Adapter-->>Library: URL in memory, owned by current account
```

The provider must allow the client's requests (CORS or the configured native
transport), and the device must support the returned media. This is not an
offline catalogue, cross-account migration, DRM bypass or new transcoder.
Catalogue freshness costs a request on selection. Errors are reported through
the existing localized library error; unavailable results do not start playback.

Run `node tests/test_xtream_media.cjs` for lazy roots, encoded credentials,
secret-free saved requests, removed items and source cancellation, and
`node tests/test_provider_drivers.cjs` for the actual provider lifecycle.
