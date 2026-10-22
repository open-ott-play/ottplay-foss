<a id="measured-javascript-cost"></a>

# Custo medido de JavaScript

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Guia de funcionalidades](roadmap-delivery.pt.md) · [Evidências brutas](evidence/roadmap-size-20261015.json)

![Comparação de todo o JavaScript do reprodutor com a mesma cadeia de ferramentas](diagrams/roadmap-size.svg)

Esta página preserva as medições JavaScript dos snapshots de código abaixo. Elas não medem a revisão atual, os pacotes de instalação nem o tráfego de rede.

Na comparação inicial, a entrada principal mais todas as famílias de provedores opcionais cresceu **31 128 bytes sem compressão / 9 759 bytes gzip**: cerca de **3.23% / 3.20%**. É um aumento do custo das funcionalidades, não uma alegação de melhoria de tamanho ou velocidade de execução. Xtream continua carregado sob demanda; retirá-lo da entrada não o remove do total.

A medição compara os arquivos de código limpos `bbf9ca7b` e `cae971da`, ambos na versão 1.1.55, com Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2 e zlib 1.2.12. Usa o montador ES5 de produção, o otimizador, a política de nomes e a identidade correta do código limpo. O nível gzip 9 é aplicado separadamente a cada recurso emitido.

- Entrada web: 848 092 / 262 392 → 874 926 / 270 321 bytes sem compressão/gzip.
- Entrada web + todos os provedores: 964 459 / 305 344 → 995 587 / 315 103.
- Entrada nativa: 848 050 / 262 460 → 874 884 / 270 372.
- Entrada nativa + todos os provedores: 964 417 / 305 412 → 995 545 / 315 154.
- O M3U opcional cresce 184 bytes sem compressão / 82 gzip; o novo Xtream tem 4 110 / 1 748. As outras seis famílias opcionais são idênticas byte a byte.

Antes de o clipe passar para here.now, mudar sua URL para um caminho local a partir da raiz acrescentou um byte JavaScript sem compressão nesta sequência histórica. Isso não mede a URL hospedada posterior. A correção de novas tentativas limitadas de análise HLS adiciona 37 bytes sem compressão / 36 gzip em uma comparação isolada do mesmo snapshot ([evidência](evidence/parse-recovery-size-20261015.json)). A correção da responsabilidade da transferência Auto nativa adiciona mais 101 bytes sem compressão / 39 gzip ([evidência](evidence/auto-recovery-size-20261015.json)). O total sem compressão resultante antes das correções das regressões de acessibilidade é 995 726 bytes; a identidade da compilação e os bytes gzip podem mudar no commit final. Os resultados finais de `build/reports/classic-bundle.json` e `npm run check:size` continuam sendo a referência para a revisão exata entregue. A compilação limpa posterior `652726f8`, incluindo correções de foco do ponteiro e dos diálogos, mede **995 858 bytes sem compressão / 315 207 gzip** para o reprodutor web completo ([evidência do artefato final](evidence/roadmap-final-size-20261015.json)). A entrada tem 875 197 / 270 425; os totais nativos são 995 816 / 315 259. Os limites desse snapshot mantiveram a margem anterior para nativo/Node/sufixo de versão: 875 300 sem compressão / 271 600 gzip para a entrada; 996 100 / 316 400 para entrada + provedores.

<a id="post-beta-integration"></a>

## Integração após a beta

![JavaScript completo após a integração de beta.4](diagrams/post-beta-size.svg)

A comparação posterior reproduz o código beta.4 `39287792` contra o runtime `9663b681`, incluindo a integração Plex e a recuperação de configurações danificadas, com os mesmos Node 26.8.2, Rollup 4.64.5 e Terser 5.51.2:

- Entrada web: 848 315 / 262 443 → 879 533 / 271 761 bytes sem compressão/gzip.
- Entrada web + todos os provedores: 964 876 / 305 452 → 1 000 388 / 316 600.
- Entrada nativa + todos os provedores: 964 834 / 305 520 → 1 000 346 / 316 654.
- Aumento da carga web completa: **35 512 / 11 148 bytes (3.68% / 3.65%)**.

A base conta sete famílias de provedores; a integração conta oito, incluindo Xtream sob demanda. Os limites de entrada desse snapshot eram 879 900 / 273 000; os totais eram 1 000 800 / 317 800, preservando espaço para nativo, Node e identidade de versão. As duas compilações locais de produção regeneram cinco arquivos de runtime versionados e omitem a declaração de revisão de código limpo. São artefatos reproduzidos localmente, não os binários beta publicados. Versões das ferramentas, hashes e essa limitação estão nas [evidências da base](evidence/post-beta-baseline-size-20261015.json) e [da integração](evidence/post-beta-candidate-size-20261015.json). O [relatório de implementação](implementation-report.pt.md#post-beta-integration-and-review) explica as correções e a validação.

**Escopo:** estes totais JavaScript excluem mecanismos de mídia externos, dicionários de idiomas, CSS, imagens e vídeo. Os pacotes históricos também levavam um **clipe A/V de 464 652 bytes**, fora dos totais acima. Sua entrega atual é separada dessas medições:

- **Repositório:** `diagnostics/av-v1.mp4` permanece com seu gerador e verificador para permitir reprodução. Manter um arquivo-fonte não o inclui em um pacote.
- **Pacotes:** Web/OTTPlay Server, Tauri, Capacitor e Docker excluem o clipe. Isso remove 464 652 bytes de mídia sem compressão, não uma redução medida de 464 652 bytes em um instalador comprimido. O formato do arquivo e outras mudanças de compilação afetam esse tamanho.
- **Rede:** o reprodutor busca o clipe em here.now apenas quando o usuário inicia a [verificação A/V](audio-video-check.pt.md). A verificação exige Internet; o clipe não é buscado para a reprodução inicial.

As medições históricas JavaScript acima continuam iguais. Medir o efeito da URL hospedada sobre JavaScript ou um instalador atual exige uma nova comparação. Os 88 README localizados são documentação do repositório, não carga do reprodutor. Esta comparação de bytes não sustenta alegações sobre tempo de inicialização, taxa de quadros, memória ou desempenho em escala de catálogo. Isso exige medições separadas nos dispositivos de destino.
