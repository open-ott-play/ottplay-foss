<a id="explicit-playback-handoff"></a>

# 명시적인 재생 인계

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[개선 사항](roadmap-delivery.ko.md)

업데이트된 플레이어와 제어 CLI에서 `ott handoff SOURCE TARGET` 를 실행합니다. 소스는 계속 재생합니다. 대상에는 동일한 소스/계정 설정과 고유하고 안정적인 채널 ID가 필요합니다. 채널 참조는 버전이 있는 로컬 지문이며, 공급자의 원시 항목 ID가 아닙니다. 클래식 M3U 행은 정확한 스트림 URL을 로컬 해시 입력으로만 사용합니다. 따라서 별도로 서명되거나 다시 작성된 URL은 안전을 위해 일치하지 않는 것으로 처리합니다. 이름을 대략적으로 비교하지 않으며 자격 증명이나 재생 가능한 URL을 전송하지 않습니다. 버전 1은 M3U, Xtream, Stalker의 실시간/아카이브를 지원합니다. VOD/시리즈와 지속적인 시청 기록 동기화는 지원하지 않습니다.

`playback_handoff_export` 는 빈 매개변수를 받아 `data.handoff` 를 반환합니다.

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

아카이브 참조는 `kind: "archive"` 와 정수 `archive_start` (현재 재생 지점을 Unix 초로 나타낸 값)를 사용합니다. `playback_handoff_import` 는 `{"handoff": ...}` 만 허용합니다. 대상은 명령을 전달하기 전에 카탈로그 식별 정보, 아카이브 가용성, 자녀 보호/키오스크 정책 및 현재 제어 소유권을 확인합니다. 스트림은 자신의 공급자를 통해 확인합니다. 가져오기가 수락되면 `{"status":"ok","data":{"dispatched":true,"kind":"live"}}` 를 반환합니다. 명령 전달은 영상 디코딩이나 들리는 HDMI 소리를 확인한 것이 아닙니다.

거부 시에는 오류 코드만 노출합니다: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. 참조에는 제한이 있으며 수신자는 추가 필드를 거부합니다. 내보내기/가져오기에는 범위를 제한한 운영자 권한을 사용하고 컨트롤러 연결을 보호하세요. 소스 식별 정보는 내용을 해석하지 않는 매칭 키이며, 양도 가능한 접근 자격 증명이 아닙니다.

`node tests/test_remote_handoff.cjs` 를 실행하세요. 인증, 결과 및 명령 TTL 동작은 [제어 가이드](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md)를 참조하세요.
