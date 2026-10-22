# De la lista de funciones al comportamiento verificado

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Contratos de funciones](roadmap-delivery.es.md) · [Pruebas del tamaño](roadmap-size.es.md)

Este informe documenta la implementación y el refuerzo, no anuncia una versión. La instantánea medida del reproductor es `652726f8`; la instantánea nativa de Android, compilada por separado, es `be0d800`. CI, integración y promoción de versiones siguen siendo controles independientes. Los commits posteriores solo de documentación o pruebas no convierten una comprobación local en prueba de que un dispositivo instalado se haya actualizado. Los estados indicados corresponden a esas instantáneas históricas; no son un seguimiento de versiones en tiempo real. Las compilaciones publicadas están en [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases).

![Proceso de implementación y controles de aceptación](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## Cómo se comprobó el trabajo

La solicitud inicial se dividió en 13 partes funcionales utilizables entre el reproductor clásico, el servicio de control/CLI y la aplicación nativa independiente de Android. Se asignaron responsables por componente para revisar e integrar cambios simultáneos sin sustituir el trabajo de otro componente. La nueva interfaz reutilizó etiquetas traducidas existentes o añadió entradas de catálogo en los 88 idiomas; las guías técnicas completas se redactaron inicialmente en inglés y ruso. El manual principal y las guías de funciones emparejadas ahora tienen ediciones completas en [24 idiomas de documentación](manual-translations.md).

Tras la implementación hubo revisión cruzada independiente y pruebas de regresión ejecutables. Antes de modificar código, cada problema comunicado se contrastó con la ruta real de callbacks, decodificador, almacenamiento o foco. Los fallos de pruebas se separaron entre regresiones de comportamiento y selectores obsoletos. Por ejemplo, cambiar las filas clásicas de `button` a `option` exigía actualizar los selectores; no justificaba debilitar el comportamiento esperado del clic.

Las compilaciones de producción limpias comprobaron después los artefactos ES5 emitidos y el coste JavaScript completo, incluidos módulos de proveedores opcionales. Las pruebas de navegador específicas usaron el cargador, el paquete y los adaptadores de dispositivo distribuidos. Android nativo tuvo su propia ejecución de pruebas Gradle, lint y empaquetado. Las comprobaciones del PR y los hilos de revisión se vuelven a comprobar tras enviar los cambios; una compilación local correcta no los sustituye.

<a id="what-changed-during-review"></a>

## Qué cambió durante la revisión

![Cinco comportamientos corregidos y el coste JavaScript medido](diagrams/implementation-results.svg)

- **Análisis HLS y reintentos:** los fallos de análisis compartían inicialmente la clasificación genérica de red. Ahora permiten como máximo una reconexión a la misma URL dentro del presupuesto de dos reintentos transitorios; los nuevos decodificadores y URL de respaldo no lo reinician. Un fallo terminal de autenticación/DRM también cancela un reintento transitorio ya encolado.
- **Alternativa nativa en Auto:** el tratamiento del error nativo podía retirar la solicitud cuando Auto ya era propietario de una alternativa. El propietario existente conserva ahora esa transición; la cancelación sigue invalidando sus callbacks demorados.
- **Enter en modales:** enfocar automáticamente el primer botón Cancelar convertía Enter en el diálogo de espera de Plex en una cancelación. Ahora los diálogos empiezan con el foco en el propio diálogo. Tab llega expresamente a sus botones; los diálogos normales de información y confirmación conservan el comportamiento de Enter y Escape/Atrás.
- **Selección con puntero en PC:** el foco del ratón cambiaba la selección antes del controlador del clic y convertía el primer clic en activación. El foco inducido por el puntero ya no preselecciona la fila. PC sigue seleccionando primero y activando después; LG conserva la acción de un solo clic. El foco del teclado sigue a la selección.
- **Pistas de Android:** una selección sin etiqueta del elemento actual podía borrarse por su propia confirmación Auto o una actualización de preferencias de subtítulos, o pasar a otro elemento con un `TrackGroup` igual. Ahora sobrevive a escrituras demoradas solo para su elemento actual. Las preferencias semánticas usan idioma/rol/etiqueta; ViewModel gestiona la persistencia para que cerrar el panel no cancele la escritura.

Las 13 partes entregadas son: muestra A/V; configuración Local/Home reanudable; recuperación acotada; límites de calidad; preferencias de pistas Android; claves de control con ámbito; asociaciones XMLTV; películas/series Xtream; accesibilidad clásica; resultados duraderos de comandos; transferencia explícita; flujos de respaldo; lotes de ajustes recuperables. La [guía de funciones](roadmap-delivery.es.md) define el alcance y las limitaciones de cada una.

<a id="evidence-and-remaining-gates"></a>

## Pruebas y controles pendientes

Para `652726f8` pasaron los cinco escenarios específicos de navegador: navegación con puntero LG webOS, navegación con puntero LG NetCast, comportamiento de dos clics en PC, semántica de teclado de diálogos y colección/resolución/cancelación/reintento de Plex. Pasaron TypeScript, la prueba unitaria de accesibilidad, lint acotado, ES5 y los límites de tamaño de paquetes. La ejecución completa de navegador sobre esta compilación terminó con **194 pruebas correctas y una omitida**: HLS nativo requiere WebKit y esta ejecución usó Chromium. El CI alojado y la secuencia acordada de integración siguen siendo controles independientes.

La cadena restante de `test:port` y `test:unified` se completó en segmentos reanudados tras corregir fixtures aislados. Cada objetivo fallido se volvió a ejecutar con éxito y los comandos restantes terminaron correctamente; no se afirma una única ejecución ininterrumpida de `npm test`. El paso exacto del CI del puente Android, de nueve comandos, también pasó localmente.

Para Android `be0d800` pasaron localmente **101 pruebas de la aplicación y 62 del núcleo compartido**, además de lint debug/release, ensamblado APK Debug/Release/Full, el bundle de versión y la compilación del APK androidTest. Compilar el APK de pruebas instrumentadas no equivale a ejecutarlo en un dispositivo. Los tres hallazgos confirmados de revisión se respondieron y resolvieron en [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68). Ese PR pasó sus controles y se integró como `5b644b94`; el CI posterior a la integración se sigue por separado. El diagrama deja pendiente el control global de CI/versión del reproductor.

El JavaScript web completo pasó de **964,459 / 305,344** bytes sin comprimir/gzip a **995,858 / 315,207**: **+31,399 / +9,863 bytes** (aproximadamente 3.26% / 3.23%). El candidato de funciones era 995,587 / 315,103; el refuerzo posterior añadió 271 / 104. La entrada principal final de esa instantánea es 875,197 / 270,425. Véanse la [medición base](evidence/roadmap-size-20261015.json), la [medición del artefacto final](evidence/roadmap-final-size-20261015.json) y el [método de medición](roadmap-size.es.md). Las comas de estas cifras de bytes separan millares.

Son costes históricos de JavaScript en bytes, **no mejoras de velocidad medidas**. Los totales excluyen motores multimedia, diccionarios, CSS, imágenes y vídeo. Los paquetes de esa instantánea incluían por separado el clip A/V de 464,652 bytes. Tras el [cambio de alojamiento](audio-video-check.es.md), `diagnostics/av-v1.mp4` permanece en el repositorio con su generador y verificador para reproducibilidad, pero se excluye de los paquetes Web/OTTPlay Server, Tauri, Capacitor y Docker. El reproductor solo lo obtiene de here.now para la prueba A/V explícita, que requiere internet; el inicio de reproducción no lo descarga. Quitar 464,652 bytes multimedia sin comprimir no establece el ahorro en instaladores comprimidos ni cambia las mediciones históricas de JavaScript. El tiempo de inicio, la regularidad de fotogramas, la memoria, la experiencia con lectores de pantalla, el audio HDMI real y el comportamiento del proveedor requieren mediciones propias en dispositivos de destino. Este informe no afirma un nuevo resultado en un dispositivo físico ni una versión beta. La [lista de aceptación física](roadmap-delivery.es.md#physical-acceptance-before-promotion) y la [estrategia de versiones](../RELEASING.md) siguen siendo los criterios de promoción.

<a id="post-beta-integration-and-review"></a>

## Integración y revisión tras la beta

Después de publicar beta.4 se integró en esta rama el código `39287792`. La revisión de ejecución `9663b681` también corrige la restauración al extremo en directo con límites de calidad HLS y permite recuperar un diario de ajustes dañado antes del inicio normal. La pantalla de recuperación bloquea la hidratación parcial de cuentas, admite reintentar y restablecer con confirmación, conserva las cookies ajenas e impide que los ajustes antiguos de cookies reaparezcan tras el restablecimiento. Véase el [proceso de recuperación](settings-recovery.es.md) y su diagrama SVG.

![Comparación completa de JavaScript tras la beta](diagrams/post-beta-size.svg)

Reproducir ambos códigos con Node 26.8.2, Rollup 4.64.5 y Terser 5.51.2 produce **964,876 / 305,452** bytes sin comprimir/gzip para el código beta.4 y **1,000,388 / 316,600** para la integración: **+35,512 / +11,148 bytes** (3.68% / 3.65%). Estos totales incluyen todos los proveedores opcionales: siete en la base y ocho en la integración. La nueva entrada mide 879,533 / 271,761. Es una comparación independiente de las gráficas anteriores congeladas.

Ambas compilaciones de producción locales regeneran cinco archivos de ejecución versionados y omiten la afirmación de una revisión de código limpio. Los informes registran esta limitación en vez de identificar esos archivos locales como artefactos publicados: [base](evidence/post-beta-baseline-size-20261015.json) e [integración](evidence/post-beta-candidate-size-20261015.json). La compilación de integración y las comprobaciones ES5/nativas pasan. También pasan seis comprobaciones específicas de navegador: recuperación/restablecimiento del diario, teclado de diálogos, puntero LG webOS y NetCast, selección de dos clics en PC y espera de Plex con propietario.

<a id="browser-gate-integration"></a>

## Integración del control de navegadores

![Resultados confirmados de verificación local de navegadores](diagrams/browser-verification-results.svg)

El código `c52f4d07` incorpora el PR 779 de main `1ecbc0e7`. Se conservan los comandos de prueba, controles de recuperación y aserciones de diálogos Plex de ambas ramas. Pasan TypeScript, lint, documentación, contratos de empaquetado/enlazado, compilación de producción y comprobaciones completas de paquetes compilados. Los 27 archivos JavaScript emitidos de reproductor/proveedores siguen siendo idénticos byte a byte a los artefactos medidos antes. La suite completa de dispositivos/navegadores sobre esa compilación termina con **196 pruebas correctas y una omisión esperada en Chromium** para el caso HLS nativo que requiere WebKit.

El archivo empaquetado exacto de Mode A se extrajo solo tras comprobar su origen, suma de verificación e inventario de paquetes/proveedores. Chromium 156.0.8078.4, Firefox 157.0 y WebKit 27.2 pasaron los cinco escenarios de perfil cada uno, sin omisiones ni reintentos: **15 resultados locales correctos** con Playwright 1.64.0. El equipo real era macOS 26.7.1, no el runner `macos-15` indicado en los perfiles elegidos. Los comprobantes registran expresamente esa diferencia y **no son una matriz alojada ni una certificación de versión**. Véanse el [resumen local](evidence/post779-local-acceptance/summary.json) y la [receta de reproducción](evidence/post779-local-acceptance/reproduce.sh), que espera una compilación de producción existente y se niega a sustituir un directorio de candidato extraído.

La [política de navegadores](browser-compatibility.es.md) requiere cinco objetivos alojados y 25 ejecuciones de escenarios para controles PR/beta; el RC completo tiene 35 objetivos y 166 ejecuciones. Son requisitos configurados, no cobertura medida.

![Cómo la verificación del candidato produce pruebas](diagrams/candidate-verification-flow.svg)

La [canalización beta](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467) independiente para main `1ecbc0e7` finalizó correctamente. No incluye este PR. La integración aún requiere su propio CI alojado correcto y revisión, seguidos de coordinación de la versión; los resultados locales anteriores no afirman que estos controles de entrega hayan pasado.

<a id="delivery"></a>

## Entrega

- [Reproductor, documentación e i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781).
- [Servidor de control y CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106).
- [Preferencias de pistas Android — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68).

Estos PR contienen el estado actual del CI y de integración. El cambio del reproductor sigue a las correcciones actuales de Plex acordadas y a su beta como una ola de entrega independiente.
