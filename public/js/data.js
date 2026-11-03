/*
 * Thư viện truyện mẫu (tạm thời).
 * Toàn bộ tên truyện, tác giả và nội dung đều được SINH TỰ ĐỘNG từ các mẫu câu gốc
 * (không sao chép tác phẩm có bản quyền). Có thể thay bằng dữ liệu thật sau này.
 * 3 thể loại × 50 truyện = 150 bản ghi.
 */
(function (global) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const pick = (a, r) => a[Math.floor(r() * a.length)];
  function shuffle(a, r) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const fill = (t, ctx) => t.replace(/\{(\w)\}/g, (m, k) => (ctx[k] != null ? ctx[k] : m));

  /* ------------------------------------------------------------------ */
  /*  MẪU NỘI DUNG THEO THỂ LOẠI                                         */
  /*  {F} nhân vật chính 1, {M} nhân vật chính 2, {S} nhân vật phụ,      */
  /*  {P} địa điểm, {I} vật phẩm, {T} mở cảnh thời gian                 */
  /* ------------------------------------------------------------------ */
  const GENRES = [
    {
      id: 'co-dai', code: 'CD', name: 'Cổ đại', color: '#C0504D',
      titleA: ['Thứ Nữ', 'Đích Nữ', 'Tiểu Thư Tướng Phủ', 'Vương Phi', 'Thái Tử Phi', 'Nữ Y', 'Kiếm Khách', 'Quận Chúa', 'Hoàng Hậu', 'Nữ Tướng', 'Công Chúa Hòa Thân', 'Thế Tử', 'Nữ Quân Sư', 'Phế Hậu'],
      titleB: ['Trọng Sinh', 'Mưu Thiên Hạ', 'Không Muốn Tranh Sủng', 'Hồi Kinh', 'Truyền Kỳ', 'Phong Hoa', 'Nghịch Thiên', 'Ẩn Danh', 'Giá Lâm', 'Tái Xuất Giang Hồ', 'Khuynh Thành', 'Định Giang Sơn'],
      titleX: ['Trường An Mộng Hoa', 'Phượng Hoàng Lửa', 'Tuyết Lạc Cung Thành', 'Huyết Ngọc Truyền Kỳ', 'Thanh Phong Kiếm Ký', 'Bạch Hạc Lâu', 'Hoa Đăng Thất Tịch', 'Cẩm Tú Thiên Thu', 'Lạc Dương Phong Vân', 'Ngọc Bội Song Long', 'Mặc Vũ Giang Nam', 'Long Ẩn Biên Ải'],
      female: ['Thẩm Tịch Nguyệt', 'Tạ Vân Khê', 'Tô Uyển Như', 'Lâm Thanh Ca', 'Diệp Yên Nhiên', 'Cố Lạc Anh', 'Mộ Dung Tuyết', 'Bùi Ngọc Dao', 'Hàn Sương Nhi', 'Lục Hoa Dung'],
      male: ['Tiêu Cảnh Diễm', 'Lục Mặc Trầm', 'Hoắc Dịch Thần', 'Bùi Hoài An', 'Tạ Tử Ngọc', 'Yến Trường Phong', 'Cố Thừa Uyên', 'Tần Lãnh Dạ', 'Mạnh Kinh Hồng', 'Triệu Thanh Viễn'],
      side: ['lão thái giám Phúc', 'nha hoàn Tiểu Đào', 'Lý ma ma', 'thị vệ A Thất', 'Tam hoàng tử', 'Liễu quý phi', 'quân sư họ Giang', 'đại phu Tôn', 'biểu muội Ninh Nhi', 'tướng quân họ Hứa'],
      places: ['kinh thành Trường An', 'Đông cung', 'phủ Thừa tướng', 'Lãnh cung', 'rừng trúc ngoài thành', 'Vọng Nguyệt lâu', 'bến đò Giang Nam', 'chùa Hàn Sơn', 'biên ải Bắc Cương', 'ngự hoa viên'],
      items: ['miếng ngọc bội khắc rồng', 'bức mật thư niêm sáp đỏ', 'thanh kiếm Thu Thủy', 'chiếc trâm phượng bằng vàng', 'bình thuốc sứ trắng', 'tấm lệnh bài Kim Ngô vệ', 'cuốn sổ sách của Hộ bộ', 'chiếc quạt lụa vẽ hoa mai'],
      times: ['Đêm ấy, trăng treo nghiêng trên mái ngói lưu ly', 'Canh ba, tiếng mõ cầm canh vọng lại từ đầu phố', 'Sáng sớm, sương mù còn phủ kín bậc thềm đá', 'Cuối giờ Thân, nắng chiều nhuộm đỏ tường cung', 'Mùa đông năm ấy, tuyết rơi suốt ba ngày không dứt', 'Tiết Thanh minh, mưa phùn lất phất trên những cành liễu'],
      open: [
        '{T}. {F} đứng lặng trước {P}, tay siết chặt {I}.',
        '{T}. Tin dữ từ {P} truyền về khiến cả phủ náo loạn.',
        '{T}. {M} thúc ngựa trở về {P}, áo giáp còn vương bụi đường xa.',
        '{T}. Trong {P}, chỉ còn một ngọn đèn dầu leo lét.',
        '{T}. Không ai ngờ rằng một buổi yến tiệc bình thường lại mở đầu cho bao sóng gió.'
      ],
      narr: [
        'Nàng biết, từ khoảnh khắc này trở đi, mỗi bước đi đều có thể là một ván cờ sinh tử.',
        '{M} khẽ nheo mắt, ánh nhìn sắc lạnh như lưỡi đao vừa tuốt khỏi vỏ.',
        '{S} cúi đầu thật thấp, không dám thở mạnh.',
        'Gió lùa qua khe cửa, làm rèm châu khẽ lay động.',
        'Ai cũng nghĩ {F} chỉ là một tiểu thư yếu đuối, nhưng không ai biết nàng đã thuộc lòng binh thư từ năm mười tuổi.',
        'Trên bàn, {I} vẫn nằm yên, như đang chờ một người đủ can đảm để mở ra bí mật của nó.',
        'Kiếp trước, nàng đã tin lầm người. Kiếp này, nàng sẽ không để lịch sử lặp lại.',
        '{M} im lặng hồi lâu, rồi chậm rãi đặt chén trà xuống.',
        'Tiếng bước chân dồn dập vang lên ngoài hành lang.',
        'Những lời đồn đại về {P} đã lan khắp kinh thành chỉ sau một đêm.',
        '{F} mỉm cười, nụ cười nhạt đến mức khiến người đối diện thấy lạnh sống lưng.',
        'Hắn đã chờ ngày này suốt mười năm.',
        'Trong cung, một câu nói sai có thể phải đổi bằng cả gia tộc.',
        '{S} lén nhìn quanh rồi dúi vào tay nàng {I}.',
        'Ánh nến hắt bóng hai người lên vách, khi gần khi xa.',
        'Nàng nhớ lời mẫu thân dặn trước lúc lâm chung: chớ tin vào những lời ngọt ngào nơi cung cấm.',
        'Đoàn xe ngựa chậm rãi lăn bánh qua cổng thành.',
        'Không khí trong điện đặc quánh, đến cả tiếng kim rơi cũng nghe rõ.',
        '{M} đưa tay đỡ lấy nàng, động tác dịu dàng hiếm thấy.',
        'Ván cờ này, ai là quân cờ, ai là người cầm cờ, vẫn còn chưa biết được.',
        'Mùi trầm hương thoang thoảng, xen lẫn chút mùi thuốc đắng từ gian phòng bên cạnh.',
        '{F} lật từng trang sổ, ngón tay dừng lại ở một dòng chữ đã bị ai đó cố tình xóa mờ.'
      ],
      dialog: [
        '— Nàng có biết mình vừa nói gì không? — {M} trầm giọng hỏi.',
        '— Thần nữ chỉ nói sự thật. — {F} ngẩng đầu, ánh mắt không chút né tránh.',
        '— Tiểu thư, không xong rồi! — {S} hớt hải chạy vào.',
        '— Nếu ta không đồng ý thì sao?',
        '— Vậy thì đêm nay, {P} sẽ không còn yên bình nữa.',
        '— Ngươi muốn ta tin ngươi? Vậy hãy đưa ra bằng chứng.',
        '— Mười năm trước, ở {P}, rốt cuộc đã xảy ra chuyện gì?',
        '— Bổn vương không cần nàng báo đáp, chỉ cần nàng sống thật tốt.',
        '— {I} này... sao lại ở trong tay ngươi?',
        '— Đừng sợ, có ta ở đây.',
        '— Kẻ nào dám làm ồn ở đây? Lôi ra ngoài!',
        '— Nước cờ này, nàng đi rất hay. — {M} khẽ cười.',
        '— Nô tỳ nguyện theo tiểu thư đến cùng.',
        '— Ngày mai lên triều, mọi chuyện sẽ được phơi bày.',
        '— Người đâu, tiễn khách!'
      ],
      end: [
        'Ngoài cửa sổ, một bóng đen lặng lẽ biến mất vào màn đêm...',
        'Nàng không hề biết, ở phía xa, có một ánh mắt đã dõi theo nàng từ rất lâu.',
        'Và đó mới chỉ là khởi đầu của một cơn bão lớn.',
        '{M} khép mắt lại. Ngày mai, kinh thành sẽ không còn như trước.',
        'Tiếng chuông xa xa vang lên, trầm mặc như một lời tiên tri.'
      ],
      chTitles: ['Trọng sinh', 'Ngọc bội', 'Đêm mưa', 'Yến tiệc trong cung', 'Mật thư', 'Ván cờ', 'Bí mật mười năm', 'Biên ải', 'Hồi kinh', 'Phong ba', 'Kế trong kế', 'Tuyết rơi', 'Tri kỷ', 'Lời thề', 'Lật bài', 'Gió nổi', 'Đông cung', 'Chân tướng'],
      desc: [
        '{F} trọng sinh trở về năm mười lăm tuổi, quyết tâm thay đổi vận mệnh của cả gia tộc. Nhưng sự xuất hiện của {M} khiến mọi kế hoạch của nàng bị đảo lộn.',
        'Một {I} bí ẩn kéo {F} vào vòng xoáy tranh đoạt ngôi vị. Giữa chốn cung đình đầy cạm bẫy, nàng chỉ có thể tin vào chính mình — và có lẽ, cả {M}.',
        'Bề ngoài là tiểu thư khuê các yếu đuối, thực chất {F} là quân sư sau màn của {M}. Một người mưu thiên hạ, một người giữ giang sơn.',
        'Mười năm trước, {P} chìm trong biển lửa. Mười năm sau, {F} trở lại với một thân phận mới và một món nợ máu cần đòi.'
      ]
    },
    {
      id: 'hai-huoc', code: 'HH', name: 'Hài hước', color: '#ED7D31',
      titleA: ['Sếp Tổng', 'Cô Nàng Hậu Đậu', 'Anh Shipper', 'Chú Mèo Béo', 'Bà Chủ Trọ', 'Học Bá', 'Thầy Giáo Mới', 'Đầu Bếp Vụng', 'Hội Độc Thân', 'Hàng Xóm Ồn Ào', 'Lớp Trưởng', 'Ông Nội Tôi', 'Cậu Em Họ'],
      titleB: ['Và Chiếc Nồi Cơm Điện', 'Đi Xem Mắt', 'Bị Ma Trêu', 'Khởi Nghiệp Bán Trà Sữa', 'Lạc Ở Đà Lạt', 'Học Nấu Ăn', 'Gặp Hạn Năm Tuổi', 'Thi Hoa Hậu Phường', 'Nuôi Gà Online', 'Làm Idol Bất Đắc Dĩ', 'Giảm Cân Thất Bại', 'Và Cái Wifi Chập Chờn'],
      titleX: ['Nhật Ký Phòng Trọ 404', 'Một Ngày Không Ổn Lắm', 'Xóm Tôi Có Biến', 'Đại Chiến Mâm Cỗ Tết', 'Công Ty Toàn Người Lạ', 'Kế Hoạch Hoàn Hảo (Không)', 'Tuyệt Chiêu Trốn Việc Nhà', 'Lớp 12A3 Không Bình Thường', 'Hội Những Người Ghét Thứ Hai', 'Chuyện Nhà Tôi Có Con Chó'],
      female: ['Bống', 'Thảo Mai', 'Lan Anh', 'Mít', 'Hà Lanh Chanh', 'Na Na', 'Bé Ba', 'Tú Ngố'],
      male: ['Tũn', 'Phúc Béo', 'Hùng Ròm', 'Minh Tuấn', 'Đức Đẹp Trai', 'Quân Còi', 'Tèo', 'Long Lắm Lời'],
      side: ['bà Tư bán xôi', 'chú bảo vệ', 'cô chủ nhiệm', 'con chó tên Xoài', 'ông nội', 'anh shipper', 'sếp Hoàng', 'bác tổ trưởng dân phố', 'mẹ', 'thằng em lớp năm'],
      places: ['quán trà sữa đầu ngõ', 'phòng trọ tầng bốn không thang máy', 'công ty', 'lớp 12A3', 'chợ phường', 'bãi gửi xe', 'tiệm cắt tóc Bé Ba', 'sân chung cư', 'phòng gym', 'đám cưới họ hàng'],
      items: ['chiếc nồi cơm điện', 'đôi dép tổ ong', 'cái điều khiển ti vi', 'nồi lẩu thái', 'con gà trống', 'chiếc xe máy đời cũ', 'hộp bánh trung thu', 'cái loa kẹo kéo'],
      times: ['Sáng thứ Hai, cái ngày mà cả vũ trụ đều ghét', 'Tối hôm đó, đúng lúc mất điện', 'Giữa trưa nắng ba mươi tám độ', 'Chiều chủ nhật, khi wifi chập chờn', 'Sáng sớm, chuông báo thức kêu lần thứ bảy', 'Tối ba mươi Tết'],
      open: [
        '{T}, {F} quyết định thay đổi cuộc đời bằng {I}.',
        '{T}, {F} và {M} lại có mặt ở {P} với một kế hoạch "hoàn hảo".',
        '{T}. Mọi chuyện bắt đầu từ một tin nhắn nhóm của {S}.',
        '{T}. {M} tuyên bố: "Từ hôm nay tao sẽ sống nghiêm túc." Không ai tin.',
        '{T}. Cả {P} đang yên bình thì {F} xuất hiện.'
      ],
      narr: [
        'Kế hoạch nghe thì hoàn hảo, nhưng như mọi khi, thực tế lại có ý kiến khác.',
        '{M} gật gù như đã hiểu, nhưng ánh mắt thì trống rỗng như ví tiền cuối tháng.',
        '{S} đứng hình mất năm giây, rồi lặng lẽ rút điện thoại ra quay video.',
        'Không khí im lặng đến mức nghe rõ tiếng con muỗi đang tính chuyện đốt ai.',
        '{F} tự tin bước lên, và ngay lập tức vấp phải {I}.',
        'Cả {P} được một phen cười nghiêng ngả.',
        'Đó là lần thứ ba trong tuần {F} thề sẽ không bao giờ tin lời {M} nữa.',
        'Mọi thứ diễn ra suôn sẻ được đúng hai phút.',
        'Ở một góc, {S} vừa ăn bánh tráng trộn vừa bình luận như bình luận viên bóng đá.',
        '{M} cố nhịn cười đến mức mặt đỏ như trái cà chua.',
        'Tin đồn lan nhanh hơn cả tốc độ wifi nhà hàng xóm.',
        '{F} hít một hơi thật sâu, chuẩn bị tinh thần cho một quyết định sai lầm nữa.',
        'Không ai hiểu vì sao {I} lại xuất hiện ở đó, và có lẽ cũng chẳng ai muốn hiểu.',
        'Sau ba mươi phút bàn bạc, cả nhóm thống nhất được đúng một điều: đi ăn trước đã.',
        'Lý thuyết thì {F} thuộc làu, thực hành thì {F} thuộc dạng thảm họa.',
        'Con chó nhà bên sủa lên ba tiếng, như thể nó cũng thấy chuyện này quá vô lý.',
        '{M} mở điện thoại tra "cách xử lý tình huống khó đỡ", kết quả trả về toàn quảng cáo.',
        'Một cơn gió thổi qua, mang theo mùi bún đậu và cả sự xấu hổ của {F}.',
        '{S} thở dài, lắc đầu, rồi lại tiếp tục quay video.',
        'Đến lúc này, {F} mới nhận ra mình đã mặc áo trái từ sáng.'
      ],
      dialog: [
        '— Bình tĩnh, tao có kế hoạch rồi! — {F} hét lên.',
        '— Lần trước mày cũng nói y chang câu đó. — {M} thở dài.',
        '— Ai cho phép hai đứa bày trò ở đây hả? — {S} chống nạnh.',
        '— Đây không phải lỗi của em, là lỗi của {I}!',
        '— Ủa, rồi giờ sao? Ai giải thích giùm cái?',
        '— Tin tao đi, lần này chắc chắn thành công chín mươi chín phần trăm.',
        '— Còn một phần trăm kia là gì?',
        '— Là... chuyện đang xảy ra bây giờ.',
        '— Trời ơi, đừng có quay! Đừng đăng lên mạng!',
        '— Tao nói rồi mà, đừng có tin mấy video hướng dẫn trên mạng.',
        '— Thôi, coi như mình chưa từng quen nhau nha.',
        '— Ê, nghiêm túc nè, nhìn tao có giống người đáng tin không?',
        '— Không.',
        '— Trả lời nhanh vậy luôn hả?',
        '— Có ai thấy {I} của tui đâu không?'
      ],
      end: [
        'Và đó là cách {F} trở thành "người nổi tiếng" bất đắc dĩ của {P}.',
        'Nhưng {F} không biết rằng, rắc rối thật sự chỉ mới bắt đầu...',
        'Tối hôm đó, nhóm chat của cả xóm có thêm hai trăm tin nhắn mới.',
        '{M} lặng lẽ ghi vào sổ tay: "Lần sau tuyệt đối không nghe lời {F}." Đây là cuốn sổ thứ ba.',
        'Ngày mai lại là một ngày mới. Một ngày mới đầy những ý tưởng tồi tệ mới.'
      ],
      chTitles: ['Kế hoạch hoàn hảo', 'Sự cố nhỏ', 'Nồi cơm điện nổi loạn', 'Buổi xem mắt định mệnh', 'Livestream thảm họa', 'Ai ăn vụng bánh?', 'Cuộc thi nấu ăn', 'Một ngày đi làm', 'Đại chiến giành wifi', 'Chuyến du lịch bụi', 'Họp tổ dân phố', 'Bí kíp giảm cân', 'Người hùng bất đắc dĩ', 'Tết nhà ai nấy lo', 'Cái kết có hậu?', 'Mất điện', 'Ngày hội thể thao'],
      desc: [
        '{F} và {M} — hai thánh "phá" nổi tiếng nhất {P} — lại vướng vào một phi vụ dở khóc dở cười chỉ vì {I}.',
        'Cuộc sống bình thường của {F} bị đảo lộn hoàn toàn khi {M} chuyển đến ở cạnh nhà. Từ đây, cả khu phố không còn ngày nào yên tĩnh.',
        'Tưởng đơn giản, ai ngờ việc giữ gìn {I} lại khiến {F} phải trải qua một chuỗi tình huống "có một không hai".',
        'Hành trình tìm lại tuổi thanh xuân (và cái ví bị mất) của {F} cùng hội bạn thân lầy lội ở {P}.'
      ]
    },
    {
      id: 'ngon-tinh', code: 'NT', name: 'Ngôn tình', color: '#E05C9B',
      titleA: ['Tổng Tài', 'Bác Sĩ Lục', 'Cô Vợ Hợp Đồng', 'Thanh Mai', 'Người Thương Cũ', 'Nữ Luật Sư', 'Chàng Họa Sĩ', 'Cô Gái Tiệm Hoa', 'Phó Giáo Sư', 'Ảnh Đế', 'Anh Hàng Xóm', 'Nữ Phóng Viên'],
      titleB: ['Yêu Muộn', 'Đừng Chạy', 'Và Nắng Hạ Năm Ấy', 'Và Mùa Thu Không Hẹn', 'Giữ Em Thật Chặt', 'Ngày Mưa Gặp Lại', 'Cưng Chiều Tận Trời', 'Một Đời Bình Yên', 'Bên Kia Thành Phố', 'Hẹn Ước Mười Năm', 'Đến Muộn'],
      titleX: ['Nếu Ngày Ấy Anh Ở Lại', 'Chiếc Ô Màu Xanh', 'Thành Phố Không Có Mùa Đông', 'Gửi Em Của Năm Mười Bảy', 'Hoàng Hôn Ở Bờ Biển Cũ', 'Cà Phê Ít Đường', 'Ánh Sao Trên Sân Thượng', 'Lá Thư Không Gửi', 'Chờ Một Người Quay Về', 'Mùa Hạ Có Anh'],
      female: ['Tô Niệm', 'Hạ An Nhiên', 'Thẩm Tri Ý', 'Lâm Vãn Tình', 'Giang Tiểu Mãn', 'Ôn Noãn', 'Diệp Khả Hân', 'Trình Thanh Thư'],
      male: ['Lục Cảnh Thâm', 'Cố Bắc Thần', 'Giang Dĩ Hằng', 'Phó Tư Viễn', 'Hoắc Lâm Xuyên', 'Tần Mặc', 'Thẩm Hoài Chi', 'Tạ Dịch Bạch'],
      side: ['cô bạn thân Tiểu Mễ', 'trợ lý Trần', 'mẹ của anh', 'người yêu cũ', 'đàn em khóa dưới', 'bà nội', 'quản lý nhà hàng', 'cậu em họ'],
      places: ['quán cà phê góc phố', 'bệnh viện thành phố', 'văn phòng tầng ba mươi hai', 'sân thượng trường cũ', 'tiệm sách nhỏ', 'bờ biển lúc hoàng hôn', 'sân bay', 'căn hộ ven sông'],
      items: ['chiếc ô màu xanh', 'bức thư tay năm mười bảy tuổi', 'chiếc nhẫn bạc', 'tấm ảnh cũ', 'cốc cà phê sữa ít đường', 'chiếc khăn len tự đan', 'hộp nhạc gỗ', 'bản hợp đồng hôn nhân'],
      times: ['Thành phố vào thu, lá vàng rơi đầy lối đi', 'Một buổi chiều mưa tầm tã', 'Đêm Giáng sinh, phố xá rực rỡ ánh đèn', 'Sáng thứ Bảy, nắng nhẹ len qua rèm cửa', 'Mười giờ đêm, văn phòng chỉ còn lại hai người', 'Mùa hạ năm ấy, ve kêu râm ran'],
      open: [
        '{T}. {F} không ngờ sẽ gặp lại {M} ở {P}.',
        '{T}. {F} ôm {I} trong tay, lòng rối như tơ vò.',
        '{T}. Ở {P}, có một người vẫn luôn chờ cô.',
        '{T}. {M} đứng đó, giữa dòng người qua lại, như chưa từng rời đi.',
        '{T}. Cô đã tự nhủ sẽ không bao giờ quay lại {P} nữa.'
      ],
      narr: [
        'Bảy năm không gặp, anh vẫn vậy, chỉ có ánh mắt là trầm hơn.',
        'Trái tim cô bỗng lỡ một nhịp.',
        '{M} cởi áo khoác, nhẹ nhàng khoác lên vai cô.',
        'Cô tự nhủ, lần này nhất định không được mềm lòng.',
        'Có những người, chỉ cần xuất hiện thôi cũng đủ làm cả thế giới lặng đi.',
        '{S} nháy mắt đầy ẩn ý rồi nhanh chóng rút lui.',
        'Mùi hương quen thuộc trên người anh khiến cô nhớ lại những ngày tháng cũ.',
        'Anh không nói gì, chỉ lặng lẽ đi phía sau cô suốt quãng đường về.',
        'Cô cúi đầu, giấu đi đôi mắt đã đỏ hoe.',
        'Hóa ra, suốt những năm qua, người giữ {I} vẫn luôn là anh.',
        'Điện thoại rung lên, màn hình hiện một tin nhắn ngắn: "Anh đang ở dưới nhà."',
        'Giữa dòng người vội vã, anh chỉ nhìn thấy mỗi mình cô.',
        '{F} biết, có những chuyện nếu không nói ra bây giờ, có lẽ cả đời sẽ không còn cơ hội.',
        'Anh khẽ cười, nụ cười dịu dàng mà cô đã lâu không được thấy.',
        'Mưa vẫn rơi, nhưng dường như không còn lạnh nữa.',
        'Khoảng cách giữa hai người chỉ còn một bước chân.',
        'Cô đã từng nghĩ thời gian có thể xóa nhòa tất cả, nhưng hóa ra không phải.',
        '{M} đặt {I} lên bàn, đẩy nhẹ về phía cô.',
        'Ánh đèn đường hắt bóng hai người dài ra trên vỉa hè ướt nước.',
        'Cô bật cười, rồi lại thấy sống mũi cay cay.'
      ],
      dialog: [
        '— Lâu rồi không gặp. — {M} lên tiếng trước.',
        '— Anh đến đây làm gì?',
        '— Đến tìm em. Chỉ vậy thôi.',
        '— Chúng ta... đã kết thúc từ lâu rồi.',
        '— Với em có thể là vậy, còn với anh thì chưa bao giờ.',
        '— Đừng tốt với em như vậy, em sẽ hiểu lầm đấy.',
        '— Vậy thì cứ hiểu lầm đi.',
        '— {F}, em còn định trốn anh đến bao giờ?',
        '— Ăn sáng chưa? Anh mua cho em rồi đây.',
        '— Cô ấy là ai vậy? — {S} tò mò hỏi.',
        '— Là người quan trọng nhất của tôi.',
        '— Em mệt rồi, anh về đi.',
        '— Anh chờ được. Bao lâu cũng chờ được.',
        '— Sao anh vẫn còn giữ {I}?'
      ],
      end: [
        'Đêm đó, cô trằn trọc mãi không ngủ được.',
        'Cô không biết rằng, ở dưới lầu, anh đã đứng đó rất lâu.',
        'Có lẽ, lần này, cô nên cho mình thêm một cơ hội.',
        'Ngoài cửa sổ, thành phố vẫn sáng đèn, như chưa từng biết đến những nỗi niềm của cô.',
        'Câu chuyện của họ, hóa ra vẫn chưa đến hồi kết.'
      ],
      chTitles: ['Gặp lại', 'Chiếc ô xanh', 'Hợp đồng', 'Hiểu lầm', 'Ngày mưa', 'Người cũ', 'Bí mật của anh', 'Lời tỏ tình muộn', 'Sân thượng năm ấy', 'Ghen', 'Chạy trốn', 'Về nhà', 'Hứa hẹn', 'Bình yên', 'Mãi mãi', 'Tin nhắn lúc nửa đêm', 'Hoàng hôn'],
      desc: [
        'Bảy năm sau ngày chia tay, {F} gặp lại {M} ở {P}. Anh vẫn vậy, chỉ có điều lần này anh không định buông tay nữa.',
        'Một bản hợp đồng, hai con người, ba điều khoản không được phá vỡ. Nhưng trái tim thì đâu cần tuân theo hợp đồng?',
        '{F} chỉ muốn sống một cuộc đời bình yên, cho đến khi {M} xuất hiện cùng {I} — món đồ cô đã đánh mất từ năm mười bảy tuổi.',
        'Anh là người cô từng thầm thương suốt thời thanh xuân. Cô là người anh tìm kiếm suốt những năm tháng trưởng thành.'
      ]
    }
  ];

  const PEN_A = ['Mộc', 'Tiểu', 'Lam', 'Thanh', 'Bạch', 'Nguyệt', 'Phong', 'Vân', 'Hạ', 'Thu', 'Mặc', 'Tuyết'];
  const PEN_B = ['Lan', 'Vũ', 'Hy', 'Miên', 'Dao', 'Khê', 'Yên', 'Linh', 'Ca', 'Sương', 'Hà', 'Nhiên'];
  const PEN_C = ['', '', '', ' Tử', ' Nhi', ' Cô Nương', ' Tiên Sinh', ' Các'];

  const pad2 = n => String(n).padStart(2, '0');

  function makeTitles(g, r) {
    const set = new Set();
    g.titleX.forEach(t => set.add(t));
    shuffle(g.titleA, r).forEach(a => shuffle(g.titleB, r).forEach(b => set.add(a + ' ' + b)));
    // giữ các tiêu đề "đặc biệt" + trộn lẫn tổ hợp
    const special = g.titleX.slice();
    const combos = shuffle([...set].filter(t => !special.includes(t)), r);
    return shuffle(special.concat(combos.slice(0, 50 - special.length)), r);
  }

  const stories = [];
  GENRES.forEach(g => {
    const r = mulberry32(hash('lib-' + g.id));
    const titles = makeTitles(g, r);
    for (let i = 0; i < 50; i++) {
      const seed = hash(g.id + '#' + i);
      const sr = mulberry32(seed);
      const cast = { F: pick(g.female, sr), M: pick(g.male, sr) };
      const chapters = 8 + Math.floor(sr() * 17);              // 8..24 chương
      const status = sr() < 0.62 ? 'Hoàn thành' : 'Đang ra';
      const views = Math.floor(1500 + Math.pow(sr(), 2.6) * 1800000);
      const rating = Math.round((3.6 + sr() * 1.4) * 10) / 10;
      const d = new Date(Date.UTC(2025, 0, 1) + Math.floor(sr() * 668) * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const author = pick(PEN_A, sr) + ' ' + pick(PEN_B, sr) + pick(PEN_C, sr);
      const desc = fill(pick(g.desc, sr), Object.assign({ P: pick(g.places, sr), I: pick(g.items, sr) }, cast));
      stories.push({
        id: g.code.toLowerCase() + '-' + pad2(i + 1),
        genre: g.id, genreName: g.name,
        title: titles[i], author, chapters, status, views, rating,
        updated: iso, updatedText: iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4),
        desc, seed, cast
      });
    }
  });

  const genreOf = st => GENRES.find(g => g.id === st.genre);

  function chapterTitles(st) {
    const g = genreOf(st);
    const pool = shuffle(g.chTitles, mulberry32(st.seed ^ 0x9e3779b9));
    const out = [];
    for (let i = 0; i < st.chapters; i++) {
      const base = pool[i % pool.length];
      out.push('Chương ' + (i + 1) + ': ' + (i < pool.length ? base : base + ' (tiếp)'));
    }
    return out;
  }

  function getChapter(st, i) {
    const g = genreOf(st);
    const r = mulberry32((st.seed + Math.imul(i + 1, 7919)) >>> 0);
    const ctx = Object.assign({}, st.cast, {
      S: pick(g.side, r), P: pick(g.places, r), I: pick(g.items, r), T: pick(g.times, r)
    });
    const n = 16 + Math.floor(r() * 10);
    const paras = [fill(pick(g.open, r), ctx)];
    let narr = shuffle(g.narr, r), dial = shuffle(g.dialog, r);
    const take = (pool, src) => { if (!pool.length) pool.push(...shuffle(src, r)); return pool.pop(); };
    while (paras.length < n - 1) {
      if (r() < 0.38) {
        const k = 2 + Math.floor(r() * 3);
        for (let j = 0; j < k && paras.length < n - 1; j++) paras.push(fill(take(dial, g.dialog), ctx));
      } else {
        paras.push(fill(take(narr, g.narr), ctx));
      }
    }
    paras.push(fill(pick(g.end, r), ctx));
    if (i === st.chapters - 1 && st.status === 'Hoàn thành') paras.push('(Toàn văn hoàn)');
    return { title: chapterTitles(st)[i], paras };
  }

  global.STORY_LIB = {
    genres: GENRES.map(g => ({ id: g.id, code: g.code, name: g.name, color: g.color })),
    stories,
    chapterTitles,
    getChapter
  };
})(window);
