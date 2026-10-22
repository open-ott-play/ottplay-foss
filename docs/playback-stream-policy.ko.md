# 화질 제한과 라이브 스트림 복구

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[디코더 소유권](device-media-backend.md)

관리형 HTML5/HLS/Shaka 플레이어는 실패한 소스에서 복구하는 동안 재생 임대 하나를 유지합니다. 라이브 채널에 명시적으로 설정한 예비 URL을 최대 세 개까지 사용할 수도 있습니다. 채널 제목으로 채널을 검색하거나 추측하거나 대체하지 않습니다.

![복구 흐름: 임대 하나, 제한된 재시도, 명시적 예비 소스](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## 화질 상한 설정

**설정 → 인터페이스 설정**에서 **최대 동영상 높이(HLS/Shaka)** 또는 **최대 스트림 비트레이트(HLS/Shaka)**를 설정하세요. 두 제약 조건은 함께 적용됩니다. **자동**은 해당 제약 조건을 해제합니다. 지원하는 값은 360/480/720/1080/2160픽셀과 1/2/4/8/16Mbps입니다. 설정은 로컬에 저장되고 일반적인 설정 저장/취소 절차를 따르며, 복구를 위한 재시작을 포함한 다음 재생 시작부터 적용됩니다.

이는 트랜스코딩 설정이 아니라 상한입니다. 1080p만 제공되는 스트림을 720p로 만들 수 없습니다. 알려진 변형 중 적합한 것이 없으면 플레이어는 **No stream meets the quality limits**를 표시하고 해당 요청의 재시도를 중단합니다. 높이나 비트레이트가 알려지지 않은 HLS 변형은 제한에 맞는다고 입증할 수 없습니다.

HLS 변형 필터링은 조각을 로드하기 전에 수행합니다. 현재 hls.js는 부적합한 변형을 제거합니다. `removeLevel`이 없는 이전 빌드는 안전한 연속 앞부분만 유지할 수 있어서 뒤쪽에 적합한 변형이 있더라도 매니페스트를 거부할 수 있습니다. Shaka는 애플리케이션의 `maxHeight`/`maxBandwidth` 제약을 사용합니다. 남은 변형 사이에서는 자동 적응이 계속됩니다.

이 설정은 관리형 HLS와 Shaka 엔진에 적용됩니다. 일반 HTML5, 플랫폼 네이티브 디코더, 유지 중인 TV/STB 엔진은 같은 제어 기능을 제공하지 않습니다. 자동 모드는 네이티브 재생을 선택할 수 있으며, 이 설정이 MSE 사용을 강제하지 않습니다. 플레이어는 디코딩 오류를 회피하려고 이미 제한된 HLS 요청을 무제한 네이티브 재생으로 바꾸지 않습니다. 네이티브 트랜스코더, 자동 하드웨어 벤치마크 또는 실제 720p 출력 보장을 뜻하지 않습니다.

<a id="configure-explicit-backups"></a>

## 명시적 예비 소스 설정

1. 원하는 라이브 채널을 시작하세요.
2. **정보 → 예비 스트림**을 여세요.
3. 슬롯 1, 2 또는 3을 선택하고 완전한 HTTP/HTTPS 미디어 URL을 입력하세요.
4. 사용 중인 슬롯을 다시 열어 **편집**하거나 **삭제**하세요. 갱신된 목록을 사용하려면 채널을 다시 시작하세요.

각 슬롯은 현재 제공자 저장소 네임스페이스와 정확한 `sourceId`/`channelId` 쌍에 속합니다. 현재 재생 세대와 소스 설정이 편집기의 유효 범위를 제한합니다. 대화상자를 연 상태에서 소스를 바꾸면 그 대화상자는 대체된 소스에 저장할 수 없습니다. 같은 슬롯의 동시 변경은 덮어쓰지 않고 거부합니다.

첫 번째 URL은 채널의 일반 소스로 유지됩니다. 중복되거나 빈 슬롯은 건너뜁니다. 채널 레코드는 최대 256개, 설정은 최대 256KiB까지 허용합니다. 사용자 정보 자격 증명, 공백, 제어 문자, 역슬래시 또는 잘못된 포트가 들어 있는 URL은 거부합니다. 제공자가 발급한 쿼리 토큰은 미디어 URL의 일부로 포함될 수 있습니다. 예비 소스 설정은 로컬 소스 설정이며 자격 증명을 공유하거나 공개하는 수단이 아닙니다.

예비 소스는 **라이브 전용**입니다. 아카이브와 VOD 요청은 라이브 대체 소스를 사용하지 않습니다. 녹화물, 시간 기준점, 권한, 탐색 의미가 다를 수 있기 때문입니다. 소유자는 동등하고 사용 권한이 있는 라이브 엔드포인트를 제공해야 합니다. 채널 제목이 일치한다는 사실만으로 동등함이 입증되지는 않습니다. 전송 엔드포인트가 바뀌어도 저장된 채널 식별자, 즐겨찾기, EPG 연결은 유지됩니다.

<a id="recovery-guarantees"></a>

## 복구 보장

- 요청당 **일시적 오류에 대한 동일 URL 지연 재시도는 총 두 번**까지이며, 예비 슬롯 세 개 각각으로 앞으로 이동하는 횟수는 한 번까지입니다. 최초 시작 이후 재생을 다시 만드는 횟수는 최대 다섯 번입니다. 새 디코더 인스턴스나 매니페스트 성공으로 이 한도가 초기화되지 않습니다. 기존의 제한된 HLS 엔진 내부 네트워크/디코딩 복구가 이 외부 복구 정책보다 먼저 실행됩니다.
- HLS 매니페스트/레벨 파싱 실패는 요청당 동일 URL 재접속 한 번까지 허용하며, 같은 총 두 번의 재시도에 포함됩니다. 새 디코더나 예비 엔드포인트가 이 한도를 초기화하지 않습니다.
- 상태 코드가 없는 네트워크 실패, HTTP 408/429, 5xx는 일시적 오류 재시도 한도를 사용할 수 있습니다. 그 밖의 HTTP 4xx는 설정된 대체 소스로 이동할 수 있지만 같은 URL을 재시도하지 않습니다. HTTP **401/403 및 소스 로그인 오류는 종료**하며, 다른 자격 증명이나 예비 엔드포인트를 탐색하지 않습니다.
- 디코딩 실패는 명시적 예비 소스로 앞으로 이동할 수 있습니다. 충족 불가능한 화질 제한은 종료합니다. 주 소스로 되돌아가는 순환은 없습니다.
- 지연은 500ms, 1초, 1.5초, 이후 최대 2초입니다. 반복 콜백은 하나로 합칩니다.
- 일시정지는 예약된 타이머를 제거하되 대기 중인 재시도는 유지하고, 재개는 이를 다시 예약합니다. 정지, 대기 모드, 소스 교체, 채널 교체는 지연된 콜백을 무효화합니다. 최종 실패한 요청은 폐기된 디코더를 자동 재생하는 대신 사용자가 명시적으로 다시 선택해야 합니다.
- Shaka 로드 실패와 심각한 오류 이벤트도 같은 경로를 사용합니다. 취소 오류는 무시합니다. 다시 연결할 때는 비동기 Shaka 해제가 끝나기를 기다립니다.
- 복구 시 불투명한 Stalker 참조를 다시 해석하고 보호된 소스 접근을 다시 준비합니다. 만료된 iOS 루프백 URL은 재사용하지 않습니다. VOD/아카이브 위치는 해제 전에 샘플링하고, 라이브 예비 소스는 라이브 최전단에서 시작합니다.

이 정책은 멈춘 프레임을 감시하는 두 번째 워치독을 추가하지 않습니다. 기존 키오스크, 자동/네이티브, HLS 복구는 각자가 관찰하는 실패 사례를 계속 담당합니다. 기존 감지기가 오류를 보고하지 않은 채 조용히 멈춘 스트림은 별도 진단이 필요합니다.

<a id="verification-and-observability"></a>

## 검증과 관측

`window.__ottStreamPolicy.snapshot()`은 엔진 이름, 요청된 제한, 기능/가용성, 재시도 횟수, 엔드포인트 인덱스, 복구 상태를 제공합니다. 스트림 URL이나 제공자 자격 증명은 포함하지 않습니다. 인덱스 0은 일반 소스이고, 이후 인덱스는 비어 있지 않은 고유한 대체 소스입니다. 이는 안정적인 원격 제어 API가 아니라 진단 상태입니다.

실행하세요:

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

테스트는 단조롭지 않은 변형 순서의 화질 필터링, 메타데이터 부재, 소스 범위 편집, 슬롯 충돌, 중복 오류, 제한된 재시도 횟수, HTTP 권한 부여 실패, 일시정지/정지/소스 취소, Shaka 해제, VOD 위치 보존을 다룹니다. 새 재생 레이블 다섯 개는 배포되는 88개 언어 팩 전체에 번역되어 있습니다. 자동화된 동등성 확인은 원어민 검수가 아닙니다. 실제 TV/D1 재생과 제공자별 매니페스트는 여전히 기기 검증이 필요합니다. [편집 가능한 다이어그램 원본](diagrams/stream-recovery.mmd).
