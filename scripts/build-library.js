'use strict';
/*
 * Dựng thư viện tĩnh cho website:
 *  1. Chuyển tác phẩm Nam Cao (data/vi/namcao.json) thành public/stories/nc-*.json
 *  2. Quét public/stories/*.json → public/stories/index.json (danh mục cho giao diện)
 *
 * Chạy: node scripts/build-library.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const STORIES = path.join(ROOT, 'public', 'stories');
const GENRES = [
  { id: 'co-dai', name: 'Cổ đại', color: '#C0504D' },
  { id: 'hai-huoc', name: 'Hài hước', color: '#ED7D31' },
  { id: 'ngon-tinh', name: 'Ngôn tình', color: '#E05C9B' },
  { id: 'van-hoc-vn', name: 'Văn học VN', color: '#4472C4' }
];

const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function buildNamCao() {
  const file = path.join(ROOT, 'data', 'vi', 'namcao.json');
  if (!fs.existsSync(file)) { console.log('… chưa có data/vi/namcao.json (chạy scripts/fetch-sources.js trước)'); return 0; }
  const src = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const w of src.works) {
    const id = 'nc-' + slug(w.title);
    const first = (w.chapters[0].paras.find(p => p.length > 60) || w.chapters[0].paras[0] || '').slice(0, 150);
    const story = {
      id, title: w.title, author: 'Nam Cao', work: w.chapters.length > 1 ? 'Tập truyện / truyện dài' : 'Truyện ngắn',
      genre: 'van-hoc-vn', era: 'Việt Nam, 1940–1951',
      desc: `Tác phẩm của Nam Cao${w.chapters.length > 1 ? ` (${w.chapters.length} phần)` : ''}. Mở đầu: “${first}${first.length >= 150 ? '…' : ''}”`,
      source: 'https://vi.wikisource.org/wiki/' + encodeURIComponent(w.page.replace(/ /g, '_')),
      license: src.license,
      chapters: w.chapters.map(c => ({ title: c.title === w.page ? w.title : c.title, paras: c.paras }))
    };
    fs.writeFileSync(path.join(STORIES, id + '.json'), JSON.stringify(story, null, 1));
    n++;
  }
  console.log(`✓ Nam Cao: ${n} truyện`);
  return n;
}

function buildIndex() {
  const items = [];
  for (const f of fs.readdirSync(STORIES).sort()) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    const s = JSON.parse(fs.readFileSync(path.join(STORIES, f), 'utf8'));
    if (!s.id || !Array.isArray(s.chapters) || !s.chapters.length) { console.log('  bỏ qua file lỗi:', f); continue; }
    items.push({
      id: s.id, title: s.title, titleZh: s.titleZh || '', author: s.author || '', authorZh: s.authorZh || '',
      work: s.work || '', genre: s.genre, era: s.era || '', desc: s.desc || '',
      translator: s.translator || '', source: s.source || '', license: s.license || '',
      chapters: s.chapters.length, chapterTitles: s.chapters.map(c => c.title),
      words: s.chapters.reduce((a, c) => a + c.paras.join(' ').split(/\s+/).length, 0)
    });
  }
  const index = { generated: new Date().toISOString(), genres: GENRES, stories: items };
  fs.writeFileSync(path.join(STORIES, 'index.json'), JSON.stringify(index));
  const by = Object.fromEntries(GENRES.map(g => [g.name, items.filter(i => i.genre === g.id).length]));
  console.log(`✓ index.json: ${items.length} truyện`, by);
}

fs.mkdirSync(STORIES, { recursive: true });
buildNamCao();
buildIndex();
