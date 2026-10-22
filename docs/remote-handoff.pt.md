<a id="explicit-playback-handoff"></a>

# Transferência explícita da reprodução

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Melhorias](roadmap-delivery.pt.md)

Com o leitor e a CLI de controlo atualizados, execute `ott handoff SOURCE TARGET`. A origem continua a reproduzir. O destino precisa da mesma fonte/conta configurada e de um ID de canal estável e único. As referências de canal são impressões digitais locais com versão, nunca IDs brutos dos itens do fornecedor. As linhas M3U clássicas usam o URL exato do fluxo apenas como entrada do hash local. Por segurança, URLs assinados ou reescritos de forma independente não correspondem. Não há correspondência aproximada por nome nem transferência de credenciais ou URLs reproduzíveis. A versão 1 suporta direto/arquivo para M3U, Xtream e Stalker; VOD/séries e sincronização contínua do histórico não são suportados.

`playback_handoff_export` aceita parâmetros vazios e devolve `data.handoff`:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

As referências de arquivo usam `kind: "archive"` e um `archive_start` inteiro (posição atual da reprodução em segundos Unix). `playback_handoff_import` aceita apenas `{"handoff": ...}`. Antes de enviar a ordem, o destino verifica a identidade do catálogo, disponibilidade do arquivo, políticas parentais/de quiosque e titularidade atual do controlo. Resolve os fluxos através do seu próprio fornecedor. Uma importação aceite devolve `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. O envio não confirma vídeo descodificado nem som HDMI audível.

As rejeições expõem apenas um código de erro: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. As referências têm limites; o recetor rejeita campos adicionais. Use permissões de operador limitadas para exportação/importação e proteja a ligação ao controlador. A identidade da fonte é uma chave opaca de correspondência, não uma credencial de acesso transferível.

Execute `node tests/test_remote_handoff.cjs`. Consulte o [guia de controlo](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) para autenticação, resultados e comportamento do TTL das ordens.
