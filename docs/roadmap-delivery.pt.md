# Melhorias de fiabilidade e multimédia

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.pt.md) · [Arquitetura](architecture.md)

Este guia descreve a implementação na revisão do código-fonte desta página, não as capacidades de uma versão anterior instalada. O leitor, o serviço de controlo/CLI e a aplicação Android nativa são artefactos separados. Atualizar um não atualiza os restantes.

![Responsabilidades e limites de confiança](diagrams/roadmap-components.svg)

Consulte o [custo medido em bytes e o gráfico comparativo](roadmap-size.pt.md); a velocidade de execução e a reprodução em dispositivos têm verificações de aceitação próprias.

<a id="what-is-implemented"></a>

## Funcionalidades implementadas

1. **Uma amostra de áudio/vídeo conhecida.** [Informações → Áudio](audio-video-check.pt.md) reproduz um clipe de oito segundos de here.now (requer Internet), com tons esquerdo/direito e flashes correspondentes. Só é obtido depois de **Reproduzir**, nunca no arranque; o ficheiro multimédia não é incluído nos pacotes do leitor. Usa temporariamente o descodificador HTML5 principal apenas em repouso ou durante televisão em direto. Não escreve no histórico de visualização. [Especificação da amostra](../diagnostics/README.md).
2. **Configuração Local/Home retomável.** A CLI de controlo permite planear, aplicar, retomar e verificar uma predefinição. Compara as definições guardadas antes de repetir uma escrita de resultado incerto. [Fluxo de controlo](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **Recuperação de reprodução limitada.** Falhas transitórias HLS/Shaka partilham uma política de recuperação finita. Falhas de autenticação e DRM não suportado são terminais. Stop, mudar de canal e substituir a fonte cancelam trabalho obsoleto.
4. **Limites de qualidade guardados.** A altura e a taxa de bits máximas restringem a seleção adaptativa; uma alternativa nativa não pode contornar silenciosamente um limite ativo.
5. **Preferências de faixas no Android nativo.** A aplicação Android independente guarda a intenção por idioma/função/rótulo, incluindo Auto e legendas desligadas, em vez de transportar um índice de faixa de outro fluxo.
6. **Operadores de comandos com âmbito limitado.** O controlador pode conceder a uma credencial acesso a dispositivos/ações específicos sem entregar a credencial de administrador.
7. **Associações XMLTV explícitas.** Um canal no âmbito de uma lista pode ser associado a um feed e ID XMLTV específicos. [Associações do guia e acessibilidade](guide-binding-accessibility.pt.md).
8. **Filmes e séries Xtream.** A biblioteca carrega a pedido o catálogo selecionado e depois os episódios de uma série. [Contrato da biblioteca](xtream-media.pt.md).
9. **Controlos clássicos acessíveis.** As listas de canais expõem a semântica de seleção; os diálogos modais mantêm e restauram o foco do teclado; os avisos têm uma região dinâmica.
10. **Resultados de comandos duradouros.** Um diário opcional e limitado do controlador retém metadados de deduplicação e resultados. Um reinício nunca repete comandos cegamente.
11. **Transferência explícita para outro dispositivo.** Referências de direto/arquivo passam para um leitor com a mesma fonte configurada. O destino resolve o seu próprio URL. [Contrato](remote-handoff.pt.md).
12. **Fluxos de reserva explícitos.** Canais em direto podem usar alternativas configuradas dentro da mesma política de recuperação finita. [Limites, recuperação e reservas](playback-stream-policy.pt.md).
13. **Lotes de definições recuperáveis.** O localStorage nativo usa um diário de anulação para escritas suportadas de várias chaves. [Garantias de armazenamento](settings-recovery.pt.md).

<a id="language-and-compatibility-coverage"></a>

## Cobertura de idiomas e compatibilidade

O leitor inclui 88 catálogos de tradução. Os sete novos rótulos de qualidade/multimédia estão traduzidos em cada catálogo; outros menus novos reutilizam rótulos já traduzidos. As verificações de catálogos abrangem paridade de chaves, marcadores de substituição e exceções revistas. Os guias técnicos correspondentes explicam os mesmos limites de implementação em [24 idiomas de documentação](manual-translations.md). Os [pontos de entrada localizados](readme/README.md) são guias de início rápido, não uma afirmação de que cada documento técnico histórico tenha 88 traduções completas.

A saída clássica mantém a sintaxe ES5. Isto não significa que todos os dispositivos suportem todos os codecs, APIs Web, garantias de armazenamento ou integrações nativas. A pré-visualização A/V limita-se ao percurso HTML5 principal gerido; motores que o substituem, como PC2/Video.js e motores nativos, estão excluídos. As associações explícitas do guia usam a implementação XMLTV alojada ou nativa; protocolos companion externos opcionais podem não as suportar. A aceitação específica de um dispositivo continua a exigir o dispositivo real.

<a id="reproduce-the-checks"></a>

## Reproduzir as verificações

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

O verificador multimédia requer FFmpeg/FFprobe. Descodifica os dois canais de áudio e verifica energia, separação e silêncio; a simples existência de uma faixa AAC não demonstra conteúdo audível. Os testes JavaScript habituais exercitam cancelamento, escritas falhadas, recuperação após reinício, mudanças de fonte e entradas inválidas. As verificações finais do bundle incluem famílias opcionais de fornecedores, não apenas a entrada principal.

No controlador, execute `go test -race ./...`, `go vet ./...` e `python3 -m unittest discover -s tests`. No Android nativo, execute os testes unitários de preferências de faixas e cópias de definições e monte o APK de depuração. A CI de cada repositório é válida para o commit correspondente, não para uma árvore alterada posteriormente.

<a id="physical-acceptance-before-promotion"></a>

## Aceitação física antes da promoção

- Num televisor de destino, execute a verificação A/V e confirme áudio esquerdo/direito, flashes visíveis, Stop e regresso ao direto. Testes de descodificação não demonstram som HDMI nem fluidez.
- Exercite fluxos permitidos/negados, uma reserva falhada e mudança de canal durante uma tentativa pendente. Confirme o limite de qualidade escolhido no backend real.
- Teste o foco das listas/diálogos com teclado, comando e um leitor de ecrã disponível.
- Associe dois nomes de canal semelhantes a IDs XMLTV diferentes e verifique a programação.
- Interrompa a aplicação de uma predefinição de teste, reinicie o controlador, retome e verifique. Transfira para fontes configuradas tanto correspondentes como não correspondentes.
- No Android nativo, mude entre fluxos com ordem de faixas diferente, reinicie a aplicação e confirme Auto/Off explícitos e o idioma preferido.

Envio bem-sucedido, definições guardadas, amostras descodificadas e testes unitários aprovados são evidências diferentes. A promoção de versões deve preservar essa distinção; consulte a [estratégia de lançamento](../RELEASING.md).
