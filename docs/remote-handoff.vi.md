<a id="explicit-playback-handoff"></a>

# Chuyển giao phát một cách tường minh

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Cải tiến](roadmap-delivery.vi.md)

Với trình phát và CLI điều khiển đã cập nhật, chạy `ott handoff SOURCE TARGET`. Nguồn tiếp tục phát. Đích cần cấu hình cùng nguồn/tài khoản và có ID kênh ổn định, duy nhất. Tham chiếu kênh là dấu vân tay cục bộ có phiên bản, không bao giờ là ID mục thô của nhà cung cấp. Các hàng M3U cổ điển chỉ dùng URL luồng chính xác làm đầu vào cho hàm băm cục bộ. Vì vậy, những URL được ký hoặc viết lại độc lập sẽ không được ghép để bảo đảm an toàn. Không dùng so khớp tên gần đúng, không truyền thông tin đăng nhập hay URL có thể phát. Phiên bản 1 hỗ trợ trực tiếp/lưu trữ cho M3U, Xtream và Stalker; không hỗ trợ VOD/phim bộ hoặc đồng bộ liên tục lịch sử xem.

`playback_handoff_export` chấp nhận tham số rỗng và trả về `data.handoff`:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

Tham chiếu lưu trữ dùng `kind: "archive"` và số nguyên `archive_start` (vị trí phát hiện tại tính bằng giây Unix). `playback_handoff_import` chỉ chấp nhận `{"handoff": ...}`. Trước khi gửi lệnh, đích kiểm tra danh tính danh mục, khả năng truy cập lưu trữ, chính sách phụ huynh/kiosk và quyền sở hữu điều khiển hiện tại. Đích xác định luồng qua nhà cung cấp riêng của mình. Nhập được chấp nhận trả về `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. Việc gửi lệnh không xác nhận video đã được giải mã hoặc có âm thanh HDMI nghe được.

Lệnh bị từ chối chỉ lộ mã lỗi: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. Tham chiếu bị giới hạn; bên nhận từ chối các trường bổ sung. Dùng quyền người vận hành có phạm vi giới hạn để xuất/nhập và bảo vệ kết nối tới bộ điều khiển. Danh tính nguồn là khóa ghép không biểu lộ nội dung, không phải thông tin cấp quyền truy cập có thể chuyển giao.

Chạy `node tests/test_remote_handoff.cjs`. Xem [hướng dẫn điều khiển](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) để biết về xác thực, kết quả và hành vi TTL của lệnh.
