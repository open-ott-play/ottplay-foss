<a id="measured-javascript-cost"></a>

# 측정된 JavaScript 비용

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[기능 안내](roadmap-delivery.ko.md) · [원시 근거 자료](evidence/roadmap-size-20261015.json)

![같은 도구 체인으로 비교한 플레이어 전체 JavaScript](diagrams/roadmap-size.svg)

이 페이지는 아래 소스 스냅샷의 JavaScript 측정값을 보존합니다. 현재 리비전, 설치 패키지 또는 네트워크 트래픽을 측정한 값이 아닙니다.

초기 비교에서 기본 진입점과 모든 선택적 공급자 계열의 합계는 **원본 31 128바이트 / gzip 9 759바이트**, 약 **3.23% / 3.20%** 증가했습니다. 이는 기능 비용의 증가이며 크기 감소나 실행 속도 향상을 주장하는 것이 아닙니다. Xtream은 계속 필요할 때 로드됩니다. 진입점 밖으로 옮겨도 총합에서 빠지지는 않습니다.

측정은 둘 다 버전 1.1.55인 깨끗한 소스 아카이브 `bbf9ca7b`와 `cae971da`를 Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2, zlib 1.2.12로 비교합니다. 운영용 ES5 조립기, 최적화기, 이름 정책과 올바른 깨끗한 소스 식별 정보를 사용합니다. gzip 레벨 9는 출력되는 각 자산에 별도로 적용됩니다.

- 웹 진입점: 848 092 / 262 392 → 874 926 / 270 321 원본/gzip 바이트.
- 웹 진입점 + 모든 공급자: 964 459 / 305 344 → 995 587 / 315 103.
- 네이티브 진입점: 848 050 / 262 460 → 874 884 / 270 372.
- 네이티브 진입점 + 모든 공급자: 964 417 / 305 412 → 995 545 / 315 154.
- 선택적 M3U는 원본 184 / gzip 82바이트 증가하고, 새 Xtream은 4 110 / 1 748입니다. 다른 여섯 선택적 계열은 바이트 단위로 같습니다.

클립을 here.now로 옮기기 전, URL을 루트 기준 로컬 경로로 바꾸면서 이 과거 변경 순서에서 원본 JavaScript 1바이트가 추가되었습니다. 나중에 호스팅한 URL의 측정값은 아닙니다. 제한된 HLS 파싱 재시도 수정은 같은 스냅샷의 독립 비교에서 원본 37 / gzip 36바이트를 더합니다([근거](evidence/parse-recovery-size-20261015.json)). 네이티브 Auto 인계 소유권 수정은 원본 101 / gzip 39바이트를 더합니다([근거](evidence/auto-recovery-size-20261015.json)). 접근성 회귀 수정 전 원본 총량은 995 726바이트이며, 빌드 식별 정보와 gzip 바이트는 최종 커밋에서 달라질 수 있습니다. 정확히 전달된 리비전의 기준은 최종 `build/reports/classic-bundle.json`와 `npm run check:size`입니다. 포인터/대화상자 포커스 수정을 포함한 이후의 깨끗한 빌드 `652726f8`는 전체 웹 플레이어에서 **원본 995 858 / gzip 315 207바이트**입니다([최종 산출물 근거](evidence/roadmap-final-size-20261015.json)). 진입점은 875 197 / 270 425이고 네이티브 총량은 995 816 / 315 259입니다. 해당 스냅샷의 상한은 이전 네이티브/Node/릴리스 접미사 여유를 유지했습니다. 진입점은 원본 875 300 / gzip 271 600, 진입점 + 공급자는 996 100 / 316 400입니다.

<a id="post-beta-integration"></a>

## 베타 이후 통합

![beta.4 통합 이후 전체 JavaScript](diagrams/post-beta-size.svg)

후속 비교는 같은 Node 26.8.2, Rollup 4.64.5, Terser 5.51.2로 beta.4 소스 `39287792`를 Plex 통합과 손상된 설정 복구를 포함한 런타임 `9663b681`에 대비해 재현합니다.

- 웹 진입점: 848 315 / 262 443 → 879 533 / 271 761 원본/gzip 바이트.
- 웹 진입점 + 모든 공급자: 964 876 / 305 452 → 1 000 388 / 316 600.
- 네이티브 진입점 + 모든 공급자: 964 834 / 305 520 → 1 000 346 / 316 654.
- 전체 웹 페이로드 증가: **35 512 / 11 148바이트 (3.68% / 3.65%)**.

기준 버전은 공급자 계열 일곱 개, 통합 버전은 지연 로드되는 Xtream을 포함해 여덟 개를 셉니다. 해당 스냅샷의 진입점 상한은 879 900 / 273 000, 총량 상한은 1 000 800 / 317 800으로 네이티브, Node, 릴리스 식별 정보의 여유를 남겼습니다. 두 로컬 운영 빌드 모두 추적되는 런타임 파일 다섯 개를 다시 만들며 깨끗한 소스 리비전이라는 표시를 생략합니다. 이는 로컬에서 재현한 산출물이며 공개된 베타 바이너리가 아닙니다. 도구 버전, 해시와 이 제한은 [기준 근거](evidence/post-beta-baseline-size-20261015.json) 및 [통합 근거](evidence/post-beta-candidate-size-20261015.json)에 기록되어 있습니다. [구현 보고서](implementation-report.ko.md#post-beta-integration-and-review)가 수정과 검증을 설명합니다.

**범위:** 이 JavaScript 총량에는 외부 미디어 엔진, 언어 사전, CSS, 이미지, 동영상이 포함되지 않습니다. 과거 플레이어 패키지는 위 총량과 별도로 **464 652바이트 A/V 클립**도 포함했습니다. 현재 배포 방식은 해당 측정과 별개입니다.

- **저장소:** 재현성을 위해 `diagnostics/av-v1.mp4`를 생성기 및 검증기와 함께 보관합니다. 소스 파일을 보관한다고 패키지에 포함되는 것은 아닙니다.
- **패키지:** Web/OTTPlay Server, Tauri, Capacitor, Docker는 클립을 제외합니다. 이는 원본 미디어 자산 464 652바이트를 제거하는 것이며 압축 설치 프로그램이 측정상 464 652바이트 줄었다는 뜻은 아닙니다. 아카이브 형식과 다른 빌드 변경이 크기에 영향을 줍니다.
- **네트워크:** 사용자가 [A/V 검사](audio-video-check.ko.md)를 시작할 때만 here.now에서 클립을 가져옵니다. 검사는 인터넷이 필요하며 시작 재생을 위해 클립을 가져오지 않습니다.

위의 과거 JavaScript 측정은 그대로 유지됩니다. 호스팅 URL이 JavaScript나 현재 설치 프로그램에 미치는 영향을 측정하려면 새 비교가 필요합니다. 현지화된 README 88개는 저장소 문서이지 플레이어 페이로드가 아닙니다. 이 바이트 비교는 시작 시간, 프레임 속도, 메모리 또는 카탈로그 규모의 성능 주장을 뒷받침하지 않습니다. 대상 장치에서 별도 측정이 필요합니다.
