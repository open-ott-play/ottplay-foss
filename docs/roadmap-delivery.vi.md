# Cải thiện độ tin cậy và phát nội dung đa phương tiện

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.vi.md) · [Kiến trúc](architecture.md)

Hướng dẫn này mô tả phần triển khai tại bản sửa đổi mã nguồn của trang, không phải khả năng của một bản phát hành cũ đã cài. Trình phát, dịch vụ điều khiển/CLI và ứng dụng Android gốc là các sản phẩm riêng. Cập nhật một sản phẩm không cập nhật những sản phẩm còn lại.

![Trách nhiệm và ranh giới tin cậy](diagrams/roadmap-components.svg)

Xem [chi phí byte đã đo và biểu đồ so sánh](roadmap-size.vi.md); tốc độ thực thi và phát trên thiết bị là những kiểm tra nghiệm thu riêng.

<a id="what-is-implemented"></a>

## Những phần đã triển khai

1. **Mẫu âm thanh/video đã biết.** [Thông tin → Âm thanh](audio-video-check.vi.md) phát đoạn phim tám giây từ here.now (cần Internet), với âm trái/phải và chớp sáng tương ứng. Chỉ tải sau khi chọn **Phát**, không bao giờ tải lúc khởi động; tệp phương tiện không nằm trong gói trình phát. Mẫu chỉ mượn bộ giải mã HTML5 chính khi nhàn rỗi hoặc xem TV trực tiếp. Không ghi lịch sử xem. [Đặc tả mẫu](../diagnostics/README.md).
2. **Thiết lập Local/Home có thể tiếp tục.** CLI điều khiển có thể lập kế hoạch, áp dụng, tiếp tục và xác minh một cấu hình đặt trước. Nó so sánh thiết lập đã lưu trước khi thử lại thao tác ghi có kết quả chưa chắc chắn. [Quy trình điều khiển](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **Khôi phục phát có giới hạn.** Lỗi tạm thời HLS/Shaka dùng chung chính sách khôi phục hữu hạn. Lỗi xác thực và DRM không được hỗ trợ là lỗi kết thúc. Stop, đổi kênh và thay nguồn hủy công việc lỗi thời.
4. **Giới hạn chất lượng được lưu.** Chiều cao và bitrate tối đa hạn chế lựa chọn thích ứng; chuyển sang bộ phát gốc không được âm thầm vượt qua giới hạn đang bật.
5. **Tùy chọn track trên Android gốc.** Ứng dụng Android độc lập ghi nhớ ý định theo ngôn ngữ/vai trò/nhãn, gồm Auto và tắt phụ đề, thay vì mang chỉ số track từ luồng khác sang.
6. **Người vận hành lệnh có phạm vi giới hạn.** Bộ điều khiển có thể cấp cho thông tin xác thực quyền trên đúng thiết bị/hành động mà không giao thông tin xác thực quản trị viên.
7. **Liên kết XMLTV rõ ràng.** Một kênh trong phạm vi danh sách phát có thể gắn với nguồn cấp và ID XMLTV cụ thể. [Liên kết lịch chương trình và khả năng tiếp cận](guide-binding-accessibility.vi.md).
8. **Phim và sê-ri Xtream.** Thư viện chỉ tải danh mục đã chọn khi cần, rồi tải các tập của một sê-ri. [Cam kết của thư viện](xtream-media.vi.md).
9. **Điều khiển cổ điển có khả năng tiếp cận.** Danh sách kênh biểu đạt ngữ nghĩa lựa chọn; hộp thoại phương thức giữ và khôi phục tiêu điểm bàn phím; thông báo có vùng cập nhật trực tiếp.
10. **Kết quả lệnh bền vững.** Nhật ký bộ điều khiển tùy chọn, có giới hạn, giữ siêu dữ liệu loại trùng và kết quả. Khởi động lại không bao giờ phát lại lệnh một cách mù quáng.
11. **Chuyển giao thiết bị rõ ràng.** Tham chiếu trực tiếp/lưu trữ chuyển sang trình phát có cùng nguồn đã cấu hình. Đích tự phân giải URL của mình. [Cam kết](remote-handoff.vi.md).
12. **Luồng dự phòng rõ ràng.** Kênh trực tiếp có thể dùng các nguồn thay thế đã cấu hình trong cùng chính sách khôi phục hữu hạn. [Giới hạn, khôi phục và dự phòng](playback-stream-policy.vi.md).
13. **Lô thiết lập có thể khôi phục.** localStorage gốc dùng nhật ký hoàn tác cho các thao tác ghi nhiều khóa được hỗ trợ. [Bảo đảm lưu trữ](settings-recovery.vi.md).

<a id="language-and-compatibility-coverage"></a>

## Phạm vi ngôn ngữ và tương thích

Trình phát có 88 danh mục bản dịch. Bảy nhãn chất lượng/phương tiện mới được dịch trong mọi danh mục; các menu mới khác tái sử dụng nhãn đã dịch. Kiểm tra danh mục bao gồm tính đồng nhất khóa, chỗ giữ chỗ và ngoại lệ đã xem xét. Các hướng dẫn kỹ thuật tương ứng giải thích cùng giới hạn triển khai bằng [24 ngôn ngữ tài liệu](manual-translations.md). [Trang vào đã bản địa hóa](readme/README.md) là hướng dẫn bắt đầu nhanh, không phải tuyên bố rằng mọi tài liệu kỹ thuật lịch sử đều có 88 bản dịch đầy đủ.

Đầu ra cổ điển vẫn dùng cú pháp ES5. Điều này không có nghĩa mọi thiết bị hỗ trợ mọi codec, Web API, bảo đảm lưu trữ hoặc tích hợp gốc. Xem thử A/V chỉ dùng đường HTML5 chính được quản lý; các bộ máy thay thế của thiết bị như PC2/Video.js và bộ máy gốc bị loại trừ. Liên kết lịch chương trình rõ ràng dùng triển khai XMLTV được lưu trữ hoặc gốc; giao thức companion ngoài tùy chọn có thể không hỗ trợ. Nghiệm thu theo thiết bị vẫn cần thiết bị thật.

<a id="reproduce-the-checks"></a>

## Tái tạo các kiểm tra

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

Bộ xác minh phương tiện cần FFmpeg/FFprobe. Nó giải mã cả hai kênh âm thanh và kiểm tra năng lượng, độ tách và khoảng lặng; chỉ có track AAC không chứng minh nội dung nghe được. Các kiểm thử JavaScript thông thường kiểm tra hủy, ghi thất bại, khôi phục sau khởi động lại, đổi nguồn và đầu vào không hợp lệ. Kiểm tra bundle cuối bao gồm các họ nhà cung cấp tùy chọn, không chỉ điểm vào chính.

Trong bộ điều khiển, chạy `go test -race ./...`, `go vet ./...` và `python3 -m unittest discover -s tests`. Trên Android gốc, chạy kiểm thử đơn vị cho tùy chọn track và sao lưu thiết lập rồi dựng APK gỡ lỗi. CI của từng kho chỉ có giá trị với commit tương ứng, không phải cây mã được thay đổi về sau.

<a id="physical-acceptance-before-promotion"></a>

## Nghiệm thu vật lý trước khi nâng giai đoạn phát hành

- Trên TV đích, chạy kiểm tra A/V và xác nhận âm trái/phải, chớp sáng nhìn thấy, Stop và trở lại TV trực tiếp. Kiểm thử bộ giải mã không chứng minh âm thanh HDMI hay độ mượt.
- Thử luồng được phép/bị từ chối, nguồn dự phòng hỏng và đổi kênh khi đang chờ thử lại. Xác nhận giới hạn chất lượng đã chọn trên backend thực tế.
- Thử tiêu điểm danh sách/hộp thoại bằng bàn phím, điều khiển từ xa và trình đọc màn hình có sẵn.
- Gắn hai tên kênh giống nhau với ID XMLTV khác nhau và xác minh dữ liệu chương trình.
- Ngắt quá trình áp dụng cấu hình thử nghiệm, khởi động lại bộ điều khiển, tiếp tục và xác minh. Chuyển giao sang nguồn đã cấu hình vừa khớp vừa không khớp.
- Trên Android gốc, đổi các luồng có thứ tự track khác nhau, khởi động lại ứng dụng và xác nhận Auto/Off rõ ràng cùng ngôn ngữ ưu tiên.

Gửi thành công, thiết lập đã lưu, mẫu đã giải mã và kiểm thử đơn vị đạt là các loại bằng chứng khác nhau. Nâng giai đoạn phát hành phải giữ sự phân biệt đó; xem [chiến lược phát hành](../RELEASING.md).
