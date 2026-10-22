<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Liên kết XMLTV thủ công và hỗ trợ bàn phím

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Kiến trúc hướng dẫn chương trình](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## Sửa hướng dẫn chương trình của kênh mà không sửa danh sách phát

Phát kênh M3U bị ảnh hưởng, mở **Information → EPG**, rồi sửa URL nguồn EPG và **XMLTV ID**. Nhập chính xác ID từ `<channel id="…">` trong tệp XMLTV, không phải tên hiển thị. Chọn **Set** để lưu liên kết và tải lại danh sách phát. **Automatic** xóa phần ghi đè của kênh này và tải lại ánh xạ gốc của danh sách. Chỉ di chuyển bằng phím mũi tên không bao giờ lưu hay đặt lại liên kết. Quay lại giữ nguyên liên kết đã lưu.

Trình sửa này có trong bản triển khai trình duyệt được lưu trữ và các lớp vỏ XMLTV gốc (Tauri và Capacitor). Nó không ghi đè hướng dẫn thuộc nhà cung cấp, điểm cuối JSON tường minh `=source` hoặc máy chủ đồng hành bên ngoài. Trình duyệt cũ thông thường dùng máy chủ đồng hành từ xa vẫn giữ giao thức ghép hiện có. Phiên bản đầu chấp nhận ID chính xác; không tải hoặc hiển thị danh sách có thể tìm kiếm của mọi kênh XMLTV.

![Liên kết thủ công nối nguồn danh sách phát và kênh ổn định với một nguồn XMLTV cùng ID chính xác; nếu không, cơ chế ghép bình thường vẫn hoạt động.](images/guide-binding.svg)

Liên kết lưu dấu vân tay nguồn danh sách, khóa kênh ổn định, URL nguồn tường minh và ID XMLTV. Đổi tên hiển thị hoặc thứ tự hàng không thay đổi liên kết nếu danh tính kênh giữ nguyên. Thay URL/tài khoản danh sách làm thay đổi không gian tên của nguồn. Mục M3U cũ không có `itemId` dùng ID kênh hiện có suy ra từ URL; đổi URL đó sẽ đổi danh tính.

Kênh được chọn giữ tên hiển thị và URL phát. Tra cứu hướng dẫn dùng một nguồn tường minh, không dự phòng theo tên, nên ID thiếu không âm thầm mượn chương trình của kênh khác. Độ lệch vùng tự động suy ra từ tên kênh không áp dụng cho liên kết chính xác này; `tvg-shift` tường minh của danh sách vẫn có hiệu lực. Hãy đặt đúng ID XMLTV theo vùng. Nếu không đọc được nguồn HTTPS tùy chỉnh vì CORS hoặc quy tắc nội dung hỗn hợp, chẩn đoán EPG thông thường sẽ báo lỗi đó.

Bản ghi cục bộ bị giới hạn ở 500 liên kết và 512 KiB mỗi nguồn; chỉ phân tích một lần khi tải danh sách, không phải mỗi kênh. Lần ghi so sánh giá trị trước và đọc lại kết quả đã lưu trước khi tải lại. Callback đến muộn của trình sửa không thể lưu vào nguồn thay thế. Đây là tùy chọn cục bộ, không phải đồng bộ giữa thiết bị. URL nguồn có thể chứa thông tin đăng nhập; tránh công khai bản xuất của kho lưu trữ.

<a id="accessible-classic-controls"></a>

## Điều khiển cổ điển có hỗ trợ tiếp cận

- Danh sách chính ảo hóa cung cấp hộp danh sách có tên, tùy chọn đã chọn, tổng số mục và vị trí tuyệt đối của mục. Chỉ hàng được chọn và đang hiển thị là điểm dừng Tab. Phím mũi tên cập nhật lựa chọn hiển thị và trạng thái ngữ nghĩa; tiêu điểm theo danh sách đang có tiêu điểm khi thay trang.
- Hộp thoại thông tin/xác nhận chuẩn, trình sửa và bảng About cung cấp vai trò phương thức cùng tên bản địa hóa. Tab và Shift+Tab tuần hoàn trong hộp phương thức trên cùng. Đóng hộp lồng nhau trả tiêu điểm về điều khiển cha còn hiển thị; lần mở đã lên lịch nhưng lỗi thời không thể cướp tiêu điểm sau khi đóng.
- Thông báo thông tin và xác nhận mô tả hộp thoại của chúng. Thông báo tạm thời dùng vùng trạng thái với thông báo không gây gián đoạn.
- Các danh mục dịch hiện có cung cấp toàn bộ nhãn mới. XMLTV và ID là định danh giao thức; tên kênh và tên máy chủ nguồn vẫn là siêu dữ liệu nguồn.

Ứng dụng giữ các đường điều khiển từ xa và cú pháp ES5. Kiểm tra DOM ngữ nghĩa không đồng nghĩa chứng nhận WCAG đầy đủ: tiêu điểm riêng theo thiết bị, giọng đọc VoiceOver/TalkBack và hành vi trình duyệt TV vẫn cần kiểm thử thực tế.

<a id="verification"></a>

## Xác minh

Chạy:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

Cũng chạy kiểm tra bản dựng/ES5/kích thước gói thông thường trên nhánh tích hợp. Kiểm tra trình duyệt nên bao gồm danh sách dài qua nhiều trang, xác nhận lồng nhau, thay nguồn trong khi sửa, liên kết đúng, thiếu và đã xóa, cùng lỗi tải EPG. Tùy chọn ngữ nghĩa cho các luồng âm thanh/phụ đề của ứng dụng Android gốc được triển khai trong kho riêng và độc lập với các điều khiển cổ điển này.
