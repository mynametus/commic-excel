'use strict';
// Vercel Serverless Function: GET /api/import?url=...
// Dùng lại logic trích xuất trong lib/core.js
const { handleImportRequest } = require('../lib/core.js');

module.exports = (req, res) => handleImportRequest(req, res);
