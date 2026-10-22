<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Association XMLTV manuelle et accessibilité au clavier

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Architecture du guide](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## Corriger le guide d'une chaîne sans modifier la liste de lecture

Lancez la chaîne M3U concernée, ouvrez **Information → EPG**, puis modifiez l'URL source EPG et l'**XMLTV ID**. Saisissez l'identifiant exact de `<channel id="…">` du fichier XMLTV, pas son nom affiché. **Set** enregistre l'association et recharge la liste. **Automatic** supprime la surcharge de cette chaîne et recharge la correspondance d'origine. Un déplacement avec les flèches ne sauvegarde ni ne réinitialise jamais une association à lui seul. Retour laisse l'association enregistrée intacte.

Cet éditeur est disponible dans le déploiement hébergé du navigateur et les conteneurs XMLTV natifs (Tauri et Capacitor). Il ne remplace pas les guides du fournisseur, les points d'accès JSON explicites `=source` ni les serveurs compagnons externes. Un navigateur ancien ordinaire utilisant un compagnon distant garde son protocole de correspondance existant. La première version accepte un identifiant exact ; elle ne télécharge ni n'affiche une liste interrogeable de toutes les chaînes XMLTV.

![Une association manuelle relie la source de la liste et la chaîne stable à un flux XMLTV et un identifiant exact ; sinon la correspondance normale reste active.](images/guide-binding.svg)

Une association stocke l'empreinte de la source de la liste, la clé stable de la chaîne, l'URL explicite du flux et l'identifiant XMLTV. Renommer un libellé affiché ou changer l'ordre des lignes ne modifie pas l'association si l'identité de la chaîne reste identique. Remplacer l'URL/le compte de la liste change l'espace de noms de la source. Pour les anciennes entrées M3U sans `itemId`, l'identifiant existant dérivé de l'URL est utilisé ; changer cette URL change son identité.

La chaîne sélectionnée garde son nom affiché et son URL de lecture. La recherche du guide utilise un seul flux explicite, sans repli sur le nom : un identifiant absent n'emprunte donc pas discrètement les programmes d'une autre chaîne. Les décalages régionaux automatiques déduits du nom ne s'appliquent pas à cette association exacte ; le `tvg-shift` explicite de la liste reste applicable. Définissez le bon identifiant XMLTV régional. Si un flux HTTPS personnalisé ne peut pas être lu à cause de CORS ou des règles de contenu mixte, le diagnostic EPG habituel signale l'échec.

L'enregistrement local est limité à 500 associations et 512 KiB par source ; il est analysé une seule fois par chargement de liste, pas par chaîne. Les écritures comparent la valeur précédente et relisent le résultat enregistré avant de recharger. Un rappel tardif de l'éditeur ne peut pas enregistrer dans une source de remplacement. C'est une préférence locale, pas une synchronisation entre appareils. Les URL des flux peuvent contenir des identifiants ; évitez de partager publiquement les exports du stockage.

<a id="accessible-classic-controls"></a>

## Commandes classiques accessibles

- La liste principale virtualisée expose une liste nommée, l'option sélectionnée, le nombre total d'éléments et leur position absolue. Seule la ligne visible sélectionnée reçoit l'arrêt Tab. Les flèches actualisent la sélection visuelle et l'état sémantique ; le focus suit une liste déjà focalisée lors du changement de page.
- Les dialogues standard d'information/confirmation, l'éditeur et les panneaux About exposent des rôles modaux et des noms localisés. Tab et Maj+Tab circulent dans le modal au premier plan. Fermer un modal imbriqué rétablit un contrôle parent encore visible ; d'anciennes ouvertures planifiées ne peuvent pas voler le focus après fermeture.
- Les messages d'information et de confirmation décrivent leurs dialogues. Les avis temporaires utilisent une région de statut à annonces non intrusives.
- Les catalogues de traduction existants fournissent tous les nouveaux libellés. XMLTV et ID sont des identifiants de protocole ; noms de chaînes et noms d'hôtes des flux restent des métadonnées de source.

L'application conserve ses chemins de télécommande et la syntaxe ES5. Les vérifications sémantiques du DOM ne constituent pas une certification WCAG complète : focus propre aux appareils, parole VoiceOver/TalkBack et comportement des navigateurs TV nécessitent encore des tests physiques.

<a id="verification"></a>

## Vérification

Exécutez :

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

Exécutez aussi les contrôles habituels de compilation/ES5/taille du bundle sur la branche intégrée. Les tests navigateur doivent couvrir une longue liste franchissant les pages, une confirmation imbriquée, le remplacement de la source pendant l'édition, une association correcte, absente et supprimée, ainsi qu'un échec de téléchargement EPG. Les préférences sémantiques de pistes de l'application Android native sont implémentées dans son dépôt séparé et sont indépendantes de ces commandes classiques.
