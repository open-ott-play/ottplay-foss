# De la liste de fonctions au comportement vérifié

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Contrats fonctionnels](roadmap-delivery.fr.md) · [Mesures de taille](roadmap-size.fr.md)

Ce rapport décrit la réalisation et la consolidation, pas une annonce de version. L'instantané mesuré du lecteur est `652726f8` ; l'instantané Android natif, construit séparément, est `be0d800`. CI, fusion et promotion d'une version restent des étapes distinctes. Des commits ultérieurs portant uniquement sur la documentation ou les tests ne transforment pas un contrôle local en preuve qu'un appareil installé a été mis à jour. Les états ci-dessous concernent ces instantanés historiques ; ce n'est pas un suivi des versions en direct. Les builds publiés sont dans [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases).

![Processus de réalisation et contrôles d'acceptation](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## Comment le travail a été vérifié

La demande initiale a été découpée en 13 ensembles fonctionnels utilisables couvrant le lecteur classique, le service de contrôle/CLI et l'application Android native indépendante. Les responsabilités ont été attribuées par composant pour permettre la revue et l'intégration des changements simultanés sans remplacer le travail d'un autre composant. La nouvelle interface a réutilisé des libellés traduits existants ou ajouté des entrées aux catalogues des 88 langues ; les guides techniques complets ont d'abord été écrits en anglais et en russe. Le manuel principal et les guides fonctionnels appariés ont désormais des éditions complètes dans [24 langues de documentation](manual-translations.md).

La réalisation a été suivie d'une revue croisée indépendante et de tests de régression exécutables. Avant toute modification du code, chaque problème signalé a été vérifié dans le véritable chemin de rappel, décodeur, stockage ou focus. Les échecs de tests ont été séparés entre régressions de comportement et sélecteurs obsolètes. Par exemple, remplacer `button` par `option` pour les lignes classiques imposait de mettre à jour les sélecteurs, pas d'affaiblir le comportement de clic attendu.

Des builds de production propres ont ensuite contrôlé les artefacts ES5 générés et le coût JavaScript complet, modules de fournisseurs optionnels compris. Les tests de navigateur ciblés utilisaient le chargeur, le bundle et les adaptateurs d'appareils distribués. Android natif a eu une exécution séparée des tests Gradle, du lint et du packaging. Les contrôles des PR et les fils de revue sont revérifiés après le push ; un build local réussi ne les remplace pas.

<a id="what-changed-during-review"></a>

## Changements pendant la revue

![Cinq comportements corrigés et coût JavaScript mesuré](diagrams/implementation-results.svg)

- **Analyse HLS et tentatives :** les échecs d'analyse partageaient initialement la classification réseau générique. Ils autorisent maintenant au plus une reconnexion à la même URL, dans le budget de deux tentatives transitoires ; les nouveaux décodeurs et URL de secours ne le réinitialisent pas. Une erreur terminale d'authentification/DRM annule aussi une tentative transitoire déjà programmée.
- **Repli natif Auto :** la gestion d'erreur native pouvait retirer la requête alors qu'Auto possédait déjà un repli. Le propriétaire existant conserve désormais cette transition ; l'annulation invalide toujours ses rappels différés.
- **Entrée dans les modales :** placer automatiquement le focus sur le premier bouton Annuler transformait Entrée dans la fenêtre d'attente Plex en annulation. Les dialogues démarrent maintenant avec le focus sur le dialogue lui-même. Tab atteint explicitement leurs boutons ; les dialogues ordinaires d'information et de confirmation conservent le comportement d'Entrée et Échap/Retour.
- **Sélection au pointeur sur PC :** le focus souris changeait la sélection avant le gestionnaire de clic, transformant le premier clic en activation. Le focus induit par le pointeur ne présélectionne plus la ligne. Le PC sélectionne toujours puis active ; LG conserve son comportement en un clic. Le focus clavier suit toujours la sélection.
- **Pistes Android :** une sélection sans libellé pour l'élément courant pouvait être effacée par sa propre confirmation Auto ou une mise à jour de préférence des sous-titres, ou passer à un autre élément avec un `TrackGroup` égal. Elle survit maintenant aux écritures différées uniquement pour son élément courant. Les préférences sémantiques utilisent langue/rôle/libellé ; le ViewModel possède la persistance, donc fermer le panneau n'annule pas l'écriture.

Les 13 ensembles livrés sont : échantillon A/V ; configuration Local/Home reprenable ; récupération bornée ; plafonds de qualité ; préférences de pistes Android ; clés de contrôle à portée limitée ; associations XMLTV ; films/séries Xtream ; accessibilité classique ; résultats durables des commandes ; transfert explicite ; flux de secours ; lots de réglages récupérables. Le [guide fonctionnel](roadmap-delivery.fr.md) définit la portée et les limites de chacun.

<a id="evidence-and-remaining-gates"></a>

## Preuves et contrôles restants

Pour `652726f8`, les cinq scénarios de navigateur ciblés ont réussi : navigation au pointeur LG webOS, navigation au pointeur LG NetCast, comportement PC à deux clics, sémantique clavier des dialogues et collection/résolution/annulation/nouvel essai Plex. TypeScript, la fixture unitaire d'accessibilité, le lint ciblé, ES5 et le budget des bundles ont réussi. L'exécution complète dans le navigateur sur ce build s'est terminée avec **194 réussites et un test ignoré** : HLS natif nécessite WebKit, tandis que cette exécution utilisait Chromium. Le CI hébergé et l'ordre de fusion convenu restent des contrôles séparés.

La chaîne restante `test:port` et `test:unified` a été achevée par segments repris après correction de fixtures isolées. Chaque cible en échec a été relancée avec succès et les commandes restantes ont réussi ; cela ne prétend pas constituer une exécution unique et ininterrompue de `npm test`. L'étape CI exacte du pont Android, composée de neuf commandes, a aussi réussi localement.

Pour Android `be0d800`, **101 tests de l'application et 62 du noyau partagé** ont réussi localement, ainsi que le lint debug/release, l'assemblage des APK Debug/Release/Full, le bundle de publication et la compilation de l'APK androidTest. Compiler l'APK des tests instrumentés ne signifie pas les exécuter sur un appareil. Les trois constats de revue confirmés ont reçu une réponse et été résolus dans [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68). Ce PR a réussi ses contrôles et a été fusionné en `5b644b94` ; le CI après fusion est suivi séparément. Le diagramme laisse en attente le contrôle global CI/publication du lecteur.

Le total JavaScript web est passé de **964,459 / 305,344** octets bruts/gzip à **995,858 / 315,207** : **+31,399 / +9,863 octets** (environ 3.26% / 3.23%). Le candidat fonctionnel mesurait 995,587 / 315,103 ; la consolidation ultérieure a ajouté 271 / 104. L'entrée principale finale de cet instantané est de 875,197 / 270,425. Voir la [mesure initiale](evidence/roadmap-size-20261015.json), la [mesure de l'artefact final](evidence/roadmap-final-size-20261015.json) et la [méthode de mesure](roadmap-size.fr.md). Les virgules de ces nombres d'octets séparent les milliers.

Ce sont des coûts historiques en octets JavaScript, **pas des gains de vitesse mesurés**. Les totaux excluent moteurs multimédias, dictionnaires, CSS, images et vidéo. Les paquets de cet instantané transportaient séparément le clip A/V de 464,652 octets. Après le [changement d'hébergement](audio-video-check.fr.md), `diagnostics/av-v1.mp4` reste dans le dépôt avec son générateur et son vérificateur pour la reproductibilité, mais est exclu des paquets Web/OTTPlay Server, Tauri, Capacitor et Docker. Le lecteur ne le récupère depuis here.now que pour le contrôle A/V explicite, qui nécessite Internet ; la lecture au démarrage ne le télécharge pas. Retirer 464,652 octets multimédias bruts ne prouve pas l'économie dans les installateurs compressés et ne modifie pas les mesures historiques JavaScript. Temps de démarrage, régularité des images, mémoire, expérience avec lecteur d'écran, véritable audio HDMI et comportement des fournisseurs nécessitent leurs propres mesures sur les appareils cibles. Ce rapport n'affirme aucun nouveau résultat matériel ni publication bêta. La [liste d'acceptation matérielle](roadmap-delivery.fr.md#physical-acceptance-before-promotion) et la [stratégie de publication](../RELEASING.md) restent les critères de promotion.

<a id="post-beta-integration-and-review"></a>

## Intégration et revue après la bêta

Après la publication de beta.4, le code `39287792` a été intégré dans cette branche. La révision d'exécution `9663b681` corrige aussi le retour au bord du direct sous limites de qualité HLS et permet de récupérer un journal de réglages endommagé avant le démarrage normal. L'écran de récupération bloque l'hydratation partielle des comptes, permet un nouvel essai et une réinitialisation confirmée, préserve les cookies sans rapport et empêche le retour des anciens réglages de cookies après réinitialisation. Voir le [processus de récupération](settings-recovery.fr.md) et son diagramme SVG.

![Comparaison JavaScript complète après la bêta](diagrams/post-beta-size.svg)

Reproduire les deux sources avec Node 26.8.2, Rollup 4.64.5 et Terser 5.51.2 donne **964,876 / 305,452** octets bruts/gzip pour la source beta.4 et **1,000,388 / 316,600** pour l'intégration : **+35,512 / +11,148 octets** (3.68% / 3.65%). Ces totaux incluent tous les fournisseurs optionnels : sept dans la base et huit dans l'intégration. La nouvelle entrée mesure 879,533 / 271,761. Cette comparaison est distincte des graphiques figés précédents.

Les deux builds de production locaux régénèrent cinq fichiers d'exécution suivis et omettent l'affirmation d'une révision de source propre. Les rapports consignent cette limite plutôt que de présenter ces fichiers locaux comme des artefacts publiés : [base](evidence/post-beta-baseline-size-20261015.json) et [intégration](evidence/post-beta-candidate-size-20261015.json). Le build d'intégration et les contrôles ES5/natifs réussissent. Six contrôles de navigateur ciblés réussissent aussi : récupération/réinitialisation du journal, clavier des dialogues, pointeur LG webOS et NetCast, sélection PC à deux clics et attente Plex avec propriétaire.

<a id="browser-gate-integration"></a>

## Intégration du contrôle des navigateurs

![Résultats confirmés des vérifications locales de navigateurs](diagrams/browser-verification-results.svg)

La source `c52f4d07` incorpore le PR 779 de main `1ecbc0e7`. Les commandes de test, contrôles de récupération et assertions de dialogues Plex des deux branches sont préservés. TypeScript, lint, documentation, contrats d'empaquetage/liaison, build de production et contrôles complets des bundles compilés réussissent. Les 27 fichiers JavaScript lecteur/fournisseurs générés restent identiques octet pour octet aux artefacts mesurés ci-dessus. La suite complète appareils/navigateurs sur ce build se termine avec **196 réussites et un test Chromium ignoré comme prévu**, pour HLS natif nécessitant WebKit.

L'archive empaquetée exacte de Mode A n'a été extraite qu'après contrôle de sa source, de sa somme de contrôle et de son inventaire de bundles/fournisseurs. Chromium 156.0.8078.4, Firefox 157.0 et WebKit 27.2 ont chacun réussi les cinq scénarios de profil sans omission ni nouvel essai : **15 réussites locales** avec Playwright 1.64.0. L'hôte réel était macOS 26.7.1, pas le runner `macos-15` nommé dans les profils choisis. Les attestations mentionnent explicitement cette différence et **ne constituent pas une qualification de matrice hébergée ou de version**. Voir le [résumé local](evidence/post779-local-acceptance/summary.json) et la [recette de reproduction](evidence/post779-local-acceptance/reproduce.sh), qui attend un build de production existant et refuse de remplacer un répertoire de candidat extrait.

La [politique de navigateurs](browser-compatibility.fr.md) impose cinq cibles hébergées et 25 exécutions de scénarios pour les contrôles PR/bêta ; le RC complet comporte 35 cibles et 166 exécutions. Ce sont des exigences configurées, pas une couverture mesurée.

![Comment la vérification d'un candidat produit des preuves](diagrams/candidate-verification-flow.svg)

Le [pipeline bêta](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467) séparé pour main `1ecbc0e7` a réussi. Il ne contient pas ce PR. L'intégration nécessite encore son propre CI hébergé réussi et sa revue, puis une coordination de publication ; les résultats locaux ci-dessus n'affirment pas que ces contrôles de livraison ont réussi.

<a id="delivery"></a>

## Livraison

- [Lecteur, documentation et i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781).
- [Serveur de contrôle et CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106).
- [Préférences de pistes Android — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68).

Ces PR portent l'état actuel du CI et de la fusion. Le changement du lecteur suit les correctifs Plex actuels convenus et leur version bêta, dans une vague de livraison distincte.
