'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAuth, hashPassword, verifyPassword, passwordProblem, COOKIE_NAME } = require('../src/auth');
const { createLimiter } = require('../src/ratelimit');
const { testConfig, testStore } = require('./helpers');

const randomPassword = () => crypto.randomBytes(12).toString('base64url');
const requestWith = token => ({ headers: { cookie: `autre=1; ${COOKIE_NAME}=${token}` } });

test('le mot de passe est haché (scrypt, sel aléatoire) et jamais stocké en clair', async () => {
  const password = randomPassword();
  const a = await hashPassword(password);
  const b = await hashPassword(password);
  assert.equal(a.algo, 'scrypt');
  assert.notEqual(a.hash, b.hash, 'deux hachages du même mot de passe diffèrent');
  assert.ok(!JSON.stringify(a).includes(password));
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword(`${password}x`, a), false);
  assert.equal(await verifyPassword(undefined, a), false);
  assert.equal(await verifyPassword(password, null), false);
});

test('les mots de passe faibles sont refusés', () => {
  assert.ok(passwordProblem('court'));
  assert.ok(passwordProblem('aaaaaaaaaaaa'));
  assert.ok(passwordProblem('1234567890'));
  assert.ok(passwordProblem('MotDePasse'));
  assert.equal(passwordProblem(randomPassword()), null);
});

test("première utilisation : le code de la console est exigé et ne sert qu'une fois", async () => {
  const store = testStore(testConfig());
  const auth = createAuth({ store });
  const password = randomPassword();
  assert.equal(auth.isConfigured(), false);
  const code = auth.setupCode();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  assert.equal((await auth.setup('AAAA-AAAA', password)).status, 403);
  assert.equal((await auth.setup(code, 'court')).status, 400);
  assert.equal(auth.isConfigured(), false);

  assert.equal((await auth.setup(code.toLowerCase().replace('-', ' '), password)).ok, true, 'casse et séparateur tolérés');
  assert.equal(auth.isConfigured(), true);
  assert.equal(auth.setupCode(), null);
  assert.equal((await auth.setup(code, password)).status, 409);
  assert.ok(!JSON.stringify(store.admin.get()).includes(password));

  assert.equal((await auth.login(password)).ok, true);
  assert.equal((await auth.login('mauvais-mot-de-passe')).status, 401);
});

test('sessions : jeton aléatoire, expiration, déconnexion', async () => {
  let time = 1_000_000;
  const auth = createAuth({ store: testStore(testConfig()), now: () => time });
  const session = auth.createSession();
  assert.ok(session.token.length >= 40);
  assert.equal(auth.readSession(requestWith(session.token)).id, session.id);
  assert.equal(auth.readSession(requestWith('jeton-invente')), null);
  assert.equal(auth.readSession({ headers: {} }), null);

  const cookie = auth.sessionCookie(session.token, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(auth.sessionCookie(session.token, false), /Secure/);

  const other = auth.createSession();
  auth.destroyOtherSessions(session.id);
  assert.equal(auth.readSession(requestWith(other.token)), null);
  assert.ok(auth.readSession(requestWith(session.token)));

  time += 8 * 24 * 3600 * 1000;
  assert.equal(auth.readSession(requestWith(session.token)), null, 'session expirée après 7 jours');
});

test('changer de mot de passe exige le mot de passe actuel', async () => {
  const auth = createAuth({ store: testStore(testConfig()) });
  const first = randomPassword();
  const second = randomPassword();
  await auth.setup(auth.setupCode(), first);
  assert.equal((await auth.changePassword('faux', second)).status, 403);
  assert.equal((await auth.changePassword(first, 'court')).status, 400);
  assert.equal((await auth.changePassword(first, second)).ok, true);
  assert.equal((await auth.login(first)).status, 401);
  assert.equal((await auth.login(second)).ok, true);
});

test('limiteur : bloque après le nombre maximal puis se libère', () => {
  let time = 0;
  const limiter = createLimiter({ max: 3, windowMs: 1000, now: () => time });
  for (let i = 0; i < 3; i++) assert.equal(limiter.take('ip').ok, true);
  const blocked = limiter.take('ip');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfter, 1);
  assert.equal(limiter.take('autre').ok, true, 'les autres clés ne sont pas touchées');
  time = 1001;
  assert.equal(limiter.take('ip').ok, true);
  limiter.reset('ip');
  assert.equal(limiter.check('ip').ok, true);
});
