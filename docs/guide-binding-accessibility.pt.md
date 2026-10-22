<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Associação manual de XMLTV e acessibilidade por teclado

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Arquitetura do guia](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## Corrigir o guia de um canal sem editar a lista

Reproduza o canal M3U afetado, abra **Information → EPG** e edite o URL da fonte EPG e o **XMLTV ID**. Introduza o ID exato de `<channel id="…">` no ficheiro XMLTV, não o nome apresentado. Escolha **Set** para guardar a associação e recarregar a lista. **Automatic** remove a substituição deste canal e recarrega o mapeamento original da lista. Mover-se apenas com as setas nunca guarda nem repõe uma associação. Voltar deixa a associação guardada inalterada.

Este editor está disponível no alojamento para navegador e nos invólucros XMLTV nativos (Tauri e Capacitor). Não substitui guias do fornecedor, endpoints JSON explícitos `=source` ou servidores auxiliares externos. Um navegador antigo simples com um auxiliar remoto mantém o protocolo de correspondência existente. A primeira versão aceita um ID exato; não descarrega nem apresenta uma lista pesquisável de todos os canais XMLTV.

![Uma associação manual liga a fonte da lista e o canal estável a um feed XMLTV e a um ID exato; caso contrário, mantém-se a correspondência normal.](images/guide-binding.svg)

A associação guarda a impressão digital da fonte da lista, a chave estável do canal, o URL explícito do feed e o ID XMLTV. Mudar um nome apresentado ou a ordem das linhas não altera a associação se a identidade do canal continuar igual. Substituir o URL/conta da lista muda o espaço de nomes da fonte. Para entradas M3U antigas sem `itemId`, usa-se o ID existente derivado do URL; mudar esse URL muda a identidade.

O canal selecionado mantém o nome apresentado e o URL de reprodução. A pesquisa do guia usa um único feed explícito sem recurso ao nome; assim, um ID em falta não toma silenciosamente a programação de outro canal. Desfasamentos regionais automáticos inferidos do nome não se aplicam a esta associação exata; o `tvg-shift` explícito da lista continua a aplicar-se. Defina o ID XMLTV regional correto. Se um feed HTTPS personalizado não puder ser lido devido a CORS ou conteúdo misto, o diagnóstico EPG normal comunica a falha.

O registo local está limitado a 500 associações e 512 KiB por fonte; é analisado uma vez por carregamento da lista, não por canal. As escritas comparam o valor anterior e releem o resultado guardado antes de recarregar. Um callback tardio do editor não pode guardar numa fonte que substituiu a original. É uma preferência local, não sincronização entre dispositivos. Os URLs dos feeds podem conter credenciais; evite partilhar exportações do armazenamento publicamente.

<a id="accessible-classic-controls"></a>

## Controlos clássicos acessíveis

- A lista principal virtualizada expõe uma caixa de lista com nome, a opção selecionada, o total de itens e a posição absoluta. Só a linha visível selecionada é uma paragem de Tab. As setas atualizam a seleção visual e o estado semântico; o foco acompanha uma lista já focada ao mudar de página.
- Os diálogos normais de informação/confirmação, o editor e os painéis About expõem papéis modais e nomes localizados. Tab e Shift+Tab circulam no modal em primeiro plano. Fechar um modal aninhado repõe um controlo pai ainda visível; aberturas agendadas desatualizadas não roubam o foco depois do fecho.
- As mensagens de informação e confirmação descrevem os seus diálogos. Avisos temporários usam uma região de estado com anúncios não intrusivos.
- Os catálogos de tradução existentes fornecem todas as novas etiquetas. XMLTV e ID são identificadores do protocolo; nomes dos canais e hosts dos feeds continuam a ser metadados da fonte.

A aplicação mantém os percursos do comando e a sintaxe ES5. Verificações semânticas do DOM não constituem certificação WCAG completa: foco específico do dispositivo, voz VoiceOver/TalkBack e comportamento de navegadores de TV ainda exigem testes físicos.

<a id="verification"></a>

## Verificação

Execute:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

Execute também as verificações normais de compilação/ES5/tamanho do bundle no ramo integrado. Os testes do navegador devem cobrir uma lista longa entre páginas, confirmação aninhada, substituição da fonte durante a edição, associações corretas, em falta e removidas, e falha ao descarregar EPG. As preferências semânticas de faixas da aplicação Android nativa são implementadas no seu repositório separado e são independentes destes controlos clássicos.
