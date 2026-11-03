'use strict';
/*
 * Tải văn bản PHẠM VI CÔNG CỘNG (public domain) về thư mục data/:
 *  - Nguyên tác chữ Hán từ Project Gutenberg và zh.wikisource  → data/zh/<book>.json
 *  - Tác phẩm Nam Cao (mất 1951) từ vi.wikisource              → data/vi/namcao.json
 *
 * Chạy:  node scripts/fetch-sources.js            (tải tất cả, bỏ qua file đã có)
 *        node scripts/fetch-sources.js --force    (tải lại)
 *
 * Tôn trọng nguồn: User-Agent có thông tin liên hệ, nghỉ giữa các request,
 * Wikimedia dùng tham số maxlag theo khuyến nghị.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const UA = 'ExcelStoryReader/1.0 (https://github.com/mynametus/commic-excel; public-domain catalog builder)';
const FORCE = process.argv.includes('--force');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* --------------------------- Nguồn chữ Hán --------------------------- */
const NUM = '[一二三四五六七八九十百零〇两兩\\d]+';
const GUTENBERG = [
  { key: 'liaozhai', id: 51828, title: '聊齋志異', author: '蒲松齡', authorVi: 'Bồ Tùng Linh', died: 1715, split: 'bracket' },
  { key: 'yingying', id: 52267, title: '鶯鶯傳', author: '元稹', authorVi: 'Nguyên Chẩn', died: 831, split: 'single' },
  { key: 'fusheng', id: 25192, title: '浮生六記', author: '沈復', authorVi: 'Thẩm Phục', died: 1825, split: 'juan' },
  { key: 'rulin', id: 24032, title: '儒林外史', author: '吳敬梓', authorVi: 'Ngô Kính Tử', died: 1754, split: 'hui' },
  { key: 'jingshi', id: 24141, title: '警世通言', author: '馮夢龍', authorVi: 'Phùng Mộng Long', died: 1646, split: 'juan' },
  { key: 'yushi', id: 27582, title: '喻世明言', author: '馮夢龍', authorVi: 'Phùng Mộng Long', died: 1646, split: 'juan' },
  { key: 'xingshi', id: 24239, title: '醒世恆言', author: '馮夢龍', authorVi: 'Phùng Mộng Long', died: 1646, split: 'juan' },
  { key: 'dongzhou', id: 25349, title: '東周列國志', author: '馮夢龍', authorVi: 'Phùng Mộng Long', died: 1646, split: 'hui' },
  { key: 'soushen', id: 25362, title: '搜神記', author: '干寶', authorVi: 'Can Bảo', died: 336, split: 'juan' }
];
const ZH_WIKISOURCE = [
  { key: 'xiaolin', page: '笑林', title: '笑林', author: '邯鄲淳', authorVi: 'Hàm Đan Thuần', died: 221 },
  { key: 'xiaozan', page: '笑贊', title: '笑贊', author: '趙南星', authorVi: 'Triệu Nam Tinh', died: 1627 }
];

/** Gom dòng thành đoạn: dòng trống = ngắt đoạn; tiếng Hán nối liền không cách */
function toParas(lines) {
  const out = [];
  let cur = '';
  for (const raw of lines) {
    const l = raw.replace(/　/g, ' ').trim();
    if (!l) { if (cur) out.push(cur); cur = ''; continue; }
    cur += l;
  }
  if (cur) out.push(cur);
  return out.filter(p => p.replace(/[\s。，、；：！？「」『』（）]/g, '').length > 1);
}

function splitGutenberg(text, mode) {
  const s = text.indexOf('*** START'), e = text.indexOf('*** END');
  const body = text.slice(text.indexOf('\n', s) + 1, e > 0 ? e : undefined);
  const lines = body.split(/\r?\n/);
  if (mode === 'single') {
    const start = lines.findIndex(l => /[一-鿿]{8,}/.test(l) && !/Author|Title|Produced/.test(l));
    return [{ title: null, paras: toParas(lines.slice(start)) }];
  }
  const head = {
    bracket: /^〈(.+?)〉$/,
    hui: new RegExp('^第' + NUM + '回\\s*(.*)$'),
    juan: new RegExp('^第' + NUM + '卷\\s*(.*)$')
  }[mode];
  const parts = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/　/g, ' ').trim();
    const m = t.match(head);
    if (m && t.length <= 40) {
      let title = (m[1] || '').trim();
      if (!title) { // tiêu đề ở dòng kế tiếp (醒世恆言)
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && lines[j].trim().length <= 30) { title = lines[j].trim(); i = j; }
      }
      cur = { title: mode === 'bracket' ? title : t.replace(/\s+/g, ' ').replace(title, '').trim() + (title ? ' ' + title : ''), titleShort: title, lines: [] };
      parts.push(cur);
      continue;
    }
    if (/^卷[一二三四五六七八九十]+$/.test(t)) continue;
    if (cur) cur.lines.push(lines[i]);
  }
  // gộp tiêu đề trùng (một số file lặp tiêu đề hồi)
  const merged = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    if (prev && prev.title === p.title) prev.lines.push(...p.lines); else merged.push(p);
  }
  return merged.map(p => ({ title: p.title, paras: toParas(p.lines) })).filter(p => p.paras.length);
}

/* --------------------------- Wikisource API --------------------------- */
async function wikiApi(host, params) {
  const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      if (j.error && j.error.code === 'maxlag') { await sleep(6000); continue; }
      if (j.error) throw new Error(j.error.info);
      return j;
    } catch (e) {
      if (/too many requests/i.test(text) || res.status === 429) { await sleep(15000 * (attempt + 1)); continue; }
      throw e;
    }
  }
  throw new Error('Wikimedia API từ chối sau nhiều lần thử: ' + url);
}

function decode(s) {
  return s.replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'");
}
/** Cắt bỏ trọn các khối <div> (kể cả div lồng bên trong) có thuộc tính khớp regex */
function stripDivs(html, attrRe) {
  const open = /<div\b([^>]*)>/gi;
  let out = '', pos = 0, m;
  while ((m = open.exec(html))) {
    if (!attrRe.test(m[1])) continue;
    const re = /<(\/?)div\b[^>]*>/gi;
    re.lastIndex = m.index;
    let depth = 0, t, end = html.length;
    while ((t = re.exec(html))) { depth += t[1] ? -1 : 1; if (depth === 0) { end = re.lastIndex; break; } }
    out += html.slice(pos, m.index);
    pos = end;
    open.lastIndex = end;
  }
  return out + html.slice(pos);
}

/** Lấy các đoạn văn từ HTML đã render của Wikisource, bỏ khung tiêu đề (có trích Wikipedia), giấy phép, chú thích */
function wikiParas(html) {
  let h = stripDivs(html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ''),
    /id="headerContainer"|class="[^"]*(?:ws-noexport|licenseContainer|headertemplate|mw-references-wrap|navbox|prp-pages-output-header)/i)
    .replace(/<table[\s\S]*?<\/table>/gi, '')
    .replace(/<sup[^>]*class="reference"[\s\S]*?<\/sup>/gi, '')
    .replace(/<span[^>]*class="pagenum[\s\S]*?<\/span>/gi, '');
  h = h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|dd|dt|blockquote)>/gi, '\n');
  return decode(h.replace(/<[^>]+>/g, ''))
    .split('\n').map(s => s.replace(/[\s ]+/g, ' ').trim())
    .filter(s => s && !/^(Chú thích|Tham khảo|Xem thêm)$/i.test(s) && !/phạm vi công cộng|public domain|Creative Commons|giấy phép/i.test(s));
}
async function wikiPage(host, title) {
  const j = await wikiApi(host, { action: 'parse', page: title, prop: 'text', redirects: '1', disableeditsection: '1' });
  return wikiParas(j.parse.text);
}

/* ------------------------------ Thực thi ------------------------------ */
function save(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 1));
}
const has = file => !FORCE && fs.existsSync(file);

async function fetchGutenberg() {
  for (const b of GUTENBERG) {
    const file = path.join(DATA, 'zh', b.key + '.json');
    if (has(file)) { console.log('✓ đã có', b.title); continue; }
    const res = await fetch(`https://www.gutenberg.org/cache/epub/${b.id}/pg${b.id}.txt`, { headers: { 'user-agent': UA } });
    if (!res.ok) { console.log('✗', b.title, 'HTTP', res.status); continue; }
    const parts = splitGutenberg(await res.text(), b.split);
    if (b.split === 'single') parts[0].title = b.title;
    save(file, { ...b, source: `https://www.gutenberg.org/ebooks/${b.id}`, license: 'Public domain (Project Gutenberg)', parts });
    console.log(`✓ ${b.title}: ${parts.length} phần`);
    await sleep(2000);
  }
}

async function fetchZhWikisource() {
  for (const b of ZH_WIKISOURCE) {
    const file = path.join(DATA, 'zh', b.key + '.json');
    if (has(file)) { console.log('✓ đã có', b.title); continue; }
    const paras = await wikiPage('zh.wikisource.org', b.page);
    save(file, { ...b, source: 'https://zh.wikisource.org/wiki/' + encodeURIComponent(b.page), license: 'Public domain (Wikisource)', parts: [{ title: b.title, paras }] });
    console.log(`✓ ${b.title}: ${paras.length} đoạn`);
    await sleep(3000);
  }
}

async function fetchNamCao() {
  const file = path.join(DATA, 'vi', 'namcao.json');
  if (has(file)) { console.log('✓ đã có Nam Cao'); return; }
  const host = 'vi.wikisource.org';
  const author = await wikiApi(host, { action: 'query', titles: 'Tác gia:Nam Cao', prop: 'links', plnamespace: '0', pllimit: '500' });
  const titles = (author.query.pages[0].links || []).map(l => l.title).filter(t => !/^Luật /.test(t));
  const works = [];
  for (const title of titles) {
    await sleep(3000);
    try {
      const sub = await wikiApi(host, { action: 'query', list: 'allpages', apprefix: title + '/', apnamespace: '0', aplimit: '200' });
      const subs = sub.query.allpages.map(p => p.title);
      const chapters = [];
      if (subs.length) {
        for (const s of subs) {
          await sleep(3000);
          chapters.push({ title: s.slice(title.length + 1), paras: await wikiPage(host, s) });
        }
      } else {
        await sleep(3000);
        chapters.push({ title, paras: await wikiPage(host, title) });
      }
      const n = chapters.reduce((a, c) => a + c.paras.join('').length, 0);
      if (n < 300) { console.log('  bỏ qua (quá ngắn/không phải truyện):', title); continue; }
      works.push({ title: title.replace(/\s*\((Nam Cao|tập truyện ngắn)\)$/, ''), page: title, chapters, chars: n });
      console.log(`  ✓ ${title}: ${chapters.length} chương, ${n} ký tự`);
    } catch (e) { console.log('  ✗', title, e.message); }
  }
  save(file, { author: 'Nam Cao', died: 1951, source: 'https://vi.wikisource.org/wiki/T%C3%A1c_gia:Nam_Cao', license: 'Public domain tại Việt Nam (tác giả mất 1951) — Wikisource', works });
  console.log(`✓ Nam Cao: ${works.length} tác phẩm`);
}

(async () => {
  const only = process.argv.find(a => a.startsWith('--only='));
  const which = only ? only.slice(7).split(',') : ['gutenberg', 'zhws', 'namcao'];
  if (which.includes('gutenberg')) await fetchGutenberg();
  if (which.includes('zhws')) await fetchZhWikisource();
  if (which.includes('namcao')) await fetchNamCao();
})().catch(e => { console.error(e); process.exit(1); });
