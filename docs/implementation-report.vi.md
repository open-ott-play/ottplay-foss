# Từ danh sách tính năng đến hành vi đã kiểm chứng

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Hợp đồng tính năng](roadmap-delivery.vi.md) · [Bằng chứng dung lượng](roadmap-size.vi.md)

Báo cáo này ghi lại quá trình triển khai và củng cố, không phải thông báo phát hành. Ảnh chụp mã trình phát được đo là `652726f8`; ảnh chụp Android gốc được biên dịch riêng là `be0d800`. CI, hợp nhất và nâng cấp giai đoạn phát hành vẫn là các cổng độc lập. Các commit sau đó chỉ sửa tài liệu hoặc kiểm thử không biến một phép kiểm tra cục bộ thành bằng chứng thiết bị đã cài đặt được cập nhật. Trạng thái bên dưới thuộc về các ảnh chụp lịch sử đó, không phải bảng theo dõi phát hành trực tiếp. Xem bản dựng đã công bố tại [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases).

![Quá trình triển khai và các cổng nghiệm thu](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## Công việc được kiểm tra như thế nào

Yêu cầu ban đầu được chia thành 13 phần tính năng có thể sử dụng trong trình phát cổ điển, dịch vụ điều khiển/CLI và ứng dụng Android gốc độc lập. Quyền phụ trách được phân theo thành phần để các thay đổi đồng thời có thể được rà soát và tích hợp mà không thay thế công việc của thành phần khác. Giao diện mới dùng lại nhãn đã dịch hoặc bổ sung mục danh mục ở cả 88 ngôn ngữ; hướng dẫn kỹ thuật đầy đủ ban đầu được viết bằng tiếng Anh và Nga. Tài liệu chính cùng các hướng dẫn tính năng song hành hiện có bản đầy đủ bằng [24 ngôn ngữ tài liệu](manual-translations.md).

Sau triển khai là rà soát chéo độc lập và kiểm thử hồi quy có thể thực thi. Mỗi vấn đề được báo cáo đều được đối chiếu với đường đi thực tế của callback, bộ giải mã, lưu trữ hoặc tiêu điểm trước khi sửa mã. Lỗi kiểm thử được phân biệt giữa hồi quy hành vi và bộ chọn lỗi thời. Ví dụ, đổi hàng cổ điển từ `button` sang `option` đòi hỏi cập nhật bộ chọn, không phải lý do giảm yêu cầu về hành vi nhấp chuột.

Các bản dựng sản xuất sạch sau đó kiểm tra sản phẩm ES5 đầu ra và toàn bộ chi phí JavaScript, gồm các mô-đun nhà cung cấp tùy chọn. Kiểm thử trình duyệt có mục tiêu dùng bộ tải, bundle và bộ chuyển đổi thiết bị được phân phối. Android gốc có lượt chạy riêng cho kiểm thử Gradle, lint và đóng gói. Các kiểm tra PR và luồng rà soát được kiểm tra lại sau khi đẩy mã; bản dựng cục bộ thành công không thay thế chúng.

<a id="what-changed-during-review"></a>

## Những thay đổi trong quá trình rà soát

![Năm hành vi đã sửa và chi phí JavaScript được đo](diagrams/implementation-results.svg)

- **Phân tích HLS và thử lại:** lỗi phân tích ban đầu dùng chung phân loại mạng tổng quát. Nay chúng được kết nối lại cùng URL tối đa một lần trong ngân sách hai lần thử cho lỗi tạm thời; bộ giải mã và URL dự phòng mới không đặt lại ngân sách. Lỗi xác thực/DRM kết thúc cũng hủy lần thử tạm thời đã xếp hàng.
- **Phương án dự phòng Auto gốc:** xử lý lỗi gốc có thể cho yêu cầu ngừng hoạt động trong khi Auto đã sở hữu một chuyển tiếp dự phòng. Chủ sở hữu hiện có nay giữ lại chuyển tiếp đó; thao tác hủy vẫn vô hiệu hóa callback trì hoãn.
- **Enter trong hộp thoại:** tự động đặt tiêu điểm vào nút Hủy đầu tiên khiến Enter trong hộp chờ Plex thành thao tác hủy. Hộp thoại nay bắt đầu với tiêu điểm trên chính hộp thoại. Tab chủ động đi đến các nút; hộp thông tin và xác nhận thông thường giữ hành vi Enter và Escape/Quay lại.
- **Chọn bằng con trỏ trên PC:** tiêu điểm chuột đổi lựa chọn trước trình xử lý nhấp, biến lần nhấp đầu thành kích hoạt. Tiêu điểm do con trỏ tạo ra không còn chọn trước hàng. PC vẫn chọn rồi mới kích hoạt; LG giữ hành vi một lần nhấp. Tiêu điểm bàn phím vẫn theo lựa chọn.
- **Rãnh Android:** lựa chọn không nhãn của mục hiện tại có thể bị xóa bởi xác nhận Auto của chính nó hoặc thay đổi tùy chọn phụ đề, hay rò sang mục khác có `TrackGroup` bằng nhau. Nay nó chỉ tồn tại qua các lần ghi trì hoãn cho mục hiện tại. Tùy chọn ngữ nghĩa dùng ngôn ngữ/vai trò/nhãn; ViewModel phụ trách lưu bền nên đóng bảng không hủy ghi.

13 phần đã giao gồm: mẫu A/V; thiết lập Local/Home có thể tiếp tục; khôi phục có giới hạn; trần chất lượng; tùy chọn rãnh Android; khóa điều khiển theo phạm vi; liên kết XMLTV; phim/phim bộ Xtream; khả năng tiếp cận cổ điển; kết quả lệnh bền vững; bàn giao tường minh; luồng dự phòng; lô cài đặt có thể khôi phục. [Hướng dẫn tính năng](roadmap-delivery.vi.md) xác định phạm vi và giới hạn từng phần.

<a id="evidence-and-remaining-gates"></a>

## Bằng chứng và các cổng còn lại

Với `652726f8`, năm kịch bản trình duyệt có mục tiêu đều đạt: điều hướng con trỏ LG webOS, điều hướng con trỏ LG NetCast, hai lần nhấp trên PC, ngữ nghĩa bàn phím hộp thoại và bộ sưu tập/phân giải/hủy/thử lại Plex. TypeScript, fixture đơn vị về tiếp cận, lint giới hạn phạm vi, ES5 và kiểm tra ngân sách bundle đều đạt. Toàn bộ lượt chạy trình duyệt trên bản dựng này kết thúc với **194 đạt và một bỏ qua**: HLS gốc cần WebKit nhưng lượt này dùng Chromium. CI được lưu trữ và thứ tự hợp nhất đã thống nhất vẫn là các cổng riêng.

Chuỗi `test:port` và `test:unified` còn lại hoàn thành theo các đoạn tiếp tục sau khi sửa fixture riêng lẻ. Mọi mục tiêu từng thất bại được chạy lại thành công và các lệnh còn lại cũng thành công; đây không phải tuyên bố có một lượt `npm test` liên tục. Bước CI cầu nối Android chính xác gồm chín lệnh cũng đạt cục bộ.

Với Android `be0d800`, **101 kiểm thử ứng dụng và 62 kiểm thử lõi dùng chung** đạt cục bộ, cùng lint debug/release, tạo APK Debug/Release/Full, bundle phát hành và biên dịch APK androidTest. Biên dịch APK kiểm thử có đo đạc không phải thực thi trên thiết bị. Ba phát hiện rà soát đã xác nhận được trả lời và giải quyết trong [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68). PR đó đạt kiểm tra và được hợp nhất thành `5b644b94`; CI sau hợp nhất được theo dõi riêng. Sơ đồ vẫn để cổng CI/phát hành tổng thể của trình phát ở trạng thái chờ.

Tổng JavaScript web đầy đủ đổi từ **964,459 / 305,344** byte thô/gzip thành **995,858 / 315,207**: **+31,399 / +9,863 byte** (khoảng 3.26% / 3.23%). Ứng viên tính năng là 995,587 / 315,103; củng cố sau đó thêm 271 / 104. Điểm vào chính cuối cùng của ảnh chụp đó là 875,197 / 270,425. Xem [phép đo cơ sở](evidence/roadmap-size-20261015.json), [phép đo sản phẩm cuối](evidence/roadmap-final-size-20261015.json) và [phương pháp đo](roadmap-size.vi.md). Dấu phẩy trong các số byte này phân cách hàng nghìn.

Đó là chi phí byte JavaScript lịch sử, **không phải cải thiện tốc độ đã đo**. Tổng không gồm máy đa phương tiện, từ điển, CSS, ảnh và video. Gói trình phát của ảnh chụp đó mang riêng clip A/V 464,652 byte. Sau [thay đổi nơi lưu trữ](audio-video-check.vi.md), `diagnostics/av-v1.mp4` còn trong kho với bộ tạo và bộ xác minh để tái lập, nhưng bị loại khỏi gói Web/OTTPlay Server, Tauri, Capacitor và Docker. Trình phát chỉ tải từ here.now cho phép kiểm tra A/V tường minh cần internet; khởi động phát không tải nó. Loại 464,652 byte đa phương tiện thô không xác lập mức tiết kiệm trong bộ cài nén hay thay đổi phép đo JavaScript lịch sử. Thời gian khởi động, độ đều khung hình, bộ nhớ, trải nghiệm trình đọc màn hình, âm thanh HDMI thật và hành vi nhà cung cấp cần phép đo riêng trên thiết bị đích. Báo cáo không khẳng định kết quả thiết bị thật mới hay phát hành beta. [Danh sách nghiệm thu vật lý](roadmap-delivery.vi.md#physical-acceptance-before-promotion) và [chiến lược phát hành](../RELEASING.md) vẫn là tiêu chí nâng giai đoạn.

<a id="post-beta-integration-and-review"></a>

## Tích hợp và rà soát sau beta

Sau khi công bố beta.4, nguồn `39287792` được tích hợp vào nhánh này. Bản sửa runtime `9663b681` cũng sửa việc trở lại mép trực tiếp dưới giới hạn chất lượng HLS và cho phép khôi phục nhật ký cài đặt hỏng trước khi khởi động bình thường. Màn hình khôi phục chặn nạp một phần trạng thái tài khoản, hỗ trợ thử lại và đặt lại có xác nhận, giữ cookie không liên quan và ngăn cài đặt cookie cũ quay lại sau đặt lại. Xem [quy trình khôi phục](settings-recovery.vi.md) và sơ đồ SVG của nó.

![So sánh JavaScript đầy đủ sau beta](diagrams/post-beta-size.svg)

Tái lập cả hai nguồn với Node 26.8.2, Rollup 4.64.5 và Terser 5.51.2 cho **964,876 / 305,452** byte thô/gzip đối với nguồn beta.4 và **1,000,388 / 316,600** đối với tích hợp: **+35,512 / +11,148 byte** (3.68% / 3.65%). Tổng gồm mọi nhà cung cấp tùy chọn: bảy trong cơ sở và tám trong tích hợp. Điểm vào mới là 879,533 / 271,761. Đây là phép so sánh tách biệt với các đồ thị cũ đã cố định phía trên.

Cả hai bản dựng sản xuất cục bộ tái tạo năm tệp runtime được theo dõi và bỏ tuyên bố về phiên bản nguồn sạch. Các báo cáo ghi giới hạn này thay vì coi tệp cục bộ là sản phẩm phát hành đã công bố: [cơ sở](evidence/post-beta-baseline-size-20261015.json) và [tích hợp](evidence/post-beta-candidate-size-20261015.json). Bản dựng tích hợp và kiểm tra ES5/gốc đạt. Sáu kiểm tra trình duyệt có mục tiêu cũng đạt: khôi phục/đặt lại nhật ký, bàn phím hộp thoại, con trỏ LG webOS và NetCast, chọn bằng hai lần nhấp PC, và chờ Plex có chủ sở hữu.

<a id="browser-gate-integration"></a>

## Tích hợp cổng trình duyệt

![Kết quả xác minh trình duyệt cục bộ đã xác nhận](diagrams/browser-verification-results.svg)

Nguồn `c52f4d07` tích hợp PR 779 từ main `1ecbc0e7`. Lệnh kiểm thử, kiểm tra khôi phục và khẳng định hộp thoại Plex của cả hai nhánh được giữ lại. TypeScript, lint, tài liệu, hợp đồng đóng gói/liên kết, bản dựng sản xuất và kiểm tra đầy đủ bundle biên dịch đều đạt. Toàn bộ 27 tệp JavaScript trình phát/nhà cung cấp đầu ra vẫn giống từng byte với sản phẩm đã đo ở trên. Bộ kiểm thử thiết bị-trình duyệt đầy đủ trên bản dựng đó kết thúc với **196 đạt và một trường hợp Chromium bỏ qua theo dự kiến** cho HLS gốc cần WebKit.

Gói lưu trữ Mode A chính xác chỉ được giải nén sau khi kiểm tra nguồn, checksum và danh sách bundle/nhà cung cấp. Chromium 156.0.8078.4, Firefox 157.0 và WebKit 27.2 mỗi loại đạt cả năm kịch bản hồ sơ mà không bỏ qua hay thử lại: **15 lần đạt cục bộ** với Playwright 1.64.0. Máy chủ thật chạy macOS 26.7.1, không phải runner `macos-15` ghi trong hồ sơ đã chọn. Biên nhận ghi rõ khác biệt này và **không phải chứng nhận ma trận được lưu trữ hay chứng nhận phát hành**. Xem [tóm tắt cục bộ](evidence/post779-local-acceptance/summary.json) và [công thức tái lập](evidence/post779-local-acceptance/reproduce.sh), vốn yêu cầu bản dựng sản xuất sẵn có và từ chối thay thế thư mục ứng viên đã giải nén.

[Chính sách trình duyệt](browser-compatibility.vi.md) yêu cầu năm mục tiêu được lưu trữ và 25 lần thực thi kịch bản cho PR/beta; RC đầy đủ có 35 mục tiêu và 166 lần thực thi. Đây là yêu cầu được cấu hình, không phải độ bao phủ đã đo.

![Cách xác minh ứng viên tạo bằng chứng](diagrams/candidate-verification-flow.svg)

[Pipeline beta](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467) riêng cho main `1ecbc0e7` đã hoàn tất thành công. Nó không gồm PR này. Tích hợp vẫn cần CI được lưu trữ và rà soát thành công của riêng mình, rồi phối hợp phát hành; các kết quả cục bộ trên không khẳng định đã vượt qua các cổng bàn giao đó.

<a id="delivery"></a>

## Bàn giao

- [Trình phát, tài liệu và i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781).
- [Máy chủ điều khiển và CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106).
- [Tùy chọn rãnh Android — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68).

Các PR này mang trạng thái CI và hợp nhất hiện tại. Thay đổi trình phát theo sau những sửa lỗi Plex hiện hành đã thống nhất và bản beta của chúng thành một đợt bàn giao riêng.
