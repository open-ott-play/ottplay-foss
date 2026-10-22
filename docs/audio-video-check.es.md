# Comprobación manual de audio y vídeo

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Recuperación del flujo](playback-stream-policy.es.md) · [Especificación de la muestra](../diagnostics/README.md)

Use **menú del reproductor → Información → Audio → Reproducir** para comprobar la imagen y el sonido con un clip conocido de ocho segundos. Esta es la comprobación A/V audible; la demostración del patrón móvil durante la introducción es silenciosa.

![Comprobación A/V: fuente del repositorio, clip alojado y reproducción explícita](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## Iniciar la comprobación

1. Ajuste el televisor, los altavoces o los auriculares a un volumen cómodo. La comprobación utiliza el volumen actual del reproductor y activa temporalmente el sonido de su vídeo; no aumenta el volumen del sistema del televisor.
2. Abra el menú del reproductor, seleccione **Información**, después **Audio** y luego **Reproducir**. Abrir el menú no descarga ni reproduce el clip.
3. Observe la pantalla y escuche la secuencia siguiente. Para finalizar antes, use **Información → Audio → Detener**.

La comprobación utiliza la ruta central HTML5 gestionada cuando el reproductor está inactivo o cuando se reproduce o pausa televisión en directo. Rechaza una solicitud VOD/archivo activa, una solicitud de directo aún cargándose y el modo de espera. Tampoco está disponible si un adaptador del dispositivo sustituye el motor central, incluidos **PC2/Video.js** y las sustituciones por motores nativos; usar un elemento de vídeo HTML5 no basta para que un adaptador sea compatible. Un rechazo no sustituye la reproducción existente. Detenga primero la solicitud actual para probar desde reposo; esto no habilita la comprobación en esos adaptadores. Las etiquetas de los menús siguen el idioma seleccionado de la interfaz.

<a id="what-you-should-see-and-hear"></a>

## Qué debería ver y oír

El fondo es un patrón de prueba móvil. Breves marcadores blancos destellan en la mitad superior izquierda o derecha al ritmo de pulsos sonoros suaves de unos 150 ms:

- **0–2 segundos:** un pulso de 440 Hz en el canal izquierdo cada segundo, con el marcador izquierdo destellando.
- **2–4 segundos:** un pulso de 880 Hz en el canal derecho, con el marcador derecho.
- **4–6 segundos:** pulsos en ambos canales, con ambos marcadores.
- **6–8 segundos:** el patrón sigue moviéndose sin sonido. Este silencio es intencionado.

Un televisor mono o una mezcla descendente puede reproducir ambos canales por un altavoz. Compruebe personalmente la pantalla física y la salida de audio. El reproductor no mide la salida de los altavoces ni emite un veredicto A/V automático de aprobado o fallido.

<a id="where-the-clip-comes-from"></a>

## De dónde procede el clip

El reproductor utiliza esta dirección HTTPS absoluta:

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

Solicita el clip solo cuando elige **Reproducir**, nunca como precarga al iniciar. El archivo tiene **464 652 bytes**, vídeo H.264 baseline a 640×360 / 25 fps y audio estéreo AAC. Se excluye de los paquetes Web, OTTPlay Server, Tauri, Capacitor y contenedores. El [archivo fuente](../diagnostics/av-v1.mp4), el generador y el verificador permanecen en el repositorio; no son una alternativa sin conexión en el reproductor instalado.

Se necesita acceso a Internet y una conexión HTTPS funcional con ese host. No existe una alternativa incluida ni otra URL de diagnóstico. Abrir el enlace anterior en un navegador ayuda a comprobar la disponibilidad del archivo, pero no ejercita la propiedad del decodificador ni el retorno al canal del reproductor. El alojamiento recibe la información habitual de conexión; consulte los [detalles de privacidad](privacy-policy.md#optional-hosted-audio-video-check).

<a id="how-playback-returns"></a>

## Cómo vuelve la reproducción

La comprobación usa el decodificador principal y sustituye temporalmente la imagen en directo. Termina al final del clip, después de **Audio → Detener** o cuando hay un error multimedia. Un **plazo de seguridad de 15 segundos comienza al aceptar la comprobación** e incluye la carga; por ello, una descarga lenta puede terminar antes de reproducir los ocho segundos completos.

En esos casos, el reproductor intenta restaurar la solicitud de directo capturada en el borde en vivo, incluido su estado de pausa, solo si esa solicitud todavía pertenece a la fuente actual y ninguna reproducción sustitutiva ha tomado el control. La URL de directo se resuelve de nuevo; su restauración sigue dependiendo del proveedor y de la red. Una comprobación iniciada en reposo vuelve al reposo.

La orden normal de reproducción **Stop**, el modo de espera o elegir otro canal cancelan la comprobación sin reiniciar el canal capturado. Cambiar la fuente o su sesión también evita una restauración obsoleta. La comprobación revierte su activación temporal del sonido al salir; si silencia durante su ejecución, ese silencio se mantiene. No cambia la preferencia de motor guardada, no escribe segundos de prueba en el historial del canal ni publica al sistema operativo una finalización falsa del canal o metadatos de prueba.

<a id="if-the-result-is-unexpected"></a>

## Si el resultado es inesperado

- **La comprobación no puede empezar:** confirme que el reproductor está inactivo o en un canal en directo ya reproduciéndose/pausado mediante la ruta central HTML5 gestionada, sin sustitución del motor del dispositivo. Un estado no compatible o un error multimedia puede mostrar **“Stream could not be played”**.
- **No carga nada o se cierra antes:** compruebe Internet y el enlace HTTPS directo. Un error de red o el vencimiento del plazo no demuestra que el decodificador o los altavoces estén averiados. Restablezca la conexión antes de volver a reproducir.
- **Imagen sin sonido:** los últimos dos segundos son deliberadamente silenciosos. Durante los seis primeros, compruebe silencio/volumen del reproductor, volumen del televisor, salida de audio seleccionada y conexión de altavoces/auriculares.
- **Solo suena un altavoz físico:** compruebe primero si el televisor usa salida mono o mezcla descendente antes de considerarlo un fallo de encaminamiento de canales.

Es una comprobación breve de un MP4 conocido por la ruta central HTML5 gestionada de imagen/audio. No demuestra que funcionen un flujo de proveedor, HLS/DASH, DRM, audio multicanal o reproducción de mayor resolución, ni mide capacidad de red o latencia de sincronización. Los límites de calidad y ajustes de flujos de respaldo en directo no alteran este clip de diagnóstico.

La propiedad y la limpieza se comprueban en [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) y [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs). Las pruebas automáticas de decodificación y ciclo de vida no sustituyen mirar y escuchar en el dispositivo real; esta guía no afirma ningún nuevo resultado en dispositivos físicos.
