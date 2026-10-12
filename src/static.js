'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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

/**
 * Empreinte des styles et des scripts : elle change dès qu'un de ces fichiers change. Ajoutée aux
 * adresses (« /css/base.css?v=… »), elle permet au navigateur de les garder un an sans jamais
 * afficher une ancienne version. Recalculée au plus toutes les deux secondes.
 */
function createVersion(publicDir) {
  let value = '';
  let checked = 0;
  return function version() {
    if (value && Date.now() - checked < 2000) return value;
    const hash = crypto.createHash('sha256');
    for (const dir of ['css', 'js']) {
      let names = [];
      try {
        names = fsSync.readdirSync(path.join(publicDir, dir)).sort();
      } catch { /* dossier absent */ }
      for (const name of names) {
        const stat = fsSync.statSync(path.join(publicDir, dir, name));
        hash.update(`${dir}/${name}:${stat.size}:${Math.round(stat.mtimeMs)};`);
      }
    }
    checked = Date.now();
    value = hash.digest('base64url').slice(0, 10);
    return value;
  };
}

/**
 * Durée de garde par le navigateur. Adresse versionnée (« ?v=… ») : un an. Sinon, styles et
 * scripts sont toujours revalidés (mise à jour immédiate) et les images restent un jour en cache.
 */
const cacheControl = (type, versioned) => (versioned ? 'public, max-age=31536000, immutable'
  : /^(text|font)\//.test(type) ? 'no-cache' : 'public, max-age=86400');

/** Sert les fichiers de public/ : types connus uniquement, jamais hors du dossier, avec ETag et compression. */
function createStatic(publicDir) {
  const root = path.resolve(publicDir);
  const compressed = new Map();

  return async function serveStatic(req, res, pathname, { versioned = false } = {}) {
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
    const headers = { 'Content-Type': type, ETag: etag, 'Cache-Control': cacheControl(type, versioned), Vary: 'Accept-Encoding' };
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

module.exports = { createStatic, createVersion, cacheControl, TYPES };
