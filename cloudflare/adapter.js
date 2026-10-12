'use strict';

const { EventEmitter } = require('node:events');

/** Ces en-têtes ne concernent que la connexion : c'est Cloudflare qui la gère. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding']);
/** Réponses sans contenu. */
const NO_BODY = new Set([101, 204, 205, 304]);

const bytes = chunk => (typeof chunk === 'string' ? Buffer.from(chunk) : chunk);

/**
 * Le site est écrit pour le serveur HTTP de Node.js : il lit une requête « req » et écrit dans une
 * réponse « res ». Cloudflare, lui, passe une Request et attend une Response. Cette fonction fait le
 * lien : la Request devient le « req » attendu, et ce que le site écrit dans « res » devient la
 * Response. Un flux en direct (Server-Sent Events) reste ouvert tant que la page l'écoute.
 */
function toFetchHandler(handle) {
  return function fetchHandler(request) {
    const url = new URL(request.url);
    const secure = url.protocol === 'https:';
    const visitor = request.headers.get('cf-connecting-ip') || '127.0.0.1';

    const req = new EventEmitter();
    req.method = request.method;
    req.url = `${url.pathname}${url.search}`;
    req.headers = Object.fromEntries(request.headers);
    req.headers.host = url.host;
    // L'adresse du visiteur et le protocole, donnés par Cloudflare (le site les lit comme derrière
    // un serveur frontal, avec TRUST_PROXY). Une valeur envoyée par le visiteur est remplacée.
    req.headers['x-forwarded-for'] = visitor;
    req.headers['x-forwarded-proto'] = secure ? 'https' : 'http';
    // Cloudflare compresse lui-même les réponses.
    delete req.headers['accept-encoding'];
    req.socket = { remoteAddress: visitor, encrypted: secure };
    req[Symbol.asyncIterator] = async function* body() {
      if (!request.body) return;
      const reader = request.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield Buffer.from(value);
      }
    };

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      queueMicrotask(() => req.emit('close'));
    };

    let respond;
    const response = new Promise(resolve => { respond = resolve; });
    let started = false; // la Response est partie
    let ended = false;
    let stream = null; // le contrôleur du flux, quand la réponse en est un
    const pending = {};

    const init = () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(pending)) {
        if (HOP_BY_HOP.has(name) || (stream && name === 'content-length')) continue;
        for (const item of [].concat(value)) headers.append(name, String(item));
      }
      return { status: res.statusCode, headers };
    };

    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader(name, value) {
        pending[name.toLowerCase()] = value;
        return res;
      },
      getHeader: name => pending[name.toLowerCase()],
      removeHeader(name) {
        delete pending[name.toLowerCase()];
      },
      writeHead(status, headers = {}) {
        res.statusCode = status;
        for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
        res.headersSent = true;
        return res;
      },
      /** Écrire sans terminer : la réponse devient un flux, envoyé au fur et à mesure. */
      write(chunk) {
        if (ended) return false;
        if (!res.headersSent) res.writeHead(res.statusCode);
        if (!stream) {
          const body = new ReadableStream({
            start: controller => { stream = controller; },
            // La page s'est fermée : le flux est coupé de l'autre côté.
            cancel: () => {
              ended = true;
              close();
            },
          });
          started = true;
          respond(new Response(body, init()));
        }
        try {
          stream.enqueue(bytes(chunk));
        } catch {
          ended = true;
          close();
          return false;
        }
        return true;
      },
      end(chunk) {
        if (ended) return res;
        if (!res.headersSent) res.writeHead(res.statusCode);
        ended = true;
        if (stream) {
          try {
            if (chunk) stream.enqueue(bytes(chunk));
            stream.close();
          } catch { /* flux déjà coupé */ }
        } else {
          started = true;
          const body = NO_BODY.has(res.statusCode) || req.method === 'HEAD' || chunk === undefined ? null : bytes(chunk);
          respond(new Response(body, init()));
        }
        close();
        return res;
      },
    };

    // La page s'est fermée (Cloudflare le signale avec l'option « enable_request_signal ») : un flux
    // en direct encore ouvert est terminé.
    request.signal?.addEventListener('abort', () => {
      if (stream) res.end();
    });

    Promise.resolve()
      .then(() => handle(req, res))
      .catch(err => console.error(`[erreur] ${request.method} ${url.pathname}`, err))
      .finally(() => {
        // Le site n'a rien répondu (cela ne devrait pas arriver) : erreur plutôt qu'une attente sans fin.
        if (!started) {
          started = true;
          respond(new Response('Erreur du serveur. Réessayez dans un instant.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
        }
      });

    return response;
  };
}

module.exports = { toFetchHandler };
