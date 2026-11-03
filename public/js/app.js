/* ============================================================
   Excel Story Reader – logic giao diện
   ============================================================ */
(function () {
  'use strict';

  const LIB = window.STORY_LIB;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const fmtNum = n => Number(n).toLocaleString('vi-VN');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function colIndex(name) { let n = 0; for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
  const fileSafe = s => norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/(^|_)([a-z])/g, (m, a, b) => a + b.toUpperCase()).slice(0, 60) || 'Truyen';

  const store = {
    get(k, d) { try { const v = localStorage.getItem('xlr.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('xlr.' + k, JSON.stringify(v)); } catch (e) { /* bộ nhớ không khả dụng */ } }
  };

  /* ------------------------------ Cài đặt ------------------------------ */
  const FONTS = ['Calibri', 'Cambria', 'Times New Roman', 'Arial', 'Segoe UI', 'Georgia', 'Tahoma', 'Verdana'];
  const SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28];
  const WIDTHS = [560, 680, 760, 880, 1000, 1160];
  const settings = Object.assign({
    zoom: 100, font: 'Calibri', size: 12, paper: 'default', align: 'justify', wrap: true,
    grid: true, headings: true, fbar: true, dark: false, readWidth: 760, bold: false
  }, store.get('settings', {}));

  function fontStack(f) {
    const serif = ['Cambria', 'Times New Roman', 'Georgia'].includes(f);
    return `'${f}', ${serif ? "Georgia, 'Times New Roman', serif" : "'Segoe UI', Arial, sans-serif"}`;
  }
  function applySettings() {
    const root = document.documentElement;
    root.dataset.theme = settings.dark ? 'dark' : 'light';
    root.dataset.paper = settings.paper;
    root.style.setProperty('--read-font', fontStack(settings.font));
    root.style.setProperty('--read-size', (settings.size * 4 / 3).toFixed(1) + 'px');
    root.style.setProperty('--read-align', settings.align);
    document.body.classList.toggle('no-grid', !settings.grid);
    document.body.classList.toggle('no-head', !settings.headings);
    document.body.classList.toggle('no-fbar', !settings.fbar);
    document.body.classList.toggle('nowrap', !settings.wrap);
    document.body.classList.toggle('boldread', settings.bold);
    $('#z-range').value = settings.zoom;
    $('#z-val').textContent = settings.zoom + '%';
    const t = $('#grid table'); if (t) t.style.zoom = settings.zoom / 100;
    syncRibbonState();
  }
  function saveSettings(rerender) { store.set('settings', settings); applySettings(); if (rerender) renderSheet(); }

  /* ------------------------------ Trạng thái ------------------------------ */
  const S = {
    filt: {}, imp: { url: '', max: 20, mode: 'auto', text: '' }, impLog: [],
    busy: false, menu: null, status: null, find: { res: [], pos: -1, q: '' }, selTd: null, model: null, dry: false
  };
  const W = { list: [], cur: 0, bossOn: false, boss: null };

  const curWb = () => (W.bossOn ? W.boss : W.list[W.cur]);
  const curSheet = () => { const wb = curWb(); return wb.sheets[wb.active]; };

  function libraryWorkbook() {
    return {
      id: 'lib', name: 'Thu_vien_truyen.xlsx', kind: 'library', active: 0,
      sheets: [
        { name: 'Tổng hợp', kind: 'library', genre: null, key: 'all', color: '#4472C4' },
        ...LIB.genres.map(g => ({ name: g.name, kind: 'library', genre: g.id, key: g.id, color: g.color })),
        { name: 'Đang đọc', kind: 'history', color: '#7030A0' },
        { name: 'Nhập link', kind: 'import', color: '#217346' }
      ]
    };
  }
  function bossWorkbook() {
    return { id: 'boss', name: 'Bao_cao_KPI_Q4_2026.xlsx', kind: 'boss', active: 0, sheets: [{ name: 'Tổng quan', kind: 'boss' }, { name: 'Chi tiết', kind: 'boss2' }, { name: 'Dữ liệu', kind: 'boss3' }] };
  }

  /* ------------------------------ Sách ------------------------------ */
  function libBook(st) {
    return {
      key: 'lib:' + st.id, src: 'lib', story: st, title: st.title, author: st.author, genre: st.genreName,
      status: st.status, views: st.views, rating: st.rating, desc: st.desc, url: null, nextUrl: null,
      chapters: LIB.chapterTitles(st).map(t => ({ title: t, paras: null, state: 'idle' }))
    };
  }
  function chapterSheetName(book, ch, i, used) {
    let name;
    if (book.src === 'lib') name = 'Chương ' + (i + 1);
    else {
      const m = (ch.title || '').match(/(?:chương|chuong|chapter|chap|hồi)\s*(\d+)/i);
      name = m ? 'Chương ' + m[1] : 'Phần ' + (i + 1);
    }
    let n = name, k = 2;
    while (used.has(n)) n = name + ' (' + (k++) + ')';
    used.add(n);
    return n;
  }
  function syncStorySheets(wb) {
    const b = wb.book;
    const used = new Set(wb.sheets.map(s => s.name));
    for (let i = wb.sheets.length - 1; i < b.chapters.length; i++) {
      wb.sheets.push({ name: chapterSheetName(b, b.chapters[i], i, used), kind: 'reader', ch: i });
    }
  }
  function storyWorkbook(book) {
    const wb = { id: book.key, name: fileSafe(book.title) + '.xlsx', kind: 'story', book, active: 0, sheets: [{ name: 'Mục lục', kind: 'toc', color: '#217346' }] };
    syncStorySheets(wb);
    return wb;
  }

  function ensureChapter(book, i) {
    const ch = book.chapters[i];
    if (!ch || ch.paras) return;
    if (book.src !== 'web') { // lib + văn bản dán
      const data = LIB.getChapter(book.story, i);
      ch.paras = data.paras; ch.state = 'done';
      return;
    }
    if (S.dry || ch.state === 'loading') return;
    ch.state = 'loading'; ch.err = null;
    ch._p = apiImport(ch.url).then(r => {
      ch.paras = r.paragraphs.length ? r.paragraphs : ['(Không trích xuất được nội dung — trang có thể tải nội dung bằng JavaScript hoặc chặn truy cập tự động. Hãy thử dùng ô "Dán văn bản".)'];
      ch.state = 'done';
      if (r.chapterTitle && !ch.title) ch.title = r.chapterTitle;
    }).catch(e => { ch.state = 'error'; ch.err = e.message; })
      .finally(() => onChapterLoaded(book, i));
  }
  function ensureChapterAsync(book, i) {
    const ch = book.chapters[i];
    if (ch.paras) return Promise.resolve();
    if (ch.state !== 'loading') ensureChapter(book, i);
    return ch._p || Promise.resolve();
  }
  function onChapterLoaded(book) {
    const wb = curWb();
    if (wb.book !== book) return;
    renderTabs();
    const sh = curSheet();
    if (sh.kind === 'toc' || sh.kind === 'reader') renderSheet();
  }

  /* ------------------------------ Lịch sử đọc ------------------------------ */
  const getHist = () => store.get('history', []);
  function touchHistory(wb, i) {
    const b = wb.book;
    if (b.src === 'paste') return;
    const h = getHist();
    let e = h.find(x => x.key === b.key);
    if (!e) e = { key: b.key, max: 0 };
    Object.assign(e, {
      title: b.title, genre: b.genre || 'Từ link', src: b.src, libId: b.story ? b.story.id : null,
      url: (b.chapters[i] && b.chapters[i].url) || b.url, bookUrl: b.url, bookKind: b.bookKind || null,
      ch: i, total: b.chapters.length, max: Math.max(e.max || 0, i + 1), ts: Date.now()
    });
    store.set('history', [e, ...h.filter(x => x.key !== b.key)].slice(0, 60));
  }
  const histOf = key => getHist().find(x => x.key === key);

  /* ------------------------------ Mô hình sheet ------------------------------ */
  const C = (c, t, o) => Object.assign({ c, t: t == null ? '' : String(t) }, o || {});

  const LCOLS = [
    { k: 'idx', label: 'STT', w: 48, num: true },
    { k: 'title', label: 'Tên truyện', w: 290 },
    { k: 'author', label: 'Tác giả', w: 150 },
    { k: 'genreName', label: 'Thể loại', w: 92, en: true },
    { k: 'chapters', label: 'Số chương', w: 88, num: true },
    { k: 'status', label: 'Trạng thái', w: 108, en: true },
    { k: 'views', label: 'Lượt đọc', w: 132, num: true },
    { k: 'rating', label: 'Đánh giá', w: 92, num: true },
    { k: 'updated', label: 'Cập nhật', w: 98, date: true },
    { k: 'desc', label: 'Mô tả', w: 560 }
  ];
  const getFilt = key => (S.filt[key] = S.filt[key] || { sort: null, q: {}, sel: {} });
  function baseList(sh) {
    const list = sh.genre ? LIB.stories.filter(s => s.genre === sh.genre) : LIB.stories;
    return list.map((s, i) => Object.assign({ idx: i + 1 }, s));
  }
  function filteredList(sh) {
    const f = getFilt(sh.key);
    let list = baseList(sh).filter(row => {
      for (const k in f.q) if (f.q[k] && !norm(row[k]).includes(norm(f.q[k]))) return false;
      for (const k in f.sel) if (f.sel[k] && !f.sel[k].includes(row[k])) return false;
      return true;
    });
    if (f.sort) {
      const col = LCOLS.find(c => c.k === f.sort.k), d = f.sort.dir;
      list = list.slice().sort((a, b) => {
        const x = a[col.k], y = b[col.k];
        const r = col.num ? x - y : String(x).localeCompare(String(y), 'vi');
        return r * d;
      });
    }
    return list;
  }
  const filterActive = (f, k) => !!(f.q[k] || f.sel[k] || (f.sort && f.sort.k === k));

  function modelLibrary(sh) {
    const f = getFilt(sh.key);
    const all = baseList(sh), list = filteredList(sh);
    const maxViews = Math.max(...all.map(s => s.views));
    const rows = [];
    const label = sh.genre ? sh.name.toUpperCase() : 'TẤT CẢ THỂ LOẠI';
    rows[0] = { cells: [C(0, 'THƯ VIỆN TRUYỆN — ' + label, { cs: 10, cls: 'title', html: '<b>THƯ VIỆN TRUYỆN</b> — ' + esc(label) })] };
    rows[1] = { cells: [C(0, `Hiển thị ${list.length}/${all.length} truyện · Bấm vào tên truyện (chữ xanh) để đọc · Bấm ▾ ở tiêu đề cột để sắp xếp/lọc · Ctrl+F để tìm`, { cs: 10, cls: 'note' })] };
    rows[3] = {
      cells: LCOLS.map((col, i) => C(i, col.label, {
        cls: 'th',
        html: esc(col.label) + `<button class="fbtn${filterActive(f, col.k) ? ' on' : ''}" data-filter="${col.k}" title="Sắp xếp & Lọc">${filterActive(f, col.k) ? (f.sort && f.sort.k === col.k ? (f.sort.dir > 0 ? '▲' : '▼') : '⧩') : '▾'}</button>`
      }))
    };
    list.forEach((s, i) => {
      const b = i % 2 ? ' b' : '';
      const ic = s.rating >= 4.5 ? 'up' : s.rating >= 4.0 ? 'side' : 'down';
      rows.push({
        cells: [
          C(0, s.idx, { cls: 'num' + b }),
          C(1, s.title, { cls: 'link' + b, act: 'open:' + s.id, f: `=HYPERLINK("#${s.id}";"${s.title}")` }),
          C(2, s.author, { cls: b }),
          C(3, s.genreName, { cls: b }),
          C(4, s.chapters, { cls: 'num' + b }),
          C(5, s.status, { cls: s.status === 'Hoàn thành' ? 'good' : 'neutral' }),
          C(6, s.views, { cls: 'num databar' + b, html: `<span class="dbar" style="--p:${(s.views / maxViews).toFixed(3)}"></span><span class="dv">${fmtNum(s.views)}</span>` }),
          C(7, s.rating.toFixed(1), { cls: 'num' + b, html: `<span class="ico ${ic}"></span>${s.rating.toFixed(1).replace('.', ',')}` }),
          C(8, s.updatedText, { cls: 'num' + b }),
          C(9, s.desc, { cls: b })
        ]
      });
    });
    const r0 = 5, r1 = 4 + list.length;
    const sumCh = list.reduce((a, s) => a + s.chapters, 0), sumV = list.reduce((a, s) => a + s.views, 0);
    const avg = list.length ? list.reduce((a, s) => a + s.rating, 0) / list.length : 0;
    rows.push({
      cells: [
        C(0, 'Tổng', { cls: 'tot', cs: 4 }),
        C(4, sumCh, { cls: 'tot num', f: `=SUBTOTAL(109;E${r0}:E${r1})` }),
        C(5, '', { cls: 'tot' }),
        C(6, fmtNum(sumV), { cls: 'tot num', f: `=SUBTOTAL(109;G${r0}:G${r1})` }),
        C(7, avg.toFixed(2).replace('.', ','), { cls: 'tot num', f: `=SUBTOTAL(101;H${r0}:H${r1})` }),
        C(8, '', { cls: 'tot' }), C(9, '', { cls: 'tot' })
      ]
    });
    return { cols: LCOLS.map(c => c.w), rows, minCols: 14 };
  }

  function modelHistory() {
    const h = getHist();
    const rows = [];
    rows[0] = { cells: [C(0, 'ĐANG ĐỌC', { cs: 7, cls: 'title', html: '<b>ĐANG ĐỌC</b> — lịch sử đọc trên trình duyệt này' })] };
    rows[1] = { cells: [C(0, h.length ? `${h.length} truyện · Bấm tên truyện để đọc tiếp` : 'Chưa có lịch sử. Mở một truyện bất kỳ trong các sheet thể loại để bắt đầu.', { cs: 7, cls: 'note' })] };
    rows[3] = { cells: ['STT', 'Tên truyện', 'Thể loại', 'Đang ở', 'Tiến độ', 'Lần đọc cuối', 'Nguồn'].map((t, i) => C(i, t, { cls: 'th' })) };
    h.forEach((e, i) => {
      const b = i % 2 ? ' b' : '';
      const p = e.total ? Math.min(1, e.max / e.total) : 0;
      rows.push({
        cells: [
          C(0, i + 1, { cls: 'num' + b }),
          C(1, e.title, { cls: 'link' + b, act: 'resume:' + i }),
          C(2, e.genre, { cls: b }),
          C(3, 'Chương ' + (e.ch + 1) + '/' + e.total, { cls: b }),
          C(4, Math.round(p * 100) + '%', { cls: 'num databar' + b, html: `<span class="dbar" style="--p:${p.toFixed(3)}"></span><span class="dv">${Math.round(p * 100)}%</span>` }),
          C(5, new Date(e.ts).toLocaleString('vi-VN'), { cls: 'num' + b }),
          C(6, e.src === 'web' ? (e.bookUrl || e.url) : 'Thư viện', { cls: b })
        ]
      });
    });
    if (h.length) { rows.push(null); rows.push({ cells: [C(1, '🗑 Xóa lịch sử đọc', { cls: 'link', act: 'clearHist' })] }); }
    return { cols: [48, 300, 100, 120, 140, 150, 360], rows };
  }

  function modelImport() {
    const rows = [];
    const im = S.imp;
    rows[0] = { cells: [C(1, 'NHẬP TRUYỆN TỪ LINK', { cs: 8, cls: 'title', html: '<b>NHẬP TRUYỆN TỪ LINK</b>' })] };
    rows[1] = { cells: [C(1, 'Dán link trang mục lục hoặc trang chương. Hệ thống sẽ tải nội dung và chia mỗi chương thành một sheet riêng.', { cs: 8, cls: 'note' })] };
    rows[3] = {
      h: 26, cells: [
        C(1, 'Link truyện (URL)', { cls: 'lbl' }),
        C(2, im.url, { cs: 6, cls: 'inputcell', html: `<input id="imp-url" type="url" placeholder="https://..." value="${esc(im.url)}" autocomplete="off" spellcheck="false">` }),
        C(8, 'Nhập', { cls: 'btncell', act: 'import', html: `<button>${S.busy ? 'Đang tải…' : '▶ Nhập'}</button>` })
      ]
    };
    const maxOpts = [5, 10, 20, 50, 100, 200, 500].map(n => `<option value="${n}"${+im.max === n ? ' selected' : ''}>${n} chương</option>`).join('');
    const modeOpts = [['auto', 'Tự động nhận diện'], ['toc', 'Trang mục lục'], ['chapter', 'Trang chương (đi theo "Chương sau")']]
      .map(([v, t]) => `<option value="${v}"${im.mode === v ? ' selected' : ''}>${t}</option>`).join('');
    rows[4] = {
      h: 26, cells: [
        C(1, 'Số chương tối đa', { cls: 'lbl' }),
        C(2, im.max, { cs: 2, cls: 'inputcell', html: `<select id="imp-max">${maxOpts}</select>` }),
        C(4, 'Chế độ', { cls: 'lbl' }),
        C(5, im.mode, { cs: 3, cls: 'inputcell', html: `<select id="imp-mode">${modeOpts}</select>` })
      ]
    };
    rows[6] = {
      h: 150, cells: [
        C(1, 'Hoặc dán văn bản', { cls: 'lbl' }),
        C(2, '', { cs: 6, cls: 'inputcell', html: `<textarea id="imp-text" placeholder="Dán nội dung truyện vào đây. Dòng tiêu đề đầu tiên (nếu có) sẽ là tên truyện; các dòng &quot;Chương 1&quot;, &quot;Chương 2&quot;… sẽ được tách thành từng sheet.">${esc(im.text)}</textarea>` }),
        C(8, 'Tách chương', { cls: 'btncell', act: 'paste', html: '<button>✂ Tách chương</button>' })
      ]
    };
    rows[8] = { cells: [C(1, 'Thời gian', { cls: 'th' }), C(2, 'Trạng thái', { cls: 'th' }), C(3, 'Chi tiết', { cls: 'th', cs: 6 })] };
    if (!S.impLog.length) rows.push({ cells: [C(1, '—', { cls: 'muted' }), C(2, 'Chưa có', { cls: 'muted' }), C(3, 'Nhật ký nhập sẽ hiển thị tại đây.', { cs: 6, cls: 'muted' })] });
    S.impLog.forEach(l => rows.push({
      cells: [C(1, l.time), C(2, l.st, { cls: l.st === 'Lỗi' ? 'bad' : l.st === 'OK' ? 'good' : 'neutral' }), C(3, l.msg, { cs: 6 })]
    }));
    rows.push(null);
    rows.push({ cells: [C(1, 'Lưu ý', { cls: 'lbl' }), C(2, '• Chỉ nhập nội dung bạn có quyền đọc; tôn trọng bản quyền và điều khoản sử dụng của trang nguồn.', { cs: 7 })] });
    rows.push({ cells: [C(2, '• Một số trang chặn tải tự động hoặc tải nội dung bằng JavaScript — khi đó hãy dùng ô "Dán văn bản".', { cs: 7 })] });
    rows.push({ cells: [C(2, '• Mỗi lần tải chương cách nhau ~0,4 giây để tránh gây tải cho trang nguồn. Nội dung nhập chỉ nằm trong bộ nhớ trình duyệt.', { cs: 7 })] });
    rows.push({ cells: [C(2, '• Nhấn Ctrl+S (hoặc Tệp › Lưu bản sao) để xuất truyện thành file .xlsx thật — mỗi chương một sheet.', { cs: 7 })] });
    return { cols: [36, 150, 110, 110, 110, 110, 110, 110, 130], rows };
  }

  function modelToc(wb) {
    const b = wb.book, rows = [];
    const hist = histOf(b.key);
    rows[0] = { cells: [C(1, b.title, { cs: 5, cls: 'title', html: '<b>' + esc(b.title) + '</b>' })] };
    rows[1] = { cells: [C(1, [b.author, b.genre].filter(Boolean).join(' · ') || 'Truyện nhập', { cs: 5, cls: 'note' })] };
    const props = [
      ['Tác giả', b.author], ['Thể loại', b.genre],
      ['Số chương', b.chapters.length + (b.totalFound && b.totalFound > b.chapters.length ? ` (đã tạo sheet; tìm thấy ${b.totalFound})` : '') + (b.nextUrl ? ' (còn chương tiếp)' : '')],
      ['Trạng thái', b.status], ['Lượt đọc', b.views ? fmtNum(b.views) : ''], ['Đánh giá', b.rating ? b.rating.toFixed(1).replace('.', ',') + ' / 5' : '']
    ].filter(p => p[1]);
    let r = 3;
    props.forEach(([k, v]) => { rows[r++] = { cells: [C(1, k, { cls: 'lbl' }), C(2, v, { cs: 3, cls: k === 'Trạng thái' ? (v === 'Hoàn thành' ? 'good' : 'neutral') : '' })] }; });
    if (b.url) rows[r++] = { cells: [C(1, 'Nguồn', { cls: 'lbl' }), C(2, b.url, { cs: 3, cls: 'link', act: 'url' })] };
    if (b.desc) rows[r++] = { cells: [C(1, 'Giới thiệu', { cls: 'lbl' }), C(2, b.desc, { cs: 3, cls: 'wrap' })] };
    r++;
    const resumeCh = hist ? Math.min(hist.ch, b.chapters.length - 1) : 0;
    rows[r++] = { h: 26, cells: [C(1, hist ? `▶ Đọc tiếp: Chương ${resumeCh + 1}` : '▶ Bắt đầu đọc', { cs: 2, cls: 'btncell', act: 'sheet:' + (resumeCh + 1), html: `<button>${hist ? '▶ Đọc tiếp — ' + esc(wb.sheets[resumeCh + 1] ? wb.sheets[resumeCh + 1].name : '') : '▶ Bắt đầu đọc'}</button>` }),
      C(3, 'Xuất .xlsx', { cls: 'btncell', act: 'export', html: '<button class="ghost">⤓ Xuất .xlsx</button>' })] };
    r++;
    rows[r++] = { cells: [C(1, 'Sheet', { cls: 'th' }), C(2, 'Tiêu đề chương', { cls: 'th' }), C(3, 'Trạng thái', { cls: 'th' }), C(4, 'Số đoạn', { cls: 'th' })] };
    b.chapters.forEach((ch, i) => {
      const bb = i % 2 ? ' b' : '';
      const st = hist && i === hist.ch ? 'Đang đọc' : hist && i < hist.max ? 'Đã đọc' : ch.state === 'loading' ? 'Đang tải…' : ch.state === 'error' ? 'Lỗi tải' : 'Chưa đọc';
      rows[r++] = {
        cells: [
          C(1, wb.sheets[i + 1].name, { cls: 'link' + bb, act: 'sheet:' + (i + 1) }),
          C(2, ch.title, { cls: 'link' + bb, act: 'sheet:' + (i + 1) }),
          C(3, st, { cls: st === 'Đã đọc' ? 'good' : st === 'Đang đọc' ? 'neutral' : st === 'Lỗi tải' ? 'bad' : bb }),
          C(4, ch.paras ? ch.paras.length : '', { cls: 'num' + bb })
        ]
      };
    });
    if (b.nextUrl) rows[r++] = { cells: [C(1, '＋ Tải thêm chương', { cs: 2, cls: 'link', act: 'more' })] };
    return { cols: [36, 120, 420, 110, 90], rows };
  }

  function navRow(wb, i) {
    const n = wb.book.chapters.length;
    const hasNext = i < n - 1, canMore = !hasNext && wb.book.nextUrl;
    return {
      h: 26, cells: [
        C(1, '◀ Chương trước', { cs: 2, cls: (i > 0 ? 'link' : 'muted') + ' navcell', act: i > 0 ? 'sheet:' + i : null }),
        C(4, '☰ Mục lục', { cs: 2, cls: 'link center navcell', act: 'sheet:0' }),
        C(7, hasNext ? 'Chương sau ▶' : canMore ? 'Tải chương sau ▶' : 'Hết', { cs: 3, cls: (hasNext || canMore ? 'link' : 'muted') + ' right navcell', act: hasNext ? 'sheet:' + (i + 2) : canMore ? 'more' : null })
      ]
    };
  }

  function modelReader(wb, sh) {
    const b = wb.book, i = sh.ch, ch = b.chapters[i];
    ensureChapter(b, i);
    const unit = Math.round(settings.readWidth / 9);
    const rows = [];
    rows.push({ cells: [C(1, ch.title, { cs: 9, cls: 'rtitle' })] });
    rows.push({ cells: [C(1, b.title + (b.author ? ' — ' + b.author : ''), { cs: 9, cls: 'note' })] });
    rows.push(navRow(wb, i));
    rows.push(null);
    if (ch.state === 'error') {
      rows.push({ cells: [C(1, '⚠ ' + ch.err, { cs: 9, cls: 'err wrap' })] });
      rows.push({ cells: [C(1, '↻ Thử lại', { cs: 2, cls: 'link', act: 'retry:' + i })] });
    } else if (!ch.paras) {
      rows.push({ cells: [C(1, '⏳ Đang tải nội dung chương… (có thể mất vài giây)', { cs: 9, cls: 'note' })] });
    } else {
      ch.paras.forEach(p => rows.push({ cells: [C(1, p, { cs: 9, cls: 'para' })] }));
      // tải trước chương kế tiếp (chỉ với truyện từ link)
      if (b.src === 'web' && !S.dry && b.chapters[i + 1] && b.chapters[i + 1].state === 'idle') setTimeout(() => ensureChapter(b, i + 1), 600);
    }
    rows.push(null);
    rows.push(navRow(wb, i));
    if (i === b.chapters.length - 1 && !b.nextUrl && ch.paras) rows.push({ cells: [C(1, '— Hết truyện (hoặc hết phần đã nhập) —', { cs: 9, cls: 'note center' })] });
    return { cols: [36].concat(Array(9).fill(unit)), rows, minRows: rows.length + 12 };
  }

  function seeded(n) { let a = n; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; }
  function modelBoss(sh) {
    const r = seeded(sh.kind === 'boss' ? 42 : sh.kind === 'boss2' ? 7 : 99);
    const depts = ['Kinh doanh miền Bắc', 'Kinh doanh miền Trung', 'Kinh doanh miền Nam', 'Marketing', 'Chăm sóc khách hàng', 'Vận hành', 'Kho vận', 'Mua hàng', 'Nhân sự', 'Tài chính', 'CNTT', 'Pháp chế'];
    const rows = [];
    rows[0] = { cells: [C(0, 'BÁO CÁO KPI QUÝ 4/2026', { cs: 7, cls: 'title', html: '<b>BÁO CÁO KPI QUÝ 4/2026</b> — ' + esc(sh.name) })] };
    rows[1] = { cells: [C(0, 'Đơn vị: triệu đồng · Số liệu minh họa · Cập nhật tự động lúc ' + new Date().toLocaleTimeString('vi-VN'), { cs: 7, cls: 'note' })] };
    rows[3] = { cells: ['Bộ phận', 'Mục tiêu', 'Thực hiện', 'Chênh lệch', 'Tỷ lệ %', 'Xu hướng', 'Ghi chú'].map((t, i) => C(i, t, { cls: 'th' })) };
    let st = 0, sa = 0;
    depts.forEach((d, i) => {
      const t = Math.round(800 + r() * 4200), a = Math.round(t * (0.72 + r() * 0.5));
      st += t; sa += a;
      const p = a / t, row = 5 + i, bb = i % 2 ? ' b' : '';
      rows.push({
        cells: [
          C(0, d, { cls: bb }), C(1, fmtNum(t), { cls: 'num' + bb, f: String(t) }), C(2, fmtNum(a), { cls: 'num' + bb, f: String(a) }),
          C(3, fmtNum(a - t), { cls: 'num' + bb, f: `=C${row}-B${row}` }),
          C(4, (p * 100).toFixed(1).replace('.', ',') + '%', { cls: 'num ' + (p >= 1 ? 'good' : p >= 0.9 ? 'neutral' : 'bad'), f: `=C${row}/B${row}` }),
          C(5, '', { cls: 'center' + bb, html: `<span class="ico ${p >= 1 ? 'up' : p >= 0.9 ? 'side' : 'down'}" style="float:none"></span>` }),
          C(6, p >= 1 ? 'Vượt kế hoạch' : p >= 0.9 ? 'Theo dõi' : 'Cần cải thiện', { cls: bb })
        ]
      });
    });
    const last = 4 + depts.length;
    rows.push({ cells: [C(0, 'Tổng cộng', { cls: 'tot' }), C(1, fmtNum(st), { cls: 'tot num', f: `=SUM(B5:B${last})` }), C(2, fmtNum(sa), { cls: 'tot num', f: `=SUM(C5:C${last})` }),
      C(3, fmtNum(sa - st), { cls: 'tot num', f: `=C${last + 1}-B${last + 1}` }), C(4, (sa / st * 100).toFixed(1).replace('.', ',') + '%', { cls: 'tot num', f: `=C${last + 1}/B${last + 1}` }), C(5, '', { cls: 'tot' }), C(6, '', { cls: 'tot' })] });
    return { cols: [190, 110, 110, 110, 90, 80, 160], rows };
  }

  function buildModel(wb, sh) {
    switch (sh.kind) {
      case 'library': return modelLibrary(sh);
      case 'history': return modelHistory();
      case 'import': return modelImport();
      case 'toc': return modelToc(wb);
      case 'reader': return modelReader(wb, sh);
      default: return modelBoss(sh);
    }
  }

  /* ------------------------------ Vẽ lưới ------------------------------ */
  const grid = $('#grid'), gridWrap = $('#gridwrap');

  function gridHtml(model, sh) {
    const ncols = Math.max(model.cols.length + 4, model.minCols || 16);
    const widths = [];
    for (let i = 0; i < ncols; i++) widths.push((sh.colW && sh.colW[i]) || model.cols[i] || 72);
    const nrows = Math.max(model.rows.length + 20, model.minRows || 60);
    const total = widths.reduce((a, b) => a + b, 0) + 44;
    const out = [`<table class="grid" style="width:${total}px;zoom:${settings.zoom / 100}"><colgroup><col class="rhcol" style="width:44px">`];
    widths.forEach(w => out.push(`<col style="width:${w}px">`));
    out.push('</colgroup><thead><tr><th class="corner"></th>');
    widths.forEach((w, i) => out.push(`<th class="ch" data-c="${i}">${colName(i)}<span class="rz" data-rz="${i}"></span></th>`));
    out.push('</tr></thead><tbody>');
    for (let r = 0; r < nrows; r++) {
      const row = model.rows[r];
      out.push(`<tr data-r="${r}"${row && row.h ? ` style="height:${row.h}px"` : ''}><th class="rh">${r + 1}</th>`);
      const map = new Map();
      if (row) row.cells.forEach(cell => map.set(cell.c, cell));
      for (let c = 0; c < ncols;) {
        const cell = map.get(c);
        if (cell) {
          const cs = Math.min(cell.cs || 1, ncols - c);
          const f = cell.f != null ? cell.f : cell.t;
          out.push(`<td data-c="${c}"${cs > 1 ? ` colspan="${cs}" data-cs="${cs}"` : ''}${cell.cls ? ` class="${cell.cls}"` : ''}${cell.act ? ` data-act="${esc(cell.act)}"` : ''}${f ? ` data-f="${esc(f)}"` : ''}>${cell.html != null ? cell.html : esc(cell.t)}</td>`);
          c += cs;
        } else { out.push(`<td data-c="${c}"></td>`); c++; }
      }
      out.push('</tr>');
    }
    out.push('</tbody></table>');
    return out.join('');
  }

  function renderSheet() {
    closeMenus();
    const wb = curWb(), sh = curSheet();
    const model = buildModel(wb, sh);
    S.model = model;
    gridWrap.className = 'k-' + sh.kind;
    grid.innerHTML = gridHtml(model, sh);
    S.selTd = null;
    gridWrap.scrollTop = sh.scrollTop || 0;
    gridWrap.scrollLeft = sh.scrollLeft || 0;
    const sel = sh.sel || defaultSel(sh);
    select(sel.r, sel.c, false);
    if (sh.kind === 'reader') touchHistory(wb, sh.ch);
    updateStatus();
  }
  function defaultSel(sh) {
    if (sh.kind === 'library' || sh.kind === 'history') return { r: 4, c: 1 };
    if (sh.kind === 'import') return { r: 3, c: 2 };
    if (sh.kind === 'reader' || sh.kind === 'toc') return { r: 0, c: 1 };
    return { r: 0, c: 0 };
  }

  function renderTitle() {
    const wb = curWb();
    $('#docname').textContent = wb.name;
    document.title = wb.name + ' - Excel';
  }
  function renderTabs() {
    const wb = curWb();
    const tabs = $('#tabs');
    tabs.innerHTML = wb.sheets.map((s, i) => {
      const loading = s.kind === 'reader' && wb.book && wb.book.chapters[s.ch].state === 'loading';
      return `<button class="tab${i === wb.active ? ' active' : ''}${loading ? ' loading' : ''}" data-i="${i}"${s.color ? ` style="--tab:${s.color}"` : ''} title="${esc(s.kind === 'reader' ? wb.book.chapters[s.ch].title : s.name)}">${esc(s.name)}</button>`;
    }).join('');
    const act = tabs.children[wb.active];
    if (act) {
      const l = act.offsetLeft - tabs.offsetLeft, r = l + act.offsetWidth;
      if (l < tabs.scrollLeft) tabs.scrollLeft = l - 20;
      else if (r > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = r - tabs.clientWidth + 20;
    }
  }
  function renderAll() { renderTitle(); renderTabs(); renderSheet(); }

  /* ------------------------------ Chọn ô ------------------------------ */
  function cellAt(r, c) {
    const tr = grid.querySelector(`tbody tr[data-r="${r}"]`);
    if (!tr) return null;
    for (const td of tr.children) {
      if (td.tagName !== 'TD') continue;
      const c0 = +td.dataset.c, cs = +(td.dataset.cs || 1);
      if (c >= c0 && c < c0 + cs) return td;
    }
    return null;
  }
  function select(r, c, scroll = true) {
    const td = cellAt(r, c);
    if (!td) return;
    if (S.selTd) S.selTd.classList.remove('sel');
    $$('#grid th.hi').forEach(th => th.classList.remove('hi'));
    td.classList.add('sel');
    S.selTd = td;
    const c0 = +td.dataset.c, cs = +(td.dataset.cs || 1);
    curSheet().sel = { r, c: c0 };
    $('#namebox').value = colName(c0) + (r + 1);
    const f = td.dataset.f != null ? td.dataset.f : td.textContent;
    $('#fx').textContent = f || '';
    const heads = $$('#grid thead th.ch');
    for (let i = c0; i < c0 + cs; i++) if (heads[i]) heads[i].classList.add('hi');
    const rh = td.parentNode.firstElementChild; if (rh) rh.classList.add('hi');
    if (scroll) ensureVisible(td);
    updateStatus();
  }
  function ensureVisible(td) {
    const wr = gridWrap.getBoundingClientRect(), r = td.getBoundingClientRect();
    const headH = 24 * settings.zoom / 100, rhW = 46 * settings.zoom / 100;
    if (r.top < wr.top + headH) gridWrap.scrollTop -= (wr.top + headH - r.top);
    else if (r.bottom > wr.bottom - 14) gridWrap.scrollTop += Math.min(r.bottom - wr.bottom + 18, r.top - wr.top - headH);
    if (r.width < wr.width - rhW) {
      if (r.left < wr.left + rhW) gridWrap.scrollLeft -= (wr.left + rhW - r.left);
      else if (r.right > wr.right - 14) gridWrap.scrollLeft += r.right - wr.right + 18;
    }
  }
  function move(dr, dc) {
    const sh = curSheet(), s = sh.sel || { r: 0, c: 0 };
    const td = cellAt(s.r, s.c);
    let r = s.r, c = s.c;
    if (dc > 0) c = s.c + (td ? +(td.dataset.cs || 1) : 1);
    else if (dc < 0) c = Math.max(0, s.c - 1);
    const nrows = grid.querySelectorAll('tbody tr').length, ncols = grid.querySelectorAll('thead th.ch').length;
    r = Math.max(0, Math.min(nrows - 1, r + dr));
    c = Math.min(c, ncols - 1);
    const t2 = cellAt(r, c);
    select(r, t2 ? +t2.dataset.c : c);
  }

  /* ------------------------------ Thanh trạng thái ------------------------------ */
  function setStatus(msg, busy) {
    S.status = msg;
    const el = $('#st-left');
    el.textContent = msg || (W.bossOn ? 'Sẵn sàng' : 'Sẵn sàng');
    el.classList.toggle('busy', !!(msg && busy !== false));
  }
  function updateStatus() {
    const sh = curSheet(), wb = curWb();
    const parts = [];
    if (sh.kind === 'reader') {
      const max = gridWrap.scrollHeight - gridWrap.clientHeight;
      const pct = max > 0 ? Math.round(gridWrap.scrollTop / max * 100) : 100;
      parts.push(`Chương ${sh.ch + 1}/${wb.book.chapters.length}${wb.book.nextUrl ? '+' : ''} · Đã đọc ${pct}%`);
      const ch = wb.book.chapters[sh.ch];
      if (ch.paras) parts.push(`${ch.paras.length} đoạn · ~${fmtNum(ch.paras.join(' ').split(/\s+/).length)} chữ`);
    } else if (sh.kind === 'library') {
      parts.push(`${filteredList(sh).length} bản ghi`);
    }
    const td = S.selTd;
    if (td) {
      const raw = (td.dataset.f != null ? td.dataset.f : td.textContent).trim();
      if (raw && !/^=/.test(raw)) {
        const num = Number(raw.replace(/\./g, '').replace(',', '.'));
        parts.push(raw && !isNaN(num) && /^[\d.,\-]+$/.test(raw) ? `Trung bình: ${fmtNum(num)}   Đếm: 1   Tổng: ${fmtNum(num)}` : 'Đếm: 1');
      }
    }
    $('#st-info').textContent = parts.join('    ');
  }

  /* ------------------------------ Điều hướng ------------------------------ */
  function activateSheet(i) {
    const wb = curWb();
    if (i < 0 || i >= wb.sheets.length) return;
    wb.active = i;
    renderTabs(); renderSheet();
  }
  function switchSheet(d) { const wb = curWb(); activateSheet(Math.max(0, Math.min(wb.sheets.length - 1, wb.active + d))); }
  function switchWb(idx) { W.bossOn = false; W.cur = idx; renderAll(); syncRibbonState(); }
  function openBook(book, ch) {
    W.bossOn = false;
    let idx = W.list.findIndex(w => w.book && w.book.key === book.key);
    if (idx < 0) { W.list.push(storyWorkbook(book)); idx = W.list.length - 1; }
    W.cur = idx;
    const wb = W.list[idx];
    if (ch != null) wb.active = Math.min(ch + 1, wb.sheets.length - 1);
    renderAll();
  }
  function openLib(id, ch) {
    const st = LIB.stories.find(s => s.id === id);
    if (!st) return;
    const existing = W.list.find(w => w.book && w.book.key === 'lib:' + id);
    openBook(existing ? existing.book : libBook(st), ch);
  }
  function goLibrary(sheetKind) {
    W.bossOn = false; W.cur = 0;
    if (sheetKind) { const i = W.list[0].sheets.findIndex(s => s.kind === sheetKind); if (i >= 0) W.list[0].active = i; }
    renderAll();
  }
  function closeWb() {
    if (W.bossOn) { toggleBoss(); return; }
    if (W.cur === 0) { toast('Không thể đóng sổ Thư viện 🙂'); return; }
    W.list.splice(W.cur, 1);
    W.cur = 0;
    renderAll();
  }
  function resume(i) {
    const e = getHist()[i];
    if (!e) return;
    if (e.src === 'lib') return openLib(e.libId, e.ch);
    const existing = W.list.find(w => w.book && w.book.key === e.key);
    if (existing) return openBook(existing.book, e.ch);
    if (e.bookKind === 'toc') runImport(e.bookUrl, { key: e.key, jump: e.ch, mode: 'toc', max: Math.max(e.total, 20) });
    else runImport(e.url, { key: e.key, mode: 'chapter' });
  }

  function doAct(act) {
    if (!act) return;
    const i = act.indexOf(':');
    const cmd = i < 0 ? act : act.slice(0, i), arg = i < 0 ? '' : act.slice(i + 1);
    switch (cmd) {
      case 'open': return openLib(arg);
      case 'sheet': return activateSheet(+arg);
      case 'resume': return resume(+arg);
      case 'import': return runImport(S.imp.url);
      case 'paste': return importPasted();
      case 'more': { const b = curWb().book; if (b && b.nextUrl) loadMore(b, 1, true); return; }
      case 'retry': { const b = curWb().book; const ch = b.chapters[+arg]; ch.state = 'idle'; ch.err = null; renderSheet(); return; }
      case 'export': return exportXlsx();
      case 'url': { const b = curWb().book; if (b && b.url) window.open(b.url, '_blank', 'noopener'); return; }
      case 'clearHist': store.set('history', []); renderSheet(); toast('Đã xóa lịch sử đọc'); return;
    }
  }

  /* ------------------------------ Nhập từ link ------------------------------ */
  const API_BASE = (() => {
    const m = document.querySelector('meta[name="api-base"]');
    return (m && m.content.trim().replace(/\/+$/, '')) || '';
  })();
  async function apiImport(url) {
    let res;
    try { res = await fetch(API_BASE + '/api/import?url=' + encodeURIComponent(url)); }
    catch (e) { throw new Error('Không gọi được máy chủ nhập truyện. Chạy "npm start", deploy lên Vercel, hoặc điền <meta name="api-base"> trong index.html.'); }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('Không có API nhập truyện ở địa chỉ này (GitHub Pages chỉ chứa file tĩnh — hãy điền <meta name="api-base"> trỏ tới bản Vercel).'); }
    if (!j.ok) throw new Error(j.error || 'Lỗi không xác định');
    return j;
  }
  function logImp(st, msg) {
    S.impLog.unshift({ time: new Date().toLocaleTimeString('vi-VN'), st, msg });
    S.impLog = S.impLog.slice(0, 30);
    if (curSheet().kind === 'import') renderSheet();
  }

  async function runImport(rawUrl, opts = {}) {
    let url = String(rawUrl || '').trim();
    if (!url) { toast('Hãy dán link truyện vào ô URL', 'err'); goLibrary('import'); setTimeout(() => { const el = $('#imp-url'); if (el) el.focus(); }, 0); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch (e) { toast('URL không hợp lệ', 'err'); return; }
    if (S.busy) { toast('Đang tải một truyện khác, vui lòng chờ…'); return; }
    const max = +(opts.max || S.imp.max) || 20, mode = opts.mode || S.imp.mode;
    S.busy = true;
    setStatus('Đang tải trang…');
    logImp('Đang tải', url);
    try {
      const r = await apiImport(url);
      const kind = mode === 'auto' ? r.kind : mode;
      const book = {
        key: opts.key || 'web:' + url, src: 'web', title: r.storyTitle || r.pageTitle || new URL(url).host,
        author: '', genre: 'Truyện từ link', status: '', desc: '', url: r.url, chapters: [], nextUrl: null, bookKind: kind
      };
      if (kind === 'toc') {
        const chs = r.chapters.slice(), seen = new Set(chs.map(c => c.url));
        let next = r.next, pages = 1;
        book.desc = r.paragraphs.join('\n').slice(0, 1500);
        while (chs.length < max && next && pages < 30) {
          setStatus(`Đang đọc mục lục trang ${pages + 1}…`);
          await sleep(400);
          try {
            const r2 = await apiImport(next);
            const fresh = r2.chapters.filter(c => !seen.has(c.url));
            if (!fresh.length) break;
            fresh.forEach(c => { seen.add(c.url); chs.push(c); });
            next = r2.next; pages++;
          } catch (e) { break; }
        }
        if (!chs.length) throw new Error('Không tìm thấy danh sách chương. Thử chọn chế độ "Trang chương" hoặc dùng ô "Dán văn bản".');
        book.chapters = chs.slice(0, max).map(c => ({ title: c.title, url: c.url, paras: null, state: 'idle' }));
        book.totalFound = chs.length;
        logImp('OK', `“${book.title}”: tìm thấy ${chs.length} chương, tạo ${book.chapters.length} sheet.`);
        openBook(book, opts.jump != null ? opts.jump : null);
        toast(`Đã nhập ${book.chapters.length} chương`, 'ok');
      } else {
        if (!r.paragraphs.length) throw new Error('Không trích xuất được nội dung từ trang này. Hãy thử dùng ô "Dán văn bản".');
        book.chapters.push({ title: r.chapterTitle || r.pageTitle || 'Chương 1', url: r.url, paras: r.paragraphs, state: 'done' });
        book.nextUrl = r.next;
        logImp('OK', `“${book.title}”: đã tải ${book.chapters[0].title}${r.next ? ' — đang tải tiếp các chương sau…' : ''}`);
        openBook(book, 0);
        S.busy = false;
        if (max > 1 && book.nextUrl) await loadMore(book, max - 1);
      }
    } catch (e) {
      logImp('Lỗi', e.message);
      toast(e.message, 'err');
    } finally {
      S.busy = false;
      setStatus(null);
      if (curSheet().kind === 'import') renderSheet();
    }
  }

  async function loadMore(book, count, jumpToNew) {
    if (book.loadingMore) { toast('Đang tải chương, vui lòng chờ…'); return; }
    book.loadingMore = true;
    const startLen = book.chapters.length;
    try {
      for (let k = 0; k < count && book.nextUrl; k++) {
        setStatus(`Đang tải chương ${book.chapters.length + 1}…`);
        const r = await apiImport(book.nextUrl);
        if (!r.paragraphs.length || book.chapters.some(c => c.url === r.url)) { book.nextUrl = null; break; }
        book.chapters.push({ title: r.chapterTitle || r.pageTitle || 'Chương ' + (book.chapters.length + 1), url: r.url, paras: r.paragraphs, state: 'done' });
        book.nextUrl = r.next && r.next !== r.url ? r.next : null;
        onBookGrew(book);
        if (k < count - 1) await sleep(400);
      }
    } catch (e) {
      toast('Dừng tải: ' + e.message, 'err');
    } finally {
      book.loadingMore = false;
      setStatus(null);
      onBookGrew(book);
      if (jumpToNew && book.chapters.length > startLen && curWb().book === book) activateSheet(startLen + 1);
    }
  }
  function onBookGrew(book) {
    const wb = W.list.find(w => w.book === book);
    if (!wb) return;
    syncStorySheets(wb);
    if (curWb() !== wb) return;
    renderTabs();
    const sh = curSheet();
    if (sh.kind === 'toc' || (sh.kind === 'reader' && sh.ch >= book.chapters.length - 2)) {
      const keep = gridWrap.scrollTop; renderSheet(); gridWrap.scrollTop = keep;
    }
  }

  function importPasted() {
    const text = (S.imp.text || '').replace(/\r/g, '');
    if (!text.trim()) { toast('Hãy dán nội dung truyện vào ô văn bản', 'err'); return; }
    const HEAD = /^\s*(chương|chuong|chapter|chap|hồi|quyển|phần)\s*[\dIVXLC]+\b/i;
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    let title = 'Văn bản dán ' + new Date().toLocaleTimeString('vi-VN');
    if (lines.length > 1 && !HEAD.test(lines[0]) && lines[0].length < 100) title = lines.shift();
    let chapters = [], cur = null;
    lines.forEach(l => {
      if (HEAD.test(l) && l.length < 150) { cur = { title: l, paras: [] }; chapters.push(cur); }
      else { if (!cur) { cur = { title: 'Mở đầu', paras: [] }; chapters.push(cur); } cur.paras.push(l); }
    });
    chapters = chapters.filter(c => c.paras.length);
    if (chapters.length === 1 && chapters[0].paras.length > 120) {
      const all = chapters[0].paras; chapters = [];
      for (let i = 0; i < all.length; i += 60) chapters.push({ title: 'Phần ' + (chapters.length + 1), paras: all.slice(i, i + 60) });
    }
    if (!chapters.length) { toast('Không có nội dung để tách', 'err'); return; }
    const book = {
      key: 'paste:' + Date.now(), src: 'paste', title, author: '', genre: 'Văn bản dán', status: '', desc: '', url: null, nextUrl: null,
      chapters: chapters.map(c => ({ title: c.title, paras: c.paras, state: 'done' }))
    };
    logImp('OK', `“${title}”: tách được ${chapters.length} chương từ văn bản dán.`);
    openBook(book, null);
    toast(`Đã tách ${chapters.length} chương`, 'ok');
  }

  /* ------------------------------ Xuất .xlsx ------------------------------ */
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    const urls = ['vendor/xlsx.full.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'];
    return urls.reduce((p, src) => p.catch(() => new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = () => (window.XLSX ? res() : rej()); s.onerror = rej; document.head.appendChild(s);
    })), Promise.reject()).catch(() => { throw new Error('Không tải được thư viện SheetJS để xuất .xlsx (cần Internet hoặc file public/vendor/xlsx.full.min.js).'); });
  }
  const safeSheet = s => String(s).replace(/[\[\]*?/\\:]/g, ' ').trim().slice(0, 31) || 'Sheet';

  async function exportXlsx() {
    const wb = curWb();
    try {
      setStatus('Đang chuẩn bị file Excel…');
      await loadXLSX();
      const X = window.XLSX, out = X.utils.book_new(), used = new Set();
      const add = (name, aoa, cols) => {
        let n = safeSheet(name), base = n, k = 2;
        while (used.has(n.toLowerCase())) n = base.slice(0, 26) + ' (' + (k++) + ')';
        used.add(n.toLowerCase());
        const ws = X.utils.aoa_to_sheet(aoa);
        if (cols) ws['!cols'] = cols;
        X.utils.book_append_sheet(out, ws, n);
      };
      if (wb.kind === 'library') {
        wb.sheets.filter(s => s.kind === 'library').forEach(sh => {
          const list = filteredList(sh);
          add(sh.name, [LCOLS.map(c => c.label)].concat(list.map(s => [s.idx, s.title, s.author, s.genreName, s.chapters, s.status, s.views, s.rating, s.updatedText, s.desc])),
            LCOLS.map(c => ({ wch: Math.round(c.w / 7) })));
        });
      } else if (wb.kind === 'story') {
        const b = wb.book;
        for (let i = 0; i < b.chapters.length; i++) {
          if (!b.chapters[i].paras) {
            setStatus(`Đang tải chương ${i + 1}/${b.chapters.length} để xuất…`);
            await ensureChapterAsync(b, i);
            if (b.src === 'web') await sleep(300);
          }
        }
        const toc = [[b.title], [], ['Tác giả', b.author || ''], ['Thể loại', b.genre || ''], ['Nguồn', b.url || ''], ['Giới thiệu', b.desc || ''], [], ['STT', 'Sheet', 'Tiêu đề chương']];
        b.chapters.forEach((c, i) => toc.push([i + 1, wb.sheets[i + 1].name, c.title]));
        add('Mục lục', toc, [{ wch: 12 }, { wch: 16 }, { wch: 80 }]);
        b.chapters.forEach((c, i) => add(wb.sheets[i + 1].name, [[c.title], []].concat((c.paras || ['(Không tải được nội dung: ' + (c.err || '') + ')']).map(p => [p])), [{ wch: 120 }]));
      } else {
        wb.sheets.forEach(sh => {
          const m = buildModel(wb, sh);
          add(sh.name, m.rows.map(row => {
            const arr = [];
            if (row) row.cells.forEach(cell => { arr[cell.c] = cell.t; });
            return arr;
          }));
        });
      }
      X.writeFile(out, wb.name);
      toast('Đã xuất ' + wb.name, 'ok');
      if (wb.kind === 'story' && curSheet().kind === 'toc') renderSheet();
    } catch (e) {
      toast(e.message || 'Xuất file thất bại', 'err');
    } finally { setStatus(null); }
  }

  /* ------------------------------ Tìm kiếm ------------------------------ */
  function findAll(q) {
    const wb = curWb(), nq = norm(q), res = [];
    if (!nq) return res;
    S.dry = true;
    try {
      wb.sheets.forEach((sh, si) => {
        const m = buildModel(wb, sh);
        m.rows.forEach((row, r) => {
          if (!row) return;
          row.cells.forEach(cell => {
            const t = cell.t;
            if (t && norm(t).includes(nq) && res.length < 500) res.push({ si, r, c: cell.c, sheet: sh.name, t });
          });
        });
      });
    } finally { S.dry = false; }
    return res;
  }
  function gotoCell(si, r, c) {
    const wb = curWb();
    if (wb.active !== si) { wb.sheets[si].sel = { r, c }; wb.sheets[si].scrollTop = 0; activateSheet(si); }
    select(r, c, true);
  }
  function renderFindRes() {
    const f = S.find, box = $('#find-res');
    if (!f.q) { box.innerHTML = ''; return; }
    if (!f.res.length) { box.innerHTML = '<p class="muted-s">Không tìm thấy dữ liệu bạn đang tìm.</p>'; return; }
    box.innerHTML = `<p class="muted-s">Tìm thấy ${f.res.length} ô${f.res.length >= 500 ? ' (giới hạn 500)' : ''}</p><table><tr><th>Trang tính</th><th>Ô</th><th>Giá trị</th></tr>` +
      f.res.map((x, i) => `<tr class="r${i === f.pos ? ' cur' : ''}" data-i="${i}"><td>${esc(x.sheet)}</td><td>$${colName(x.c)}$${x.r + 1}</td><td title="${esc(x.t)}">${esc(x.t.slice(0, 120))}</td></tr>`).join('') + '</table>';
  }
  function openFind(q) {
    const d = $('#finddlg');
    d.classList.remove('hidden');
    const inp = $('#find-q');
    if (q != null) inp.value = q;
    inp.focus(); inp.select();
  }
  function doFindAll() {
    const q = $('#find-q').value.trim();
    S.find = { q, res: findAll(q), pos: -1 };
    renderFindRes();
  }
  function doFindNext() {
    const q = $('#find-q').value.trim();
    if (q !== S.find.q) doFindAll();
    const f = S.find;
    if (!f.res.length) { renderFindRes(); return; }
    f.pos = (f.pos + 1) % f.res.length;
    const x = f.res[f.pos];
    gotoCell(x.si, x.r, x.c);
    renderFindRes();
    const cur = $('#find-res tr.cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------------ Menu / Toast / Hộp thoại ------------------------------ */
  function closeMenus() { if (S.menu) { S.menu.remove(); S.menu = null; } }
  function placeMenu(m, anchor, up) {
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px';
    const top = up ? r.top - m.offsetHeight - 4 : r.bottom + 2;
    m.style.top = Math.max(8, Math.min(top, innerHeight - m.offsetHeight - 8)) + 'px';
    S.menu = m;
  }
  function showMenu(anchor, items, up) {
    closeMenus();
    const m = document.createElement('div');
    m.className = 'menu';
    m.innerHTML = items.map((it, i) => it === '-' ? '<div class="msep"></div>' : `<button class="mi" data-i="${i}">${it.on ? '✓ ' : ''}${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('');
    m.addEventListener('click', e => { const b = e.target.closest('.mi'); if (!b) return; const it = items[+b.dataset.i]; closeMenus(); if (it.fn) it.fn(); });
    placeMenu(m, anchor, up);
  }
  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), kind === 'err' ? 5500 : 2600);
  }
  function modal(title, html) {
    $('#modal-t').textContent = title;
    $('#modal-b').innerHTML = html;
    $('#modal').classList.remove('hidden');
  }
  const KEYS_HTML = `<div class="kbd">
    <kbd>← ↑ → ↓</kbd><span>Di chuyển giữa các ô</span>
    <kbd>Enter</kbd><span>Mở liên kết trong ô (chữ xanh) / xuống ô dưới</span>
    <kbd>Ctrl/Alt + PgDn · PgUp</kbd><span>Sang sheet (chương) sau / trước</span>
    <kbd>Space · PgDn</kbd><span>Cuộn xuống một trang khi đọc</span>
    <kbd>Ctrl + F</kbd><span>Tìm trong sổ làm việc</span>
    <kbd>Alt + Q</kbd><span>Tìm truyện trong thư viện</span>
    <kbd>Ctrl + S</kbd><span>Xuất file .xlsx thật (mỗi chương một sheet)</span>
    <kbd>Ctrl + + / −</kbd><span>Phóng to / thu nhỏ</span>
    <kbd>Esc</kbd><span>"Sếp đến!" — chuyển ngay sang bảng báo cáo (nhấn lại để quay về)</span>
    <kbd>Nhấp đúp tab ribbon</kbd><span>Thu gọn / mở ribbon</span>
  </div>`;

  /* ------------------------------ Chế độ "sếp đến" ------------------------------ */
  function toggleBoss() {
    W.bossOn = !W.bossOn;
    closeMenus();
    $('#backstage').classList.add('hidden');
    renderAll();
    syncRibbonState();
  }

  /* ------------------------------ Bộ lọc cột ------------------------------ */
  function openFilter(btn, key) {
    closeMenus();
    const sh = curSheet(), f = getFilt(sh.key), col = LCOLS.find(c => c.k === key);
    const values = col.en ? [...new Set(baseList(sh).map(r => r[key]))].sort((a, b) => a.localeCompare(b, 'vi')) : null;
    const sel = f.sel[key] ? new Set(f.sel[key]) : new Set(values || []);
    const numeric = col.num || col.date;
    const m = document.createElement('div');
    m.className = 'menu fpanel';
    m.innerHTML = `
      <button class="mi" data-a="asc">↑ Sắp xếp ${numeric ? 'Nhỏ nhất → Lớn nhất' : 'A → Z'}</button>
      <button class="mi" data-a="desc">↓ Sắp xếp ${numeric ? 'Lớn nhất → Nhỏ nhất' : 'Z → A'}</button>
      <div class="msep"></div>
      <button class="mi" data-a="clear"${filterActive(f, key) ? '' : ' disabled'}>✕ Xóa bộ lọc khỏi “${esc(col.label)}”</button>
      <div class="fp-body">
        <input class="fp-q" placeholder="Tìm kiếm" value="${esc(f.q[key] || '')}">
        ${values ? `<div class="fp-list"><label><input type="checkbox" data-all${sel.size === values.length ? ' checked' : ''}> (Chọn tất cả)</label>${values.map(v => `<label><input type="checkbox" data-v="${esc(v)}"${sel.has(v) ? ' checked' : ''}> ${esc(v)}</label>`).join('')}</div>` : ''}
      </div>
      <div class="fp-act"><button class="ok">OK</button><button class="cancel">Hủy</button></div>`;
    const apply = () => {
      const q = $('.fp-q', m).value.trim();
      if (q) f.q[key] = q; else delete f.q[key];
      if (values) {
        const picked = $$('input[data-v]', m).filter(x => x.checked).map(x => x.dataset.v);
        if (picked.length === values.length) delete f.sel[key]; else f.sel[key] = picked;
      }
      closeMenus(); sh.scrollTop = 0; renderSheet();
    };
    m.addEventListener('click', e => {
      const a = e.target.closest('[data-a]');
      if (a) {
        if (a.dataset.a === 'clear') { delete f.q[key]; delete f.sel[key]; if (f.sort && f.sort.k === key) f.sort = null; }
        else f.sort = { k: key, dir: a.dataset.a === 'asc' ? 1 : -1 };
        closeMenus(); renderSheet(); return;
      }
      if (e.target.closest('.ok')) return apply();
      if (e.target.closest('.cancel')) return closeMenus();
    });
    m.addEventListener('change', e => {
      if (e.target.matches('[data-all]')) $$('input[data-v]', m).forEach(x => { x.checked = e.target.checked; });
    });
    m.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    placeMenu(m, btn);
    $('.fp-q', m).focus();
  }

  /* ------------------------------ Ribbon ------------------------------ */
  const P = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
  const svg = body => `<svg viewBox="0 0 24 24" ${P}>${body}</svg>`;
  const ICON = {
    paste: svg('<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><rect x="9" y="2.5" width="6" height="4" rx="1" fill="#D9D9D9"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4"/>'),
    cut: svg('<circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="M8.3 16.2 17 4M15.7 16.2 7 4"/>'),
    copy: svg('<rect x="8" y="8" width="12" height="13" rx="1.5"/><path d="M16 8V4.5A1.5 1.5 0 0 0 14.5 3h-9A1.5 1.5 0 0 0 4 4.5v11A1.5 1.5 0 0 0 5.5 17H8"/>'),
    brush: svg('<rect x="4" y="3" width="13" height="5.5" rx="1" fill="#FFD966"/><path d="M17 5.7h3v5.3h-8.5v3.5"/><rect x="10.3" y="14.5" width="2.4" height="6.5" rx=".6"/>'),
    border: svg('<rect x="4" y="4" width="16" height="16" stroke-dasharray="2 2"/><path d="M4 20h16" stroke-width="2.4"/>'),
    fill: svg('<path d="m5 12 6.5-6.5 6 6L11 18z"/><path d="M19.5 13.5s2 2.4 2 3.5a2 2 0 0 1-4 0c0-1.1 2-3.5 2-3.5z"/><rect x="2" y="20" width="16" height="2.6" fill="#FFE200" stroke="none"/>'),
    fcolor: svg('<path d="m7 17 5-12 5 12M8.8 13h6.4"/><rect x="3" y="19.5" width="18" height="2.6" fill="#E00000" stroke="none"/>'),
    alignL: svg('<path d="M3 5h18M3 10h12M3 15h18M3 20h12"/>'),
    alignC: svg('<path d="M3 5h18M6 10h12M3 15h18M6 20h12"/>'),
    justify: svg('<path d="M3 5h18M3 10h18M3 15h18M3 20h18"/>'),
    indent: svg('<path d="M3 5h18M11 10h10M11 15h10M3 20h18M3 9.5l3.5 3L3 15.5"/>'),
    wrap: svg('<path d="M3 5h18M3 12h14a3 3 0 0 1 0 6h-4m2-2-2 2 2 2M3 19h6"/>'),
    merge: svg('<rect x="3" y="5" width="18" height="14"/><path d="M7 12h10M15 10l2 2-2 2M9 10l-2 2 2 2"/>'),
    cond: svg('<rect x="3" y="3" width="18" height="18"/><path d="M3 9h18M3 15h18M9 3v18"/><rect x="10" y="9.8" width="10.2" height="4.4" fill="#E06666" stroke="none"/><rect x="10" y="15.8" width="6" height="4.4" fill="#93C47D" stroke="none"/>'),
    table: svg('<rect x="3" y="4" width="18" height="16"/><rect x="3" y="4" width="18" height="5" fill="#4472C4" stroke="none"/><path d="M3 14h18M9 9v11M15 9v11"/>'),
    styles: svg('<rect x="3" y="5" width="8" height="6" fill="#C6EFCE"/><rect x="13" y="5" width="8" height="6" fill="#FFC7CE"/><rect x="3" y="13" width="8" height="6" fill="#FFEB9C"/><rect x="13" y="13" width="8" height="6"/>'),
    insert: svg('<rect x="4" y="4" width="16" height="16"/><path d="M12 8v8M8 12h8" stroke="#217346" stroke-width="2"/>'),
    del: svg('<rect x="4" y="4" width="16" height="16"/><path d="M8 12h8" stroke="#C00000" stroke-width="2"/>'),
    format: svg('<rect x="4" y="4" width="16" height="16"/><path d="M4 10h16M10 4v16"/>'),
    sum: svg('<path d="M18 5H6l6 7-6 7h12"/>'),
    filldown: svg('<path d="M12 4v13m0 0-4-4m4 4 4-4M5 20h14"/>'),
    eraser: svg('<path d="m4 15 9-9 7 7-6 6H8z"/><path d="M9 20h11"/>'),
    sort: svg('<path d="M7 4v16m0 0-3-3m3 3 3-3"/><path d="M13 5h7M13 10h5M13 15h3"/>'),
    sortAZ: svg('<path d="M6 4v16m0 0-3-3m3 3 3-3"/><text x="11" y="10.5" font-size="8" stroke="none" fill="currentColor" font-family="Segoe UI">A</text><text x="11" y="20" font-size="8" stroke="none" fill="currentColor" font-family="Segoe UI">Z</text>'),
    sortZA: svg('<path d="M6 4v16m0 0-3-3m3 3 3-3"/><text x="11" y="10.5" font-size="8" stroke="none" fill="currentColor" font-family="Segoe UI">Z</text><text x="11" y="20" font-size="8" stroke="none" fill="currentColor" font-family="Segoe UI">A</text>'),
    filter: svg('<path d="M3 4h18l-7 8v6l-4 2v-8z"/>'),
    find: svg('<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>'),
    web: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
    refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
    export: svg('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/>'),
    grid: svg('<rect x="3" y="3" width="18" height="18"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),
    zoom: svg('<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M10 7v6M7 10h6"/>'),
    z100: svg('<rect x="3" y="5" width="18" height="14" rx="1"/><text x="5" y="15.5" font-size="7.5" stroke="none" fill="currentColor" font-family="Segoe UI">100</text>'),
    moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
    windows: svg('<rect x="3" y="5" width="13" height="10"/><rect x="8" y="9" width="13" height="10" fill="var(--ui-bg2)"/>'),
    full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    freeze: svg('<rect x="3" y="3" width="18" height="18"/><path d="M3 8h18M8 3v18" stroke="#217346" stroke-width="2.4"/>'),
    chart: svg('<path d="M3 20h18"/><rect x="5" y="11" width="3" height="9" fill="#4472C4" stroke="none"/><rect x="10.5" y="5" width="3" height="15" fill="#ED7D31" stroke="none"/><rect x="16" y="13" width="3" height="7" fill="#A5A5A5" stroke="none"/>'),
    pivot: svg('<rect x="3" y="3" width="18" height="18"/><path d="M3 8h18M8 3v18"/><path d="M12 12h5v5" stroke="#217346"/>'),
    picture: svg('<rect x="3" y="5" width="18" height="14"/><circle cx="9" cy="10" r="2"/><path d="m3 17 6-5 4 3 3-2 5 4"/>'),
    shapes: svg('<circle cx="8" cy="9" r="4.5"/><rect x="11" y="11" width="9" height="9"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    text: svg('<rect x="3" y="4" width="18" height="16"/><path d="M8 8h8M12 8v9"/>'),
    theme: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M12 3v18"/><rect x="3.7" y="3.7" width="7.6" height="7.6" fill="#4472C4" stroke="none"/><rect x="12.7" y="12.7" width="7.6" height="7.6" fill="#ED7D31" stroke="none"/>'),
    margins: svg('<rect x="4" y="3" width="16" height="18"/><rect x="7" y="6" width="10" height="12" stroke-dasharray="2 1.5"/>'),
    orient: svg('<rect x="3" y="7" width="13" height="10"/><rect x="11" y="3" width="10" height="13" fill="var(--ui-bg2)"/>'),
    width: svg('<path d="M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3M3 4v16M21 4v16" />'),
    fx: svg('<text x="4" y="17" font-size="14" font-style="italic" stroke="none" fill="currentColor" font-family="Cambria, serif">fx</text>'),
    book: svg('<path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1z"/><path d="M12 6v14"/>'),
    calc: svg('<rect x="5" y="3" width="14" height="18" rx="1.5"/><rect x="7.5" y="5.5" width="9" height="4"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/>'),
    spell: svg('<path d="M4 15 7.5 5l3.5 10M5.3 11.5h4.4M13 13l3 3 5-6"/>'),
    stats: svg('<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    comment: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
    lock: svg('<rect x="5" y="10" width="14" height="10" rx="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
    normal: svg('<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>'),
    page: svg('<rect x="5" y="3" width="14" height="18"/><path d="M8 7h8M8 11h8M8 15h5"/>'),
    boss: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 13h18"/>'),
    keyboard: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
    home: svg('<path d="M3 11 12 4l9 7M5 10v10h14V10"/>'),
    save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
    undo: svg('<path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    redo: svg('<path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"/>')
  };

  const big = (icon, label, cmd, o) => Object.assign({ big: true, icon, label, cmd }, o || {});
  const sm = (icon, label, cmd, o) => Object.assign({ icon, label, cmd }, o || {});
  const xs = (icon, title, cmd, o) => Object.assign({ icon, title, cmd, xs: true }, o || {});
  const RIBBON = [
    { id: 'file', label: 'Tệp' },
    {
      id: 'home', label: 'Trang chủ', groups: [
        { label: 'Bộ nhớ tạm', cols: [{ big: big('paste', 'Dán', 'decor') }, { stack: [sm('cut', 'Cắt', 'decor'), sm('copy', 'Sao chép', 'copy'), sm('brush', 'Định dạng', 'decor')] }] },
        { label: 'Phông chữ', cols: [{ rows: [
          [{ select: 'font', w: 128, title: 'Phông chữ khi đọc' }, { select: 'size', w: 52, title: 'Cỡ chữ khi đọc' }, { txt: 'A<sup>▲</sup>', title: 'Tăng cỡ chữ', cmd: 'fontUp', xs: true }, { txt: 'A<sup>▼</sup>', title: 'Giảm cỡ chữ', cmd: 'fontDown', xs: true }],
          [{ txt: '<b>B</b>', title: 'In đậm chữ đọc', cmd: 'bold', toggle: 'bold', xs: true }, { txt: '<i>I</i>', title: 'Nghiêng', cmd: 'decor', xs: true }, { txt: '<u>U</u>', title: 'Gạch chân', cmd: 'decor', xs: true },
            xs('border', 'Đường lưới', 'grid', { toggle: 'grid' }), xs('fill', 'Màu nền trang đọc', 'paper'), xs('fcolor', 'Màu phông', 'decor')]
        ] }] },
        { label: 'Căn lề', cols: [{ rows: [
          [xs('alignL', 'Căn trái', 'align:left', { on: () => settings.align === 'left' }), xs('alignC', 'Căn giữa', 'align:center', { on: () => settings.align === 'center' }), xs('justify', 'Căn đều hai bên', 'align:justify', { on: () => settings.align === 'justify' })],
          [xs('indent', 'Thụt lề', 'decor'), xs('width', 'Độ rộng vùng đọc', 'readWidth')]
        ] }, { stack: [sm('wrap', 'Ngắt dòng', 'wrap', { toggle: 'wrap' }), sm('merge', 'Gộp & Căn giữa', 'decor')] }] },
        { label: 'Số', cols: [{ rows: [[{ select: 'numfmt', w: 110, title: 'Định dạng số' }], [{ txt: '%', cmd: 'decor', xs: true, title: 'Phần trăm' }, { txt: ',', cmd: 'decor', xs: true, title: 'Dấu phân cách' }, { txt: '.0', cmd: 'decor', xs: true, title: 'Tăng thập phân' }, { txt: '.00', cmd: 'decor', xs: true, title: 'Giảm thập phân' }]] }] },
        { label: 'Kiểu', cols: [{ big: big('cond', 'Định dạng có điều kiện', 'decor') }, { big: big('table', 'Định dạng như Bảng', 'decor') }, { big: big('styles', 'Kiểu ô', 'decor') }] },
        { label: 'Ô', cols: [{ big: big('insert', 'Chèn', 'decor') }, { big: big('del', 'Xóa', 'decor') }, { big: big('format', 'Định dạng', 'decor') }] },
        { label: 'Chỉnh sửa', cols: [{ stack: [sm('sum', 'Tự động tính tổng', 'decor'), sm('filldown', 'Điền', 'decor'), sm('eraser', 'Xóa', 'decor')] }, { big: big('sort', 'Sắp xếp & Lọc', 'sortMenu') }, { big: big('find', 'Tìm & Chọn', 'find') }] }
      ]
    },
    {
      id: 'insert', label: 'Chèn', groups: [
        { label: 'Bảng', cols: [{ big: big('pivot', 'PivotTable', 'decor') }, { big: big('table', 'Bảng', 'decor') }] },
        { label: 'Hình minh họa', cols: [{ big: big('picture', 'Hình ảnh', 'decor') }, { big: big('shapes', 'Hình dạng', 'decor') }] },
        { label: 'Biểu đồ', cols: [{ big: big('chart', 'Biểu đồ đề xuất', 'decor') }] },
        { label: 'Liên kết', cols: [{ big: big('link', 'Liên kết (nhập truyện)', 'importSheet') }] },
        { label: 'Văn bản', cols: [{ big: big('text', 'Hộp văn bản', 'decor') }] }
      ]
    },
    {
      id: 'layout', label: 'Bố trí Trang', groups: [
        { label: 'Chủ đề', cols: [{ big: big('theme', 'Chủ đề tối/sáng', 'dark', { toggle: 'dark' }) }, { big: big('fill', 'Màu giấy', 'paper') }] },
        { label: 'Thiết lập Trang', cols: [{ big: big('margins', 'Lề', 'decor') }, { big: big('orient', 'Hướng', 'decor') }, { big: big('width', 'Độ rộng vùng đọc', 'readWidth') }] },
        { label: 'Tùy chọn Trang tính', cols: [{ stack: [{ check: 'grid', label: 'Đường lưới' }, { check: 'headings', label: 'Tiêu đề hàng/cột' }] }] }
      ]
    },
    {
      id: 'formulas', label: 'Công thức', groups: [
        { label: 'Thư viện Hàm', cols: [{ big: big('fx', 'Chèn Hàm', 'decor') }, { big: big('sum', 'Tự động tính tổng', 'decor') }, { big: big('book', 'Dùng gần đây', 'decor') }, { big: big('calc', 'Tài chính', 'decor') }] },
        { label: 'Tính toán', cols: [{ big: big('calc', 'Tùy chọn tính toán', 'decor') }] }
      ]
    },
    {
      id: 'data', label: 'Dữ liệu', groups: [
        { label: 'Lấy & Chuyển đổi Dữ liệu', cols: [{ big: big('web', 'Từ Web (nhập link)', 'importSheet') }, { big: big('book', 'Từ Văn bản', 'importSheet') }] },
        { label: 'Truy vấn & Kết nối', cols: [{ big: big('refresh', 'Làm mới Tất cả', 'refresh') }] },
        { label: 'Sắp xếp & Lọc', cols: [{ big: big('sortAZ', 'Sắp xếp A→Z', 'sortAZ') }, { big: big('sortZA', 'Sắp xếp Z→A', 'sortZA') }, { big: big('filter', 'Xóa bộ lọc', 'clearFilter') }] },
        { label: 'Công cụ', cols: [{ big: big('export', 'Xuất .xlsx', 'export') }] }
      ]
    },
    {
      id: 'review', label: 'Xem lại', groups: [
        { label: 'Soát lỗi', cols: [{ big: big('spell', 'Chính tả', 'decor') }, { big: big('stats', 'Thống kê Sổ làm việc', 'stats') }] },
        { label: 'Chú thích', cols: [{ big: big('comment', 'Chú thích Mới', 'decor') }] },
        { label: 'Bảo vệ', cols: [{ big: big('lock', 'Bảo vệ Trang tính', 'decor') }] }
      ]
    },
    {
      id: 'view', label: 'Xem', groups: [
        { label: 'Dạng xem Sổ làm việc', cols: [{ big: big('normal', 'Thường', 'decor') }, { big: big('page', 'Bố trí Trang', 'decor') }] },
        { label: 'Hiện', cols: [{ stack: [{ check: 'grid', label: 'Đường lưới' }, { check: 'fbar', label: 'Thanh công thức' }, { check: 'headings', label: 'Tiêu đề' }] }] },
        { label: 'Thu phóng', cols: [{ big: big('zoom', 'Thu phóng', 'zoomMenu') }, { big: big('z100', '100%', 'zoom100') }] },
        { label: 'Cửa sổ', cols: [{ big: big('freeze', 'Cố định Ô', 'decor') }, { big: big('windows', 'Chuyển Cửa sổ', 'windows') }, { big: big('full', 'Toàn màn hình', 'full') }, { big: big('moon', 'Chế độ tối', 'dark', { toggle: 'dark' }) }] },
        { label: 'Bí mật', cols: [{ big: big('boss', 'Sếp đến! (Esc)', 'boss') }] }
      ]
    },
    {
      id: 'help', label: 'Trợ giúp', groups: [
        { label: 'Trợ giúp', cols: [{ big: big('keyboard', 'Phím tắt', 'keys') }, { big: big('info', 'Giới thiệu', 'about') }] }
      ]
    }
  ];
  let curTab = 'home';

  function itemHtml(it, size) {
    if (it.check) return `<label class="rchk"><input type="checkbox" data-check="${it.check}"${settings[it.check] ? ' checked' : ''}> ${esc(it.label)}</label>`;
    if (it.select) {
      let opts = '';
      if (it.select === 'font') opts = FONTS.map(f => `<option${f === settings.font ? ' selected' : ''}>${f}</option>`).join('');
      else if (it.select === 'size') opts = SIZES.map(s => `<option${s === settings.size ? ' selected' : ''}>${s}</option>`).join('');
      else opts = ['Chung', 'Số', 'Tiền tệ', 'Ngày', 'Phần trăm', 'Văn bản'].map(s => `<option>${s}</option>`).join('');
      return `<select class="rsel" data-sel="${it.select}" style="width:${it.w}px" title="${esc(it.title || '')}">${opts}</select>`;
    }
    const cls = ['rb', size];
    return `<button class="${cls.join(' ')}" data-cmd="${it.cmd}"${it.toggle ? ` data-toggle="${it.toggle}"` : ''} title="${esc(it.title || it.label || '')}">` +
      (it.icon ? `<span class="ic">${ICON[it.icon]}</span>` : '') + (it.txt ? `<span class="tx">${it.txt}</span>` : '') +
      (it.label && size !== 'xs' ? `<span class="lb">${esc(it.label)}</span>` : '') + '</button>';
  }
  function renderRibbon() {
    $('#rtabs').innerHTML = RIBBON.map(t => `<button class="rtab${t.id === 'file' ? ' file' : ''}${t.id === curTab ? ' on' : ''}" data-tab="${t.id}" role="tab">${t.label}</button>`).join('');
    const tab = RIBBON.find(t => t.id === curTab);
    $('#ribbon').innerHTML = tab.groups.map(g => `<div class="rgroup"><div class="rg-body">${g.cols.map(col => {
      if (col.big) return itemHtml(col.big, 'big');
      if (col.stack) return `<div class="rcol">${col.stack.map(it => itemHtml(it, 'sm')).join('')}</div>`;
      return `<div class="rcol">${col.rows.map(row => `<div class="rrow">${row.map(it => itemHtml(it, 'xs')).join('')}</div>`).join('')}</div>`;
    }).join('')}</div><div class="rg-label">${g.label}</div></div>`).join('');
    syncRibbonState();
  }
  function findItem(cmd) {
    for (const t of RIBBON) for (const g of t.groups || []) for (const col of g.cols) {
      const items = col.big ? [col.big] : col.stack ? col.stack : [].concat(...col.rows);
      const f = items.find(it => it.cmd === cmd);
      if (f) return f;
    }
    return null;
  }
  function syncRibbonState() {
    $$('#ribbon [data-toggle]').forEach(b => b.classList.toggle('on', !!settings[b.dataset.toggle]));
    $$('#ribbon [data-cmd^="align:"]').forEach(b => b.classList.toggle('on', b.dataset.cmd === 'align:' + settings.align));
    $$('#ribbon [data-check]').forEach(c => { c.checked = !!settings[c.dataset.check]; });
    const f = $('#ribbon [data-sel="font"]'); if (f) f.value = settings.font;
    const s = $('#ribbon [data-sel="size"]'); if (s) s.value = String(settings.size);
  }

  function runCmd(cmd, el) {
    const [name, arg] = cmd.split(':');
    const sh = curSheet();
    switch (name) {
      case 'decor': {
        const it = el && el.title ? el.title : 'Tính năng này';
        return toast(`“${it}” chỉ để trang trí — đây là trình đọc truyện 😉`);
      }
      case 'copy': {
        const td = S.selTd; if (!td) return;
        const t = td.dataset.f != null ? td.dataset.f : td.textContent;
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Đã sao chép ô ' + $('#namebox').value), () => toast('Trình duyệt không cho phép sao chép', 'err'));
        return;
      }
      case 'fontUp': { const i = SIZES.indexOf(settings.size); settings.size = SIZES[Math.min(SIZES.length - 1, (i < 0 ? 3 : i) + 1)]; return saveSettings(); }
      case 'fontDown': { const i = SIZES.indexOf(settings.size); settings.size = SIZES[Math.max(0, (i < 0 ? 3 : i) - 1)]; return saveSettings(); }
      case 'bold': case 'grid': case 'wrap': case 'dark':
        settings[name] = !settings[name]; return saveSettings();
      case 'align': settings.align = arg; return saveSettings();
      case 'paper':
        return showMenu(el, [['default', 'Trắng (mặc định)'], ['sepia', 'Giấy cũ (sepia)'], ['mint', 'Xanh bạc hà'], ['gray', 'Xám dịu']].map(([v, l]) => ({ label: l, on: settings.paper === v, fn: () => { settings.paper = v; saveSettings(); } })));
      case 'readWidth':
        return showMenu(el, WIDTHS.map(w => ({ label: w + ' px', sub: w === 760 ? 'mặc định' : '', on: settings.readWidth === w, fn: () => { settings.readWidth = w; curWb().sheets.forEach(s => { if (s.kind === 'reader') s.colW = null; }); saveSettings(true); } })));
      case 'zoomMenu':
        return showMenu(el, [50, 75, 90, 100, 110, 125, 150, 175, 200].map(z => ({ label: z + '%', on: settings.zoom === z, fn: () => setZoom(z) })));
      case 'zoom100': return setZoom(100);
      case 'windows':
        return showMenu(el, W.list.map((w, i) => ({ label: (i + 1) + ' ' + w.name, on: !W.bossOn && i === W.cur, fn: () => switchWb(i) })));
      case 'full':
        if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
        return;
      case 'boss': return toggleBoss();
      case 'find': return openFind();
      case 'export': return exportXlsx();
      case 'importSheet': return goLibrary('import');
      case 'library': return goLibrary();
      case 'closeWb': return closeWb();
      case 'keys': return modal('Phím tắt', KEYS_HTML);
      case 'about': return showAbout();
      case 'sortMenu':
        return showMenu(el, [
          { label: 'Sắp xếp tên truyện A → Z', fn: () => runCmd('sortAZ') },
          { label: 'Sắp xếp tên truyện Z → A', fn: () => runCmd('sortZA') },
          { label: 'Lượt đọc cao nhất', fn: () => sortBy('views', -1) },
          { label: 'Đánh giá cao nhất', fn: () => sortBy('rating', -1) },
          { label: 'Mới cập nhật', fn: () => sortBy('updated', -1) },
          '-', { label: 'Xóa sắp xếp & bộ lọc', fn: () => runCmd('clearFilter') }
        ]);
      case 'sortAZ': return sortBy('title', 1);
      case 'sortZA': return sortBy('title', -1);
      case 'clearFilter':
        if (sh.kind !== 'library') return toast('Bộ lọc chỉ áp dụng cho các sheet thư viện');
        S.filt[sh.key] = null; sh.scrollTop = 0; renderSheet(); return toast('Đã xóa bộ lọc');
      case 'refresh': {
        if (sh.kind === 'reader' && curWb().book.src === 'web') {
          const ch = curWb().book.chapters[sh.ch]; ch.paras = null; ch.state = 'idle'; renderSheet(); return toast('Đang tải lại chương…');
        }
        renderSheet(); return toast('Đã làm mới');
      }
      case 'stats': return showStats();
    }
  }
  function sortBy(k, dir) {
    const sh = curSheet();
    if (sh.kind !== 'library') { goLibrary(); return sortBy(k, dir); }
    getFilt(sh.key).sort = { k, dir }; sh.scrollTop = 0; renderSheet();
  }
  function setZoom(z) {
    settings.zoom = Math.max(50, Math.min(200, Math.round(z / 10) * 10 || 100));
    saveSettings();
    updateStatus();
  }
  function showStats() {
    const wb = curWb();
    let html;
    if (wb.book) {
      const loaded = wb.book.chapters.filter(c => c.paras);
      const words = loaded.reduce((a, c) => a + c.paras.join(' ').split(/\s+/).length, 0);
      html = `<table class="rlist"><tr><td>Trang tính</td><td>${wb.sheets.length}</td></tr><tr><td>Chương đã tải</td><td>${loaded.length}/${wb.book.chapters.length}</td></tr>` +
        `<tr><td>Số đoạn</td><td>${fmtNum(loaded.reduce((a, c) => a + c.paras.length, 0))}</td></tr><tr><td>Số chữ (ước tính)</td><td>${fmtNum(words)}</td></tr>` +
        `<tr><td>Thời gian đọc (~200 chữ/phút)</td><td>${Math.max(1, Math.round(words / 200))} phút</td></tr></table>`;
    } else {
      html = `<table class="rlist"><tr><td>Trang tính</td><td>${wb.sheets.length}</td></tr><tr><td>Tổng số truyện</td><td>${LIB.stories.length}</td></tr>` +
        LIB.genres.map(g => `<tr><td>${g.name}</td><td>${LIB.stories.filter(s => s.genre === g.id).length} truyện</td></tr>`).join('') + '</table>';
    }
    modal('Thống kê Sổ làm việc', html);
  }
  function showAbout() {
    modal('Giới thiệu', `<p><b>Excel Story Reader</b> — đọc truyện trong giao diện bảng tính.</p>
      <p>• Thư viện mẫu: ${LIB.stories.length} truyện (${LIB.genres.map(g => g.name).join(', ')}), nội dung được sinh tự động để minh họa.<br>
      • Mỗi chương là một sheet. Nhập truyện khác bằng link ở sheet <b>Nhập link</b>.<br>
      • Xuất ra file .xlsx thật bằng Ctrl+S.</p>
      <p class="muted-s">Bản nháp / dự án cá nhân. Hãy tôn trọng bản quyền của tác giả và trang nguồn khi nhập truyện.</p>`);
  }

  /* ------------------------------ Backstage ------------------------------ */
  function histTable(limit) {
    const h = getHist().slice(0, limit);
    if (!h.length) return '<p class="muted-s">Chưa có truyện nào được đọc gần đây.</p>';
    return `<table class="rlist"><tr><th>Tên</th><th>Đang ở</th><th>Thể loại</th><th>Lần cuối</th></tr>${h.map((e, i) => `<tr class="r" data-resume="${i}"><td>📗 ${esc(e.title)}</td><td>Chương ${e.ch + 1}/${e.total}</td><td>${esc(e.genre)}</td><td>${new Date(e.ts).toLocaleDateString('vi-VN')}</td></tr>`).join('')}</table>`;
  }
  function openBackstage(page) {
    $('#backstage').classList.remove('hidden');
    $$('#backstage aside button').forEach(b => b.classList.toggle('on', b.dataset.bs === page));
    const main = $('#bs-main');
    const hour = new Date().getHours();
    if (page === 'home') {
      main.innerHTML = `<h1>${hour < 11 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'}</h1>
        <div class="tiles">
          <button class="tile" data-go="lib"><div class="pv">▦</div><span>Thư viện truyện</span></button>
          ${LIB.genres.map(g => `<button class="tile" data-go="g:${g.id}"><div class="pv" style="color:${g.color}">▤</div><span>${g.name}</span></button>`).join('')}
          <button class="tile" data-go="import"><div class="pv">⤓</div><span>Nhập truyện từ link</span></button>
        </div>
        <h2>Gần đây</h2>${histTable(12)}`;
    } else if (page === 'open') {
      main.innerHTML = `<h1>Mở</h1><h2>Sổ làm việc đang mở</h2><table class="rlist">${W.list.map((w, i) => `<tr class="r" data-wb="${i}"><td>📗 ${esc(w.name)}</td><td>${w.sheets.length} trang tính</td></tr>`).join('')}</table><h2>Gần đây</h2>${histTable(40)}`;
    } else if (page === 'keys') {
      main.innerHTML = '<h1>Phím tắt</h1>' + KEYS_HTML;
    } else if (page === 'about') {
      main.innerHTML = `<h1>Giới thiệu</h1><p><b>Excel Story Reader</b> mô phỏng giao diện bảng tính để đọc truyện: mỗi chương là một sheet, thư viện là các bảng có thể sắp xếp/lọc, nhập truyện bằng link và xuất ra file .xlsx thật.</p>
        <p>Nội dung thư viện mẫu được sinh tự động chỉ để minh họa. Khi nhập truyện từ link, hãy tôn trọng bản quyền và điều khoản của trang nguồn.</p>`;
    }
  }
  function closeBackstage() { $('#backstage').classList.add('hidden'); }

  /* ------------------------------ Tìm truyện trên thanh tiêu đề ------------------------------ */
  let tsItems = [], tsPos = -1;
  function renderTSearch() {
    const q = $('#tsearch').value.trim(), dd = $('#tsearch-dd');
    if (!q) { dd.classList.add('hidden'); tsItems = []; return; }
    const nq = norm(q);
    tsItems = [];
    if (/^https?:\/\/|^www\.|\.[a-z]{2,}\//i.test(q)) tsItems.push({ label: '⤓ Nhập truyện từ link này', sub: q, fn: () => { S.imp.url = q; goLibrary('import'); runImport(q); } });
    LIB.stories.filter(s => norm(s.title).includes(nq) || norm(s.author).includes(nq)).slice(0, 12)
      .forEach(s => tsItems.push({ label: s.title, sub: s.genreName + ' · ' + s.author, fn: () => openLib(s.id) }));
    tsItems.push({ label: `🔍 Tìm “${q}” trong sổ làm việc hiện tại`, fn: () => { openFind(q); doFindAll(); } });
    tsPos = tsItems.length > 1 ? 0 : -1;
    dd.innerHTML = tsItems.map((it, i) => `<button class="mi${i === tsPos ? ' hl' : ''}" data-i="${i}">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('');
    dd.classList.remove('hidden');
  }
  function pickTSearch(i) {
    const it = tsItems[i];
    $('#tsearch-dd').classList.add('hidden');
    if (!it) return;
    $('#tsearch').value = ''; $('#tsearch').blur();
    it.fn();
  }

  /* ------------------------------ Sự kiện ------------------------------ */
  function bind() {
    // Ribbon
    $('#rtabs').addEventListener('click', e => {
      const b = e.target.closest('.rtab'); if (!b) return;
      if (b.dataset.tab === 'file') return openBackstage('home');
      $('#ribbon').classList.remove('collapsed');
      curTab = b.dataset.tab; renderRibbon();
    });
    $('#rtabs').addEventListener('dblclick', e => { if (e.target.closest('.rtab:not(.file)')) $('#ribbon').classList.toggle('collapsed'); });
    $('#ribbon').addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (b) runCmd(b.dataset.cmd, b); });
    $('#ribbon').addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.check) { settings[t.dataset.check] = t.checked; saveSettings(); }
      if (t.dataset.sel === 'font') { settings.font = t.value; saveSettings(); }
      if (t.dataset.sel === 'size') { settings.size = +t.value; saveSettings(); }
    });
    $('#titlebar').addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (b) runCmd(b.dataset.cmd, b); });

    // Lưới
    grid.addEventListener('mousedown', e => {
      const rz = e.target.closest('.rz');
      if (rz) return startResize(e, +rz.dataset.rz);
      const fb = e.target.closest('.fbtn');
      if (fb) { e.preventDefault(); e.stopPropagation(); return openFilter(fb, fb.dataset.filter); }
      const td = e.target.closest('td');
      if (td) return select(+td.parentNode.dataset.r, +td.dataset.c, false);
      const rh = e.target.closest('th.rh');
      if (rh) return select(+rh.parentNode.dataset.r, 0, false);
      const ch = e.target.closest('th.ch');
      if (ch) { const r = (curSheet().sel || { r: 0 }).r; select(r, +ch.dataset.c, false); }
    });
    grid.addEventListener('click', e => {
      if (e.target.closest('.fbtn, .rz, input, select, textarea')) return;
      const td = e.target.closest('td');
      if (td && td.dataset.act && (td.classList.contains('link') || td.classList.contains('btncell'))) doAct(td.dataset.act);
    });
    grid.addEventListener('dblclick', e => {
      const td = e.target.closest('td');
      if (td && td.dataset.act && !td.classList.contains('link') && !td.classList.contains('btncell')) doAct(td.dataset.act);
    });
    grid.addEventListener('input', e => {
      const t = e.target;
      if (t.id === 'imp-url') S.imp.url = t.value;
      if (t.id === 'imp-text') S.imp.text = t.value;
    });
    grid.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'imp-max') S.imp.max = +t.value;
      if (t.id === 'imp-mode') S.imp.mode = t.value;
    });
    let raf = 0;
    gridWrap.addEventListener('scroll', () => {
      const sh = curSheet(); sh.scrollTop = gridWrap.scrollTop; sh.scrollLeft = gridWrap.scrollLeft;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; updateStatus(); });
    }, { passive: true });

    // Tab sheet
    $('#tabs').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) activateSheet(+t.dataset.i); });
    $('#tabs').addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { $('#tabs').scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    $('#tabbar').addEventListener('click', e => {
      const n = e.target.closest('.tnav'); if (!n) return;
      const tabs = $('#tabs');
      if (n.dataset.nav === 'prev') tabs.scrollBy({ left: -240, behavior: 'smooth' });
      if (n.dataset.nav === 'next') tabs.scrollBy({ left: 240, behavior: 'smooth' });
      if (n.dataset.nav === 'list') { const wb = curWb(); showMenu(n, wb.sheets.map((s, i) => ({ label: s.name, sub: s.kind === 'reader' ? wb.book.chapters[s.ch].title : '', on: i === wb.active, fn: () => activateSheet(i) })), true); }
    });
    $('#addsheet').addEventListener('click', () => {
      const wb = curWb();
      if (wb.kind === 'story' && wb.book.nextUrl) return loadMore(wb.book, 1, true);
      if (wb.kind === 'story') return toast('Đã hết chương để tải thêm');
      if (wb.kind === 'library') return goLibrary('import');
      toast('Không thể thêm trang tính ở đây');
    });

    // Thanh công thức
    $('#fexp').addEventListener('click', () => $('#fbar').classList.toggle('expanded'));
    $('#namebox').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const m = e.target.value.trim().match(/^([A-Za-z]{1,3})(\d{1,5})$/);
      if (m) { select(+m[2] - 1, colIndex(m[1]), true); gridWrap.focus(); } else toast('Tham chiếu không hợp lệ (ví dụ: B12)', 'err');
    });
    $('#namebox').addEventListener('focus', e => e.target.select());

    // Thanh trạng thái
    $('#z-range').addEventListener('input', e => setZoom(+e.target.value));
    $('#z-minus').addEventListener('click', () => setZoom(settings.zoom - 10));
    $('#z-plus').addEventListener('click', () => setZoom(settings.zoom + 10));

    // Backstage
    $('#backstage aside').addEventListener('click', e => {
      const b = e.target.closest('[data-bs]'); if (!b) return;
      const a = b.dataset.bs;
      if (a === 'back') return closeBackstage();
      if (a === 'import') { closeBackstage(); return goLibrary('import'); }
      if (a === 'export') { closeBackstage(); return exportXlsx(); }
      if (a === 'close') { closeBackstage(); return closeWb(); }
      openBackstage(a);
    });
    $('#bs-main').addEventListener('click', e => {
      const r = e.target.closest('[data-resume]'); if (r) { closeBackstage(); return resume(+r.dataset.resume); }
      const w = e.target.closest('[data-wb]'); if (w) { closeBackstage(); return switchWb(+w.dataset.wb); }
      const g = e.target.closest('[data-go]'); if (!g) return;
      closeBackstage();
      const v = g.dataset.go;
      if (v === 'lib') return goLibrary();
      if (v === 'import') return goLibrary('import');
      const gi = W.list[0].sheets.findIndex(s => s.genre === v.slice(2));
      W.bossOn = false; W.cur = 0; W.list[0].active = gi; renderAll();
    });

    // Hộp thoại
    document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) hideDlg($('#' + c.dataset.close)); });
    $('#find-all').addEventListener('click', doFindAll);
    $('#find-next').addEventListener('click', doFindNext);
    $('#find-q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doFindNext(); } });
    $('#find-res').addEventListener('click', e => {
      const tr = e.target.closest('tr.r'); if (!tr) return;
      S.find.pos = +tr.dataset.i; const x = S.find.res[S.find.pos]; gotoCell(x.si, x.r, x.c); renderFindRes();
    });

    // Tìm truyện
    const ts = $('#tsearch');
    ts.addEventListener('input', renderTSearch);
    ts.addEventListener('focus', renderTSearch);
    ts.addEventListener('keydown', e => {
      const dd = $('#tsearch-dd');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!tsItems.length) return;
        tsPos = (tsPos + (e.key === 'ArrowDown' ? 1 : -1) + tsItems.length) % tsItems.length;
        $$('.mi', dd).forEach((b, i) => b.classList.toggle('hl', i === tsPos));
      } else if (e.key === 'Enter') { e.preventDefault(); pickTSearch(tsPos < 0 ? 0 : tsPos); }
    });
    $('#tsearch-dd').addEventListener('mousedown', e => { const b = e.target.closest('.mi'); if (b) { e.preventDefault(); pickTSearch(+b.dataset.i); } });
    ts.addEventListener('blur', () => setTimeout(() => $('#tsearch-dd').classList.add('hidden'), 120));

    // Đóng menu khi bấm ra ngoài
    document.addEventListener('mousedown', e => { if (S.menu && !S.menu.contains(e.target) && !e.target.closest('[data-cmd], .tnav')) closeMenus(); });
    window.addEventListener('resize', closeMenus);

    document.addEventListener('keydown', onKey);
  }

  function startResize(e, i) {
    e.preventDefault();
    const sh = curSheet();
    const col = grid.querySelectorAll('col')[i + 1], table = grid.querySelector('table');
    const x0 = e.clientX, w0 = parseFloat(col.style.width), t0 = parseFloat(table.style.width), z = settings.zoom / 100;
    const mv = ev => {
      const w = Math.max(16, w0 + (ev.clientX - x0) / z);
      col.style.width = w + 'px'; table.style.width = (t0 + w - w0) + 'px';
      $('#st-info').textContent = `Độ rộng: ${Math.round(w)} pixel`;
    };
    const up = () => {
      document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
      sh.colW = sh.colW || {}; sh.colW[i] = parseFloat(col.style.width); updateStatus();
    };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }

  function hideDlg(el) {
    if (!el) return;
    if (el.contains(document.activeElement)) document.activeElement.blur();
    el.classList.add('hidden');
  }
  function anyOverlayOpen() {
    return S.menu || !$('#finddlg').classList.contains('hidden') || !$('#modal').classList.contains('hidden') || !$('#backstage').classList.contains('hidden');
  }

  function onKey(e) {
    const ae = document.activeElement;
    const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
    const k = e.key;
    if (k === 'Escape') {
      if (anyOverlayOpen()) {
        closeMenus(); closeBackstage(); hideDlg($('#finddlg')); hideDlg($('#modal'));
        return;
      }
      if (typing) { ae.blur(); return; }
      toggleBoss();
      return;
    }
    if ((e.ctrlKey || e.metaKey || e.altKey) && (k === 'PageDown' || k === 'PageUp')) { e.preventDefault(); switchSheet(k === 'PageDown' ? 1 : -1); return; }
    if (e.ctrlKey || e.metaKey) {
      const kl = k.toLowerCase();
      if (kl === 'f') { e.preventDefault(); openFind(); return; }
      if (kl === 's') { e.preventDefault(); exportXlsx(); return; }
      if (k === '=' || k === '+') { e.preventDefault(); setZoom(settings.zoom + 10); return; }
      if (k === '-') { e.preventDefault(); setZoom(settings.zoom - 10); return; }
      if (k === '0') { e.preventDefault(); setZoom(100); return; }
      if (k === 'Home' && !typing) { e.preventDefault(); gridWrap.scrollTop = 0; select(0, 0); return; }
      return;
    }
    if (e.altKey && k.toLowerCase() === 'q') { e.preventDefault(); $('#tsearch').focus(); return; }
    if (typing) {
      if (k === 'Enter' && ae.id === 'imp-url') { e.preventDefault(); runImport(ae.value); }
      return;
    }
    if (anyOverlayOpen()) return;
    const sh = curSheet();
    const page = () => gridWrap.clientHeight * 0.88;
    switch (k) {
      case 'ArrowUp': e.preventDefault(); move(-1, 0); break;
      case 'ArrowDown': e.preventDefault(); move(1, 0); break;
      case 'ArrowLeft': e.preventDefault(); move(0, -1); break;
      case 'ArrowRight': case 'Tab': e.preventDefault(); move(0, e.shiftKey ? -1 : 1); break;
      case 'Enter': {
        e.preventDefault();
        const td = S.selTd;
        if (td && td.dataset.act && (td.classList.contains('link') || td.classList.contains('btncell'))) doAct(td.dataset.act);
        else move(e.shiftKey ? -1 : 1, 0);
        break;
      }
      case 'PageDown': case ' ':
        e.preventDefault(); gridWrap.scrollBy({ top: e.shiftKey ? -page() : page(), behavior: 'smooth' }); break;
      case 'PageUp': e.preventDefault(); gridWrap.scrollBy({ top: -page(), behavior: 'smooth' }); break;
      case 'Home': e.preventDefault(); select((sh.sel || { r: 0 }).r, 0); break;
    }
  }

  /* ------------------------------ Khởi động ------------------------------ */
  function init() {
    $$('#titlebar .qat').forEach(b => { b.innerHTML = ICON[b.dataset.ic || 'save']; });
    W.list.push(libraryWorkbook());
    W.boss = bossWorkbook();
    const lastTab = store.get('libTab', 1);
    W.list[0].active = Math.min(lastTab, W.list[0].sheets.length - 1);
    renderRibbon();
    applySettings();
    bind();
    renderAll();
    window.addEventListener('beforeunload', () => store.set('libTab', W.list[0].active));
    if (location.protocol === 'file:') toast('Đang mở trực tiếp từ file: phần thư viện vẫn dùng được, nhưng "Nhập link" cần chạy "npm start".', 'err');
  }
  init();
})();
