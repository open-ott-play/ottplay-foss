<a id="explicit-playback-handoff"></a>

# Transfert explicite de lecture

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Améliorations](roadmap-delivery.fr.md)

Avec le lecteur et la CLI de contrôle à jour, exécutez `ott handoff SOURCE TARGET`. La source continue la lecture. La cible doit avoir la même source/le même compte configuré et un identifiant de chaîne stable et unique. Les références de chaîne sont des empreintes locales versionnées, jamais les identifiants bruts d'éléments du fournisseur. Les lignes M3U classiques utilisent l'URL exacte du flux uniquement comme entrée du hachage local. Des URL signées ou réécrites indépendamment ne correspondent donc pas, par sécurité. Il n'y a ni rapprochement approximatif de noms, ni transfert d'identifiants de connexion ou d'URL lisibles. La version 1 prend en charge le direct et les archives pour M3U, Xtream et Stalker ; la VOD/les séries et la synchronisation continue de l'historique ne sont pas prises en charge.

`playback_handoff_export` accepte des paramètres vides et renvoie `data.handoff` :

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

Les références d'archives utilisent `kind: "archive"` et un entier `archive_start` (position de lecture actuelle en secondes Unix). `playback_handoff_import` accepte uniquement `{"handoff": ...}`. La cible vérifie l'identité du catalogue, la disponibilité des archives, les règles parentales/de kiosque et la propriété actuelle du contrôle avant d'envoyer la commande. Elle résout les flux via son propre fournisseur. Une importation acceptée renvoie `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. L'envoi ne confirme ni le décodage de la vidéo ni un son HDMI audible.

Un refus n'expose qu'un code d'erreur : `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. Les références sont bornées ; le récepteur rejette les champs supplémentaires. Utilisez des autorisations d'opérateur limitées pour l'export/import et protégez la connexion au contrôleur. L'identité de la source est une clé opaque de correspondance, pas un justificatif d'accès transférable.

Exécutez `node tests/test_remote_handoff.cjs`. Consultez le [guide de contrôle](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) pour l'authentification, les résultats et le comportement du TTL des commandes.
