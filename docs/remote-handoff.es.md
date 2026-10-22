<a id="explicit-playback-handoff"></a>

# Transferencia explícita de reproducción

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Mejoras](roadmap-delivery.es.md)

Con el reproductor y la CLI de control actualizados, ejecute `ott handoff SOURCE TARGET`. El origen sigue reproduciendo. El destino necesita la misma fuente/cuenta configurada y un ID de canal estable y único. Las referencias de canal son huellas locales versionadas, nunca los ID de elemento sin procesar del proveedor. Las filas M3U clásicas usan la URL exacta del flujo únicamente como entrada del hash local. Por ello, las URL firmadas o reescritas de forma independiente no coinciden, por seguridad. No se realizan coincidencias aproximadas por nombre ni se transfieren credenciales o URL reproducibles. La versión 1 admite directo/archivo para M3U, Xtream y Stalker; no admite VOD/series ni sincronización continua del historial de reproducción.

`playback_handoff_export` acepta parámetros vacíos y devuelve `data.handoff`:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

Las referencias de archivo usan `kind: "archive"` y un `archive_start` entero (posición actual de reproducción en segundos Unix). `playback_handoff_import` solo acepta `{"handoff": ...}`. Antes de enviar la orden, el destino comprueba la identidad del catálogo, la disponibilidad del archivo, las políticas parentales/de quiosco y la titularidad actual del control. Resuelve los flujos mediante su propio proveedor. Una importación aceptada devuelve `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. El envío no confirma que el vídeo se haya decodificado ni que se oiga sonido por HDMI.

Los rechazos exponen únicamente un código de error: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. Las referencias tienen límites; el receptor rechaza campos adicionales. Use permisos de operador con alcance limitado para exportar/importar y proteja la conexión con el controlador. La identidad de la fuente es una clave opaca de coincidencia, no una credencial de acceso transferible.

Ejecute `node tests/test_remote_handoff.cjs`. Consulte la [guía de control](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) para la autenticación, los resultados y el comportamiento del TTL de las órdenes.
