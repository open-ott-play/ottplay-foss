<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# 수동 XMLTV 연결과 키보드 접근성

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[프로그램 가이드 아키텍처](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## 재생목록을 편집하지 않고 채널 가이드 수정하기

문제가 있는 M3U 채널을 재생하고 **Information → EPG** 를 연 뒤 EPG 소스 URL과 **XMLTV ID** 를 편집합니다. XMLTV 파일의 `<channel id="…">` 에 있는 정확한 ID를 입력하세요. 표시 이름을 입력하는 것이 아닙니다. **Set** 을 선택하면 연결을 저장하고 재생목록을 다시 불러옵니다. **Automatic** 은 이 채널의 재정의를 제거하고 원래 재생목록 매핑을 다시 불러옵니다. 방향키로 이동하는 것만으로는 연결을 저장하거나 초기화하지 않습니다. 뒤로 가기는 저장된 연결을 그대로 둡니다.

이 편집기는 호스팅된 브라우저 배포와 네이티브 XMLTV 셸(Tauri 및 Capacitor)에서 사용할 수 있습니다. 공급자가 관리하는 가이드, 명시적 `=source` JSON 엔드포인트 또는 외부 보조 서버를 재정의하지 않습니다. 원격 보조 서버를 사용하는 일반 구형 브라우저는 기존 매칭 프로토콜을 유지합니다. 첫 버전은 정확한 ID를 받으며, 모든 XMLTV 채널의 검색 가능한 목록을 다운로드하거나 표시하지 않습니다.

![수동 연결은 재생목록 소스와 안정적인 채널을 하나의 XMLTV 피드 및 정확한 ID에 연결하며, 그 외에는 일반 매칭이 유지됩니다.](images/guide-binding.svg)

연결은 재생목록 소스 지문, 안정적인 채널 키, 명시적 피드 URL 및 XMLTV ID를 저장합니다. 채널 식별 정보가 같다면 표시 레이블이나 행 순서가 바뀌어도 연결은 바뀌지 않습니다. 재생목록 URL/계정을 교체하면 소스 네임스페이스가 바뀝니다. `itemId` 가 없는 구형 M3U 항목은 기존 URL 기반 채널 ID를 사용하므로, 해당 URL을 바꾸면 식별 정보도 바뀝니다.

선택한 채널은 표시 이름과 재생 URL을 유지합니다. 가이드 조회는 하나의 명시적 피드를 사용하고 이름으로 대체 조회하지 않으므로, ID가 없다고 다른 채널의 프로그램을 조용히 가져오지 않습니다. 채널 이름에서 추정한 자동 지역 시간 차이는 이 정확한 연결에 적용되지 않지만, 재생목록의 명시적 `tvg-shift` 는 계속 적용됩니다. 올바른 지역 XMLTV ID를 설정하세요. 사용자 HTTPS 피드를 CORS나 혼합 콘텐츠 규칙 때문에 읽을 수 없으면 일반 EPG 진단이 해당 오류를 보고합니다.

로컬 기록은 소스당 연결 500개 및 512 KiB로 제한됩니다. 채널마다가 아니라 재생목록을 불러올 때 한 번 파싱합니다. 쓰기 작업은 이전 값을 비교하고, 다시 불러오기 전에 저장된 결과를 다시 읽습니다. 늦게 도착한 편집기 콜백은 교체된 소스에 저장할 수 없습니다. 이는 로컬 기본 설정이며 기기 간 동기화가 아닙니다. 피드 URL에는 자격 증명이 포함될 수 있으니 저장소 내보내기를 공개하지 마세요.

<a id="accessible-classic-controls"></a>

## 접근 가능한 클래식 컨트롤

- 가상화된 메인 목록은 이름 있는 목록 상자, 선택된 옵션, 전체 항목 수 및 절대 항목 위치를 노출합니다. 선택된 표시 행만 Tab 정지점입니다. 방향키 탐색은 시각적 선택과 의미적 상태를 함께 갱신하며, 페이지가 교체될 때 포커스는 이미 포커스된 목록을 따라갑니다.
- 표준 정보/확인 대화상자, 편집기 및 About 패널은 모달 역할과 지역화된 이름을 노출합니다. Tab과 Shift+Tab은 맨 앞 모달 안에서 순환합니다. 중첩 모달을 닫으면 여전히 보이는 상위 컨트롤로 돌아가며, 오래된 예약 열기는 닫힌 뒤 포커스를 빼앗을 수 없습니다.
- 정보와 확인 메시지는 해당 대화상자를 설명합니다. 임시 알림은 방해하지 않는 상태 알림 영역을 사용합니다.
- 추가된 모든 레이블은 기존 번역 카탈로그에서 제공됩니다. XMLTV와 ID는 프로토콜 식별자이며, 채널 이름과 피드 호스트 이름은 소스 메타데이터로 유지됩니다.

애플리케이션은 리모컨 경로와 ES5 구문을 유지합니다. 의미적 DOM 검사는 완전한 WCAG 인증을 뜻하지 않습니다. 기기별 포커스, VoiceOver/TalkBack 음성 및 TV 브라우저 동작은 여전히 실제 기기에서 테스트해야 합니다.

<a id="verification"></a>

## 검증

다음을 실행합니다.

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

통합 브랜치에서 일반 빌드/ES5/번들 크기 검사도 실행하세요. 브라우저 검사는 페이지 경계를 넘는 긴 목록, 중첩 확인, 편집 중 소스 교체, 올바른 연결·없는 연결·제거된 연결 및 EPG 다운로드 실패를 포함해야 합니다. 네이티브 Android 앱의 의미 기반 트랙 기본 설정은 별도 저장소에서 구현되며 이 클래식 컨트롤과 독립적입니다.
