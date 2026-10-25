'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const MAX_BODY_BYTES = 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const PISTON_API_URL = process.env.PISTON_API_URL || 'https://emkc.org/api/v2/piston/execute';
const PISTON_API_TOKEN = process.env.PISTON_API_TOKEN || '';
const requestBuckets = new Map();
const ALLOWED_LANGUAGES = new Set(['python', 'javascript', 'sqlite3', 'c++', 'java', 'c', 'typescript', 'rust', 'go', 'csharp', 'php', 'ruby']);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function sendText(res, statusCode, message, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(message);
}

function checkRateLimit(ip) {
  const now = Date.now();
  const current = requestBuckets.get(ip);
  if (!current || now - current.start >= RATE_LIMIT_WINDOW_MS) {
    requestBuckets.set(ip, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT_MAX;
}

async function handleExecution(req, res) {
  const forwarded = (req.headers['x-forwarded-for'] || '').toString().split(',').map(value => value.trim()).filter(Boolean);
  const ip = forwarded.length ? forwarded[forwarded.length - 1] : (req.socket.remoteAddress || 'unknown');
  if (requestBuckets.size > 1000) {
    const now = Date.now();
    for (const [key, value] of requestBuckets) if (now - value.start >= RATE_LIMIT_WINDOW_MS) requestBuckets.delete(key);
  }
  if (!checkRateLimit(ip)) return sendText(res, 429, 'Execution rate limit reached. Please wait one minute and try again.');

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) return sendText(res, 413, 'Request is too large (maximum 1 MB).');

  let raw = '';
  try {
    for await (const chunk of req) {
      raw += chunk.toString('utf8');
      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
        return sendText(res, 413, 'Request is too large (maximum 1 MB).');
      }
    }
    const payload = JSON.parse(raw || '{}');
    const { language, version, files, stdin = '' } = payload;
    if (typeof language !== 'string' || !ALLOWED_LANGUAGES.has(language)) {
      return sendText(res, 400, 'Unsupported compiler language.');
    }
    if (typeof version !== 'string' || version.length > 40 || !Array.isArray(files) || files.length < 1 || files.length > 20) {
      return sendText(res, 400, 'Invalid compiler request.');
    }
    if (typeof stdin !== 'string' || stdin.length > 100_000) {
      return sendText(res, 400, 'Standard input must be text under 100 KB.');
    }
    const cleanFiles = [];
    let totalCodeBytes = 0;
    for (const file of files) {
      if (!file || typeof file.name !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(file.name) || typeof file.content !== 'string') {
        return sendText(res, 400, 'Each file must have a safe filename and text content.');
      }
      totalCodeBytes += Buffer.byteLength(file.content, 'utf8');
      cleanFiles.push({ name: file.name, content: file.content });
    }
    if (totalCodeBytes > 900_000) return sendText(res, 413, 'Total code is too large (maximum 900 KB).');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const upstream = await fetch(PISTON_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(PISTON_API_TOKEN ? { Authorization: `Bearer ${PISTON_API_TOKEN}` } : {})
        },
        body: JSON.stringify({ language, version, files: cleanFiles, stdin }),
        signal: controller.signal
      });
      const body = await upstream.text();
      if (!upstream.ok) {
        const detail = upstream.status === 401 || upstream.status === 403
          ? 'Compiler service requires authorization. Configure PISTON_API_URL and PISTON_API_TOKEN, or use an authorized/self-hosted Piston service.'
          : `Compiler service returned HTTP ${upstream.status}.`;
        return sendText(res, 502, detail);
      }
      let result;
      try { result = JSON.parse(body); } catch { return sendText(res, 502, 'Compiler service returned invalid JSON.'); }
      if (!result || !result.run) return sendText(res, 502, 'Compiler service response did not include a run result.');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(result));
    } catch (error) {
      const status = error && error.name === 'AbortError' ? 504 : 502;
      sendText(res, status, status === 504 ? 'Compiler service timed out.' : 'Compiler service is unavailable. Please try again later.');
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    sendText(res, 400, 'Request body must be valid JSON.');
  }
}

function resolvePublicFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const relative = decoded.replace(/^\/+/, '') || 'index.html';
  const resolved = path.resolve(PUBLIC_DIR, relative);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (req.method === 'POST' && pathname === '/api/execute') {
    return handleExecution(req, res);
  }
  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/execute') {
      res.setHeader('Allow', 'POST');
      return sendText(res, 405, 'Method Not Allowed');
    }
    return sendText(res, 404, 'Not Found');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', pathname === '/api/execute' ? 'GET, HEAD, POST' : 'GET, HEAD');
    return sendText(res, 405, 'Method Not Allowed');
  }

  if (pathname === '/healthz') {
    const body = JSON.stringify({
      status: 'ok',
      platform: 'CI Codes v3.0 Enterprise',
      founder: 'Chiragpala Naik MD',
      timestamp: new Date().toISOString()
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }

  let filePath = resolvePublicFile(pathname);
  if (!filePath) return sendText(res, 400, 'Bad Request');
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      // Friendly SPA fallback for application routes, but never for missing assets.
      if (path.extname(pathname)) return sendText(res, 404, 'Not Found');
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    const stat = fs.statSync(filePath);
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=3600'
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) sendText(res, 500, 'Unable to read requested file');
      else res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Request error:', error);
    if (!res.headersSent) sendText(res, 500, 'Internal Server Error');
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CI Codes v3.0 running at http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
