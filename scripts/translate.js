'use strict';
/*
 * Dịch truyện cổ chữ Hán (phạm vi công cộng) sang tiếng Việt bằng Claude API.
 * Kết quả: public/stories/<id>.json, sau đó chạy scripts/build-library.js để cập nhật danh mục.
 *
 * Chuẩn bị:
 *   npm install                       (cài @anthropic-ai/sdk)
 *   node scripts/fetch-sources.js     (tải nguyên tác về data/zh)
 *   Đặt ANTHROPIC_API_KEY (hoặc đăng nhập bằng `ant auth login`)
 *
 * Chạy:
 *   node scripts/translate.js --dry                      xem kế hoạch + ước tính chi phí, KHÔNG gọi API
 *   node scripts/translate.js --genre=ngon-tinh --limit=5
 *   node scripts/translate.js --genre=all
 *   Tuỳ chọn: --effort=low|medium|high  (mặc định medium)
 *
 * Chạy lại an toàn: truyện đã dịch sẽ bỏ qua; truyện dịch dở sẽ tiếp tục từ đoạn đã lưu.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ZH = path.join(ROOT, 'data', 'zh');
const PARTIAL = path.join(ROOT, 'data', 'translations');
const STORIES = path.join(ROOT, 'public', 'stories');
const PLAN = require('./translation-plan.json');

const MODEL = 'claude-opus-5-5';
const PRICE = { input: 4, output: 20 }; // USD / 1 triệu token (Claude Opus 5.5)
const CHUNK = 2500;                     // số ký tự Hán tối đa mỗi lần gọi

const arg = (name, def) => { const a = process.argv.find(x => x.startsWith('--' + name + '=')); return a ? a.split('=')[1] : def; };
const DRY = process.argv.includes('--dry');
const GENRE = arg('genre', 'all');
const LIMIT = Number(arg('limit', 0)) || Infinity;
const EFFORT = arg('effort', 'medium');

const GENRE_NAME = { 'co-dai': 'Cổ đại', 'ngon-tinh': 'Ngôn tình', 'hai-huoc': 'Hài hước' };
const books = {};
function book(key) {
  if (!books[key]) {
    const f = path.join(ZH, key + '.json');
    if (!fs.existsSync(f)) throw new Error(`Chưa có nguồn ${key}. Chạy: node scripts/fetch-sources.js`);
    books[key] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  return books[key];
}

/* ------------------------- Lập danh sách việc cần làm ------------------------- */
const refKey = r => r.book + '|' + (r.parts ? r.parts.join(',') : '') + '|' + (r.range ? r.range.join('-') : '') + '|' + (r.split ? r.split + ':' + r.index : '');

function existingRefs() {
  const set = new Set();
  if (!fs.existsSync(STORIES)) return set;
  for (const f of fs.readdirSync(STORIES)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    try { const s = JSON.parse(fs.readFileSync(path.join(STORIES, f), 'utf8')); if (s.sourceRef) set.add(refKey(s.sourceRef)); } catch (e) { /* bỏ qua */ }
  }
  return set;
}

function resolve(entry, genre) {
  const b = book(entry.book);
  let parts, id;
  if (entry.parts) {
    parts = entry.parts.map(t => b.parts.find(p => p.title === t || p.title.endsWith(' ' + t) || p.title.replace(/\s+/g, '') === t.replace(/\s+/g, '')));
    if (parts.some(p => !p)) return { error: `không tìm thấy phần "${entry.parts.join(', ')}" trong ${b.title}` };
    id = `${entry.book}-${b.parts.indexOf(parts[0])}`;
  } else if (entry.range) {
    parts = b.parts.slice(entry.range[0], entry.range[1]);
    id = `${entry.book}-r${entry.range[0]}-${entry.range[1]}`;
  } else if (entry.split) {
    const all = b.parts.flatMap(p => p.paras);
    const paras = all.slice(entry.index * entry.split, (entry.index + 1) * entry.split);
    if (!paras.length) return { error: `${b.title}: hết nội dung ở tập ${entry.index + 1}` };
    parts = [{ title: entry.title, paras }];
    id = `${entry.book}-s${entry.split}-${entry.index}`;
  } else {
    parts = b.parts;
    id = entry.book;
  }
  const chars = parts.reduce((a, p) => a + p.paras.join('').length, 0);
  return { id, genre, entry, book: b, parts, chars, ref: { book: entry.book, parts: entry.parts, range: entry.range, split: entry.split, index: entry.index } };
}

function chunkParas(paras) {
  const out = [];
  let cur = [];
  let len = 0;
  const pieces = [];
  for (const p of paras) {
    if (p.length <= CHUNK) { pieces.push(p); continue; }
    // đoạn quá dài: tách theo dấu kết câu
    let buf = '';
    for (const s of p.split(/(?<=[。！？」])/)) { if ((buf + s).length > CHUNK && buf) { pieces.push(buf); buf = ''; } buf += s; }
    if (buf) pieces.push(buf);
  }
  for (const p of pieces) {
    if (len + p.length > CHUNK && cur.length) { out.push(cur); cur = []; len = 0; }
    cur.push(p); len += p.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/* ------------------------------- Gọi Claude ------------------------------- */
const SYSTEM = `Bạn là dịch giả văn học cổ điển Trung Hoa sang tiếng Việt.
Nhiệm vụ: dịch nguyên văn chữ Hán (văn ngôn hoặc bạch thoại cổ) sang tiếng Việt hiện đại, trong sáng, đọc trôi chảy, giữ không khí truyện cổ.
Quy tắc:
- Trung thành với nguyên tác: không thêm tình tiết, không bình luận, không tóm tắt, không bỏ sót câu nào.
- Tên người, địa danh, chức quan, niên hiệu: phiên âm Hán–Việt (ví dụ 張生 → Trương sinh, 長安 → Trường An).
- Lời thoại đặt trong ngoặc kép “ ”.
- Thơ, từ, câu đối: dịch thành thơ tiếng Việt có vần nhịp nếu được, các dòng ngăn cách bằng " / ", đặt trong ngoặc kép.
- Lời bình "異史氏曰" dịch là "Dị sử thị nói:".
- Bỏ các ghi chú xuất xứ, số quyển của người biên tập (ví dụ "廣記二百六十二", "御覽…") và ký hiệu lỗi văn bản.
- Nếu đoạn nguồn bị lỗi/khuyết chữ, dịch phần hiểu được, không bịa thêm.
Định dạng trả lời (chỉ văn bản thuần, không markdown):
TIÊU ĐỀ: <tiêu đề phần đã dịch sang tiếng Việt>
---
<các đoạn dịch, mỗi đoạn cách nhau một dòng trống, giữ đúng số đoạn và thứ tự như nguồn>`;

let client = null;
async function getClient() {
  if (!client) {
    const sdk = require('@anthropic-ai/sdk');
    const Anthropic = sdk.default || sdk;
    client = new Anthropic({ maxRetries: 4 });
  }
  return client;
}

async function ask(userText, maxTokens) {
  const c = await getClient();
  // fallbacks: "default" — nếu model chính từ chối vì bộ lọc an toàn, API tự chạy lại trên model dự phòng
  const stream = c.beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: EFFORT },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userText }]
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Model từ chối dịch đoạn này' + (msg.stop_details && msg.stop_details.category ? ` (${msg.stop_details.category})` : ''));
  if (msg.stop_reason === 'max_tokens') throw new Error('Bản dịch bị cắt do vượt max_tokens — giảm CHUNK');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { text, usage: msg.usage };
}

function parseTranslation(text) {
  const m = text.match(/^\s*TIÊU ĐỀ:\s*(.+?)\s*\n-{3,}\s*\n([\s\S]*)$/);
  const title = m ? m[1].trim() : null;
  const body = m ? m[2] : text;
  const paras = body.split(/\n\s*\n/).map(s => s.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  return { title, paras };
}

/* -------------------------------- Dịch 1 truyện -------------------------------- */
async function translateJob(job) {
  fs.mkdirSync(PARTIAL, { recursive: true });
  const pfile = path.join(PARTIAL, job.id + '.json');
  const state = fs.existsSync(pfile) ? JSON.parse(fs.readFileSync(pfile, 'utf8')) : { chapters: [], usage: { input: 0, output: 0 } };
  const save = () => fs.writeFileSync(pfile, JSON.stringify(state, null, 1));

  for (let pi = 0; pi < job.parts.length; pi++) {
    const part = job.parts[pi];
    const chunks = chunkParas(part.paras);
    const ch = state.chapters[pi] || (state.chapters[pi] = { titleZh: part.title, title: null, paras: [], done: 0 });
    for (let ci = ch.done; ci < chunks.length; ci++) {
      process.stdout.write(`   phần ${pi + 1}/${job.parts.length}, đoạn ${ci + 1}/${chunks.length}… `);
      const prompt = `Tác phẩm: ${job.book.title} (${job.book.author}). Tiêu đề phần: ${part.title}${chunks.length > 1 ? ` — đoạn ${ci + 1}/${chunks.length}` : ''}.\n\nNguyên văn (${chunks[ci].length} đoạn):\n\n${chunks[ci].join('\n\n')}`;
      const { text, usage } = await ask(prompt, 32000);
      const t = parseTranslation(text);
      if (!ch.title && t.title) ch.title = t.title;
      ch.paras.push(...t.paras);
      ch.done = ci + 1;
      state.usage.input += usage.input_tokens + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      state.usage.output += usage.output_tokens;
      save();
      console.log(`✓ ${t.paras.length} đoạn`);
    }
  }

  // Tên truyện + mô tả ngắn
  if (!state.meta) {
    const excerpt = state.chapters.flatMap(c => c.paras).join('\n').slice(0, 2500);
    const { text, usage } = await ask(
      `Dưới đây là bản dịch tiếng Việt của một truyện cổ (${job.book.title}). Hãy trả lời đúng định dạng:\nTIÊU ĐỀ: <tên truyện tiếng Việt ngắn gọn, phiên âm Hán–Việt hoặc dịch nghĩa${job.entry.title ? `; gợi ý: ${job.entry.title}` : ''}>\n---\n<một đoạn giới thiệu 1–2 câu, tối đa 45 chữ, không tiết lộ kết thúc>\n\n${excerpt}`, 2000);
    const t = parseTranslation(text);
    state.meta = { title: job.entry.title || t.title, desc: t.paras.join(' ') };
    state.usage.input += usage.input_tokens; state.usage.output += usage.output_tokens;
    save();
  }

  const b = job.book;
  const story = {
    id: job.id,
    title: state.meta.title || state.chapters[0].title,
    titleZh: job.parts.length === 1 ? job.parts[0].title : b.title,
    author: b.authorVi, authorZh: b.author,
    work: { liaozhai: 'Liêu Trai chí dị', soushen: 'Sưu thần ký', dongzhou: 'Đông Chu liệt quốc', jingshi: 'Cảnh thế thông ngôn', yushi: 'Dụ thế minh ngôn', xingshi: 'Tỉnh thế hằng ngôn', fusheng: 'Phù sinh lục ký', rulin: 'Nho lâm ngoại sử', xiaozan: 'Tiếu tán', xiaolin: 'Tiếu lâm', yingying: 'Truyền kỳ đời Đường' }[job.entry.book] || b.title,
    genre: job.genre,
    era: `Tác giả mất năm ${b.died}`,
    desc: state.meta.desc,
    source: b.source,
    license: `Nguyên tác thuộc phạm vi công cộng (tác giả mất năm ${b.died}). Bản dịch tiếng Việt mới, dịch từ nguyên tác chữ Hán bằng ${MODEL}.`,
    translator: `Claude (AI, ${MODEL}) — bản dịch máy, cần biên tập lại`,
    sourceRef: job.ref,
    chapters: state.chapters.map((c, i) => ({ title: job.parts.length > 1 ? `Hồi ${i + 1}: ${c.title || c.titleZh}` : (c.title || state.meta.title), paras: c.paras }))
  };
  fs.writeFileSync(path.join(STORIES, job.id + '.json'), JSON.stringify(story, null, 1));
  fs.unlinkSync(pfile);
  return state.usage;
}

/* ---------------------------------- Main ---------------------------------- */
(async () => {
  const done = existingRefs();
  const seen = new Set();
  const jobs = [];
  for (const genre of Object.keys(GENRE_NAME)) {
    if (GENRE !== 'all' && GENRE !== genre) continue;
    for (const entry of PLAN[genre] || []) {
      const key = refKey(entry);
      if (seen.has(key)) { console.log(`  ⚠ trùng trong kế hoạch, bỏ qua: ${key}`); continue; }
      seen.add(key);
      if (done.has(key)) continue;
      const job = resolve(entry, genre);
      if (job.error) { console.log('  ⚠', job.error); continue; }
      if (fs.existsSync(path.join(STORIES, job.id + '.json'))) continue;
      jobs.push(job);
    }
  }
  const todo = jobs.slice(0, LIMIT);
  const chars = todo.reduce((a, j) => a + j.chars, 0);
  const calls = todo.reduce((a, j) => a + j.parts.reduce((x, p) => x + chunkParas(p.paras).length, 0) + 1, 0);
  // Ước tính thô: 1 ký tự Hán ≈ 1,5 token vào; bản dịch tiếng Việt ≈ 3 token/ký tự Hán (chưa tính token suy nghĩ)
  const estIn = chars * 1.5 + calls * 900, estOut = chars * 3.2;
  const cost = (estIn * PRICE.input + estOut * PRICE.output) / 1e6;
  console.log(`\nCần dịch: ${todo.length} truyện (${jobs.length} chưa dịch), ${chars.toLocaleString('vi-VN')} ký tự Hán, ~${calls} lần gọi API`);
  for (const g of Object.keys(GENRE_NAME)) { const n = todo.filter(j => j.genre === g).length; if (n) console.log(`  ${GENRE_NAME[g]}: ${n}`); }
  console.log(`Ước tính chi phí (${MODEL}, effort ${EFFORT}): ~${cost.toFixed(2)} USD — con số thô, chi phí thật có thể cao hơn do token suy nghĩ.`);
  if (DRY || !todo.length) return;

  const total = { input: 0, output: 0 };
  for (const [i, job] of todo.entries()) {
    console.log(`\n[${i + 1}/${todo.length}] ${job.id} — ${job.parts[0].title}${job.parts.length > 1 ? ` (+${job.parts.length - 1} phần)` : ''} [${GENRE_NAME[job.genre]}]`);
    try {
      const u = await translateJob(job);
      total.input += u.input; total.output += u.output;
    } catch (e) {
      console.log(`   ✗ Lỗi: ${e.message} (đã lưu tiến độ, chạy lại để tiếp tục)`);
      if (e.status === 401 || e.status === 403) break;
    }
  }
  console.log(`\nĐã dùng: ${total.input.toLocaleString('vi-VN')} token vào, ${total.output.toLocaleString('vi-VN')} token ra ≈ ${((total.input * PRICE.input + total.output * PRICE.output) / 1e6).toFixed(2)} USD`);
  console.log('Tiếp theo: node scripts/build-library.js');
})().catch(e => { console.error(e); process.exit(1); });
