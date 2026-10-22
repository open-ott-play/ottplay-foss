# Vérification manuelle de l'audio et de la vidéo

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Récupération du flux](playback-stream-policy.fr.md) · [Spécification du clip de test](../diagnostics/README.md)

Utilisez **menu du lecteur → Informations → Audio → Lecture** pour contrôler l'image et le son avec un clip connu de huit secondes. Il s'agit de la vérification A/V audible ; la démonstration du motif mobile lors de la présentation initiale est silencieuse.

![Vérification A/V : source du dépôt, clip hébergé et lecture explicite](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## Démarrer la vérification

1. Réglez le téléviseur, les enceintes ou le casque à un volume confortable. La vérification utilise le volume courant du lecteur et réactive temporairement le son de sa vidéo ; elle n'augmente pas le volume système du téléviseur.
2. Ouvrez le menu du lecteur, sélectionnez **Informations**, puis **Audio**, puis **Lecture**. Ouvrir le menu seul ne télécharge ni ne lit le clip.
3. Regardez l'écran et écoutez la séquence ci-dessous. Pour terminer plus tôt, utilisez **Informations → Audio → Arrêter**.

La vérification utilise le chemin central HTML5 géré lorsque le lecteur est inactif ou que la télévision en direct est en lecture ou en pause. Elle refuse une requête VOD/archives active, une requête de direct encore en chargement et la veille. Elle est aussi indisponible si un adaptateur de l'appareil remplace le moteur central, notamment **PC2/Video.js** et les substitutions par des moteurs natifs ; employer un élément vidéo HTML5 ne rend pas à lui seul un adaptateur admissible. Un refus ne remplace pas la lecture en cours. Arrêtez d'abord la requête courante pour tester au repos ; cela n'active pas la vérification sur ces adaptateurs. Les libellés suivent la langue d'interface sélectionnée.

<a id="what-you-should-see-and-hear"></a>

## Ce que vous devez voir et entendre

Le fond est un motif de test animé. De brefs repères blancs clignotent sur la moitié supérieure gauche ou droite au rythme d'impulsions sonores discrètes d'environ 150 ms :

- **0–2 secondes :** une impulsion à 440 Hz dans le canal gauche chaque seconde, avec le repère gauche.
- **2–4 secondes :** une impulsion à 880 Hz dans le canal droit, avec le repère droit.
- **4–6 secondes :** les deux canaux émettent des impulsions, avec les deux repères.
- **6–8 secondes :** le motif continue de bouger sans son. Ce silence est volontaire.

Un téléviseur mono ou un sous-mixage peut reproduire les deux canaux sur une seule enceinte. Vérifiez vous-même l'écran physique et la sortie audio. Le lecteur ne mesure pas la sortie des enceintes et ne fournit pas de verdict A/V automatique de réussite ou d'échec.

<a id="where-the-clip-comes-from"></a>

## Provenance du clip

Le lecteur utilise cette adresse HTTPS absolue :

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

Il demande le clip uniquement quand vous choisissez **Lecture**, jamais en préchargement au démarrage. Le fichier fait **464 652 octets**, avec une vidéo H.264 baseline à 640×360 / 25 fps et un son AAC stéréo. Il est exclu des paquets Web, OTTPlay Server, Tauri, Capacitor et des conteneurs. Le [fichier source](../diagnostics/av-v1.mp4), le générateur et le vérificateur restent dans le dépôt ; ils ne constituent pas un secours hors ligne dans le lecteur installé.

Un accès Internet et une connexion HTTPS fonctionnelle à cet hôte sont nécessaires. Il n'existe ni secours intégré ni autre URL de diagnostic. Ouvrir le lien dans un navigateur peut vérifier la disponibilité du fichier, mais ne teste ni la possession du décodeur par le lecteur ni le retour à la chaîne. L'hébergeur reçoit les informations de connexion habituelles ; voir les [détails de confidentialité](privacy-policy.md#optional-hosted-audio-video-check).

<a id="how-playback-returns"></a>

## Retour à la lecture

La vérification utilise le décodeur principal et remplace temporairement l'image du direct. Elle se termine à la fin du clip, après **Audio → Arrêter** ou lors d'une erreur multimédia. Un **délai de sécurité de 15 secondes commence dès l'acceptation de la vérification** et couvre aussi le chargement ; un téléchargement lent peut donc s'achever avant que les huit secondes soient lues.

Dans ces cas, le lecteur tente de restaurer la requête de direct capturée au point courant du direct, y compris son état de pause, uniquement si elle appartient encore à la source courante et qu'aucune lecture de remplacement n'a pris la main. L'URL du direct est résolue de nouveau ; la restauration dépend toujours du fournisseur et du réseau. Une vérification lancée au repos revient au repos.

La commande de lecture ordinaire **Stop**, la veille ou la sélection d'une autre chaîne annulent la vérification sans redémarrer la chaîne capturée. Changer la source ou sa session empêche également une restauration périmée. La vérification annule sa réactivation temporaire du son en quittant ; si vous coupez le son pendant son exécution, cette coupure reste effective. Elle ne modifie pas la préférence de moteur enregistrée, n'ajoute pas les secondes de test à l'historique de la chaîne et ne publie au système d'exploitation ni fausse fin de chaîne ni métadonnées de test.

<a id="if-the-result-is-unexpected"></a>

## Si le résultat est inattendu

- **La vérification ne démarre pas :** assurez-vous que le lecteur est au repos ou sur une chaîne en direct déjà en lecture/pause via le chemin central HTML5 géré, sans moteur de remplacement propre à l'appareil. Un état non pris en charge ou une erreur multimédia peut afficher **“Stream could not be played”**.
- **Rien ne charge ou la vérification se ferme tôt :** vérifiez Internet et le lien HTTPS direct. Une erreur réseau ou l'expiration du délai ne prouve pas une panne du décodeur ou des enceintes. Rétablissez la connexion avant de relancer la lecture.
- **Image sans son :** les deux dernières secondes sont volontairement silencieuses. Pendant les six premières, vérifiez sourdine/volume du lecteur, volume du téléviseur, sortie audio sélectionnée et connexion des enceintes/du casque.
- **Une seule enceinte physique émet du son :** vérifiez d'abord si le téléviseur utilise une sortie mono ou un sous-mixage avant d'y voir une erreur d'acheminement des canaux.

Il s'agit d'une courte vérification d'un MP4 connu via le chemin central HTML5 géré d'image/audio. Elle ne garantit pas qu'un flux fournisseur, HLS/DASH, DRM, le son multicanal ou une résolution supérieure fonctionneront, et ne mesure ni capacité réseau ni latence de synchronisation. Les plafonds de qualité et les paramètres de flux de secours du direct ne modifient pas ce clip de diagnostic.

La possession du décodeur et le nettoyage sont couverts par [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) et [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs). Les vérifications automatisées du décodage et du cycle de vie ne remplacent pas regarder et écouter sur l'appareil réel ; ce guide ne revendique aucun nouveau résultat sur un appareil physique.
