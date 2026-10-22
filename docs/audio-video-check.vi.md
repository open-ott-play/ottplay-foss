# Kiểm tra âm thanh và hình ảnh thủ công

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Khôi phục luồng](playback-stream-policy.vi.md) · [Đặc tả mẫu](../diagnostics/README.md)

Dùng **menu trình phát → Thông tin → Âm thanh → Phát** để kiểm tra hình và tiếng bằng đoạn phim tám giây đã biết. Đây là kiểm tra A/V có âm thanh; phần trình diễn mẫu chuyển động khi giới thiệu ứng dụng không có tiếng.

![Kiểm tra A/V: nguồn trong kho, đoạn phim được lưu trữ và phát theo yêu cầu rõ ràng](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## Bắt đầu kiểm tra

1. Đặt TV, loa hoặc tai nghe ở âm lượng dễ chịu. Kiểm tra dùng âm lượng hiện tại của trình phát và tạm bật tiếng video; nó không tăng âm lượng hệ thống của TV.
2. Mở menu trình phát, chọn **Thông tin**, rồi **Âm thanh**, rồi **Phát**. Chỉ mở menu không tải xuống hoặc phát đoạn phim.
3. Quan sát màn hình và nghe trình tự dưới đây. Để kết thúc sớm, dùng **Thông tin → Âm thanh → Dừng**.

Kiểm tra dùng đường phát HTML5 lõi được quản lý khi trình phát nhàn rỗi, hoặc khi TV trực tiếp đang phát hay tạm dừng. Nó từ chối yêu cầu VOD/lưu trữ đang hoạt động, yêu cầu trực tiếp vẫn đang tải và chế độ chờ. Nó cũng không có sẵn khi bộ thích ứng thiết bị thay thế bộ máy lõi, gồm **PC2/Video.js** và bộ máy gốc thay thế; chỉ sử dụng phần tử video HTML5 không làm bộ thích ứng đủ điều kiện. Từ chối không thay thế phiên phát hiện có. Hãy dừng yêu cầu hiện tại trước nếu muốn kiểm tra từ trạng thái nhàn rỗi; việc này không bật kiểm tra trên các bộ thích ứng đó. Nhãn menu theo ngôn ngữ giao diện đã chọn.

<a id="what-you-should-see-and-hear"></a>

## Những gì cần thấy và nghe

Nền là mẫu kiểm tra chuyển động. Dấu trắng ngắn nhấp nháy ở nửa trên bên trái hoặc phải, đồng bộ với xung âm nhẹ kéo dài khoảng 150 ms:

- **0–2 giây:** mỗi giây có xung 440 Hz ở kênh trái, cùng dấu trái nhấp nháy.
- **2–4 giây:** xung 880 Hz ở kênh phải, cùng dấu phải.
- **4–6 giây:** cả hai kênh phát xung, cùng cả hai dấu.
- **6–8 giây:** mẫu tiếp tục chuyển động không có tiếng. Khoảng lặng này là chủ ý.

TV mono hoặc trộn giảm kênh có thể phát cả hai kênh qua một loa. Hãy tự kiểm tra màn hình vật lý và đầu ra âm thanh. Trình phát không đo đầu ra loa và không đưa ra kết luận A/V đạt/không đạt tự động.

<a id="where-the-clip-comes-from"></a>

## Nguồn đoạn phim

Trình phát dùng địa chỉ HTTPS tuyệt đối này:

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

Nó chỉ yêu cầu đoạn phim khi chọn **Phát**, không bao giờ tải trước lúc khởi động. Tệp có **464 652 byte**, video H.264 baseline 640×360 / 25 fps và âm thanh AAC stereo. Tệp bị loại khỏi các gói Web, OTTPlay Server, Tauri, Capacitor và container. [Tệp nguồn](../diagnostics/av-v1.mp4), trình tạo và trình xác minh vẫn nằm trong kho; chúng không phải phương án dự phòng ngoại tuyến trong trình phát đã cài.

Cần Internet và kết nối HTTPS hoạt động tới máy chủ đó. Không có bản dự phòng đi kèm hoặc URL chẩn đoán thay thế. Mở liên kết trên trong trình duyệt giúp kiểm tra tệp có sẵn, nhưng không kiểm tra quyền sở hữu bộ giải mã của trình phát hay hành vi trở lại kênh. Dịch vụ lưu trữ nhận thông tin kết nối thông thường; xem [chi tiết quyền riêng tư](privacy-policy.md#optional-hosted-audio-video-check).

<a id="how-playback-returns"></a>

## Cách trở lại phiên phát

Kiểm tra dùng bộ giải mã chính, tạm thay hình ảnh trực tiếp. Nó kết thúc khi hết đoạn phim, sau **Âm thanh → Dừng**, hoặc khi có lỗi phương tiện. **Thời hạn an toàn 15 giây bắt đầu khi kiểm tra được chấp nhận** và bao gồm cả tải; vì thế tải chậm có thể kết thúc trước khi phát đủ tám giây.

Trong các trường hợp này, trình phát thử khôi phục yêu cầu trực tiếp đã lưu tại mép trực tiếp hiện tại, kể cả trạng thái tạm dừng, chỉ khi yêu cầu vẫn thuộc nguồn hiện tại và chưa bị phiên phát khác thay thế. URL trực tiếp được phân giải lại; khôi phục vẫn phụ thuộc nhà cung cấp và mạng. Kiểm tra từ trạng thái nhàn rỗi trở về nhàn rỗi.

Lệnh phát thông thường **Stop**, chế độ chờ hoặc chọn kênh khác hủy kiểm tra mà không khởi động lại kênh đã lưu. Thay đổi nguồn hoặc phiên của nguồn cũng ngăn khôi phục lỗi thời. Khi thoát, kiểm tra hoàn tác việc tạm bật tiếng của nó; nếu bạn tắt tiếng trong lúc chạy thì trạng thái tắt tiếng vẫn còn hiệu lực. Nó không đổi tùy chọn bộ máy đã lưu, ghi giây thử nghiệm vào lịch sử kênh, hay công bố việc kết thúc kênh giả hoặc siêu dữ liệu thử nghiệm cho hệ điều hành.

<a id="if-the-result-is-unexpected"></a>

## Nếu kết quả không như mong đợi

- **Không thể bắt đầu kiểm tra:** xác nhận trình phát đang nhàn rỗi hoặc ở kênh trực tiếp đã phát/tạm dừng qua đường HTML5 lõi được quản lý, không có bộ máy thiết bị thay thế. Trạng thái không được hỗ trợ hoặc lỗi phương tiện có thể hiện **“Stream could not be played”**.
- **Không tải được gì hoặc kiểm tra đóng sớm:** kiểm tra Internet và liên kết HTTPS trực tiếp. Lỗi mạng hoặc hết hạn không chứng minh bộ giải mã hay loa hỏng. Khôi phục kết nối trước khi chọn Phát lại.
- **Có hình nhưng không tiếng:** hai giây cuối cố ý im lặng. Trong sáu giây đầu, kiểm tra tắt tiếng/âm lượng trình phát, âm lượng TV, đầu ra âm thanh đã chọn và kết nối loa/tai nghe.
- **Chỉ một loa vật lý phát:** trước tiên kiểm tra TV có dùng đầu ra mono hay trộn giảm kênh không, rồi mới xem đó là lỗi định tuyến kênh.

Đây là kiểm tra ngắn một MP4 đã biết qua đường hình/tiếng HTML5 lõi được quản lý. Nó không xác nhận luồng nhà cung cấp, HLS/DASH, DRM, âm thanh đa kênh hay độ phân giải cao hơn sẽ hoạt động, và không đo dung lượng mạng hoặc độ trễ đồng bộ. Trần chất lượng và thiết lập luồng dự phòng trực tiếp không thay đổi đoạn phim chẩn đoán này.

Quyền sở hữu và dọn dẹp được kiểm thử trong [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) và [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs). Kiểm tra giải mã và vòng đời tự động không thay thế việc nhìn và nghe trên thiết bị thật; hướng dẫn này không tuyên bố kết quả mới trên thiết bị vật lý.
