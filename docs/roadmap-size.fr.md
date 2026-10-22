<a id="measured-javascript-cost"></a>

# Coût JavaScript mesuré

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Guide des fonctionnalités](roadmap-delivery.fr.md) · [Données brutes](evidence/roadmap-size-20261015.json)

![Comparaison de tout le JavaScript du lecteur avec la même chaîne d’outils](diagrams/roadmap-size.svg)

Cette page conserve les mesures JavaScript des instantanés source ci-dessous. Elles ne mesurent ni la révision actuelle, ni les paquets d’installation, ni le trafic réseau.

Dans la comparaison initiale, le point d’entrée principal et toutes les familles de fournisseurs optionnels ont augmenté de **31 128 octets bruts / 9 759 octets gzip**, soit environ **3.23% / 3.20%**. Il s’agit du coût accru des fonctions, pas d’une amélioration annoncée de taille ou de vitesse d’exécution. Xtream reste chargé à la demande ; le sortir du point d’entrée ne le retire pas du total.

La mesure compare les archives source propres `bbf9ca7b` et `cae971da`, toutes deux en version 1.1.55, avec Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2 et zlib 1.2.12. Elle utilise l’assembleur ES5 de production, l’optimiseur, la politique de nommage et l’identité correcte des sources propres. Le niveau gzip 9 est appliqué séparément à chaque ressource produite.

- Entrée web : 848 092 / 262 392 → 874 926 / 270 321 octets bruts/gzip.
- Entrée web + tous les fournisseurs : 964 459 / 305 344 → 995 587 / 315 103.
- Entrée native : 848 050 / 262 460 → 874 884 / 270 372.
- Entrée native + tous les fournisseurs : 964 417 / 305 412 → 995 545 / 315 154.
- M3U optionnel augmente de 184 octets bruts / 82 gzip ; le nouveau Xtream représente 4 110 / 1 748. Les six autres familles optionnelles sont identiques octet par octet.

Avant le transfert du clip vers here.now, remplacer son URL par un chemin local depuis la racine a ajouté un octet JavaScript brut dans cette séquence historique. Cela ne mesure pas l’URL hébergée ultérieure. La correction des nouvelles tentatives bornées d’analyse HLS ajoute 37 octets bruts / 36 gzip dans une comparaison isolée du même instantané ([preuve](evidence/parse-recovery-size-20261015.json)). La correction de responsabilité du transfert Auto natif ajoute encore 101 octets bruts / 39 gzip ([preuve](evidence/auto-recovery-size-20261015.json)). Le total brut obtenu avant les corrections des régressions d’accessibilité est de 995 726 octets ; l’identité de compilation et les octets gzip peuvent varier dans le commit final. Le `build/reports/classic-bundle.json` final et `npm run check:size` restent la référence pour la révision précisément livrée. La compilation propre suivante `652726f8`, avec les corrections du focus pointeur/dialogue, mesure **995 858 octets bruts / 315 207 gzip** pour le lecteur web complet ([preuve de l’artefact final](evidence/roadmap-final-size-20261015.json)). Son entrée fait 875 197 / 270 425 ; les totaux natifs sont 995 816 / 315 259. Les plafonds de cet instantané ont conservé la marge précédente pour natif/Node/suffixe de version : 875 300 bruts / 271 600 gzip pour l’entrée ; 996 100 / 316 400 pour entrée + fournisseurs.

<a id="post-beta-integration"></a>

## Intégration après la bêta

![JavaScript complet après l’intégration de beta.4](diagrams/post-beta-size.svg)

La comparaison suivante reproduit les sources beta.4 `39287792` face au runtime `9663b681`, avec l’intégration Plex et la récupération des réglages endommagés, à l’aide des mêmes Node 26.8.2, Rollup 4.64.5 et Terser 5.51.2 :

- Entrée web : 848 315 / 262 443 → 879 533 / 271 761 octets bruts/gzip.
- Entrée web + tous les fournisseurs : 964 876 / 305 452 → 1 000 388 / 316 600.
- Entrée native + tous les fournisseurs : 964 834 / 305 520 → 1 000 346 / 316 654.
- Augmentation de la charge web complète : **35 512 / 11 148 octets (3.68% / 3.65%)**.

La référence compte sept familles de fournisseurs ; l’intégration en compte huit, dont Xtream à la demande. Les plafonds d’entrée de cet instantané étaient de 879 900 / 273 000 ; les plafonds totaux de 1 000 800 / 317 800, en gardant de la place pour natif, Node et l’identité de version. Les deux compilations locales de production régénèrent cinq fichiers de runtime suivis et omettent l’affirmation d’une révision source propre. Ce sont des artefacts reproduits localement, pas les binaires bêta publiés. Les versions des outils, les empreintes et cette limite figurent dans les [preuves de référence](evidence/post-beta-baseline-size-20261015.json) et [d’intégration](evidence/post-beta-candidate-size-20261015.json). Le [rapport d’implémentation](implementation-report.fr.md#post-beta-integration-and-review) explique les corrections et la validation.

**Périmètre :** ces totaux JavaScript excluent les moteurs multimédias externes, dictionnaires de langues, CSS, images et vidéos. Les anciens paquets du lecteur contenaient aussi un **clip A/V de 464 652 octets**, hors des totaux ci-dessus. Sa livraison actuelle est distincte de ces mesures :

- **Dépôt :** `diagnostics/av-v1.mp4` reste avec son générateur et son vérificateur pour la reproductibilité. Conserver un fichier source ne l’inclut pas dans un paquet.
- **Paquets :** Web/OTTPlay Server, Tauri, Capacitor et Docker excluent le clip. Cela retire 464 652 octets bruts de média, pas une réduction mesurée de 464 652 octets d’un installateur compressé. Le format d’archive et les autres changements de compilation influent sur cette taille.
- **Réseau :** le lecteur récupère le clip depuis here.now uniquement lorsque l’utilisateur lance le [test A/V](audio-video-check.fr.md). Le test nécessite Internet ; le clip n’est pas récupéré pour la lecture au démarrage.

Les mesures historiques JavaScript ci-dessus restent inchangées. Mesurer l’effet de l’URL hébergée sur JavaScript ou un installateur actuel exige une nouvelle comparaison. Les 88 README localisés sont de la documentation du dépôt, pas du contenu livré au lecteur. Cette comparaison d’octets n’établit aucune performance de démarrage, fréquence d’images, consommation mémoire ou montée en charge du catalogue. Il faut des mesures séparées sur les appareils cibles.
