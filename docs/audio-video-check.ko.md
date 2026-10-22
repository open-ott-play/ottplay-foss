# 수동 오디오/비디오 확인

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[스트림 복구](playback-stream-policy.ko.md) · [테스트 샘플 규격](../diagnostics/README.md)

**플레이어 메뉴 → 정보 → 오디오 → 재생**을 사용해 알려진 8초 클립으로 영상과 소리를 확인하세요. 이것이 소리가 있는 A/V 확인입니다. 초기 안내의 움직이는 패턴 데모는 무음입니다.

![A/V 확인: 저장소 원본, 호스팅된 클립, 명시적 재생](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## 확인 시작

1. TV, 스피커 또는 헤드폰을 편안한 음량으로 설정하세요. 확인은 플레이어의 현재 음량을 사용하고 비디오 음소거를 잠시 해제합니다. TV 시스템 음량을 높이지 않습니다.
2. 플레이어 메뉴에서 **정보**, **오디오**, **재생** 순서로 선택하세요. 메뉴만 열면 클립을 다운로드하거나 재생하지 않습니다.
3. 화면을 보고 아래 순서의 소리를 들으세요. 일찍 끝내려면 **정보 → 오디오 → 중지**를 사용하세요.

확인은 플레이어가 유휴 상태이거나 실시간 TV를 재생 또는 일시 정지한 동안 관리되는 코어 HTML5 재생 경로를 사용합니다. 활성 VOD/보관 요청, 아직 로딩 중인 실시간 요청, 대기 모드에서는 거부합니다. **PC2/Video.js**와 네이티브 엔진 재정의를 포함해 장치 어댑터가 코어 엔진을 교체한 경우에도 사용할 수 없습니다. HTML5 video 요소를 사용한다는 사실만으로 어댑터가 대상이 되지는 않습니다. 거부해도 기존 재생을 바꾸지 않습니다. 유휴 상태에서 시험하려면 먼저 현재 요청을 중지하세요. 다만 위 어댑터에서 확인이 활성화되지는 않습니다. 메뉴 레이블은 선택한 인터페이스 언어를 따릅니다.

<a id="what-you-should-see-and-hear"></a>

## 보고 들어야 할 내용

배경은 움직이는 테스트 패턴입니다. 짧은 흰색 표시가 위쪽 왼쪽 또는 오른쪽 절반에서 약 150 ms 길이의 조용한 음향 펄스에 맞춰 깜박입니다.

- **0–2초:** 매초 왼쪽 채널에서 440 Hz 펄스가 나며 왼쪽 표시가 깜박입니다.
- **2–4초:** 오른쪽 채널에서 880 Hz 펄스와 오른쪽 표시가 나옵니다.
- **4–6초:** 두 채널에서 펄스가 나오고 두 표시가 깜박입니다.
- **6–8초:** 패턴은 소리 없이 계속 움직입니다. 의도된 무음입니다.

모노 TV나 다운믹스는 두 채널을 한 스피커로 재생할 수 있습니다. 실제 화면과 오디오 출력을 직접 확인하세요. 플레이어는 스피커 출력을 측정하거나 자동 A/V 통과/실패 판정을 내리지 않습니다.

<a id="where-the-clip-comes-from"></a>

## 클립의 출처

플레이어는 다음 절대 HTTPS 주소를 사용합니다.

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

**재생**을 선택했을 때만 클립을 요청하며 시작 시 미리 가져오지 않습니다. 파일은 **464 652바이트**이고, H.264 baseline 영상 640×360 / 25 fps와 AAC 스테레오 오디오입니다. Web, OTTPlay Server, Tauri, Capacitor, 컨테이너 패키지에서 제외됩니다. [원본 파일](../diagnostics/av-v1.mp4), 생성기와 검증기는 저장소에 남아 있지만 설치된 플레이어의 오프라인 대체 파일은 아닙니다.

인터넷 접근과 해당 호스트로의 정상 HTTPS 연결이 필요합니다. 내장된 대체 파일이나 다른 진단 URL은 없습니다. 위 링크를 브라우저에서 열면 파일 가용성을 확인할 수 있지만 플레이어의 디코더 소유권이나 채널 복귀 동작은 시험하지 않습니다. 호스팅 서비스는 일반적인 연결 정보를 받습니다. [개인정보 세부사항](privacy-policy.md#optional-hosted-audio-video-check)을 참조하세요.

<a id="how-playback-returns"></a>

## 재생으로 돌아가는 방법

확인은 주 디코더를 사용해 실시간 영상을 잠시 대체합니다. 클립 끝, **오디오 → 중지** 선택 또는 미디어 오류 발생 시 종료됩니다. **확인이 수락될 때 15초 안전 제한 시간이 시작**되며 로딩도 포함합니다. 따라서 다운로드가 느리면 8초 전체가 재생되기 전에 종료될 수 있습니다.

이러한 종료 경로에서 플레이어는 저장한 실시간 요청을 일시 정지 상태까지 포함해 실시간 끝 지점으로 복구하려고 합니다. 단, 요청이 여전히 현재 소스에 속하고 다른 재생이 대체하지 않은 경우에만 그렇습니다. 실시간 URL은 다시 해석하며 복원은 여전히 공급자와 네트워크에 의존합니다. 유휴 상태에서 시작한 확인은 유휴 상태로 돌아갑니다.

일반 재생 **Stop** 명령, 대기 모드, 다른 채널 선택은 저장된 채널을 다시 시작하지 않고 확인을 취소합니다. 소스나 소스 세션을 바꾸어도 오래된 복원을 방지합니다. 확인 종료 시 자신이 잠시 해제한 음소거를 되돌립니다. 실행 중 직접 음소거했다면 그 음소거가 유지됩니다. 저장된 엔진 환경설정을 바꾸거나 테스트 시간을 채널 기록에 쓰지 않으며, 거짓 채널 완료나 테스트 메타데이터를 OS에 게시하지 않습니다.

<a id="if-the-result-is-unexpected"></a>

## 결과가 예상과 다를 때

- **확인을 시작할 수 없음:** 장치 엔진 재정의 없이 관리되는 코어 HTML5 경로를 사용하고, 플레이어가 유휴 상태이거나 이미 재생/일시 정지 중인 실시간 채널인지 확인하세요. 미지원 상태나 미디어 오류는 **“Stream could not be played”**를 표시할 수 있습니다.
- **아무것도 로드되지 않거나 일찍 종료됨:** 인터넷 연결과 직접 HTTPS 링크를 확인하세요. 네트워크 오류나 제한 시간 만료가 디코더나 스피커 고장의 증거는 아닙니다. 연결을 복구한 뒤 다시 재생하세요.
- **영상은 있지만 소리가 없음:** 마지막 2초는 의도적으로 무음입니다. 처음 6초 동안 플레이어 음소거/음량, TV 음량과 선택된 오디오 출력, 스피커/헤드폰 연결을 확인하세요.
- **실제 스피커 하나만 소리가 남:** 채널 라우팅 오류로 판단하기 전에 TV가 모노 출력이나 다운믹스를 사용하는지 확인하세요.

이것은 관리되는 코어 HTML5 영상/오디오 경로로 알려진 MP4를 짧게 확인하는 기능입니다. 공급자 스트림, HLS/DASH, DRM, 다중 채널 오디오 또는 더 높은 해상도 재생이 작동함을 입증하지 않으며 네트워크 용량이나 동기화 지연을 측정하지 않습니다. 품질 상한과 실시간 예비 스트림 설정은 이 진단 클립에 영향을 주지 않습니다.

소유권과 정리 동작은 [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) 및 [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs)에서 검사합니다. 자동 디코딩 및 수명 주기 검사는 실제 장치에서 보고 듣는 과정을 대신하지 못합니다. 이 안내서는 새로운 실제 장치 결과를 주장하지 않습니다.
