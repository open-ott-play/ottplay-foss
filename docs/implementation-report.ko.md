# 기능 목록에서 검증된 동작까지

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[기능 계약](roadmap-delivery.ko.md) · [크기 근거](roadmap-size.ko.md)

이 보고서는 구현과 안정화 과정을 기록하며 릴리스 발표가 아닙니다. 측정한 플레이어 스냅샷은 `652726f8`이고, 별도로 빌드한 네이티브 Android 스냅샷은 `be0d800`입니다. CI, 병합, 릴리스 승격은 각각 별도의 관문입니다. 이후 문서나 테스트만 바꾼 커밋이 로컬 검사를 설치된 기기가 업데이트되었다는 증거로 바꾸지는 않습니다. 아래 관문 상태는 해당 과거 스냅샷의 상태이며 실시간 릴리스 추적이 아닙니다. 게시된 빌드는 [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases)를 참고하세요.

![구현 과정과 인수 관문](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## 작업을 검증한 방법

최초 요청은 클래식 플레이어, 제어 서비스/CLI, 독립 네이티브 Android 앱에 걸친 13개의 사용 가능한 기능 단위로 나눴습니다. 다른 구성 요소의 작업을 대체하지 않고 동시 변경을 검토·통합하도록 구성 요소별로 담당을 지정했습니다. 새 UI는 기존 번역 레이블을 재사용하거나 88개 언어 모두에 카탈로그 항목을 추가했습니다. 완전한 기술 안내서는 처음에 영어와 러시아어로 작성했습니다. 이제 주 설명서와 짝을 이룬 기능 안내서는 [24개 문서 언어](manual-translations.md)의 완전한 판을 제공합니다.

구현 후 독립적인 교차 검토와 실행 가능한 회귀 테스트를 수행했습니다. 보고된 문제는 코드를 바꾸기 전에 실제 콜백, 디코더, 저장소 또는 포커스 경로에서 확인했습니다. 테스트 실패는 동작 회귀와 오래된 테스트 선택자로 구분했습니다. 예를 들어 클래식 행을 `button`에서 `option`으로 바꾸면 선택자를 업데이트해야 하지만, 기대하는 클릭 동작을 약화할 근거가 되지는 않습니다.

그다음 깨끗한 프로덕션 빌드로 생성된 ES5 산출물과 선택적 제공자 모듈을 포함한 전체 JavaScript 비용을 확인했습니다. 집중 브라우저 테스트는 배포되는 로더, 번들, 기기 어댑터를 사용했습니다. 네이티브 Android는 Gradle 테스트, lint, 패키지 빌드를 별도로 수행했습니다. 푸시한 후에는 PR 검사와 검토 스레드를 다시 확인하며, 로컬 빌드 성공이 이를 대체하지 않습니다.

<a id="what-changed-during-review"></a>

## 검토 과정에서 바뀐 점

![수정한 다섯 동작과 측정한 JavaScript 비용](diagrams/implementation-results.svg)

- **HLS 파싱과 재시도:** 파싱 실패는 처음에 일반 네트워크 분류를 공유했습니다. 이제 일시적 오류 재시도 두 번의 예산 안에서 동일 URL 재접속을 최대 한 번만 허용합니다. 새 디코더와 예비 URL은 이 예산을 초기화하지 않습니다. 최종 인증/DRM 실패는 이미 예약된 일시적 재시도도 취소합니다.
- **네이티브 Auto 대체 경로:** Auto가 이미 대체 경로를 소유한 상태에서 네이티브 오류 처리가 요청을 종료할 수 있었습니다. 이제 기존 소유자가 해당 전환을 유지하며, 취소는 여전히 지연 콜백을 무효화합니다.
- **모달 Enter:** 첫 취소 버튼에 자동으로 포커스를 두면 Plex 대기 대화상자의 Enter가 취소로 바뀌었습니다. 이제 대화상자 자체에 포커스를 두고 시작합니다. Tab은 명시적으로 버튼에 도달하며, 일반 정보·확인 대화상자는 Enter와 Escape/뒤로 동작을 유지합니다.
- **PC 포인터 선택:** 클릭 처리기보다 먼저 마우스 포커스가 선택을 바꿔 첫 클릭이 활성화가 되었습니다. 포인터가 만든 포커스는 더 이상 행을 미리 선택하지 않습니다. PC는 계속 선택 후 활성화하고, LG는 한 번 클릭 동작을 유지합니다. 키보드 포커스는 계속 선택을 따릅니다.
- **Android 트랙:** 현재 항목의 레이블 없는 선택은 자체 Auto 확인이나 자막 설정 업데이트로 지워지거나, 같은 `TrackGroup`을 가진 다른 항목으로 넘어갈 수 있었습니다. 이제 현재 항목에 대해서만 지연 쓰기 이후에도 유지됩니다. 의미 기반 설정은 언어/역할/레이블을 사용하며, ViewModel이 영속 저장을 소유하므로 패널을 닫아도 쓰기가 취소되지 않습니다.

제공한 13개 단위는 A/V 샘플, 재개 가능한 Local/Home 설정, 제한된 복구, 화질 상한, Android 트랙 설정, 범위가 제한된 제어 키, XMLTV 연결, Xtream 영화/시리즈, 클래식 접근성, 지속되는 명령 결과, 명시적 인계, 예비 스트림, 복구 가능한 설정 배치입니다. [기능 안내서](roadmap-delivery.ko.md)가 각 범위와 한계를 정의합니다.

<a id="evidence-and-remaining-gates"></a>

## 증거와 남은 관문

`652726f8`에서 다섯 집중 브라우저 시나리오가 통과했습니다. LG webOS 포인터 탐색, LG NetCast 포인터 탐색, PC 두 번 클릭 동작, 대화상자 키보드 의미, Plex 컬렉션/해석/취소/재시도입니다. TypeScript, 접근성 단위 픽스처, 범위를 한정한 lint, ES5, 번들 예산 검사도 통과했습니다. 이 빌드의 전체 브라우저 실행은 **194개 통과, 1개 건너뜀**으로 끝났습니다. 네이티브 HLS는 WebKit이 필요하지만 이 실행은 Chromium을 사용했습니다. 호스팅 CI와 합의한 병합 순서는 별도 관문입니다.

남은 `test:port`와 `test:unified` 연쇄는 개별 픽스처 수정 후 재개한 구간별로 완료했습니다. 실패했던 대상마다 다시 실행해 성공했고 나머지 명령도 성공했습니다. 이는 한 번의 중단 없는 `npm test` 실행을 주장하는 것이 아닙니다. 정확히 아홉 명령으로 된 Android 브리지 CI 단계도 로컬에서 통과했습니다.

Android `be0d800`에서는 **앱 테스트 101개와 공통 코어 테스트 62개**가 로컬에서 통과했습니다. debug/release lint, Debug/Release/Full APK 조립, 릴리스 번들, androidTest APK 컴파일도 통과했습니다. 계측 테스트 APK 컴파일은 기기에서의 실행이 아닙니다. 확인된 검토 지적 세 건은 [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68)에서 답변하고 해결했습니다. 이 PR은 검사를 통과하고 `5b644b94`로 병합되었으며, 병합 후 CI는 별도로 추적합니다. 다이어그램은 플레이어 전체 CI/릴리스 관문을 대기 상태로 둡니다.

전체 웹 JavaScript는 원본/gzip **964,459 / 305,344**바이트에서 **995,858 / 315,207**로 바뀌었습니다. 차이는 **+31,399 / +9,863바이트**(약 3.26% / 3.23%)입니다. 기능 후보는 995,587 / 315,103이었고, 후속 안정화가 271 / 104를 추가했습니다. 해당 스냅샷의 최종 주 진입 파일은 875,197 / 270,425입니다. [기준 측정](evidence/roadmap-size-20261015.json), [최종 산출물 측정](evidence/roadmap-final-size-20261015.json), [측정 방법](roadmap-size.ko.md)을 참고하세요.

이는 과거의 JavaScript 바이트 비용이며 **측정된 속도 향상이 아닙니다**. 합계에는 미디어 엔진, 사전, CSS, 이미지, 영상이 빠져 있습니다. 해당 스냅샷의 플레이어 패키지는 별도로 464,652바이트 A/V 클립을 포함했습니다. [호스팅 변경](audio-video-check.ko.md) 후 `diagnostics/av-v1.mp4`와 생성기·검증기는 재현성을 위해 저장소에 남지만, Web/OTTPlay Server, Tauri, Capacitor, Docker 패키지에서는 제외됩니다. 플레이어는 인터넷이 필요한 명시적 A/V 검사에서만 here.now에서 가져오며, 시작 재생 때는 가져오지 않습니다. 원본 미디어 464,652바이트 제거가 압축 설치 프로그램의 절감량을 입증하거나 과거 JavaScript 측정을 바꾸지는 않습니다. 시작 시간, 프레임 간격, 메모리, 화면 읽기 프로그램 경험, 실제 HDMI 오디오, 제공자 동작은 대상 기기에서 별도 측정해야 합니다. 이 보고서는 새 물리 기기 결과나 베타 릴리스를 주장하지 않습니다. [물리 기기 인수 목록](roadmap-delivery.ko.md#physical-acceptance-before-promotion)과 [릴리스 전략](../RELEASING.md)이 계속 승격 기준입니다.

<a id="post-beta-integration-and-review"></a>

## 베타 이후 통합과 검토

beta.4를 게시한 뒤 소스 `39287792`를 이 브랜치에 통합했습니다. 런타임 리비전 `9663b681`은 HLS 화질 제한 아래에서 라이브 가장자리로 돌아가는 동작도 수정하고, 손상된 설정 저널을 일반 시작 전에 복구할 수 있게 합니다. 복구 화면은 계정 상태 일부만 불러오는 것을 막고, 재시도와 확인 후 초기화를 지원하며, 관련 없는 쿠키를 보존하고, 초기화 뒤 오래된 쿠키 설정이 돌아오지 못하게 합니다. [복구 절차](settings-recovery.ko.md)와 SVG 다이어그램을 참고하세요.

![베타 이후 전체 JavaScript 비교](diagrams/post-beta-size.svg)

Node 26.8.2, Rollup 4.64.5, Terser 5.51.2로 두 소스를 재현하면 beta.4 소스는 원본/gzip **964,876 / 305,452**바이트, 통합 버전은 **1,000,388 / 316,600**입니다. 차이는 **+35,512 / +11,148바이트**(3.68% / 3.65%)입니다. 선택적 제공자 전체를 포함하며, 기준 버전에는 일곱 개, 통합에는 여덟 개입니다. 새 진입 파일은 879,533 / 271,761입니다. 이는 위에 고정된 이전 그래프와 별개의 비교입니다.

두 로컬 프로덕션 빌드 모두 추적되는 런타임 파일 다섯 개를 다시 생성하고, 깨끗한 소스 리비전이라는 주장을 생략합니다. 보고서는 로컬 파일을 게시된 릴리스 산출물이라고 부르는 대신 이 한계를 기록합니다. [기준](evidence/post-beta-baseline-size-20261015.json)과 [통합](evidence/post-beta-candidate-size-20261015.json)을 참고하세요. 통합 빌드와 ES5/네이티브 검사는 통과합니다. 저널 복구/초기화, 대화상자 키보드, LG webOS·NetCast 포인터 입력, PC 두 번 클릭 선택, 소유권이 있는 Plex 대기라는 여섯 집중 브라우저 검사도 통과합니다.

<a id="browser-gate-integration"></a>

## 브라우저 관문 통합

![확인된 로컬 브라우저 검증 결과](diagrams/browser-verification-results.svg)

소스 `c52f4d07`은 main `1ecbc0e7`의 PR 779를 포함합니다. 두 브랜치의 테스트 명령, 복구 검사, Plex 대화상자 단언을 보존합니다. TypeScript, lint, 문서, 패키징/링커 계약, 프로덕션 빌드, 컴파일된 번들 전체 검사가 통과합니다. 생성된 플레이어/제공자 JavaScript 파일 27개 모두 위에서 측정한 산출물과 바이트 단위로 같습니다. 이 빌드의 전체 기기 브라우저 테스트 모음은 **196개 통과, 예상된 Chromium 건너뜀 1개**로 끝나며, 건너뛴 것은 WebKit이 필요한 네이티브 HLS 사례입니다.

정확히 패키징된 Mode A 아카이브는 소스, 체크섬, 번들/제공자 목록을 확인한 뒤에만 풀었습니다. Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2는 각각 프로필 시나리오 다섯 개 모두를 건너뜀이나 재시도 없이 통과했습니다. Playwright 1.64.0으로 **로컬 통과 15개**입니다. 실제 호스트는 macOS 26.7.1이며 선택한 프로필에 명시된 `macos-15` 러너가 아닙니다. 증빙은 이 차이를 명시하고 **호스팅 매트릭스 또는 릴리스 자격 검증이 아닙니다**. [로컬 요약](evidence/post779-local-acceptance/summary.json)과 [재현 절차](evidence/post779-local-acceptance/reproduce.sh)를 참고하세요. 재현 절차는 기존 프로덕션 빌드를 요구하고 압축을 푼 후보 디렉터리 교체를 거부합니다.

[브라우저 정책](browser-compatibility.ko.md)은 PR/베타 검사에 호스팅 대상 다섯 개와 시나리오 실행 25회를 요구하며, 전체 RC는 대상 35개와 실행 166회입니다. 이는 설정된 요구 사항이지 측정된 범위가 아닙니다.

![후보 검증이 증거를 만드는 과정](diagrams/candidate-verification-flow.svg)

main `1ecbc0e7`의 별도 [베타 파이프라인](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467)은 성공적으로 끝났습니다. 여기에는 이 PR이 포함되지 않습니다. 통합은 아직 자체 호스팅 CI 성공과 검토, 이후 릴리스 조율이 필요합니다. 위 로컬 결과는 이러한 전달 관문을 통과했다고 주장하지 않습니다.

<a id="delivery"></a>

## 전달

- [플레이어, 문서, i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781).
- [제어 서버와 CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106).
- [Android 트랙 설정 — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68).

이 PR들이 현재 CI와 병합 상태를 담고 있습니다. 플레이어 변경은 합의한 현재 Plex 수정과 그 베타 릴리스 뒤에 별도 전달 단계로 이어집니다.
