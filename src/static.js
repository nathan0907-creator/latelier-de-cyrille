'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { acceptedEncoding, compress, COMPRESSIBLE } = require('./http');

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Sert les fichiers de public/ : types connus uniquement, jamais hors du dossier, avec ETag et compression. */
function createStatic(publicDir) {
  const root = path.resolve(publicDir);
  const compressed = new Map();

  return async function serveStatic(req, res, pathname) {
    let relative;
    try {
      relative = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    if (relative.includes('\0') || relative.split('/').some(segment => segment.startsWith('.'))) return false;

    const type = TYPES[path.extname(relative).toLowerCase()];
    if (!type) return false;

    const file = path.resolve(root, `.${relative}`);
    if (!file.startsWith(root + path.sep)) return false;

    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;

    const etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': type,
      ETag: etag,
      // Styles et scripts : toujours revalidés (mise à jour immédiate). Images : un jour en cache.
      'Cache-Control': /^(text|font)\//.test(type) ? 'no-cache' : 'public, max-age=86400',
      Vary: 'Accept-Encoding',
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }

    let body = await fs.readFile(file);
    const encoding = body.length > 1024 && COMPRESSIBLE.test(type) ? acceptedEncoding(req) : null;
    if (encoding) {
      const key = `${file}|${etag}|${encoding}`;
      if (!compressed.has(key)) compressed.set(key, compress(body, encoding));
      body = compressed.get(key);
      headers['Content-Encoding'] = encoding;
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}

module.exports = { createStatic };
