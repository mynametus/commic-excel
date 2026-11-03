# Excel Story Reader — Đọc truyện trong giao diện bảng tính

> Bản nháp / dự án thử nghiệm.

## Chạy

```bash
npm start            # cần Node 18 trở lên, không phải cài thêm thư viện
# mở http://localhost:3000
```

Biến môi trường: `PORT` (mặc định 3000), `HOST` (mặc định 127.0.0.1; đặt `0.0.0.0` để điện thoại trong mạng LAN truy cập được).

## Ý tưởng & tính năng

| Thành phần Excel | Dùng để làm gì |
|---|---|
| Sổ làm việc `Thu_vien_truyen.xlsx` | Thư viện: sheet *Tổng hợp*, *Cổ đại*, *Hài hước*, *Ngôn tình* (mỗi thể loại 50 truyện), *Đang đọc*, *Nhập link* |
| Bảng có bộ lọc ▾ ở tiêu đề | Sắp xếp/lọc theo tên, tác giả, trạng thái, lượt đọc… |
| Định dạng có điều kiện | Thanh dữ liệu (data bar) cho lượt đọc, biểu tượng ▲▶▼ cho điểm đánh giá, màu Good/Neutral cho trạng thái |
| Mỗi truyện = 1 sổ `.xlsx` | Sheet *Mục lục* + **mỗi chương một sheet** |
| Hộp tên / thanh công thức | Hiện ô đang chọn và nội dung ô (`=HYPERLINK(...)`, `=SUBTOTAL(...)`) |
| Ribbon | Phông chữ/cỡ chữ đọc, căn lề, ngắt dòng, màu giấy, độ rộng vùng đọc, chế độ tối, thu phóng, chuyển cửa sổ, xuất `.xlsx` |
| Ctrl+F | Tìm trong toàn bộ sổ làm việc (giống hộp thoại *Tìm và Thay thế*) |
| Esc | “Sếp đến!” — chuyển ngay sang bảng báo cáo KPI giả |
| Ctrl+S | Xuất file **.xlsx thật** (SheetJS), mỗi chương một sheet |

### Nhập truyện bằng link
Sheet **Nhập link** → dán URL → **▶ Nhập**:
- **Trang mục lục**: lấy danh sách chương (tự đi qua các trang phân trang của mục lục), mỗi chương thành một sheet, nội dung chỉ tải khi mở sheet đó.
- **Trang chương**: lấy nội dung chương rồi đi theo link “Chương sau” cho tới số chương tối đa đã chọn.
- **Dán văn bản**: dùng khi trang chặn tải tự động; các dòng “Chương N” được tách thành từng sheet.

Phía server (`server.js`) tải trang giúp trình duyệt (để tránh chặn CORS), chặn địa chỉ nội bộ (chống SSRF), giới hạn 5 MB mỗi trang, chờ tối đa 15 giây, lưu tạm kết quả 10 phút; giữa các lần tải chương có nghỉ khoảng 0,4 giây.

## Cấu trúc

```
server.js              máy chủ tĩnh + API /api/import
public/index.html      khung giao diện
public/css/excel.css   giao diện giống Excel (sáng/tối)
public/js/data.js      thư viện mẫu 150 truyện (nội dung sinh tự động)
public/js/app.js       lưới ô, sheet, ribbon, bộ lọc, tìm kiếm, nhập link, xuất xlsx
public/vendor/         SheetJS 0.18.5 (dùng khi không có Internet)
```

## Lưu ý
- Nội dung thư viện mẫu do chương trình **tự sinh từ mẫu câu**, chỉ để minh họa. Có thể thay bằng dữ liệu thật (JSON/API) mà giữ nguyên giao diện.
- Khi nhập truyện từ link, hãy tôn trọng bản quyền và điều khoản sử dụng của trang nguồn. Trang dùng JavaScript để hiển thị nội dung hoặc có chống bot (Cloudflare…) có thể không tải được, khi đó hãy dùng ô **Dán văn bản**.
- Lịch sử đọc và các cài đặt chỉ lưu trong `localStorage` của trình duyệt đang dùng.
