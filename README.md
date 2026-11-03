# Excel Story Reader — Đọc truyện trong giao diện bảng tính

> Bản nháp / dự án thử nghiệm.

## Chạy

```bash
npm start            # cần Node 18 trở lên, không phải cài thêm thư viện
# mở http://localhost:3000
```

Biến môi trường: `PORT` (mặc định 3000), `HOST` (mặc định 127.0.0.1; đặt `0.0.0.0` để điện thoại trong mạng LAN truy cập được).

## Deploy

### Vercel (khuyên dùng: đầy đủ tính năng, kể cả "Nhập link")
1. Vào https://vercel.com → **Add New… → Project** → chọn repo `commic-excel` → **Import**.
2. Framework Preset: **Other**. Không cần đổi gì khác, vì `vercel.json` đã đặt thư mục xuất là `public/` và function `api/import.js`.
3. Bấm **Deploy**. Từ đó, mỗi lần `git push` lên `main` Vercel sẽ tự deploy lại.

### GitHub Pages (chỉ file tĩnh)
1. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push lên `main`. Workflow `.github/workflows/pages.yml` sẽ deploy thư mục `public/`.
3. Địa chỉ trang: `https://<tài-khoản>.github.io/commic-excel/`.
4. Muốn "Nhập link" chạy được trên Pages: deploy thêm lên Vercel, rồi điền vào `public/index.html`:
   `<meta name="api-base" content="https://<tên-dự-án>.vercel.app">`

## Thư viện truyện thật (phạm vi công cộng)

| Thể loại | Nguồn | Bản quyền |
|---|---|---|
| Cổ đại, Ngôn tình, Hài hước | Nguyên tác chữ Hán từ Project Gutenberg (API Gutendex) và zh.wikisource: *Liêu Trai chí dị*, *Tam ngôn*, *Đông Chu liệt quốc*, *Sưu thần ký*, *Phù sinh lục ký*, *Oanh Oanh truyện*, *Nho lâm ngoại sử*, *Tiếu lâm*, *Tiếu tán* | Tác giả mất từ năm 221 đến 1825 nên thuộc phạm vi công cộng. Bản dịch tiếng Việt là bản dịch mới do AI (Claude) thực hiện, **cần biên tập lại** |
| Trinh thám, Cổ tích & Ngụ ngôn, Ngôn tình, Hài hước | Nguyên tác trên Project Gutenberg và Aozora Bunko: Conan Doyle (Sherlock Holmes), Aesop, anh em Grimm, Andersen, O. Henry, Mark Twain, Akutagawa Ryūnosuke | Tác giả mất trước năm 1931; vài truyện Grimm/Andersen/Aesop dịch qua bản tiếng Anh thế kỷ 19 (cũng thuộc phạm vi công cộng). Bản dịch tiếng Việt mới do AI thực hiện, **cần biên tập lại** |
| Văn học VN | 30 tác phẩm của Nam Cao trên vi.wikisource (API MediaWiki) | Nam Cao mất năm 1951; theo Luật SHTT Việt Nam (bảo hộ đến hết 50 năm sau năm tác giả mất) đã hết bảo hộ — **cần pháp chế xác nhận** |

Không dùng nội dung từ các trang truyện dịch còn bản quyền.

### Dịch thêm truyện (mục tiêu 50 truyện mỗi thể loại)

```bash
npm install                                            # cài @anthropic-ai/sdk
node scripts/fetch-sources.js                          # tải nguyên tác về data/ (không commit)
node scripts/translate.js --dry                        # xem kế hoạch + ước tính chi phí, không gọi API
node scripts/translate.js --genre=ngon-tinh --limit=5  # cần ANTHROPIC_API_KEY
node scripts/build-library.js                          # cập nhật public/stories/index.json
```

- Kế hoạch dịch: `scripts/translation-plan.json`.
- Model `claude-opus-5-5`, effort `medium` (đổi bằng `--effort=high`).
- Lưu tiến độ trong `data/translations/`; chạy lại sẽ tiếp tục từ đoạn đang dở.
- Bật `fallbacks: "default"`: nếu model chính từ chối một đoạn vì bộ lọc an toàn, API tự chạy lại bằng model dự phòng.

## Ý tưởng & tính năng

| Thành phần Excel | Dùng để làm gì |
|---|---|
| Sổ làm việc `Thu_vien_truyen.xlsx` | Thư viện: sheet *Tổng hợp*, *Cổ đại*, *Hài hước*, *Ngôn tình*, *Văn học VN*, *Đang đọc*, *Nhập link* |
| Bảng có bộ lọc ▾ ở tiêu đề | Sắp xếp/lọc theo tên, tên gốc, tác giả, tác phẩm, độ dài, loại bản dịch… |
| Định dạng có điều kiện | Thanh dữ liệu (data bar) cho độ dài truyện, màu Good/Neutral cho nguyên bản/bản dịch máy |
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

Phía server (`lib/core.js`) tải trang giúp trình duyệt (để tránh chặn CORS), chặn địa chỉ nội bộ (chống SSRF), giới hạn 5 MB mỗi trang, chờ tối đa 15 giây, lưu tạm kết quả 10 phút; giữa các lần tải chương có nghỉ khoảng 0,4 giây.

## Cấu trúc

```
lib/core.js            lõi nhập truyện (trích xuất nội dung, chặn SSRF, cache)
scripts/serve.js       máy chủ chạy trên máy (npm start)
api/import.js          Vercel Serverless Function /api/import
public/index.html      khung giao diện
public/css/excel.css   giao diện giống Excel (sáng/tối)
public/js/app.js       lưới ô, sheet, ribbon, bộ lọc, tìm kiếm, nhập link, xuất xlsx
public/stories/        thư viện tĩnh: index.json + mỗi truyện một file JSON
scripts/fetch-sources.js   tải nguyên tác (Gutenberg, Wikisource) về data/
scripts/translate.js       dịch truyện cổ chữ Hán sang tiếng Việt bằng Claude API
scripts/build-library.js   dựng public/stories/index.json
public/vendor/         SheetJS 0.18.5 (dùng khi không có Internet)
```

## Lưu ý
- Bản dịch truyện cổ là bản dịch máy, nên rà soát và biên tập trước khi công bố rộng rãi.
- Khi nhập truyện từ link, hãy tôn trọng bản quyền và điều khoản sử dụng của trang nguồn. Trang dùng JavaScript để hiển thị nội dung hoặc có chống bot (Cloudflare…) có thể không tải được, khi đó hãy dùng ô **Dán văn bản**.
- Lịch sử đọc và các cài đặt chỉ lưu trong `localStorage` của trình duyệt đang dùng.
