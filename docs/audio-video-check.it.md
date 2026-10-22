# Controllo manuale di audio e video

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Recupero del flusso](playback-stream-policy.it.md) · [Specifica del campione](../diagnostics/README.md)

Usare **menu del lettore → Informazioni → Audio → Riproduci** per controllare immagine e suono con un filmato noto di otto secondi. Questo è il controllo A/V udibile; la dimostrazione del motivo in movimento durante l'introduzione è silenziosa.

![Controllo A/V: sorgente nel repository, filmato ospitato e riproduzione esplicita](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## Avviare il controllo

1. Impostare televisore, altoparlanti o cuffie a un volume confortevole. Il controllo usa il volume attuale del lettore e riattiva temporaneamente l'audio del suo video; non aumenta il volume di sistema del televisore.
2. Aprire il menu del lettore, scegliere **Informazioni**, poi **Audio**, poi **Riproduci**. Aprire soltanto il menu non scarica né riproduce il filmato.
3. Guardare lo schermo e ascoltare la sequenza seguente. Per terminare prima, usare **Informazioni → Audio → Ferma**.

Il controllo usa il percorso HTML5 centrale gestito quando il lettore è inattivo oppure la TV in diretta è in riproduzione o in pausa. Rifiuta una richiesta VOD/archivio attiva, una richiesta in diretta ancora in caricamento e lo standby. Non è disponibile neppure quando un adattatore del dispositivo sostituisce il motore centrale, inclusi **PC2/Video.js** e i motori nativi sostitutivi; il solo uso di un elemento video HTML5 non rende idoneo un adattatore. Un rifiuto non sostituisce la riproduzione in corso. Fermare prima la richiesta corrente per provare dall'inattività; questo non abilita il controllo su tali adattatori. Le etichette dei menu seguono la lingua selezionata dell'interfaccia.

<a id="what-you-should-see-and-hear"></a>

## Cosa vedere e sentire

Lo sfondo è un motivo di prova in movimento. Brevi indicatori bianchi lampeggiano nella metà superiore sinistra o destra insieme a impulsi sonori deboli di circa 150 ms:

- **0–2 secondi:** un impulso da 440 Hz nel canale sinistro ogni secondo, con l'indicatore sinistro.
- **2–4 secondi:** un impulso da 880 Hz nel canale destro, con l'indicatore destro.
- **4–6 secondi:** impulsi in entrambi i canali, con entrambi gli indicatori.
- **6–8 secondi:** il motivo continua a muoversi senza suono. Il silenzio è intenzionale.

Un televisore mono o un downmix può riprodurre entrambi i canali da un solo altoparlante. Controllare personalmente schermo fisico e uscita audio. Il lettore non misura l'uscita degli altoparlanti e non emette un verdetto automatico A/V di successo o fallimento.

<a id="where-the-clip-comes-from"></a>

## Provenienza del filmato

Il lettore usa questo indirizzo HTTPS assoluto:

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

Richiede il filmato solo quando si sceglie **Riproduci**, mai come precaricamento all'avvio. Il file è di **464 652 byte**, con video H.264 baseline a 640×360 / 25 fps e audio stereo AAC. È escluso dai pacchetti Web, OTTPlay Server, Tauri, Capacitor e container. Il [file sorgente](../diagnostics/av-v1.mp4), il generatore e il verificatore restano nel repository; non sono un'alternativa offline nel lettore installato.

Servono accesso a Internet e una connessione HTTPS funzionante verso quell'host. Non esistono un'alternativa inclusa o un altro URL diagnostico. Aprire il collegamento nel browser aiuta a controllare la disponibilità del file, ma non esercita la proprietà del decoder del lettore o il ritorno al canale. Il servizio di hosting riceve le normali informazioni di connessione; vedere i [dettagli sulla privacy](privacy-policy.md#optional-hosted-audio-video-check).

<a id="how-playback-returns"></a>

## Ritorno alla riproduzione

Il controllo usa il decoder principale e sostituisce temporaneamente l'immagine in diretta. Termina alla fine del filmato, dopo **Audio → Ferma** o quando si verifica un errore multimediale. Una **scadenza di sicurezza di 15 secondi inizia quando il controllo viene accettato** e comprende il caricamento; un download lento può quindi terminare prima che siano riprodotti tutti gli otto secondi.

In questi casi, il lettore tenta di ripristinare la richiesta in diretta acquisita al punto corrente del live, incluso il suo stato di pausa, solo se appartiene ancora alla sorgente corrente e nessuna riproduzione sostitutiva ha preso il controllo. L'URL live viene risolto di nuovo; il ripristino dipende ancora da provider e rete. Un controllo avviato in inattività torna all'inattività.

Il normale comando di riproduzione **Stop**, lo standby o la scelta di un altro canale annullano il controllo senza riavviare il canale acquisito. Cambiare la sorgente o la sua sessione impedisce anche un ripristino obsoleto. All'uscita il controllo annulla la propria riattivazione temporanea dell'audio; se si disattiva l'audio durante l'esecuzione, resta disattivato. Non cambia la preferenza del motore salvata, non scrive secondi di prova nella cronologia del canale e non pubblica al sistema operativo un falso completamento del canale o metadati di prova.

<a id="if-the-result-is-unexpected"></a>

## Se il risultato è inatteso

- **Il controllo non parte:** verificare che il lettore sia inattivo o su un canale live già in riproduzione/pausa tramite il percorso HTML5 centrale gestito, senza sostituzioni del motore del dispositivo. Uno stato non supportato o un errore multimediale può mostrare **“Stream could not be played”**.
- **Non carica nulla o termina presto:** controllare Internet e il collegamento HTTPS diretto. Un errore di rete o la scadenza non dimostrano un guasto del decoder o degli altoparlanti. Ripristinare la connessione prima di riprovare.
- **Immagine senza suono:** gli ultimi due secondi sono intenzionalmente silenziosi. Nei primi sei controllare muto/volume del lettore, volume del televisore, uscita audio scelta e collegamento di altoparlanti/cuffie.
- **Suona un solo altoparlante fisico:** controllare prima se il televisore usa un'uscita mono o un downmix, prima di considerarlo un errore di instradamento dei canali.

È un breve controllo di un MP4 noto attraverso il percorso HTML5 centrale gestito per immagine/audio. Non dimostra che funzionino un flusso del provider, HLS/DASH, DRM, audio multicanale o risoluzioni maggiori, né misura capacità di rete o latenza di sincronizzazione. I limiti di qualità e le impostazioni dei flussi live di riserva non modificano questo filmato diagnostico.

Proprietà e pulizia sono coperte da [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) e [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs). Le verifiche automatiche di decodifica e ciclo di vita non sostituiscono guardare e ascoltare sul dispositivo reale; questa guida non dichiara nuovi risultati su dispositivi fisici.
