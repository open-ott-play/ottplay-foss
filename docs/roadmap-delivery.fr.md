# Améliorations de la fiabilité et des médias

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.fr.md) · [Architecture](architecture.md)

Ce guide décrit l'implémentation à la révision source de cette page, pas les capacités d'une ancienne version installée. Le lecteur, le service de contrôle/CLI et l'application Android native sont des artefacts distincts. Mettre l'un à jour ne met pas les autres à jour.

![Responsabilités et frontières de confiance](diagrams/roadmap-components.svg)

Voir le [coût mesuré en octets et le graphique comparatif](roadmap-size.fr.md) ; la vitesse d'exécution et la lecture sur appareil font l'objet de vérifications d'acceptation distinctes.

<a id="what-is-implemented"></a>

## Fonctionnalités implémentées

1. **Un échantillon audio/vidéo connu.** [Informations → Audio](audio-video-check.fr.md) diffuse un clip de huit secondes depuis here.now (Internet requis), avec des sons gauche/droite et des flashs correspondants. Il n'est chargé qu'après **Lecture**, jamais au démarrage ; le fichier multimédia n'est pas inclus dans les paquets du lecteur. Il emprunte le décodeur HTML5 principal uniquement au repos ou pendant la télévision en direct. Il n'écrit pas d'historique de visionnage. [Spécification du clip](../diagnostics/README.md).
2. **Configuration Local/Home reprenable.** La CLI de contrôle peut planifier, appliquer, reprendre et vérifier un préréglage. Elle compare les paramètres enregistrés avant de réessayer une écriture au résultat incertain. [Processus de contrôle](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **Récupération bornée de la lecture.** Les erreurs transitoires HLS/Shaka partagent une politique de récupération finie. Les erreurs d'authentification et les DRM non pris en charge sont définitifs. Stop, le changement de chaîne et le remplacement de source annulent les opérations périmées.
4. **Limites de qualité enregistrées.** La hauteur et le débit maximaux contraignent la sélection adaptative ; un repli natif ne doit pas contourner silencieusement un plafond actif.
5. **Préférences de pistes Android natives.** L'application Android indépendante mémorise l'intention selon la langue/le rôle/le libellé, y compris Auto et les sous-titres désactivés, au lieu de reprendre l'indice d'une piste d'un autre flux.
6. **Opérateurs de commandes à droits limités.** Le contrôleur peut autoriser un identifiant pour des appareils/actions précis sans communiquer l'identifiant administrateur.
7. **Associations XMLTV explicites.** Une chaîne appartenant à une liste peut être associée à un flux de données et un ID XMLTV précis. [Associations du guide et accessibilité](guide-binding-accessibility.fr.md).
8. **Films et séries Xtream.** La médiathèque charge à la demande le catalogue sélectionné, puis les épisodes d'une série. [Contrat de la médiathèque](xtream-media.fr.md).
9. **Commandes classiques accessibles.** Les listes de chaînes exposent la sémantique de sélection ; les boîtes de dialogue modales conservent puis restaurent le focus clavier ; les notifications disposent d'une région dynamique.
10. **Résultats de commandes durables.** Un journal facultatif borné du contrôleur conserve les métadonnées de déduplication et de résultat. Un redémarrage ne rejoue jamais aveuglément les commandes.
11. **Transfert explicite vers un appareil.** Les références direct/archives passent à un lecteur configuré avec la même source. La cible résout sa propre URL. [Contrat](remote-handoff.fr.md).
12. **Flux de secours explicites.** Les chaînes en direct peuvent utiliser des alternatives configurées dans la même politique de récupération finie. [Limites, récupération et secours](playback-stream-policy.fr.md).
13. **Lots de paramètres récupérables.** Le localStorage natif utilise un journal d'annulation pour les écritures multiclés prises en charge. [Garanties de stockage](settings-recovery.fr.md).

<a id="language-and-compatibility-coverage"></a>

## Langues et compatibilité

Le lecteur comprend 88 catalogues de traduction. Les sept nouveaux libellés qualité/média sont traduits dans chaque catalogue ; les autres nouveaux menus réutilisent les libellés traduits existants. Les contrôles des catalogues couvrent la parité des clés, les paramètres substituables et les exceptions examinées. Les guides techniques associés expliquent les mêmes limites d'implémentation dans [24 langues de documentation](manual-translations.md). Les [points d'entrée localisés](readme/README.md) sont des guides de démarrage rapide, pas l'affirmation que chaque document technique historique possède 88 traductions complètes.

La sortie classique conserve la syntaxe ES5. Cela ne signifie pas que chaque appareil prend en charge tous les codecs, API Web, garanties de stockage ou intégrations natives. L'aperçu A/V est limité au chemin HTML5 principal géré ; les moteurs qui le remplacent, notamment PC2/Video.js et les moteurs natifs, sont exclus. Les associations explicites du guide utilisent l'implémentation XMLTV hébergée ou native ; les protocoles externes facultatifs de compagnon peuvent ne pas les prendre en charge. L'acceptation propre à un appareil nécessite toujours l'appareil réel.

<a id="reproduce-the-checks"></a>

## Reproduire les vérifications

```sh
npm ci
npm run typecheck
npm run test:localization
npm test
npm run build:server
npm run check:es5
npm run check:size
python3 scripts/check-av-diagnostic.py diagnostics/av-v1.mp4
```

Le vérificateur multimédia nécessite FFmpeg/FFprobe. Il décode les deux canaux audio et vérifie leur énergie, leur séparation et le silence ; la seule présence d'une piste AAC ne prouve pas un contenu audible. Les tests JavaScript ordinaires vérifient l'annulation, les écritures échouées, la récupération après redémarrage, les changements de source et les entrées invalides. Les contrôles finaux du bundle incluent les familles de fournisseurs facultatives, pas seulement l'entrée principale.

Dans le contrôleur, exécuter `go test -race ./...`, `go vet ./...` et `python3 -m unittest discover -s tests`. Dans Android natif, exécuter les tests unitaires des préférences de pistes et de sauvegarde des paramètres, puis assembler l'APK de débogage. La CI de chaque dépôt fait autorité pour le commit correspondant, pas pour un arbre modifié ultérieurement.

<a id="physical-acceptance-before-promotion"></a>

## Acceptation physique avant promotion

- Sur le téléviseur cible, lancer la vérification A/V et confirmer le son gauche/droite, les flashs visibles, Stop et le retour au direct. Les tests du décodeur ne prouvent ni le son HDMI ni la fluidité.
- Tester les flux autorisés/refusés, un secours défaillant et le changement de chaîne pendant une tentative en attente. Confirmer la limite de qualité sélectionnée sur le moteur réel.
- Tester le focus des listes/dialogues avec un clavier, une télécommande et un lecteur d'écran disponible.
- Associer deux noms de chaînes similaires à des ID XMLTV différents et vérifier les programmes.
- Interrompre l'application d'un préréglage de test, redémarrer le contrôleur, reprendre et vérifier. Effectuer un transfert vers des sources configurées correspondantes et non correspondantes.
- Dans Android natif, changer de flux avec un ordre des pistes différent, redémarrer l'application et confirmer Auto/Off explicites ainsi que la langue préférée.

L'envoi réussi, les paramètres enregistrés, les échantillons décodés et les tests unitaires réussis sont des preuves différentes. La promotion d'une version doit préserver cette distinction ; voir la [stratégie de publication](../RELEASING.md).
