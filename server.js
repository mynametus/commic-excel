'use strict';
/*
 * Máy chủ nhỏ (không cần thư viện ngoài):
 *  - Phục vụ giao diện tĩnh trong thư mục public/
 *  - API /api/import?url=...  : tải trang truyện, trích xuất tiêu đề, nội dung,
 *    danh sách chương, link chương sau/trước (trình duyệt không tự làm được vì CORS).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns').promises;
const net = require('node:net');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === '1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const UA = process.env.UA || 'Mozilla/5.0 (compatible; ExcelStoryReader/1.0)';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ----------------------------- An toàn URL ----------------------------- */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (/^f[cd]/.test(s) || s.startsWith('fe80')) return true;
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivateIp(m[1]) : false;
  }
  return true;
}

async function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'URL không hợp lệ'); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Chỉ hỗ trợ link http/https');
  if (u.username || u.password) throw new HttpError(400, 'URL không được chứa tài khoản/mật khẩu');
  if (ALLOW_PRIVATE) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host }];
  else {
    try { addrs = await dns.lookup(host, { all: true }); }
    catch { throw new HttpError(400, 'Không phân giải được tên miền: ' + host); }
  }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) {
    throw new HttpError(403, 'Không cho phép truy cập địa chỉ nội bộ/mạng riêng');
  }
  return u;
}

/* ----------------------------- Tải trang ------------------------------ */
async function readLimited(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > MAX_BYTES) { reader.cancel().catch(() => {}); throw new HttpError(413, 'Trang quá lớn (> 5 MB)'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function decodeBody(buf, contentType) {
  let cs = (contentType.match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!cs) {
    const head = buf.subarray(0, 4096).toString('latin1');
    cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  try { return new TextDecoder(cs || 'utf-8').decode(buf); }
  catch { return new TextDecoder('utf-8').decode(buf); }
}

async function fetchPage(rawUrl) {
  let url = rawUrl;
  for (let hop = 0; hop < 6; hop++) {
    const u = await checkUrl(url);
    let res;
    try {
      res = await fetch(u, {
        redirect: 'manual',
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
          'accept-language': 'vi-VN,vi;q=0.9,en;q=0.6'
        },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (e) {
      throw new HttpError(502, e.name === 'TimeoutError' ? 'Trang nguồn phản hồi quá chậm (timeout)' : 'Không kết nối được trang nguồn');
    }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, u).href; continue; }
    if (res.status === 403 || res.status === 503) throw new HttpError(502, `Trang nguồn chặn truy cập tự động (HTTP ${res.status}). Hãy dùng ô "Dán văn bản".`);
    if (!res.ok) throw new HttpError(502, `Trang nguồn trả về lỗi HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (ct && !/html|xml|text\/plain/i.test(ct)) throw new HttpError(415, 'Link không phải trang HTML/văn bản');
    const buf = await readLimited(res);
    return { body: decodeBody(buf, ct), finalUrl: u.href, isText: /text\/plain/i.test(ct) };
  }
  throw new HttpError(508, 'Quá nhiều lần chuyển hướng');
}

/* ----------------------------- Trích xuất ----------------------------- */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—', laquo: '«', raquo: '»', middot: '·', bull: '•', copy: '©'
};
{
  const pairs = 'agrave à aacute á acirc â atilde ã egrave è eacute é ecirc ê igrave ì iacute í ograve ò oacute ó ocirc ô otilde õ ugrave ù uacute ú yacute ý'.split(' ');
  for (let i = 0; i < pairs.length; i += 2) {
    NAMED[pairs[i]] = pairs[i + 1];
    NAMED[pairs[i][0].toUpperCase() + pairs[i].slice(1)] = pairs[i + 1].toUpperCase();
  }
}

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = /x/i.test(e[1]) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}
const clean = s => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/[\s\u00a0]+/g, ' ').trim();

function attr(attrs, name) {
  const m = attrs.match(new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : '';
}
function metaContent(html, prop) {
  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const p = attr(m[1], 'property') || attr(m[1], 'name');
    if (p.toLowerCase() === prop) return clean(attr(m[1], 'content'));
  }
  return '';
}

const BLOCK = 'p|div|h[1-6]|li|ul|ol|section|article|blockquote|tr|table|header|footer|nav|aside|main|pre|hr|center';
function htmlToLines(fragment, dropLinks = true) {
  let s = fragment;
  if (dropLinks) s = s.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(new RegExp('</?(?:' + BLOCK + ')\\b[^>]*>', 'gi'), '\n');
  s = decodeEntities(s.replace(/<[^>]+>/g, ''));
  return s.split('\n').map(x => x.replace(/[\s\u00a0]+/g, ' ').trim()).filter(Boolean);
}

/** Cắt khối <div ...> cân bằng bắt đầu tại vị trí start */
function balancedDiv(html, start) {
  const re = /<(\/?)div\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
}

const CONTENT_HINTS = ['chapter-c', 'chapter-content', 'chapter_content', 'chaptercontent', 'box-chap', 'reading-content',
  'content-chapter', 'chapter-detail', 'vungdoc', 'noidung', 'noi-dung', 'story-content', 'entry-content', 'text-content',
  'article-content', 'post-content', 'chapter-body', 'reading', 'content'];

function contentByHint(h) {
  for (const hint of CONTENT_HINTS) {
    const re = new RegExp('<div\\b[^>]*\\b(?:id|class)\\s*=\\s*["\'][^"\']*\\b' + hint.replace('-', '\\-') + '\\b[^"\']*["\'][^>]*>', 'i');
    const m = re.exec(h);
    if (!m) continue;
    const lines = htmlToLines(balancedDiv(h, m.index));
    if (lines.join('').length >= 300) return lines;
  }
  return null;
}

/** Chọn đoạn văn bản liên tục "đậm đặc" nhất (thuật toán Kadane trên điểm từng dòng) */
function densestBlock(lines) {
  let best = -Infinity, bs = 0, be = -1, cur = 0, cs = 0;
  lines.forEach((l, i) => {
    const sc = l.length >= 60 ? l.length : l.length >= 20 ? l.length * 0.5 : -15;
    if (cur <= 0) { cur = sc; cs = i; } else cur += sc;
    if (cur > best) { best = cur; bs = cs; be = i; }
  });
  const block = lines.slice(bs, be + 1);
  if (block.join('').length < 200) return lines.filter(l => l.length >= 40);
  return block;
}

const CH_RE = /(?:^|[\s:|\-–—(\[])(?:chương|chuong|chapter|chap|ch\.|hồi|tập)\s*[:.#\-]?\s*(\d{1,5})/i;
const HREF_CH_RE = /(?:chuong|chapter|chap)[-_]?(\d{1,5})(?=[-_\/.]|$)/i;
const NEXT_RE = /(?:chương|chap|chapter|bài|trang)\s*(?:sau|tiếp|kế)|tiếp theo|^next\b|next\s*(?:chapter|page|›|»|>)|^(?:›|»|>>|→)$|^sau\s*[›»>]?$/i;
const PREV_RE = /(?:chương|chap|chapter|bài|trang)\s*trước|^prev|previous|^(?:‹|«|<<|←)$|^[‹«<]?\s*trước$/i;

function extract(html, baseUrl) {
  const base = new URL(baseUrl);
  const pageTitle = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const ogTitle = metaContent(html, 'og:title');
  let h = html.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|template|select|button|form|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  const headings = [...h.matchAll(/<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m => clean(m[2])).filter(Boolean);
  const chTitleEl = h.match(/<(\w+)\b[^>]*class\s*=\s*["'][^"']*(?:chapter-title|chapter_title|chaptertitle|chap-title|title-chapter)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i);

  // Liên kết
  const links = [];
  for (const m of h.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], 'href');
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) continue;
    let abs;
    try { const u = new URL(href, base); u.hash = ''; abs = u; } catch { continue; }
    if (!/^https?:$/.test(abs.protocol)) continue;
    links.push({
      href: abs.href, host: abs.host, text: clean(m[2]), title: attr(m[1], 'title'),
      rel: attr(m[1], 'rel').toLowerCase(),
      cls: (attr(m[1], 'class') + ' ' + attr(m[1], 'id')).toLowerCase()
    });
  }
  const same = links.filter(l => l.host === base.host && l.href !== base.href);

  // Danh sách chương
  const seen = new Set();
  let chapters = [];
  for (const l of same) {
    if (NEXT_RE.test(l.text) || PREV_RE.test(l.text)) continue;
    const tm = l.text.match(CH_RE) || (' ' + l.title).match(CH_RE);
    const hm = l.href.match(HREF_CH_RE);
    if (!tm && !hm) continue;
    if (seen.has(l.href)) continue;
    seen.add(l.href);
    const n = Number((tm || hm)[1]);
    chapters.push({ url: l.href, title: (l.text || l.title || 'Chương ' + n).slice(0, 200), n });
  }
  if (chapters.length > 1 && chapters[0].n > chapters[chapters.length - 1].n) chapters.reverse();

  // Chương sau / trước
  const headNext = (h.match(/<link\b[^>]*rel\s*=\s*["']?next["']?[^>]*>/i) || [])[0];
  let next = same.find(l => /\bnext\b/.test(l.rel)) ||
    same.find(l => NEXT_RE.test(l.text) || NEXT_RE.test(l.title)) ||
    same.find(l => /\b(?:next|next-chap|chap-next|btn-next|nextchap)\b/.test(l.cls));
  let nextUrl = next ? next.href : null;
  if (!nextUrl && headNext) {
    try { const u = new URL(attr(headNext, 'href'), base); if (u.host === base.host) nextUrl = u.href; } catch { /* bỏ qua */ }
  }
  const prev = same.find(l => /\bprev\b/.test(l.rel)) || same.find(l => PREV_RE.test(l.text) || PREV_RE.test(l.title));

  // Nội dung
  let body = h.replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  let paragraphs = contentByHint(body) || densestBlock(htmlToLines(body));
  paragraphs = paragraphs.filter(p => !/^(quảng cáo|advertisement|ads)$/i.test(p)).slice(0, 4000);
  const chars = paragraphs.reduce((s, p) => s + p.length, 0);

  // Tiêu đề
  const chapterTitle = (chTitleEl && clean(chTitleEl[2])) || headings.find(t => CH_RE.test(' ' + t)) || '';
  const rawTitle = ogTitle || pageTitle || headings[0] || base.host;
  const segs = rawTitle.split(/\s+[|\-–—:]\s+/).filter(s => !CH_RE.test(' ' + s));
  const storyTitle = (segs[0] || rawTitle).slice(0, 200);

  let kind;
  if (chapters.length >= 5 && chars < 2500) kind = 'toc';
  else if (chars >= 300) kind = 'chapter';
  else kind = chapters.length ? 'toc' : 'chapter';

  return {
    url: base.href, pageTitle, storyTitle, chapterTitle, kind,
    paragraphs, chars, chapters: chapters.slice(0, 3000),
    next: nextUrl, prev: prev ? prev.href : null
  };
}

function extractText(text, url) {
  const paragraphs = text.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4000);
  return { url, pageTitle: '', storyTitle: new URL(url).pathname.split('/').pop() || url, chapterTitle: '', kind: 'chapter',
    paragraphs, chars: paragraphs.join('').length, chapters: [], next: null, prev: null };
}

/* ------------------------------ Bộ nhớ đệm ----------------------------- */
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
function cacheGet(k) { const e = cache.get(k); if (e && Date.now() - e.t < CACHE_TTL) return e.v; cache.delete(k); return null; }
function cacheSet(k, v) { cache.set(k, { t: Date.now(), v }); if (cache.size > 200) cache.delete(cache.keys().next().value); }

/* ------------------------------ HTTP server ---------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8'
};
function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function handleImport(res, target) {
  if (!target) return sendJson(res, 400, { ok: false, error: 'Thiếu tham số url' });
  const hit = cacheGet(target);
  if (hit) return sendJson(res, 200, { ok: true, cached: true, ...hit });
  const page = await fetchPage(target);
  const data = page.isText ? extractText(page.body, page.finalUrl) : extract(page.body, page.finalUrl);
  cacheSet(target, data);
  sendJson(res, 200, { ok: true, ...data });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Không tìm thấy'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname === '/api/import') return await handleImport(res, u.searchParams.get('url'));
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      serveStatic(req, res, u.pathname);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      sendJson(res, status, { ok: false, error: e instanceof HttpError ? e.message : 'Lỗi máy chủ: ' + e.message });
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`📗 Excel Story Reader đang chạy: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  });
}

module.exports = { extract, htmlToLines, createServer, isPrivateIp };
