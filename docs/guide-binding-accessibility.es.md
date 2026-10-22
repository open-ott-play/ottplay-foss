<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Asignación manual de XMLTV y accesibilidad por teclado

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Arquitectura de la guía](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## Corregir la guía de un canal sin editar la lista

Reproduzca el canal M3U afectado, abra **Information → EPG** y edite la URL de origen de EPG y la **XMLTV ID**. Introduzca el ID exacto de `<channel id="…">` del archivo XMLTV, no su nombre visible. Elija **Set** para guardar la asignación y recargar la lista. **Automatic** elimina la anulación de este canal y recarga la asignación original de la lista. Moverse con flechas por sí solo nunca guarda ni restablece una asignación. Atrás deja intacta la asignación guardada.

Este editor está disponible en el despliegue alojado para navegador y en contenedores XMLTV nativos (Tauri y Capacitor). No sustituye guías del proveedor, endpoints JSON explícitos `=source` ni servidores auxiliares externos. Un navegador antiguo sencillo que usa un servidor auxiliar remoto conserva su protocolo de coincidencia existente. La primera versión acepta un ID exacto; no descarga ni muestra una lista buscable de todos los canales XMLTV.

![Una asignación manual vincula la fuente de la lista y el canal estable con una fuente XMLTV y un ID exacto; en los demás casos sigue activa la coincidencia normal.](images/guide-binding.svg)

La asignación guarda la huella de la fuente de la lista, la clave estable del canal, la URL explícita de la fuente y el ID XMLTV. Renombrar una etiqueta visible o cambiar el orden de las filas no modifica la asignación si la identidad del canal sigue igual. Cambiar la URL/cuenta de la lista cambia el espacio de nombres de la fuente. Para entradas M3U antiguas sin `itemId`, se utiliza el ID de canal existente derivado de la URL; cambiar esa URL cambia su identidad.

El canal seleccionado conserva su nombre visible y URL de reproducción. La consulta de la guía usa una sola fuente explícita y no recurre al nombre; por ello, un ID inexistente no toma silenciosamente la programación de otro canal. Los desplazamientos regionales automáticos deducidos del nombre no se aplican a esta asignación exacta; el `tvg-shift` explícito de la lista sí se aplica. Establezca el ID XMLTV regional correcto. Si una fuente HTTPS personalizada no puede leerse por reglas CORS o de contenido mixto, los diagnósticos EPG normales informan de ese fallo.

El registro local está limitado a 500 asignaciones y 512 KiB por fuente; se analiza una vez al cargar la lista, no una vez por canal. Las escrituras comparan el valor anterior y releen el resultado guardado antes de recargar. Una devolución de llamada tardía del editor no puede guardar en una fuente que haya sustituido a la anterior. Es una preferencia local, no sincronización entre dispositivos. Las URL de fuentes pueden contener credenciales; evite compartir exportaciones del almacenamiento públicamente.

<a id="accessible-classic-controls"></a>

## Controles clásicos accesibles

- La lista principal virtualizada expone un cuadro de lista con nombre, la opción seleccionada, el número total de elementos y la posición absoluta. Solo la fila visible seleccionada es una parada de Tab. La navegación con flechas actualiza la selección visual y el estado semántico; el foco sigue a una lista ya enfocada al cambiar de página.
- Los diálogos habituales de información/confirmación, el editor y los paneles About exponen roles modales y nombres localizados. Tab y Mayús+Tab recorren el modal en primer plano. Al cerrar un modal anidado se restaura un control padre que siga visible; las aperturas programadas obsoletas no pueden robar el foco tras el cierre.
- Los mensajes informativos y de confirmación describen sus diálogos. Los avisos temporales usan una región de estado con anuncios no intrusivos.
- Los catálogos de traducción existentes aportan todas las etiquetas nuevas. XMLTV e ID son identificadores del protocolo; los nombres de canales y hosts de las fuentes siguen siendo metadatos de origen.

La aplicación conserva sus rutas del mando y la sintaxis ES5. Las comprobaciones semánticas del DOM no constituyen una certificación WCAG completa: el foco específico del dispositivo, la voz de VoiceOver/TalkBack y el comportamiento de navegadores de TV siguen necesitando pruebas físicas.

<a id="verification"></a>

## Verificación

Ejecute:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

Ejecute también las comprobaciones habituales de compilación/ES5/tamaño del paquete en la rama integrada. Las pruebas de navegador deben cubrir una lista larga entre páginas, una confirmación anidada, sustitución de la fuente durante la edición, asignaciones correctas, inexistentes y eliminadas, y un fallo de descarga EPG. Las preferencias semánticas de pistas de la aplicación Android nativa se implementan en su repositorio separado y son independientes de estos controles clásicos.
