'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'salon_session';
// Sans I, L, O, 0 ni 1 : le code se recopie sans erreur depuis la console.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOO_COMMON = new Set([
  '1234567890', '0123456789', '0987654321', 'azertyuiop', 'qwertyuiop', 'motdepasse',
  'motdepasse1', 'motdepasse123', 'password123', 'azerty12345', 'coiffeur123', 'coiffeuse123',
]);

const sha256 = value => crypto.createHash('sha256').update(value).digest();

/** Comparaison à temps constant, quelle que soit la longueur des chaînes. */
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(String(a)), sha256(String(b)));

function derive(password, salt, params) {
  return scrypt(password.normalize('NFKC'), salt, params.keylen, {
    N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r,
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await derive(password, salt, SCRYPT);
  return { algo: 'scrypt', ...SCRYPT, salt: salt.toString('hex'), hash: hash.toString('hex') };
}

async function verifyPassword(password, record) {
  if (!record || record.algo !== 'scrypt' || typeof password !== 'string') return false;
  const expected = Buffer.from(record.hash, 'hex');
  const actual = await derive(password, Buffer.from(record.salt, 'hex'), { ...record, keylen: expected.length });
  return crypto.timingSafeEqual(actual, expected);
}

/** Message d'erreur si le mot de passe est trop faible, sinon null. */
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (password.length > 200) return 'Le mot de passe est trop long (200 caractères au plus).';
  if (/^(.)\1+$/.test(password) || TOO_COMMON.has(password.toLowerCase())) return 'Ce mot de passe est trop facile à deviner.';
  return null;
}

function generateSetupCode() {
  const chars = Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

const normalizeCode = code => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

const failure = (status, error) => ({ ok: false, status, error });

/**
 * Accès à l'espace salon.
 * - Première utilisation : un code à usage unique, affiché dans la console du serveur,
 *   autorise la création du mot de passe (personne d'autre ne peut s'approprier l'espace).
 * - Le mot de passe est haché avec scrypt ; seul le hachage est enregistré.
 * - Les sessions vivent en mémoire, identifiées par le SHA-256 d'un jeton aléatoire.
 */
function createAuth({ store, now = Date.now }) {
  const sessions = new Map();
  let setupCode = null;

  const isConfigured = () => Boolean(store.admin.get());

  function currentSetupCode() {
    if (isConfigured()) return null;
    if (!setupCode) setupCode = generateSetupCode();
    return setupCode;
  }

  async function setup(code, password) {
    if (isConfigured()) return failure(409, "L'espace salon est déjà configuré.");
    const expected = currentSetupCode();
    if (!safeEqual(normalizeCode(code), normalizeCode(expected))) return failure(403, 'Code de configuration incorrect.');
    const problem = passwordProblem(password);
    if (problem) return failure(400, problem);
    setupCode = null; // usage unique : une seconde demande simultanée échoue
    try {
      store.admin.set({ ...(await hashPassword(password)), createdAt: new Date().toISOString() });
    } catch (err) {
      setupCode = expected;
      throw err;
    }
    return { ok: true };
  }

  async function login(password) {
    if (!isConfigured()) return failure(409, "L'espace salon n'est pas encore configuré.");
    if (!(await verifyPassword(password, store.admin.get()))) return failure(401, 'Mot de passe incorrect.');
    return { ok: true };
  }

  async function changePassword(current, next) {
    // 403 et non 401 : la session est valide, c'est le mot de passe saisi qui ne l'est pas.
    if (!(await verifyPassword(current, store.admin.get()))) return failure(403, 'Mot de passe actuel incorrect.');
    const problem = passwordProblem(next);
    if (problem) return failure(400, problem);
    store.admin.set({ ...(await hashPassword(next)), createdAt: store.admin.get().createdAt, changedAt: new Date().toISOString() });
    return { ok: true };
  }

  function createSession() {
    const token = crypto.randomBytes(32).toString('base64url');
    const id = sha256(token).toString('hex');
    sessions.set(id, { expires: now() + SESSION_TTL_MS });
    return { token, id };
  }

  function readSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token || token.length > 128) return null;
    const id = sha256(token).toString('hex');
    const session = sessions.get(id);
    if (!session) return null;
    if (session.expires <= now()) {
      sessions.delete(id);
      return null;
    }
    return { id };
  }

  function cookie(token, secure) {
    const attributes = ['Path=/', 'HttpOnly', 'SameSite=Strict'];
    if (secure) attributes.push('Secure');
    attributes.push(token ? `Max-Age=${SESSION_TTL_MS / 1000}` : 'Max-Age=0');
    return `${COOKIE_NAME}=${token || ''}; ${attributes.join('; ')}`;
  }

  return {
    isConfigured,
    setupCode: currentSetupCode,
    setup,
    login,
    changePassword,
    createSession,
    readSession,
    destroySession: id => sessions.delete(id),
    destroyOtherSessions(keepId) {
      for (const id of [...sessions.keys()]) if (id !== keepId) sessions.delete(id);
    },
    hasSession: id => sessions.has(id),
    sessionCookie: (token, secure) => cookie(token, secure),
    clearedCookie: secure => cookie('', secure),
    sweep() {
      const t = now();
      for (const [id, session] of sessions) if (session.expires <= t) sessions.delete(id);
    },
  };
}

module.exports = { createAuth, hashPassword, verifyPassword, passwordProblem, generateSetupCode, COOKIE_NAME };
