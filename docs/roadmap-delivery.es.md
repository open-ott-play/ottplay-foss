# Mejoras de fiabilidad y reproducción multimedia

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.es.md) · [Arquitectura](architecture.md)

Esta guía describe la implementación en la revisión del código fuente de esta página, no las capacidades de una versión anterior instalada. El reproductor, el servicio de control/CLI y la aplicación Android nativa son artefactos separados. Actualizar uno no actualiza los demás.

![Responsabilidades y límites de confianza](diagrams/roadmap-components.svg)

Consulte el [coste medido en bytes y el gráfico comparativo](roadmap-size.es.md); la velocidad de ejecución y la reproducción en dispositivos requieren comprobaciones de aceptación separadas.

<a id="what-is-implemented"></a>

## Funciones implementadas

1. **Una muestra conocida de audio y vídeo.** [Información → Audio](audio-video-check.es.md) reproduce un clip de ocho segundos desde here.now (requiere Internet), con tonos izquierdo/derecho y destellos correspondientes. Solo se descarga tras **Reproducir**, nunca al iniciar; el archivo multimedia no forma parte de los paquetes del reproductor. Utiliza temporalmente el decodificador HTML5 principal solo en reposo o durante televisión en directo. No escribe en el historial de visualización. [Especificación de la muestra](../diagnostics/README.md).
2. **Configuración Local/Home reanudable.** La CLI de control permite planificar, aplicar, reanudar y verificar un ajuste preestablecido. Compara la configuración guardada antes de repetir una escritura cuyo resultado es incierto. [Flujo de control](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **Recuperación de reproducción limitada.** Los errores transitorios de HLS/Shaka comparten una política de recuperación finita. La autenticación fallida y el DRM no compatible son terminales. Stop, cambiar de canal o sustituir la fuente cancelan las operaciones obsoletas.
4. **Límites de calidad guardados.** La altura y la tasa de bits máximas restringen la selección adaptativa; una alternativa nativa no debe eludir silenciosamente un límite activo.
5. **Preferencias de pistas en Android nativo.** La aplicación Android independiente recuerda la intención por idioma/función/etiqueta, incluidos Auto y subtítulos desactivados, en lugar de trasladar un índice de pista de otro flujo.
6. **Operadores de comandos con permisos acotados.** El controlador puede conceder a una credencial acceso a dispositivos/acciones concretos sin entregar la credencial de administrador.
7. **Vinculaciones XMLTV explícitas.** Un canal dentro del ámbito de una lista puede vincularse a una fuente y un ID XMLTV específicos. [Vinculaciones de la guía y accesibilidad](guide-binding-accessibility.es.md).
8. **Películas y series Xtream.** La biblioteca carga bajo demanda el catálogo seleccionado y después los episodios de una serie. [Contrato de la biblioteca](xtream-media.es.md).
9. **Controles clásicos accesibles.** Las listas de canales exponen la semántica de selección; los diálogos modales conservan y restauran el foco del teclado; los avisos tienen una región activa.
10. **Resultados de comandos duraderos.** Un diario opcional y acotado del controlador conserva metadatos de deduplicación y resultados. Un reinicio nunca repite comandos a ciegas.
11. **Traspaso explícito a otro dispositivo.** Las referencias de directo/archivo se transfieren a un reproductor con la misma fuente configurada. El destino resuelve su propia URL. [Contrato](remote-handoff.es.md).
12. **Flujos de respaldo explícitos.** Los canales en directo pueden usar alternativas configuradas dentro de la misma política de recuperación finita. [Límites, recuperación y respaldos](playback-stream-policy.es.md).
13. **Lotes de configuración recuperables.** localStorage nativo utiliza un diario de deshacer para las escrituras admitidas de varias claves. [Garantías de almacenamiento](settings-recovery.es.md).

<a id="language-and-compatibility-coverage"></a>

## Cobertura de idiomas y compatibilidad

El reproductor incluye 88 catálogos de traducción. Las siete nuevas etiquetas de calidad/multimedia están traducidas en cada catálogo; los demás menús nuevos reutilizan etiquetas ya traducidas. Las comprobaciones de catálogos cubren paridad de claves, marcadores de posición y excepciones revisadas. Las guías técnicas emparejadas explican los mismos límites de implementación en [24 idiomas de documentación](manual-translations.md). Los [puntos de entrada localizados](readme/README.md) son guías de inicio rápido, no una afirmación de que cada documento técnico histórico tiene 88 traducciones completas.

La salida clásica conserva la sintaxis ES5. Eso no significa que todos los dispositivos admitan cada códec, API web, garantía de almacenamiento o integración nativa. La vista previa A/V está restringida a la ruta HTML5 principal gestionada; quedan excluidos los motores que la sustituyen, como PC2/Video.js y los motores nativos. Las vinculaciones explícitas de la guía utilizan la implementación XMLTV alojada o nativa; los protocolos externos opcionales de companion pueden no admitirlas. La aceptación específica de un dispositivo sigue necesitando el dispositivo real.

<a id="reproduce-the-checks"></a>

## Reproducir las comprobaciones

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

El verificador multimedia necesita FFmpeg/FFprobe. Decodifica ambos canales de audio y comprueba su energía, separación y silencio; la mera existencia de una pista AAC no demuestra contenido audible. Las pruebas JavaScript habituales ejercitan cancelación, escrituras fallidas, recuperación tras reinicios, cambios de fuente y entradas no válidas. Las comprobaciones finales del bundle incluyen las familias opcionales de proveedores, no solo la entrada principal.

En el controlador ejecute `go test -race ./...`, `go vet ./...` y `python3 -m unittest discover -s tests`. En Android nativo ejecute las pruebas unitarias de preferencias de pistas y copias de configuración, y genere el APK de depuración. La CI de cada repositorio es válida para el commit correspondiente, no para un árbol modificado posteriormente.

<a id="physical-acceptance-before-promotion"></a>

## Aceptación física antes de promover una versión

- En un televisor de destino, ejecute la comprobación A/V y confirme audio izquierdo/derecho, destellos visibles, Stop y retorno al directo. Las pruebas del decodificador no demuestran sonido HDMI ni fluidez.
- Ejercite flujos permitidos/denegados, un respaldo fallido y un cambio de canal durante un reintento pendiente. Confirme el límite de calidad seleccionado en el backend real.
- Pruebe el foco de listas/diálogos con teclado, mando y un lector de pantalla disponible.
- Vincule dos nombres de canal similares a ID XMLTV distintos y verifique los datos de programación.
- Interrumpa la aplicación de un ajuste preestablecido de prueba, reinicie el controlador, reanude y verifique. Haga traspasos tanto a una fuente configurada coincidente como a una no coincidente.
- En Android nativo, cambie entre flujos con distinto orden de pistas, reinicie la aplicación y confirme el comportamiento explícito de Auto/Off y del idioma preferido.

El envío satisfactorio, la configuración guardada, las muestras decodificadas y las pruebas unitarias aprobadas son evidencias diferentes. La promoción de versiones debe conservar esa distinción; consulte la [estrategia de publicación](../RELEASING.md).
