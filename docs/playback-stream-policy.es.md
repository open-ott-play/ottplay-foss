# Límites de calidad y recuperación de emisiones en directo

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Propiedad del decodificador](device-media-backend.md)

El reproductor HTML5/HLS/Shaka gestionado conserva una única concesión de reproducción mientras se recupera de una fuente fallida. También puede usar hasta tres URL de respaldo configuradas explícitamente para un canal en directo. Nunca descubre, adivina ni sustituye un canal por su título.

![Recuperación: una concesión, reintentos finitos y respaldos explícitos](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## Establecer un límite de calidad

Abra **Ajustes → Ajustes de interfaz** y configure **Altura máxima de vídeo (HLS/Shaka)** y/o **Tasa de bits máxima del flujo (HLS/Shaka)**. Ambas restricciones se aplican conjuntamente. **Automático** elimina la restricción correspondiente. Se admiten 360/480/720/1080/2160 píxeles y 1/2/4/8/16 Mbps. Los ajustes se guardan localmente, participan en el flujo normal de guardar/cancelar y entran en vigor en el siguiente inicio de reproducción, incluido un reinicio de recuperación.

Son límites, no ajustes de transcodificación. Un flujo disponible solo en 1080p no puede convertirse en 720p. Si ninguna variante anunciada cumple, el reproductor muestra **No stream meets the quality limits** y deja de reintentar esa solicitud. Una altura/tasa desconocida no demuestra que una variante HLS restringida cumpla.

El filtrado de variantes HLS ocurre antes de cargar fragmentos. El hls.js actual elimina variantes no aptas; versiones antiguas sin `removeLevel` solo pueden conservar un prefijo contiguo seguro y pueden rechazar un manifiesto con variantes posteriores que sí cumplirían. Shaka utiliza las restricciones de aplicación `maxHeight`/`maxBandwidth`. La adaptación automática continúa entre las variantes restantes.

Estos ajustes se aplican a los motores HLS y Shaka gestionados. HTML5 simple, los decodificadores nativos de la plataforma y los motores TV/STB conservados no exponen los mismos controles. Auto puede seleccionar reproducción nativa; el ajuste no la fuerza a MSE. El reproductor no cambiará una solicitud HLS ya restringida a reproducción nativa sin restricciones solo para eludir un error de decodificación. No se implica un transcodificador nativo, una prueba automática del hardware ni una afirmación de salida física a 720p.

<a id="configure-explicit-backups"></a>

## Configurar respaldos explícitos

1. Inicie el canal en directo deseado.
2. Abra **Información → Flujos de respaldo**.
3. Seleccione la posición 1, 2 o 3 e introduzca una URL multimedia HTTP/HTTPS completa.
4. Vuelva a abrir una posición ocupada para **Editar** o **Eliminar**. Inicie otra vez el canal para usar la lista actualizada.

Cada posición pertenece al espacio de almacenamiento del proveedor actual y al par exacto `sourceId`/`channelId`. La generación actual de reproducción y la configuración de la fuente delimitan el editor. Cambiar de fuente con un diálogo abierto impide que ese diálogo guarde en la fuente sustituta. Un cambio concurrente en la misma posición se rechaza en lugar de sobrescribirse.

La primera URL sigue siendo la fuente habitual del canal. Se omiten las posiciones vacías y duplicadas. Se aceptan un máximo de 256 registros de canal y 256 KiB de configuración. Se rechazan las URL con credenciales en user-info, espacios en blanco, caracteres de control, barras inversas o un puerto no válido. Los tokens de consulta del proveedor aún pueden formar parte de una URL multimedia: estos ajustes son configuración local de la fuente, no un mecanismo para compartir credenciales o hacerlas públicas.

Los respaldos son **solo para directo**. Las solicitudes de archivo y VOD nunca usan una alternativa en directo: la grabación, el origen temporal, los derechos y la semántica de búsqueda pueden diferir. El propietario debe aportar destinos en directo equivalentes y autorizados. Un título de canal coincidente no demuestra equivalencia. La identidad guardada del canal, los favoritos y la vinculación EPG no cambian al modificar el destino de transporte.

<a id="recovery-guarantees"></a>

## Garantías de recuperación

- La solicitud tiene como máximo **dos reintentos transitorios diferidos de la misma URL en total**, y como máximo un avance a cada una de las tres posiciones de respaldo: hasta cinco recreaciones tras el inicio inicial. Una nueva instancia del decodificador o un manifiesto exitoso no reinician el presupuesto. La recuperación HLS acotada de red y decodificación dentro del motor ocurre antes de esta política externa.
- Los fallos al analizar manifiestos/niveles HLS permiten como máximo una reconexión a la misma URL por solicitud, incluida en el total de dos reintentos. Un decodificador o destino de respaldo nuevo no reinicia este límite.
- Los fallos de red sin estado, HTTP 408/429 y 5xx pueden usar el presupuesto transitorio. Otros HTTP 4xx pueden avanzar a una alternativa configurada, pero no reintentan la misma URL. **HTTP 401/403 y los errores de inicio de sesión en la fuente terminan la solicitud**, sin probar otras credenciales o destinos de respaldo.
- Los fallos de decodificación pueden avanzar a un respaldo explícito. Los límites de calidad imposibles terminan la solicitud. No hay ciclos de vuelta a la fuente principal.
- La demora es de 500 ms, 1 s, 1.5 s y después hasta 2 s. Los callbacks repetidos se agrupan.
- Pause elimina el temporizador programado conservando el reintento pendiente; Resume lo programa de nuevo. Stop, espera, sustitución de fuente o canal invalidan los callbacks diferidos. Una solicitud fallida de forma terminal necesita selección explícita de nuevo, no reproducir automáticamente su decodificador retirado.
- Los fallos de carga y eventos de error críticos de Shaka comparten esta ruta; los errores de cancelación se ignoran. La reconexión espera a la destrucción asíncrona de Shaka.
- La recuperación vuelve a resolver una referencia opaca de Stalker y prepara otra vez el acceso protegido a la fuente. No reutiliza una URL loopback caducada de iOS. La posición VOD/archivo se captura antes del desmontaje; los respaldos de directo empiezan en su borde en vivo.

La recuperación opcional basada en el reloj multimedia de la emisión en directo se describe más abajo. La recuperación existente de kiosk, Auto/native y HLS conserva sus propios ámbitos y el comportamiento de sus motores.

<a id="verification-and-observability"></a>

## Verificación y observabilidad

`window.__ottStreamPolicy.snapshot()` expone nombre del motor, límites solicitados, capacidad/disponibilidad, número de reintentos, índice del destino y estado de recuperación. No contiene URL del flujo ni credenciales del proveedor. El índice cero representa la fuente normal; los posteriores son alternativas únicas no vacías. Es estado de diagnóstico, no una API estable de control remoto.

Ejecute:

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

Las pruebas ejercitan el filtrado de calidad con variantes en orden no monótono, metadatos no disponibles, edición por fuente, conflictos de posiciones, errores duplicados, presupuestos acotados, fallos de autorización HTTP, cancelación por pausa/parada/fuente, desmontaje de Shaka y conservación de posición VOD. Las cinco nuevas etiquetas de reproducción están traducidas en los 88 paquetes de idioma incluidos; la paridad automática no es revisión de hablantes nativos. La reproducción física TV/D1 y los manifiestos específicos de proveedores aún requieren validación en dispositivos. [Fuente editable del diagrama](diagrams/stream-recovery.mmd).

<a id="live-stall-recovery"></a>

## Recuperación de una emisión en directo bloqueada

En **Ajustes → Ajustes de interfaz**, seleccione **Intentos de recuperación en directo** (0–5) y **Tiempo de espera de bloqueo en directo, s** (10/15/20/30). Los valores predeterminados son 0 intentos y 15 segundos. Cero desactiva solo este supervisor; la recuperación existente de errores del motor no cambia. Los ajustes utilizan el flujo habitual Guardar/Cancelar.

Tras confirmar que la reproducción avanza, si se detiene el reloj multimedia del directo principal se invoca el `backend.restart()` existente. La pausa, la búsqueda de posición, las páginas ocultas, el estado sin conexión y kiosk suspenden la observación; se excluyen el archivo, VOD y la vía PiP. El PiP nativo oculta el OSD HTML. Los cambios de canal, fuente o generación cancelan la observación anterior. El inicio de reproducción que nunca avanza sigue sujeto al tratamiento existente de arranque y errores. Los reemplazos del decodificador y los avances breves no renuevan el presupuesto de intentos: lo renuevan diez segundos de avance continuo. Agotar el límite impide más reinicios del supervisor para ese bloqueo. Una recuperación pendiente del motor tiene prioridad; no se pueden eludir los errores terminales de autorización, DRM o calidad. Se observa el tiempo multimedia, no la presentación física de la imagen ni los fotogramas congelados mientras el reloj multimedia sigue avanzando.

Para una prueba básica sin suscripción, seleccione **Probar demo**. Una vez iniciada la reproducción, establezca temporalmente `document.getElementById("video").playbackRate = 0` en DevTools de la pestaña de prueba; después restablézcalo a 1. La pausa se excluye deliberadamente de la recuperación por bloqueo.
