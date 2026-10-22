# Verificação manual de áudio e vídeo

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Recuperação do fluxo](playback-stream-policy.pt.md) · [Especificação da amostra](../diagnostics/README.md)

Use **menu do leitor → Informações → Áudio → Reproduzir** para verificar a imagem e o som com um clipe conhecido de oito segundos. Esta é a verificação A/V audível; a demonstração do padrão em movimento na apresentação inicial é silenciosa.

![Verificação A/V: fonte no repositório, clipe alojado e reprodução explícita](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## Iniciar a verificação

1. Ajuste o televisor, as colunas ou os auscultadores para um volume confortável. A verificação usa o volume atual do leitor e ativa temporariamente o som do vídeo; não aumenta o volume de sistema do televisor.
2. Abra o menu do leitor, escolha **Informações**, depois **Áudio** e **Reproduzir**. Abrir apenas o menu não descarrega nem reproduz o clipe.
3. Observe o ecrã e ouça a sequência abaixo. Para terminar mais cedo, use **Informações → Áudio → Parar**.

A verificação usa o percurso HTML5 central gerido quando o leitor está inativo ou quando a televisão em direto está a reproduzir ou em pausa. Recusa um pedido VOD/arquivo ativo, um pedido de direto ainda a carregar e o modo de espera. Também não está disponível quando um adaptador do dispositivo substitui o motor central, incluindo **PC2/Video.js** e substituições por motores nativos; usar apenas um elemento de vídeo HTML5 não torna um adaptador elegível. Uma recusa não substitui a reprodução existente. Pare primeiro o pedido atual para testar a partir da inatividade; isso não ativa a verificação nesses adaptadores. Os rótulos dos menus seguem o idioma da interface selecionado.

<a id="what-you-should-see-and-hear"></a>

## O que deve ver e ouvir

O fundo é um padrão de teste em movimento. Breves marcadores brancos piscam na metade superior esquerda ou direita, em sincronia com impulsos sonoros discretos de aproximadamente 150 ms:

- **0–2 segundos:** um impulso de 440 Hz no canal esquerdo a cada segundo, com o marcador esquerdo a piscar.
- **2–4 segundos:** um impulso de 880 Hz no canal direito, com o marcador direito.
- **4–6 segundos:** impulsos em ambos os canais, com ambos os marcadores.
- **6–8 segundos:** o padrão continua a mover-se sem som. Este silêncio é intencional.

Um televisor mono ou uma mistura descendente pode reproduzir ambos os canais numa só coluna. Verifique pessoalmente o ecrã físico e a saída de áudio. O leitor não mede a saída das colunas nem produz um veredito A/V automático de aprovação ou falha.

<a id="where-the-clip-comes-from"></a>

## Origem do clipe

O leitor usa este endereço HTTPS absoluto:

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

Só pede o clipe quando escolhe **Reproduzir**, nunca como pré-carregamento no arranque. O ficheiro tem **464 652 bytes**, vídeo H.264 baseline a 640×360 / 25 fps e áudio estéreo AAC. É excluído dos pacotes Web, OTTPlay Server, Tauri, Capacitor e contentores. O [ficheiro fonte](../diagnostics/av-v1.mp4), o gerador e o verificador permanecem no repositório; não constituem uma alternativa offline no leitor instalado.

São necessários acesso à Internet e uma ligação HTTPS funcional a esse anfitrião. Não há alternativa incluída nem outro URL de diagnóstico. Abrir a ligação acima num navegador pode verificar a disponibilidade do ficheiro, mas não exercita a propriedade do descodificador pelo leitor nem o regresso ao canal. O alojamento recebe a informação normal da ligação; veja os [detalhes de privacidade](privacy-policy.md#optional-hosted-audio-video-check).

<a id="how-playback-returns"></a>

## Como regressa a reprodução

A verificação usa o descodificador principal e substitui temporariamente a imagem em direto. Termina no fim do clipe, após **Áudio → Parar** ou quando ocorre um erro multimédia. Um **prazo de segurança de 15 segundos começa quando a verificação é aceite** e inclui o carregamento; por isso, um descarregamento lento pode terminar antes de tocar os oito segundos completos.

Nesses casos, o leitor tenta restaurar o pedido de direto capturado no ponto atual da transmissão, incluindo o estado de pausa, apenas se ainda pertencer à fonte atual e nenhuma reprodução substituta tiver assumido o controlo. O URL do direto é novamente resolvido; a restauração continua dependente do fornecedor e da rede. Uma verificação iniciada em repouso regressa ao repouso.

O comando normal de reprodução **Stop**, o modo de espera ou a escolha de outro canal cancelam a verificação sem reiniciar o canal capturado. Alterar a fonte ou a sua sessão também impede uma restauração obsoleta. Ao sair, a verificação desfaz a sua ativação temporária do som; se silenciar durante a execução, esse silêncio mantém-se. Não altera a preferência guardada do motor, não escreve segundos de teste no histórico do canal nem publica no sistema operativo uma falsa conclusão do canal ou metadados de teste.

<a id="if-the-result-is-unexpected"></a>

## Se o resultado for inesperado

- **A verificação não começa:** confirme que o leitor está inativo ou num canal em direto já a reproduzir/em pausa pelo percurso HTML5 central gerido, sem substituição do motor pelo dispositivo. Um estado não suportado ou erro multimédia pode apresentar **“Stream could not be played”**.
- **Nada carrega ou a verificação fecha cedo:** verifique Internet e a ligação HTTPS direta. Um erro de rede ou o fim do prazo não prova que o descodificador ou as colunas estejam avariados. Restabeleça a ligação antes de reproduzir novamente.
- **Imagem sem som:** os últimos dois segundos são deliberadamente silenciosos. Nos seis primeiros, verifique silêncio/volume do leitor, volume do televisor, saída de áudio selecionada e ligação de colunas/auscultadores.
- **Só uma coluna física toca:** verifique primeiro se o televisor usa saída mono ou mistura descendente antes de considerar uma falha no encaminhamento dos canais.

Esta é uma verificação breve de um MP4 conhecido pelo percurso HTML5 central gerido de imagem/áudio. Não demonstra que funcionem um fluxo do fornecedor, HLS/DASH, DRM, áudio multicanal ou reprodução com maior resolução, nem mede capacidade da rede ou latência de sincronização. Os limites de qualidade e definições de fluxos de reserva em direto não alteram este clipe de diagnóstico.

A propriedade e a limpeza são cobertas por [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) e [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs). As verificações automáticas de descodificação e ciclo de vida não substituem ver e ouvir no dispositivo real; este guia não afirma qualquer novo resultado em dispositivos físicos.
