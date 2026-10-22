# Limites de qualidade e recuperação de fluxos em direto

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Propriedade do descodificador](device-media-backend.md)

O leitor HTML5/HLS/Shaka gerido mantém uma única concessão de reprodução durante a recuperação de uma fonte que falhou. Também pode usar até três URL de reserva explicitamente configurados para um canal em direto. Nunca descobre, adivinha ou substitui um canal pelo título.

![Recuperação: uma concessão, tentativas finitas e reservas explícitas](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## Definir um limite de qualidade

Abra **Definições → Definições da interface** e configure **Altura máxima do vídeo (HLS/Shaka)** e/ou **Taxa de bits máxima do fluxo (HLS/Shaka)**. As duas restrições aplicam-se em conjunto. **Automático** remove a restrição correspondente. São suportados 360/480/720/1080/2160 píxeis e 1/2/4/8/16 Mbps. As definições são guardadas localmente, participam no fluxo normal de guardar/cancelar e entram em vigor no próximo início de reprodução, incluindo um reinício de recuperação.

São limites, não definições de transcodificação. Um fluxo apenas em 1080p não pode tornar-se 720p. Se nenhuma variante anunciada cumprir, o leitor apresenta **No stream meets the quality limits** e deixa de repetir essa solicitação. Altura/taxa desconhecidas não provam que uma variante HLS cumpra a restrição.

A filtragem de variantes HLS ocorre antes de carregar fragmentos. O hls.js atual remove variantes não elegíveis; versões antigas sem `removeLevel` só conseguem manter um prefixo contíguo seguro e podem rejeitar um manifesto com variantes posteriores que seriam elegíveis. O Shaka usa restrições da aplicação `maxHeight`/`maxBandwidth`. A adaptação automática continua entre as variantes restantes.

Estas definições aplicam-se aos motores HLS e Shaka geridos. HTML5 simples, descodificadores nativos da plataforma e motores TV/STB mantidos não expõem os mesmos controlos. Auto pode selecionar reprodução nativa; a definição não a força para MSE. O leitor não muda uma solicitação HLS já limitada para reprodução nativa sem limites apenas para contornar um erro de descodificação. Não implica transcodificador nativo, teste automático de hardware nem garantia de saída física a 720p.

<a id="configure-explicit-backups"></a>

## Configurar reservas explícitas

1. Inicie o canal em direto pretendido.
2. Abra **Informações → Fluxos de reserva**.
3. Selecione a posição 1, 2 ou 3 e introduza um URL multimédia HTTP/HTTPS completo.
4. Reabra uma posição ocupada para **Editar** ou **Eliminar**. Reinicie o canal para usar a lista atualizada.

Cada posição pertence ao espaço de armazenamento do fornecedor atual e ao par exato `sourceId`/`channelId`. A geração de reprodução e a configuração da fonte atuais delimitam o editor. Mudar de fonte com um diálogo aberto impede que esse diálogo guarde na fonte substituta. Uma alteração concorrente na mesma posição é rejeitada, em vez de sobrescrita.

O primeiro URL continua a ser a fonte normal do canal. Posições duplicadas e vazias são ignoradas. São aceites no máximo 256 registos de canal e 256 KiB de configuração. São rejeitados URL com credenciais em user-info, espaços em branco, caracteres de controlo, barras invertidas ou porta inválida. Os tokens de consulta do fornecedor ainda podem fazer parte de um URL multimédia: as reservas são configuração local da fonte, não um mecanismo para partilhar ou publicar credenciais.

As reservas são **apenas para direto**. Solicitações de arquivo e VOD nunca usam uma alternativa em direto: gravação, origem temporal, direitos e semântica de procura podem ser diferentes. O proprietário tem de fornecer destinos em direto equivalentes e autorizados. Um título de canal coincidente não prova equivalência. A identidade guardada do canal, os favoritos e a associação EPG não mudam quando muda o destino de transporte.

<a id="recovery-guarantees"></a>

## Garantias de recuperação

- A solicitação tem no máximo **duas tentativas transitórias adiadas no mesmo URL, no total**, e no máximo um avanço para cada uma das três posições de reserva: até cinco recriações após o início inicial. Uma nova instância do descodificador ou um manifesto bem-sucedido não repõe o orçamento. A recuperação HLS limitada de rede e descodificação dentro do motor ocorre antes desta política externa.
- Falhas de análise do manifesto/nível HLS permitem no máximo uma reconexão ao mesmo URL por solicitação, incluída no mesmo total de duas tentativas. Um novo descodificador ou destino de reserva não repõe este limite.
- Falhas de rede sem estado, HTTP 408/429 e 5xx podem usar o orçamento transitório. Outros HTTP 4xx podem avançar para uma alternativa configurada, mas não repetem o mesmo URL. **HTTP 401/403 e erros de autenticação na fonte terminam a solicitação**, sem testar credenciais alternativas nem destinos de reserva.
- Falhas de descodificação podem avançar para uma reserva explícita. Limites de qualidade impossíveis terminam a solicitação. Não existe retorno cíclico à fonte principal.
- O atraso é 500 ms, 1 s, 1.5 s e depois no máximo 2 s. Callbacks repetidos são agrupados.
- Pause remove o temporizador agendado mantendo a tentativa pendente; Resume agenda-o novamente. Stop, espera e substituição da fonte ou canal invalidam callbacks adiados. Uma solicitação terminalmente falhada requer nova seleção explícita, em vez de reproduzir automaticamente o descodificador retirado.
- Falhas de carregamento e eventos críticos de erro do Shaka partilham este caminho; erros de cancelamento são ignorados. A reconexão espera pela destruição assíncrona do Shaka.
- A recuperação resolve novamente uma referência opaca Stalker e prepara de novo o acesso protegido à fonte. Não reutiliza um URL loopback iOS expirado. A posição VOD/arquivo é recolhida antes da desmontagem; reservas de direto começam no seu ponto atual de transmissão.

A política não introduz um segundo monitor de fotogramas parados. A recuperação existente de kiosk, Auto/native e HLS continua a cobrir os seus próprios casos de falha observados. Um fluxo que para silenciosamente sem erro comunicado por um detetor existente precisa de diagnóstico separado.

<a id="verification-and-observability"></a>

## Verificação e observabilidade

`window.__ottStreamPolicy.snapshot()` expõe nome do motor, limites pedidos, capacidade/disponibilidade, contagem de tentativas, índice do destino e estado de recuperação. Não contém URL do fluxo nem credenciais do fornecedor. O índice zero significa a fonte normal; os posteriores são alternativas únicas não vazias. É estado de diagnóstico, não uma API estável de controlo remoto.

Execute:

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

Os testes exercitam filtragem de qualidade com variantes em ordem não monótona, metadados indisponíveis, edição no âmbito da fonte, conflitos de posições, erros duplicados, orçamentos limitados, falhas de autorização HTTP, cancelamento por pausa/paragem/fonte, desmontagem Shaka e retenção da posição VOD. Os cinco novos rótulos de reprodução estão traduzidos nos 88 pacotes linguísticos incluídos; a paridade automática não é revisão por falantes nativos. A reprodução física TV/D1 e manifestos específicos dos fornecedores ainda exigem validação no dispositivo. [Fonte editável do diagrama](diagrams/stream-recovery.mmd).
