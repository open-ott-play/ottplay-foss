<a id="measured-javascript-cost"></a>

# Chi phí JavaScript đã đo

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Hướng dẫn tính năng](roadmap-delivery.vi.md) · [Bằng chứng thô](evidence/roadmap-size-20261015.json)

![So sánh toàn bộ JavaScript của trình phát bằng cùng bộ công cụ](diagrams/roadmap-size.svg)

Trang này lưu các phép đo JavaScript từ những ảnh chụp mã nguồn bên dưới. Chúng không đo bản sửa đổi hiện tại, gói cài đặt hay lưu lượng mạng.

Trong so sánh ban đầu, điểm vào chính cùng mọi họ nhà cung cấp tùy chọn tăng **31 128 byte thô / 9 759 byte gzip**, khoảng **3.23% / 3.20%**. Đây là chi phí tăng thêm của tính năng, không phải tuyên bố giảm kích thước hay tăng tốc thực thi. Xtream vẫn tải theo nhu cầu; đưa nó ra khỏi điểm vào không loại nó khỏi tổng.

Phép đo so sánh các kho nguồn sạch `bbf9ca7b` và `cae971da`, đều ở phiên bản 1.1.55, với Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2 và zlib 1.2.12. Nó dùng bộ lắp ghép ES5 sản xuất, bộ tối ưu, chính sách đặt tên và định danh nguồn sạch chính xác. Gzip mức 9 được áp dụng riêng cho từng tài nguyên xuất ra.

- Điểm vào web: 848 092 / 262 392 → 874 926 / 270 321 byte thô/gzip.
- Điểm vào web + mọi nhà cung cấp: 964 459 / 305 344 → 995 587 / 315 103.
- Điểm vào native: 848 050 / 262 460 → 874 884 / 270 372.
- Điểm vào native + mọi nhà cung cấp: 964 417 / 305 412 → 995 545 / 315 154.
- M3U tùy chọn tăng 184 byte thô / 82 gzip; Xtream mới là 4 110 / 1 748. Sáu họ tùy chọn còn lại giống hệt từng byte.

Trước khi chuyển clip sang here.now, đổi URL sang đường dẫn cục bộ từ gốc đã thêm một byte JavaScript thô trong chuỗi thay đổi lịch sử này. Đây không phải phép đo URL được lưu trữ sau đó. Bản sửa thử lại phân tích HLS có giới hạn thêm 37 byte thô / 36 gzip trong so sánh tách biệt cùng một ảnh chụp ([bằng chứng](evidence/parse-recovery-size-20261015.json)). Bản sửa quyền sở hữu bàn giao Auto native thêm 101 byte thô / 39 gzip nữa ([bằng chứng](evidence/auto-recovery-size-20261015.json)). Tổng thô trước khi sửa các hồi quy về khả năng tiếp cận là 995 726 byte; định danh bản dựng và số byte gzip có thể đổi ở commit cuối. `build/reports/classic-bundle.json` và `npm run check:size` cuối cùng vẫn là căn cứ cho đúng bản sửa đổi được phát hành. Bản dựng sạch tiếp theo `652726f8`, gồm sửa tiêu điểm con trỏ/hộp thoại, đo được **995 858 byte thô / 315 207 gzip** cho toàn bộ trình phát web ([bằng chứng hiện vật cuối](evidence/roadmap-final-size-20261015.json)). Điểm vào là 875 197 / 270 425; tổng native là 995 816 / 315 259. Các ngưỡng của ảnh chụp đó giữ phần dự phòng trước đây cho native/Node/hậu tố phát hành: 875 300 thô / 271 600 gzip cho điểm vào; 996 100 / 316 400 cho điểm vào + nhà cung cấp.

<a id="post-beta-integration"></a>

## Tích hợp sau beta

![Toàn bộ JavaScript sau khi tích hợp beta.4](diagrams/post-beta-size.svg)

So sánh sau tái tạo nguồn beta.4 `39287792` đối chiếu với runtime `9663b681`, gồm tích hợp Plex và khôi phục cài đặt hỏng, bằng cùng Node 26.8.2, Rollup 4.64.5 và Terser 5.51.2:

- Điểm vào web: 848 315 / 262 443 → 879 533 / 271 761 byte thô/gzip.
- Điểm vào web + mọi nhà cung cấp: 964 876 / 305 452 → 1 000 388 / 316 600.
- Điểm vào native + mọi nhà cung cấp: 964 834 / 305 520 → 1 000 346 / 316 654.
- Mức tăng toàn bộ tải web: **35 512 / 11 148 byte (3.68% / 3.65%)**.

Đường cơ sở tính bảy họ nhà cung cấp; bản tích hợp tính tám, gồm Xtream tải theo nhu cầu. Ngưỡng điểm vào của ảnh chụp đó là 879 900 / 273 000; ngưỡng tổng là 1 000 800 / 317 800, chừa chỗ cho native, Node và định danh phát hành. Cả hai bản dựng sản xuất cục bộ tái tạo năm tệp runtime được theo dõi và bỏ tuyên bố về bản sửa đổi nguồn sạch. Đây là hiện vật tái tạo cục bộ, không phải tệp nhị phân beta đã phát hành. Phiên bản công cụ, hàm băm và giới hạn đó được ghi trong [bằng chứng cơ sở](evidence/post-beta-baseline-size-20261015.json) và [bằng chứng tích hợp](evidence/post-beta-candidate-size-20261015.json). [Báo cáo triển khai](implementation-report.vi.md#post-beta-integration-and-review) giải thích các bản sửa và xác minh.

**Phạm vi:** các tổng JavaScript này không gồm bộ máy đa phương tiện bên ngoài, từ điển ngôn ngữ, CSS, ảnh và video. Gói trình phát trước đây còn mang **clip A/V 464 652 byte**, nằm ngoài các tổng trên. Cách phân phối hiện nay tách biệt với những phép đo đó:

- **Kho mã:** `diagnostics/av-v1.mp4` vẫn được giữ cùng bộ tạo và bộ xác minh để có thể tái tạo. Giữ tệp nguồn không có nghĩa là đưa nó vào gói.
- **Gói:** Web/OTTPlay Server, Tauri, Capacitor và Docker loại clip. Việc này bỏ 464 652 byte tài nguyên media thô, không phải mức giảm đã đo 464 652 byte của bộ cài nén. Định dạng lưu trữ và thay đổi dựng khác ảnh hưởng đến kích thước đó.
- **Mạng:** trình phát chỉ lấy clip từ here.now khi người dùng bắt đầu [kiểm tra A/V](audio-video-check.vi.md). Kiểm tra cần Internet; clip không được tải cho phát lúc khởi động.

Các phép đo JavaScript lịch sử trên giữ nguyên. Đo tác động của URL được lưu trữ tới JavaScript hoặc bộ cài hiện tại cần so sánh mới. 88 README bản địa hóa là tài liệu kho mã, không phải tải của trình phát. So sánh byte này không chứng minh thời gian khởi động, tốc độ khung hình, bộ nhớ hay hiệu năng ở quy mô danh mục. Các yếu tố đó cần phép đo riêng trên thiết bị đích.
