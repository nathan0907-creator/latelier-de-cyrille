'use strict';

const zlib = require('node:zlib');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'inconnu';
}

const isSecure = (req, trustProxy) =>
  Boolean(req.socket.encrypted) || (trustProxy && req.headers['x-forwarded-proto'] === 'https');

/**
 * Protection CSRF : une requête qui modifie quelque chose doit venir du site lui-même.
 * (Le cookie de session est en plus « SameSite=Strict ».)
 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
  return req.headers['sec-fetch-site'] === 'same-origin';
}

async function readJson(req, limit = 16 * 1024) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, 'Format de requête non accepté.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Requête trop volumineuse.');
    chunks.push(chunk);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Requête illisible.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Requête illisible.');
  return data;
}

function contentSecurityPolicy(config, secure) {
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: ${config.imageHosts.join(' ')}`.trim(),
    'frame-src https://www.google.com',
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (secure) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** Les en-têtes de sécurité de toutes les réponses du site. */
function securityHeaders(config, secure) {
  return {
    'Content-Security-Policy': contentSecurityPolicy(config, secure),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...(secure && { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }),
  };
}

function applySecurityHeaders(req, res, config) {
  for (const [name, value] of Object.entries(securityHeaders(config, isSecure(req, config.trustProxy)))) res.setHeader(name, value);
}

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;

function acceptedEncoding(req) {
  const accepted = String(req.headers['accept-encoding'] || '');
  if (/\bbr\b/.test(accepted)) return 'br';
  if (/\bgzip\b/.test(accepted)) return 'gzip';
  return null;
}

function compress(buffer, encoding) {
  return encoding === 'br'
    ? zlib.brotliCompressSync(buffer, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
    : zlib.gzipSync(buffer);
}

/** Envoie une réponse, compressée quand le navigateur l'accepte et que le contenu s'y prête. */
function send(req, res, status, headers, body) {
  let buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const encoding = buffer.length > 1024 && COMPRESSIBLE.test(headers['Content-Type'] || '') ? acceptedEncoding(req) : null;
  if (encoding) {
    buffer = compress(buffer, encoding);
    headers['Content-Encoding'] = encoding;
  }
  headers.Vary = 'Accept-Encoding';
  headers['Content-Length'] = buffer.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buffer);
}

function sendJson(req, res, status, data, headers = {}) {
  send(req, res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, JSON.stringify(data));
}

function sendHtml(req, res, status, html, headers = {}) {
  send(req, res, status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...headers }, String(html));
}

module.exports = {
  HttpError, clientIp, isSecure, sameOrigin, readJson, securityHeaders, applySecurityHeaders,
  acceptedEncoding, compress, send, sendJson, sendHtml, COMPRESSIBLE,
};
