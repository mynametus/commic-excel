'use strict';
// Vercel Serverless Function: GET /api/import?url=...
// Dùng lại logic trích xuất của server.js
const { handleImportRequest } = require('../server.js');

module.exports = (req, res) => handleImportRequest(req, res);
