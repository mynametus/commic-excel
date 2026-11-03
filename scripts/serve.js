'use strict';
/*
 * Máy chủ chạy trên máy (npm start) — không dùng khi deploy Vercel.
 *  - Phục vụ giao diện tĩnh trong thư mục public/
 *  - Chuyển /api/import?url=... sang lib/core.js
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { handleImportRequest, sendJson, HttpError } = require('../lib/core.js');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8'
};

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
      if (u.pathname === '/api/import') return await handleImportRequest(req, res);
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

module.exports = { createServer };
