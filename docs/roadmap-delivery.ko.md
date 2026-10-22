# 신뢰성과 미디어 기능 개선

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.ko.md) · [아키텍처](architecture.md)

이 안내서는 이 페이지에 해당하는 소스 리비전의 구현을 설명하며, 이전에 설치한 릴리스의 기능을 뜻하지 않습니다. 플레이어, 제어 서비스/CLI, 네이티브 Android 앱은 별도 결과물입니다. 하나를 업데이트해도 다른 결과물은 업데이트되지 않습니다.

![책임과 신뢰 경계](diagrams/roadmap-components.svg)

[측정된 바이트 비용과 비교 차트](roadmap-size.ko.md)를 참조하세요. 실행 속도와 장치 재생은 별도의 인수 검사 항목입니다.

<a id="what-is-implemented"></a>

## 구현된 기능

1. **검증 대상이 알려진 오디오/비디오 샘플.** [정보 → 오디오](audio-video-check.ko.md)는 좌우 음과 일치하는 섬광이 있는 8초 클립을 here.now에서 재생합니다(인터넷 필요). **재생**을 누른 뒤에만 가져오며 시작 시에는 가져오지 않습니다. 미디어 파일은 플레이어 패키지에 포함되지 않습니다. 유휴 상태나 실시간 TV 시청 중에만 주 HTML5 디코더를 잠시 사용하며 시청 기록을 쓰지 않습니다. [샘플 규격](../diagnostics/README.md).
2. **재개 가능한 Local/Home 설정.** 제어 CLI는 프리셋을 계획, 적용, 재개, 검증할 수 있습니다. 결과가 불확실한 쓰기를 재시도하기 전에 저장된 설정을 비교합니다. [제어 작업 흐름](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **횟수가 제한된 재생 복구.** HLS/Shaka의 일시적 오류는 유한한 복구 정책을 공유합니다. 인증 오류와 미지원 DRM은 종료 조건입니다. Stop, 채널 변경, 소스 교체는 오래된 작업을 취소합니다.
4. **저장되는 품질 제한.** 최대 높이와 비트레이트가 적응형 선택을 제한합니다. 네이티브 재생으로 전환해 활성 상한을 몰래 우회해서는 안 됩니다.
5. **네이티브 Android 트랙 환경설정.** 독립 Android 앱은 다른 스트림의 트랙 인덱스를 이어 쓰는 대신 Auto와 자막 Off를 포함한 언어/역할/레이블 의도를 기억합니다.
6. **범위가 제한된 명령 운영자.** 컨트롤러는 관리자 자격 증명을 넘기지 않고 특정 장치/작업만 허용하는 자격 증명을 부여할 수 있습니다.
7. **명시적 XMLTV 연결.** 재생목록 범위의 채널을 특정 피드와 XMLTV ID에 연결할 수 있습니다. [편성표 연결과 접근성](guide-binding-accessibility.ko.md).
8. **Xtream 영화와 시리즈.** 미디어 라이브러리는 선택한 카탈로그를 필요할 때 가져온 뒤 시리즈의 에피소드를 가져옵니다. [라이브러리 계약](xtream-media.ko.md).
9. **접근성 있는 클래식 제어.** 채널 목록은 선택 의미를 노출하고, 모달 대화상자는 키보드 포커스를 유지하고 복원하며, 알림에는 라이브 영역이 있습니다.
10. **지속되는 명령 결과.** 선택적인 크기 제한 컨트롤러 저널이 중복 제거 및 결과 메타데이터를 보관합니다. 재시작은 명령을 무작정 재실행하지 않습니다.
11. **명시적 장치 인계.** 실시간/보관 참조를 동일한 소스가 설정된 플레이어로 전달합니다. 대상이 자체 URL을 해석합니다. [계약](remote-handoff.ko.md).
12. **명시적 예비 스트림.** 실시간 채널은 같은 유한 복구 정책 안에서 구성된 대체 스트림을 사용할 수 있습니다. [제한, 복구, 예비 스트림](playback-stream-policy.ko.md).
13. **복구 가능한 설정 묶음.** 네이티브 localStorage는 지원되는 여러 키 쓰기에 실행 취소 저널을 사용합니다. [저장 보장](settings-recovery.ko.md).

<a id="language-and-compatibility-coverage"></a>

## 언어 및 호환성 범위

플레이어에는 88개 번역 카탈로그가 포함됩니다. 새 품질/미디어 레이블 7개는 모든 카탈로그에 번역되어 있으며 다른 새 메뉴는 기존 번역 레이블을 재사용합니다. 카탈로그 검사는 키 일치, 자리표시자, 검토된 예외를 확인합니다. 관련 기술 안내서는 같은 구현 제한을 [24개 문서 언어](manual-translations.md)로 설명합니다. [현지화된 시작 페이지](readme/README.md)는 빠른 시작 안내서이며 과거의 모든 기술 문서에 88개 완역이 있다는 주장이 아닙니다.

클래식 출력은 ES5 구문을 유지합니다. 모든 장치가 모든 코덱, Web API, 저장 보장 또는 네이티브 통합을 지원한다는 뜻은 아닙니다. A/V 미리 보기는 관리되는 주 HTML5 경로로 제한되며 PC2/Video.js 및 네이티브 엔진 같은 장치 엔진 대체는 제외됩니다. 명시적 편성표 연결은 호스팅 또는 네이티브 XMLTV 구현을 사용하며 선택적인 외부 companion 프로토콜은 지원하지 않을 수 있습니다. 장치별 인수 검사에는 여전히 실제 장치가 필요합니다.

<a id="reproduce-the-checks"></a>

## 검사 재현

```sh
npm ci
npm run typecheck
npm run test:localization
npm test
npm run build:server
npm run check:es5
npm run check:size
python3 scripts/check-av-diagnostic.py diagnostics/av-v1.mp4
```

미디어 검증기에는 FFmpeg/FFprobe가 필요합니다. 두 오디오 채널을 디코딩하고 에너지, 분리, 무음을 검사합니다. AAC 트랙이 있다는 사실만으로 들리는 콘텐츠를 입증하지는 못합니다. 일반 JavaScript 테스트는 취소, 쓰기 실패, 재시작 복구, 소스 변경, 잘못된 입력을 검증합니다. 최종 번들 검사에는 주 진입점뿐 아니라 선택적 공급자 제품군도 포함됩니다.

컨트롤러에서 `go test -race ./...`, `go vet ./...`, `python3 -m unittest discover -s tests`를 실행하세요. 네이티브 Android에서 트랙 환경설정 및 설정 백업 단위 테스트를 실행하고 디버그 APK를 조립하세요. 각 저장소의 CI는 해당 커밋에만 유효하며 나중에 변경된 트리에는 적용되지 않습니다.

<a id="physical-acceptance-before-promotion"></a>

## 승격 전 실제 장치 인수 검사

- 대상 TV에서 A/V 검사를 실행하고 좌우 오디오, 보이는 섬광, Stop, 실시간 TV 복귀를 확인하세요. 디코더 테스트가 HDMI 소리나 부드러움을 입증하지는 못합니다.
- 허용/거부된 스트림, 실패한 예비 스트림, 재시도 대기 중 채널 변경을 시험하세요. 실제 백엔드에서 선택한 품질 제한을 확인하세요.
- 키보드, 리모컨, 사용 가능한 화면 읽기 프로그램으로 목록/대화상자 포커스를 시험하세요.
- 비슷한 두 채널 이름을 서로 다른 XMLTV ID에 연결하고 프로그램 데이터를 확인하세요.
- 테스트 프리셋 적용을 중단한 다음 컨트롤러를 재시작하고 재개하여 검증하세요. 일치하거나 일치하지 않게 설정된 소스 모두에 인계하세요.
- 네이티브 Android에서 트랙 순서가 다른 스트림으로 전환하고 앱을 재시작하여 명시적 Auto/Off 및 기본 언어 동작을 확인하세요.

성공적인 전송, 저장된 설정, 디코딩된 샘플, 통과한 단위 테스트는 서로 다른 증거입니다. 릴리스 승격에서는 이를 구분해야 합니다. [릴리스 전략](../RELEASING.md)을 참조하세요.
