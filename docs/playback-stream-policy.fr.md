# Limites de qualité et récupération des flux en direct

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Possession du décodeur](device-media-backend.md)

Le lecteur HTML5/HLS/Shaka géré conserve un unique droit de lecture pendant la récupération après la défaillance d'une source. Il peut aussi utiliser jusqu'à trois URL de secours explicitement configurées pour une chaîne en direct. Il ne découvre, ne devine ni ne remplace jamais une chaîne à partir de son titre.

![Récupération : un droit de lecture, des tentatives finies et des secours explicites](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## Définir un plafond de qualité

Ouvrez **Paramètres → Paramètres de l'interface** et définissez **Hauteur vidéo maximale (HLS/Shaka)** et/ou **Débit maximal du flux (HLS/Shaka)**. Les deux contraintes s'appliquent ensemble. **Automatique** supprime la contrainte correspondante. Les choix pris en charge sont 360/480/720/1080/2160 pixels et 1/2/4/8/16 Mbps. Les paramètres sont enregistrés localement, suivent le processus normal d'enregistrement/annulation et prennent effet au prochain démarrage de lecture, y compris lors d'un redémarrage de récupération.

Il s'agit de plafonds, pas de paramètres de transcodage. Un flux uniquement en 1080p ne devient pas du 720p. Si aucune variante annoncée ne convient, le lecteur affiche **No stream meets the quality limits** et cesse de réessayer cette requête. Une hauteur/un débit inconnu ne prouve pas qu'une variante HLS respecte la contrainte.

Le filtrage des variantes HLS précède le chargement des fragments. Le hls.js actuel supprime les variantes non admissibles ; les anciennes versions sans `removeLevel` ne peuvent conserver qu'un préfixe contigu sûr et peuvent rejeter un manifeste contenant plus loin des variantes pourtant admissibles. Shaka emploie les restrictions d'application `maxHeight`/`maxBandwidth`. L'adaptation automatique continue parmi les variantes restantes.

Ces paramètres s'appliquent aux moteurs HLS et Shaka gérés. Le HTML5 simple, les décodeurs natifs de plateforme et les moteurs TV/STB conservés n'exposent pas les mêmes commandes. Auto peut choisir la lecture native ; le paramètre ne la force pas vers MSE. Le lecteur ne transfère pas une requête HLS déjà contrainte vers une lecture native sans contraintes pour contourner une erreur de décodage. Aucun transcodeur natif, benchmark matériel automatique ni garantie de sortie physique en 720p n'est impliqué.

<a id="configure-explicit-backups"></a>

## Configurer des secours explicites

1. Démarrez la chaîne en direct voulue.
2. Ouvrez **Informations → Flux de secours**.
3. Choisissez l'emplacement 1, 2 ou 3 et saisissez une URL multimédia HTTP/HTTPS complète.
4. Rouvrez un emplacement occupé pour le **Modifier** ou le **Supprimer**. Redémarrez la chaîne pour utiliser la liste actualisée.

Chaque emplacement appartient à l'espace de stockage du fournisseur actuel et à la paire exacte `sourceId`/`channelId`. La génération de lecture et la configuration de source courantes délimitent l'éditeur. Changer de source pendant qu'un dialogue est ouvert empêche ce dialogue d'enregistrer dans la source de remplacement. Une modification simultanée du même emplacement est rejetée plutôt qu'écrasée.

La première URL reste la source habituelle de la chaîne. Les emplacements vides et doublons sont ignorés. Au maximum 256 enregistrements de chaîne et 256 KiB de configuration sont acceptés. Les URL contenant des identifiants dans user-info, des espaces blancs, des caractères de contrôle, des barres obliques inverses ou un port invalide sont rejetées. Les jetons de requête fournis par le fournisseur peuvent toujours faire partie d'une URL multimédia : les secours sont une configuration locale de source, pas un moyen de partager ou de publier des identifiants.

Les secours concernent **uniquement le direct**. Les requêtes d'archives et de VOD n'utilisent jamais une alternative en direct : enregistrement, origine temporelle, droits et sémantique de déplacement peuvent différer. Le propriétaire doit fournir des points d'accès en direct équivalents et autorisés. Un titre de chaîne identique ne prouve pas l'équivalence. L'identité enregistrée de la chaîne, les favoris et l'association EPG restent inchangés quand son point de transport change.

<a id="recovery-guarantees"></a>

## Garanties de récupération

- La requête dispose au total d'au plus **deux tentatives transitoires différées sur la même URL**, et d'au plus une progression vers chacun de ses trois emplacements de secours : au maximum cinq recréations après le démarrage initial. Une nouvelle instance de décodeur ou un manifeste réussi ne réinitialise pas ce budget. La récupération HLS bornée du réseau et du décodage dans le moteur intervient avant cette politique externe.
- Les erreurs d'analyse de manifeste/niveau HLS autorisent au plus une reconnexion à la même URL par requête, comptée dans le même total de deux tentatives. Un nouveau décodeur ou point de secours ne réinitialise pas cette limite.
- Les erreurs réseau sans statut, HTTP 408/429 et 5xx peuvent employer le budget transitoire. Les autres HTTP 4xx peuvent passer à une alternative configurée mais ne réessaient pas la même URL. **HTTP 401/403 et les erreurs de connexion à la source terminent la requête**, sans tester d'autres identifiants ou points de secours.
- Les erreurs de décodage peuvent avancer vers un secours explicite. Des limites de qualité impossibles terminent la requête. Aucun cycle ne ramène à la source principale.
- Le délai est de 500 ms, 1 s, 1.5 s, puis au plus 2 s. Les rappels répétés sont regroupés.
- Pause retire le temporisateur prévu en conservant la tentative en attente ; Resume le programme de nouveau. Stop, veille, remplacement de source ou de chaîne invalident les rappels différés. Une requête définitivement échouée demande une nouvelle sélection explicite, plutôt que relancer automatiquement son décodeur retiré.
- Les erreurs de chargement Shaka et les événements d'erreur critiques partagent ce chemin ; les erreurs d'annulation sont ignorées. Le rattachement attend la destruction asynchrone de Shaka.
- La récupération résout de nouveau une référence Stalker opaque et prépare à nouveau l'accès protégé à la source. Elle ne réutilise pas une URL loopback iOS expirée. La position VOD/archives est relevée avant le démontage ; les secours en direct commencent au bord du direct.

La récupération facultative fondée sur l'horloge média du direct est décrite ci-dessous. Les mécanismes existants de kiosk, Auto/native et HLS conservent leurs périmètres et le comportement de leurs moteurs.

<a id="verification-and-observability"></a>

## Vérification et observabilité

`window.__ottStreamPolicy.snapshot()` expose le nom du moteur, les limites demandées, les capacités/disponibilités, le nombre de tentatives, l'indice du point d'accès et l'état de récupération. Il ne contient ni URL du flux ni identifiants du fournisseur. L'indice zéro désigne la source habituelle ; les suivants sont les alternatives uniques non vides. Il s'agit d'un état diagnostique, pas d'une API stable de télécommande.

Exécutez :

```sh
node tests/test_stream_policy.cjs
node tests/test_port_engine_lifecycle.cjs
node tests/test_settings_parity.cjs
node tests/test_media_backend.cjs
npm run test:localization
npm run typecheck
npm run build:server
node scripts/check-es5.cjs --server-only
```

Les tests vérifient le filtrage de qualité avec un ordre non monotone des variantes, les métadonnées indisponibles, l'édition limitée à une source, les conflits d'emplacements, les erreurs dupliquées, les budgets bornés, les erreurs d'autorisation HTTP, l'annulation par pause/arrêt/source, le démontage Shaka et la conservation de position VOD. Les cinq nouveaux libellés de lecture sont traduits dans les 88 packs linguistiques livrés ; la parité automatique n'est pas une révision par un locuteur natif. La lecture physique TV/D1 et les manifestes propres aux fournisseurs nécessitent encore une validation sur appareil. [Source modifiable du diagramme](diagrams/stream-recovery.mmd).

<a id="live-stall-recovery"></a>

## Récupération d'un direct bloqué

Dans **Paramètres → Paramètres d'interface**, choisissez **Tentatives de récupération du direct** (0–5) et **Délai de blocage du direct, s** (10/15/20/30). Les valeurs par défaut sont 0 tentative et 15 secondes. Zéro désactive uniquement ce mécanisme de surveillance ; la récupération existante des erreurs du moteur reste inchangée. Les paramètres suivent le fonctionnement habituel Enregistrer/Annuler.

Après confirmation de la progression de la lecture, l'arrêt de l'horloge média du direct principal appelle le `backend.restart()` existant. La pause, le déplacement dans la vidéo, les pages masquées, l'état hors ligne et kiosk suspendent l'observation ; les archives, la VOD et la voie PiP sont exclues. Le PiP natif masque l'OSD HTML. Un changement de chaîne, de source ou de génération annule l'observation précédente. Une lecture initiale qui ne progresse jamais reste soumise au traitement existant du démarrage et des erreurs. Le remplacement du décodeur et une progression brève ne renouvellent pas le nombre d'essais disponibles : dix secondes de progression continue le renouvellent. Une fois la limite atteinte, aucun redémarrage supplémentaire n'est déclenché par la surveillance pour ce blocage. Une récupération du moteur en attente est prioritaire ; les erreurs terminales d'autorisation, de DRM ou de qualité ne peuvent pas être contournées. Le mécanisme observe le temps média, et non l'affichage physique de l'image ni les images figées alors que l'horloge média continue d'avancer.

Pour un test de base sans abonnement, choisissez **Essayer la démo**. Une fois la lecture démarrée, définissez temporairement `document.getElementById("video").playbackRate = 0` dans les DevTools de l'onglet de test ; rétablissez ensuite la valeur 1. La pause est volontairement exclue de la récupération des blocages.
