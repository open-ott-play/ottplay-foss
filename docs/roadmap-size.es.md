<a id="measured-javascript-cost"></a>

# Coste medido de JavaScript

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Guía de funciones](roadmap-delivery.es.md) · [Evidencias sin procesar](evidence/roadmap-size-20261015.json)

![Comparación de todo el JavaScript del reproductor con la misma cadena de herramientas](diagrams/roadmap-size.svg)

Esta página conserva las mediciones de JavaScript de las instantáneas de código indicadas abajo. No miden la revisión actual, los instaladores ni el tráfico de red.

En la comparación inicial, la entrada principal y todas las familias de proveedores opcionales crecieron **31 128 bytes sin comprimir / 9 759 bytes gzip**: aproximadamente **3.23% / 3.20%**. Es un aumento del coste funcional, no una mejora declarada de tamaño o velocidad de ejecución. Xtream sigue cargándose bajo demanda; sacarlo de la entrada no lo elimina del total.

La medición compara los archivos de código limpios `bbf9ca7b` y `cae971da`, ambos versión 1.1.55, con Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2 y zlib 1.2.12. Utiliza el ensamblador ES5 de producción, el optimizador, la política de nombres y la identidad correcta del código limpio. El nivel 9 de gzip se aplica por separado a cada recurso emitido.

- Entrada web: 848 092 / 262 392 → 874 926 / 270 321 bytes sin comprimir/gzip.
- Entrada web + todos los proveedores: 964 459 / 305 344 → 995 587 / 315 103.
- Entrada nativa: 848 050 / 262 460 → 874 884 / 270 372.
- Entrada nativa + todos los proveedores: 964 417 / 305 412 → 995 545 / 315 154.
- M3U opcional crece 184 bytes sin comprimir / 82 gzip; el nuevo Xtream ocupa 4 110 / 1 748. Las otras seis familias opcionales son idénticas byte a byte.

Antes de trasladar el clip a here.now, cambiar su URL por una ruta local desde la raíz añadió un byte JavaScript sin comprimir en esta secuencia histórica. Eso no mide la URL alojada posterior. La corrección del reintento acotado de análisis HLS añade 37 bytes sin comprimir / 36 gzip en una comparación aislada de la misma instantánea ([evidencia](evidence/parse-recovery-size-20261015.json)). La corrección de propiedad de la transferencia Auto nativa añade otros 101 bytes sin comprimir / 39 gzip ([evidencia](evidence/auto-recovery-size-20261015.json)). El total sin comprimir resultante antes de corregir las regresiones de accesibilidad es de 995 726 bytes; la identidad de compilación y los bytes gzip pueden cambiar en el commit final. Los resultados finales de `build/reports/classic-bundle.json` y `npm run check:size` siguen siendo la autoridad para la revisión entregada exacta. La compilación limpia posterior `652726f8`, con las correcciones de foco del puntero y los diálogos, mide **995 858 bytes sin comprimir / 315 207 gzip** para el reproductor web completo ([evidencia del artefacto final](evidence/roadmap-final-size-20261015.json)). Su entrada ocupa 875 197 / 270 425; los totales nativos son 995 816 / 315 259. Los límites de esa instantánea mantuvieron el margen previo para nativo/Node/sufijo de versión: 875 300 sin comprimir / 271 600 gzip para la entrada; 996 100 / 316 400 para entrada + proveedores.

<a id="post-beta-integration"></a>

## Integración posterior a la beta

![JavaScript completo tras integrar beta.4](diagrams/post-beta-size.svg)

La comparación posterior reproduce el código beta.4 `39287792` frente al runtime `9663b681`, incluida la integración Plex y la recuperación de ajustes dañados, con los mismos Node 26.8.2, Rollup 4.64.5 y Terser 5.51.2:

- Entrada web: 848 315 / 262 443 → 879 533 / 271 761 bytes sin comprimir/gzip.
- Entrada web + todos los proveedores: 964 876 / 305 452 → 1 000 388 / 316 600.
- Entrada nativa + todos los proveedores: 964 834 / 305 520 → 1 000 346 / 316 654.
- Aumento de la carga web completa: **35 512 / 11 148 bytes (3.68% / 3.65%)**.

La base cuenta siete familias de proveedores; la integración, ocho, incluido Xtream bajo demanda. Los límites de entrada de esa instantánea eran 879 900 / 273 000; los totales, 1 000 800 / 317 800, conservando margen para nativo, Node e identidad de versión. Ambas compilaciones locales de producción regeneran cinco archivos de runtime versionados y omiten la declaración de revisión de código limpio. Son artefactos reproducidos localmente, no los binarios beta publicados. Las versiones de herramientas, hashes y esa limitación figuran en la [evidencia de base](evidence/post-beta-baseline-size-20261015.json) y la [evidencia de integración](evidence/post-beta-candidate-size-20261015.json). El [informe de implementación](implementation-report.es.md#post-beta-integration-and-review) explica las correcciones y la validación.

**Alcance:** estos totales JavaScript excluyen motores multimedia externos, diccionarios de idiomas, CSS, imágenes y vídeo. Los paquetes históricos también incluían un **clip A/V de 464 652 bytes**, fuera de los totales anteriores. Su distribución actual es independiente de esas mediciones:

- **Repositorio:** `diagnostics/av-v1.mp4` permanece junto con su generador y verificador para permitir la reproducción. Conservar un archivo fuente no lo incluye en un paquete.
- **Paquetes:** Web/OTTPlay Server, Tauri, Capacitor y Docker excluyen el clip. Esto elimina 464 652 bytes multimedia sin comprimir, no una reducción medida de 464 652 bytes en un instalador comprimido. El formato del archivo y otros cambios de compilación afectan ese tamaño.
- **Red:** el reproductor obtiene el clip de here.now solo cuando el usuario inicia la [prueba A/V](audio-video-check.es.md). La prueba necesita Internet; el clip no se obtiene para la reproducción inicial.

Las mediciones históricas anteriores no cambian. Medir el efecto de la URL alojada sobre JavaScript o un instalador actual exige una comparación nueva. Los 88 README localizados son documentación del repositorio, no carga del reproductor. Esta comparación de bytes no permite afirmar mejoras de tiempo de inicio, fotogramas por segundo, memoria ni rendimiento a escala de catálogo. Eso requiere mediciones separadas en los dispositivos de destino.
