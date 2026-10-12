'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
// Une fois connectée, la coiffeuse le reste sur cet appareil : la session vaut 400 jours (le plus
// long qu'un navigateur accepte de garder un cookie) et se prolonge d'elle-même à chaque visite.
const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;
// On ne réécrit pas la session à chaque clic : au plus une fois par jour.
const SESSION_RENEW_MS = 24 * 60 * 60 * 1000;
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

/** L'identifiant ne tient pas compte des majuscules ni des espaces autour. */
const normalizeUsername = username => String(username ?? '').normalize('NFKC').trim().toLowerCase();

/** Message d'erreur si l'identifiant ne convient pas, sinon null. */
function usernameProblem(username) {
  return /^[a-z0-9][a-z0-9._@-]{2,59}$/.test(normalizeUsername(username))
    ? null
    : 'Choisissez un identifiant de 3 caractères au moins (lettres sans accent, chiffres, point, tiret, ou une adresse e-mail).';
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

const failure = (status, error) => ({ ok: false, status, error });

/** Longueur minimale du code de configuration choisi en ligne (secret SETUP_CODE de Cloudflare). */
const MIN_SECRET_CODE = 8;

/**
 * Accès à l'espace salon.
 * - On se connecte avec un identifiant et un mot de passe, choisis à la première utilisation.
 * - Première utilisation : un code à usage unique autorise la création du compte (personne
 *   d'autre ne peut s'approprier l'espace). Sur l'ordinateur du salon, le serveur le tire au sort
 *   et l'affiche dans sa fenêtre. En ligne sur Cloudflare, c'est le secret SETUP_CODE (setupCode) ;
 *   le remplacer par un nouveau code permet de choisir un nouveau mot de passe (mot de passe oublié).
 * - Le mot de passe est haché avec scrypt ; seul le hachage est enregistré.
 * - Les sessions sont enregistrées sous le SHA-256 d'un jeton aléatoire : le jeton lui-même ne
 *   se trouve que dans le cookie du navigateur. Une session dure tant que l'appareil revient
 *   (elle se prolonge à chaque visite) ; se déconnecter ou changer de mot de passe y met fin.
 */
function createAuth({ store, now = Date.now, setupCode: secret }) {
  // Sans secret (ordinateur du salon), le code est tiré au sort. Un secret trop court ne sert pas.
  const fixedCode = secret === undefined ? null : normalizeCode(secret);
  const usableCode = fixedCode && fixedCode.length >= MIN_SECRET_CODE ? fixedCode : '';
  const codeKey = usableCode ? sha256(`code:${usableCode}`).toString('hex') : '';
  let setupCode = null;
  let settingUp = false;

  /** Configuré : un mot de passe existe, et le secret n'a pas été remplacé depuis qu'il a été choisi. */
  function isConfigured() {
    const admin = store.admin.get();
    return Boolean(admin) && (!codeKey || admin.codeKey === codeKey);
  }

  function currentSetupCode() {
    if (isConfigured()) return null;
    if (fixedCode !== null) return usableCode || null;
    if (!setupCode) setupCode = generateSetupCode();
    return setupCode;
  }

  async function setup(code, password, username) {
    if (isConfigured()) return failure(409, "L'espace salon est déjà configuré.");
    const expected = currentSetupCode();
    if (!expected) {
      return failure(503, `Ajoutez d'abord le secret SETUP_CODE (${MIN_SECRET_CODE} lettres ou chiffres au moins) dans les réglages du site sur Cloudflare.`);
    }
    if (!safeEqual(normalizeCode(code), normalizeCode(expected))) return failure(403, 'Code de configuration incorrect.');
    const problem = usernameProblem(username) || passwordProblem(password);
    if (problem) return failure(400, problem);
    if (settingUp) return failure(409, "L'espace salon est en cours de configuration."); // usage unique
    settingUp = true;
    try {
      store.admin.set({ username: normalizeUsername(username), ...(await hashPassword(password)), ...(codeKey && { codeKey }), createdAt: new Date().toISOString() });
    } finally {
      settingUp = false;
    }
    setupCode = null;
    // Nouveau mot de passe : les sessions ouvertes avec l'ancien (mot de passe oublié) ne valent plus rien.
    store.sessions.removeWhere(() => true);
    return { ok: true };
  }

  async function login(username, password) {
    if (!isConfigured()) return failure(409, "L'espace salon n'est pas encore configuré.");
    const record = store.admin.get();
    // Le mot de passe est toujours vérifié, même si l'identifiant est faux : la réponse ne dit
    // pas lequel des deux est en cause, ni par son texte ni par le temps qu'elle met.
    const passwordOk = await verifyPassword(password, record);
    // Un compte créé avant l'arrivée des identifiants n'en a pas : seul son mot de passe compte.
    const usernameOk = !record.username || safeEqual(normalizeUsername(username), record.username);
    if (!passwordOk || !usernameOk) return failure(401, record.username ? 'Identifiant ou mot de passe incorrect.' : 'Mot de passe incorrect.');
    return { ok: true };
  }

  async function changePassword(current, next) {
    // 403 et non 401 : la session est valide, c'est le mot de passe saisi qui ne l'est pas.
    if (!(await verifyPassword(current, store.admin.get()))) return failure(403, 'Mot de passe actuel incorrect.');
    const problem = passwordProblem(next);
    if (problem) return failure(400, problem);
    const { username, createdAt, codeKey: key } = store.admin.get();
    store.admin.set({ ...(username && { username }), ...(await hashPassword(next)), ...(key && { codeKey: key }), createdAt, changedAt: new Date().toISOString() });
    return { ok: true };
  }

  const forget = id => store.sessions.removeWhere(key => key === id) > 0;

  function createSession() {
    const token = crypto.randomBytes(32).toString('base64url');
    const id = sha256(token).toString('hex');
    store.sessions.set(id, { expires: now() + SESSION_TTL_MS });
    return { token, id };
  }

  function readSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token || token.length > 128) return null;
    const id = sha256(token).toString('hex');
    const session = store.sessions.get(id);
    if (!session) return null;
    if (session.expires <= now()) {
      forget(id);
      return null;
    }
    return { id, token };
  }

  /**
   * Prolonge une session en cours d'utilisation. Renvoie le cookie à renvoyer au navigateur (le même
   * jeton, pour 400 jours de plus), ou null si elle a déjà été prolongée dans la journée.
   */
  function renewSession(session, secure) {
    const saved = session && store.sessions.get(session.id);
    if (!saved || saved.expires - now() > SESSION_TTL_MS - SESSION_RENEW_MS) return null;
    store.sessions.set(session.id, { ...saved, expires: now() + SESSION_TTL_MS });
    return cookie(session.token, secure);
  }

  function cookie(token, secure) {
    const attributes = ['Path=/', 'HttpOnly', 'SameSite=Strict'];
    if (secure) attributes.push('Secure');
    attributes.push(token ? `Max-Age=${SESSION_TTL_MS / 1000}` : 'Max-Age=0');
    return `${COOKIE_NAME}=${token || ''}; ${attributes.join('; ')}`;
  }

  return {
    isConfigured,
    /** Le compte a-t-il un identifiant ? (Un compte ancien n'a qu'un mot de passe.) */
    hasUsername: () => Boolean(store.admin.get()?.username),
    setupCode: currentSetupCode,
    /** Où trouver le code de configuration : dans la fenêtre du serveur, ou dans les réglages de Cloudflare. */
    codeSource: fixedCode === null ? 'console' : 'secret',
    setup,
    login,
    changePassword,
    createSession,
    readSession,
    renewSession,
    destroySession: forget,
    destroyOtherSessions(keepId) {
      store.sessions.removeWhere(id => id !== keepId);
    },
    hasSession: id => Boolean(store.sessions.get(id)),
    sessionCookie: (token, secure) => cookie(token, secure),
    clearedCookie: secure => cookie('', secure),
    sweep() {
      const t = now();
      store.sessions.removeWhere((id, session) => session.expires <= t);
    },
  };
}

module.exports = { createAuth, hashPassword, verifyPassword, passwordProblem, usernameProblem, generateSetupCode, COOKIE_NAME };
