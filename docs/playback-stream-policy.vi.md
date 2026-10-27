# Giới hạn chất lượng và khôi phục luồng trực tiếp

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Quyền sở hữu bộ giải mã](device-media-backend.md)

Trình phát HTML5/HLS/Shaka được quản lý giữ một quyền phát duy nhất khi khôi phục từ nguồn bị lỗi. Nó cũng có thể dùng tối đa ba URL dự phòng được cấu hình rõ ràng cho một kênh trực tiếp. Nó không bao giờ tự tìm, đoán hoặc thay thế kênh theo tên.

![Khôi phục: một quyền phát, số lần thử hữu hạn và nguồn dự phòng rõ ràng](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## Đặt trần chất lượng

Mở **Cài đặt → Cài đặt giao diện** và đặt **Chiều cao video tối đa (HLS/Shaka)** và/hoặc **Bitrate luồng tối đa (HLS/Shaka)**. Hai ràng buộc áp dụng đồng thời. **Tự động** bỏ ràng buộc tương ứng. Các lựa chọn được hỗ trợ là 360/480/720/1080/2160 pixel và 1/2/4/8/16 Mbps. Thiết lập được lưu cục bộ, dùng quy trình lưu/hủy thông thường và có hiệu lực ở lần bắt đầu phát tiếp theo, kể cả khởi động lại để khôi phục.

Đây là trần, không phải thiết lập chuyển mã. Luồng chỉ có 1080p không thể thành 720p. Nếu không có biến thể được công bố nào phù hợp, trình phát báo **No stream meets the quality limits** và ngừng thử lại yêu cầu. Chiều cao/bitrate không biết không chứng minh biến thể HLS đáp ứng giới hạn.

Lọc biến thể HLS diễn ra trước khi tải phân đoạn. hls.js hiện tại loại bỏ biến thể không đủ điều kiện; bản cũ không có `removeLevel` chỉ giữ được phần đầu liên tiếp an toàn và có thể từ chối manifest dù các biến thể phía sau đủ điều kiện. Shaka dùng ràng buộc ứng dụng `maxHeight`/`maxBandwidth`. Thích ứng tự động tiếp tục giữa các biến thể còn lại.

Thiết lập này áp dụng cho các bộ máy HLS và Shaka được quản lý. HTML5 thuần, bộ giải mã gốc của nền tảng và bộ máy TV/STB giữ lại không cung cấp cùng điều khiển. Auto có thể chọn phát gốc; thiết lập không ép nó sang MSE. Trình phát không chuyển một yêu cầu HLS đã bị giới hạn sang phát gốc không giới hạn chỉ để tránh lỗi giải mã. Không hàm ý bộ chuyển mã gốc, đo hiệu năng phần cứng tự động hay đầu ra vật lý 720p.

<a id="configure-explicit-backups"></a>

## Cấu hình dự phòng rõ ràng

1. Bắt đầu kênh trực tiếp mong muốn.
2. Mở **Thông tin → Luồng dự phòng**.
3. Chọn ô 1, 2 hoặc 3 và nhập URL phương tiện HTTP/HTTPS đầy đủ.
4. Mở lại ô đã có để **Sửa** hoặc **Xóa**. Bắt đầu lại kênh để dùng danh sách mới.

Mỗi ô thuộc không gian lưu trữ hiện tại của nhà cung cấp và đúng cặp `sourceId`/`channelId`. Thế hệ phát và cấu hình nguồn hiện tại giới hạn trình sửa. Đổi nguồn khi hộp thoại đang mở ngăn hộp thoại đó lưu vào nguồn thay thế. Thay đổi đồng thời ở cùng ô bị từ chối thay vì bị ghi đè.

URL đầu vẫn là nguồn thông thường của kênh. Ô trùng và rỗng bị bỏ qua. Chấp nhận tối đa 256 bản ghi kênh và 256 KiB cấu hình. Từ chối URL có thông tin xác thực trong user-info, khoảng trắng, ký tự điều khiển, dấu gạch chéo ngược hoặc cổng không hợp lệ. Token truy vấn do nhà cung cấp cấp vẫn có thể nằm trong URL phương tiện: thiết lập dự phòng là cấu hình nguồn cục bộ, không phải cơ chế chia sẻ hoặc công khai thông tin xác thực.

Dự phòng **chỉ dành cho trực tiếp**. Yêu cầu lưu trữ và VOD không bao giờ dùng nguồn trực tiếp thay thế: bản ghi, mốc thời gian, quyền và ngữ nghĩa tua có thể khác. Chủ sở hữu phải cung cấp điểm cuối trực tiếp tương đương và được phép. Tên kênh giống nhau không chứng minh tương đương. Danh tính kênh đã lưu, yêu thích và liên kết EPG không đổi khi điểm cuối truyền tải thay đổi.

<a id="recovery-guarantees"></a>

## Bảo đảm khôi phục

- Yêu cầu có tối đa **hai lần thử lại tạm thời có trì hoãn trên cùng URL trong toàn bộ quá trình**, và tối đa một lần tiến tới mỗi trong ba ô dự phòng: không quá năm lần tạo lại sau lần bắt đầu ban đầu. Thể hiện bộ giải mã mới hoặc manifest thành công không đặt lại ngân sách. Khôi phục mạng và giải mã HLS có giới hạn sẵn có trong bộ máy chạy trước chính sách bên ngoài này.
- Lỗi phân tích manifest/cấp HLS cho phép tối đa một lần kết nối lại cùng URL cho mỗi yêu cầu, tính trong cùng tổng hai lần thử. Bộ giải mã hoặc điểm dự phòng mới không đặt lại giới hạn.
- Lỗi mạng không có trạng thái, HTTP 408/429 và 5xx có thể dùng ngân sách tạm thời. HTTP 4xx khác có thể chuyển sang nguồn thay thế đã cấu hình nhưng không thử lại cùng URL. **HTTP 401/403 và lỗi đăng nhập nguồn kết thúc yêu cầu**, không thử thông tin xác thực khác hoặc điểm cuối dự phòng.
- Lỗi giải mã có thể tiến đến nguồn dự phòng rõ ràng. Giới hạn chất lượng không thể đáp ứng kết thúc yêu cầu. Không có vòng quay về nguồn chính.
- Độ trễ là 500 ms, 1 s, 1.5 s, rồi tối đa 2 s. Callback lặp lại được gộp.
- Pause bỏ bộ hẹn giờ đã lên lịch nhưng giữ lần thử lại đang chờ; Resume lên lịch lại. Stop, chế độ chờ, thay nguồn và thay kênh vô hiệu hóa callback trì hoãn. Yêu cầu thất bại cuối cùng cần chọn lại rõ ràng, không tự phát bộ giải mã đã ngừng sử dụng.
- Lỗi tải Shaka và sự kiện lỗi nghiêm trọng dùng chung đường này; lỗi hủy được bỏ qua. Gắn lại chờ Shaka hủy bất đồng bộ xong.
- Khôi phục phân giải lại tham chiếu Stalker mờ và chuẩn bị lại truy cập nguồn được bảo vệ. Nó không dùng lại URL loopback iOS đã hết hạn. Vị trí VOD/lưu trữ được lấy trước khi tháo; nguồn dự phòng trực tiếp bắt đầu ở mép trực tiếp của mình.

Khôi phục tùy chọn dựa trên đồng hồ media của luồng trực tiếp được mô tả bên dưới. Các cơ chế khôi phục kiosk, Auto/native và HLS hiện có giữ nguyên phạm vi và hành vi của bộ máy phát.

<a id="verification-and-observability"></a>

## Xác minh và khả năng quan sát

`window.__ottStreamPolicy.snapshot()` cung cấp tên bộ máy, giới hạn yêu cầu, khả năng/tính sẵn có, số lần thử, chỉ số điểm cuối và trạng thái khôi phục. Nó không chứa URL luồng hay thông tin xác thực nhà cung cấp. Chỉ số không là nguồn thường; chỉ số sau chỉ các lựa chọn thay thế duy nhất không rỗng. Đây là trạng thái chẩn đoán, không phải API điều khiển từ xa ổn định.

Chạy:

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

Kiểm thử bao gồm lọc chất lượng với thứ tự biến thể không đơn điệu, siêu dữ liệu không có, sửa trong phạm vi nguồn, xung đột ô, lỗi trùng, ngân sách giới hạn, lỗi cấp quyền HTTP, hủy bằng pause/stop/nguồn, tháo Shaka và giữ vị trí VOD. Năm nhãn phát mới được dịch trong cả 88 gói ngôn ngữ đi kèm; kiểm tra tương đương tự động không phải duyệt bởi người bản ngữ. Phát vật lý TV/D1 và manifest riêng của nhà cung cấp vẫn cần xác minh trên thiết bị. [Nguồn sơ đồ có thể sửa](diagrams/stream-recovery.mmd).

<a id="live-stall-recovery"></a>

## Khôi phục luồng trực tiếp bị dừng tiến triển

Trong **Cài đặt → Cài đặt giao diện**, chọn **Số lần thử khôi phục trực tiếp** (0–5) và **Thời gian chờ khi luồng trực tiếp bị kẹt, giây** (10/15/20/30). Giá trị mặc định là 0 lần thử và 15 giây. Số 0 chỉ tắt bộ giám sát này; cơ chế khôi phục lỗi của bộ máy phát hiện có không thay đổi. Cài đặt sử dụng quy trình Lưu/Hủy thông thường.

Sau khi xác nhận việc phát đã tiến triển, nếu đồng hồ media của luồng trực tiếp chính ngừng tiến lên, cơ chế sẽ gọi `backend.restart()` hiện có. Tạm dừng, tua tìm vị trí, trang bị ẩn, trạng thái ngoại tuyến và kiosk sẽ tạm ngừng theo dõi; nội dung lưu trữ, VOD và nhánh PiP được loại trừ. PiP gốc ẩn OSD HTML. Thay đổi kênh, nguồn hoặc thế hệ sẽ hủy phiên theo dõi cũ. Lần phát ban đầu chưa từng tiến triển vẫn do cơ chế xử lý khởi động/lỗi hiện có quản lý. Thay bộ giải mã và tiến triển ngắn không làm mới số lần thử: mười giây tiến triển liên tục mới làm điều đó. Khi hết giới hạn, bộ giám sát không khởi động lại thêm cho lần bị kẹt đó. Khôi phục đang chờ của bộ máy phát được ưu tiên; không thể bỏ qua lỗi kết thúc về cấp quyền, DRM hoặc chất lượng. Cơ chế theo dõi thời gian media, không phải hình ảnh hiển thị vật lý hay khung hình bị đóng băng trong khi đồng hồ media vẫn tiến lên.

Để kiểm tra cơ bản mà không cần đăng ký dịch vụ, chọn **Thử bản demo**. Khi đã bắt đầu phát, tạm đặt `document.getElementById("video").playbackRate = 0` trong DevTools của thẻ kiểm tra; sau đó đặt lại thành 1. Tạm dừng được cố ý loại trừ khỏi cơ chế khôi phục khi bị kẹt.
