# Da lista de funcionalidades ao comportamento verificado

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Contratos das funcionalidades](roadmap-delivery.pt.md) · [Evidências de tamanho](roadmap-size.pt.md)

Este relatório registra a implementação e o reforço de robustez, não anuncia uma versão. O instantâneo medido do player é `652726f8`; o instantâneo Android nativo, compilado separadamente, é `be0d800`. CI, merge e promoção de versões continuam sendo etapas independentes. Commits posteriores apenas de documentação ou testes não transformam uma verificação local em prova de que um dispositivo instalado foi atualizado. Os estados abaixo pertencem a esses instantâneos históricos; não são um acompanhamento de versões em tempo real. As compilações publicadas estão em [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases).

![Processo de implementação e critérios de aceitação](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## Como o trabalho foi verificado

A solicitação inicial foi dividida em 13 partes funcionais utilizáveis entre o player clássico, o serviço de controle/CLI e o aplicativo Android nativo independente. A responsabilidade foi atribuída por componente para permitir a revisão e integração de alterações simultâneas sem substituir o trabalho de outro componente. A nova interface reutilizou rótulos traduzidos existentes ou adicionou entradas aos catálogos dos 88 idiomas; os guias técnicos completos foram escritos inicialmente em inglês e russo. O manual principal e os guias de funcionalidades emparelhados agora têm edições completas em [24 idiomas de documentação](manual-translations.md).

A implementação foi seguida por revisão cruzada independente e testes de regressão executáveis. Antes de alterar o código, cada problema relatado foi conferido no caminho real de callback, decodificador, armazenamento ou foco. Falhas de testes foram separadas entre regressões de comportamento e seletores obsoletos. Por exemplo, mudar as linhas clássicas de `button` para `option` exigia atualizar seletores; não justificava enfraquecer o comportamento de clique esperado.

Compilações de produção limpas verificaram os artefatos ES5 emitidos e o custo JavaScript completo, incluindo módulos de provedores opcionais. Testes direcionados de navegador usaram o carregador, o bundle e os adaptadores de dispositivo distribuídos. Android nativo recebeu uma execução separada de testes Gradle, lint e empacotamento. As verificações de PR e discussões de revisão são conferidas novamente após o push; uma compilação local aprovada não as substitui.

<a id="what-changed-during-review"></a>

## O que mudou durante a revisão

![Cinco comportamentos corrigidos e custo JavaScript medido](diagrams/implementation-results.svg)

- **Análise HLS e novas tentativas:** falhas de análise inicialmente compartilhavam a classificação genérica de rede. Agora recebem no máximo uma reconexão à mesma URL, dentro do orçamento de duas tentativas transitórias; novos decodificadores e URLs de backup não o reiniciam. Uma falha terminal de autenticação/DRM também cancela uma tentativa transitória já enfileirada.
- **Alternativa nativa em Auto:** o tratamento de erro nativo podia retirar a solicitação quando Auto já era proprietário de uma alternativa. O proprietário existente agora mantém essa transição; o cancelamento continua invalidando seus callbacks atrasados.
- **Enter em modais:** focar automaticamente o primeiro botão Cancelar transformava Enter no diálogo de espera Plex em cancelamento. Os diálogos agora começam com foco no próprio diálogo. Tab alcança seus botões explicitamente; diálogos normais de informação e confirmação preservam o comportamento de Enter e Escape/Voltar.
- **Seleção por ponteiro no PC:** o foco do mouse mudava a seleção antes do manipulador de clique, transformando o primeiro clique em ativação. O foco induzido pelo ponteiro não pré-seleciona mais a linha. O PC continua selecionando e depois ativando; LG mantém o comportamento de um clique. O foco do teclado continua seguindo a seleção.
- **Faixas Android:** uma seleção sem rótulo do item atual podia ser apagada por sua própria confirmação Auto ou por uma preferência de legendas, ou passar a outro item com `TrackGroup` igual. Agora ela sobrevive a escritas atrasadas apenas para seu item atual. Preferências semânticas usam idioma/função/rótulo; o ViewModel controla a persistência para que fechar o painel não cancele a escrita.

As 13 partes entregues são: amostra A/V; configuração Local/Home retomável; recuperação limitada; tetos de qualidade; preferências de faixas Android; chaves de controle com escopo; associações XMLTV; filmes/séries Xtream; acessibilidade clássica; resultados duráveis de comandos; transferência explícita; streams de backup; lotes de configurações recuperáveis. O [guia de funcionalidades](roadmap-delivery.pt.md) define o escopo e as limitações de cada uma.

<a id="evidence-and-remaining-gates"></a>

## Evidências e etapas restantes

Para `652726f8`, passaram os cinco cenários direcionados de navegador: navegação por ponteiro LG webOS, navegação por ponteiro LG NetCast, comportamento de dois cliques no PC, semântica de teclado dos diálogos e coleção/resolução/cancelamento/nova tentativa Plex. Passaram TypeScript, a fixture unitária de acessibilidade, lint direcionado, ES5 e os limites de tamanho dos bundles. A execução completa no navegador sobre essa compilação terminou com **194 testes aprovados e um ignorado**: HLS nativo exige WebKit, enquanto essa execução usou Chromium. CI hospedada e a sequência de merge acordada continuam sendo etapas separadas.

A cadeia restante de `test:port` e `test:unified` foi concluída em segmentos retomados após corrigir fixtures isoladas. Cada alvo com falha foi executado novamente com sucesso, e os comandos restantes terminaram corretamente; isso não afirma uma única execução ininterrupta de `npm test`. A etapa exata de CI da ponte Android, com nove comandos, também passou localmente.

Para Android `be0d800`, passaram localmente **101 testes do aplicativo e 62 do núcleo compartilhado**, além de lint debug/release, montagem de APK Debug/Release/Full, bundle de release e compilação do APK androidTest. Compilar o APK de testes instrumentados não é executá-los num dispositivo. Os três achados confirmados da revisão foram respondidos e resolvidos em [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68). Esse PR passou nas verificações e foi integrado como `5b644b94`; a CI pós-merge é acompanhada separadamente. O diagrama deixa pendente a etapa geral de CI/release do player.

O JavaScript web completo mudou de **964,459 / 305,344** bytes brutos/gzip para **995,858 / 315,207**: **+31,399 / +9,863 bytes** (cerca de 3.26% / 3.23%). O candidato funcional era 995,587 / 315,103; o reforço posterior acrescentou 271 / 104. A entrada principal final desse instantâneo é 875,197 / 270,425. Veja a [medição inicial](evidence/roadmap-size-20261015.json), a [medição do artefato final](evidence/roadmap-final-size-20261015.json) e o [método de medição](roadmap-size.pt.md). As vírgulas nesses números de bytes separam milhares.

São custos históricos em bytes JavaScript, **não melhorias de velocidade medidas**. Os totais excluem motores de mídia, dicionários, CSS, imagens e vídeo. Os pacotes desse instantâneo levavam separadamente o clipe A/V de 464,652 bytes. Após a [mudança de hospedagem](audio-video-check.pt.md), `diagnostics/av-v1.mp4` permanece no repositório com seu gerador e verificador para reprodução, mas fica excluído dos pacotes Web/OTTPlay Server, Tauri, Capacitor e Docker. O player o busca em here.now somente para a verificação A/V explícita, que exige internet; a reprodução inicial não o baixa. Remover 464,652 bytes brutos de mídia não determina a economia nos instaladores comprimidos nem altera as medições históricas JavaScript. Tempo de inicialização, regularidade de quadros, memória, experiência com leitor de tela, áudio HDMI real e comportamento dos provedores exigem medições próprias nos dispositivos-alvo. Este relatório não afirma novo resultado em dispositivo físico nem lançamento beta. A [lista de aceitação física](roadmap-delivery.pt.md#physical-acceptance-before-promotion) e a [estratégia de releases](../RELEASING.md) continuam sendo os critérios de promoção.

<a id="post-beta-integration-and-review"></a>

## Integração e revisão após a beta

Após publicar beta.4, o código `39287792` foi integrado a esta branch. A revisão de execução `9663b681` também corrige a restauração à borda ao vivo sob limites de qualidade HLS e torna recuperável um diário de configurações danificado antes da inicialização normal. A tela de recuperação bloqueia a hidratação parcial da conta, oferece nova tentativa e redefinição confirmada, preserva cookies não relacionados e impede que configurações antigas de cookies retornem após redefinir. Veja o [processo de recuperação](settings-recovery.pt.md) e seu diagrama SVG.

![Comparação JavaScript completa após a beta](diagrams/post-beta-size.svg)

Reproduzir ambos os códigos com Node 26.8.2, Rollup 4.64.5 e Terser 5.51.2 fornece **964,876 / 305,452** bytes brutos/gzip para o código beta.4 e **1,000,388 / 316,600** para a integração: **+35,512 / +11,148 bytes** (3.68% / 3.65%). Esses totais incluem todos os provedores opcionais: sete na base e oito na integração. A nova entrada tem 879,533 / 271,761. Esta comparação é separada dos gráficos anteriores congelados.

Ambas as compilações de produção locais regeneram cinco arquivos de execução rastreados e omitem a declaração de uma revisão de código limpa. Os relatórios registram essa limitação em vez de identificar esses arquivos locais como artefatos publicados: [base](evidence/post-beta-baseline-size-20261015.json) e [integração](evidence/post-beta-candidate-size-20261015.json). A compilação integrada e verificações ES5/nativas passam. Também passam seis verificações direcionadas de navegador: recuperação/redefinição do diário, teclado dos diálogos, ponteiro LG webOS e NetCast, seleção com dois cliques no PC e espera Plex com proprietário.

<a id="browser-gate-integration"></a>

## Integração da etapa de navegadores

![Resultados confirmados de verificação local dos navegadores](diagrams/browser-verification-results.svg)

O código `c52f4d07` incorpora PR 779 de main `1ecbc0e7`. São preservados comandos de teste, verificações de recuperação e asserções dos diálogos Plex de ambas as branches. Passam TypeScript, lint, documentação, contratos de empacotamento/vinculação, compilação de produção e verificações completas dos bundles compilados. Todos os 27 arquivos JavaScript emitidos de player/provedores permanecem idênticos byte a byte aos artefatos medidos acima. A suíte completa de dispositivo/navegador nessa compilação termina com **196 testes aprovados e uma omissão esperada no Chromium** para HLS nativo que exige WebKit.

O arquivo exato empacotado do Mode A foi extraído somente após conferir origem, checksum e inventário de bundles/provedores. Chromium 156.0.8078.4, Firefox 157.0 e WebKit 27.2 passaram, cada um, nos cinco cenários de perfil sem omissões nem novas tentativas: **15 aprovações locais** com Playwright 1.64.0. O host real era macOS 26.7.1, não o runner `macos-15` citado nos perfis selecionados. Os comprovantes registram explicitamente essa diferença e **não são qualificação da matriz hospedada ou da release**. Veja o [resumo local](evidence/post779-local-acceptance/summary.json) e a [receita de reprodução](evidence/post779-local-acceptance/reproduce.sh), que espera uma compilação de produção existente e se recusa a substituir um diretório de candidato extraído.

A [política de navegadores](browser-compatibility.pt.md) exige cinco alvos hospedados e 25 execuções de cenários para verificações PR/beta; o RC completo tem 35 alvos e 166 execuções. São requisitos configurados, não cobertura medida.

![Como a verificação do candidato produz evidências](diagrams/candidate-verification-flow.svg)

A [pipeline beta](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467) separada para main `1ecbc0e7` terminou com sucesso. Ela não inclui este PR. A integração ainda exige sua própria CI hospedada bem-sucedida e revisão, seguidas da coordenação da release; os resultados locais acima não afirmam que essas etapas de entrega passaram.

<a id="delivery"></a>

## Entrega

- [Player, documentação e i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781).
- [Servidor de controle e CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106).
- [Preferências de faixas Android — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68).

Esses PRs mostram o estado atual da CI e do merge. A alteração do player vem depois das correções atuais acordadas do Plex e da beta delas, como uma onda de entrega separada.
