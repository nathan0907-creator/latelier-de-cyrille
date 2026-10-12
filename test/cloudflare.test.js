'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApp } = require('../src/app');
const { createAuth } = require('../src/auth');
const { createStore } = require('../src/store');
const { toFetchHandler } = require('../cloudflare/adapter');
const { sqlBackend, CHUNK } = require('../cloudflare/storage');
const { testConfig, testStore, clockAt, BROWSER, TUESDAY } = require('./helpers');

const password = () => crypto.randomBytes(12).toString('base64url');

/** Le site tel qu'il tourne sur Cloudflare (cloudflare/worker.js) : sans minuteur, derrière l'adaptateur. */
function cloudflareSite(t) {
  const config = testConfig({}, { TRUST_PROXY: '1' });
  const app = createApp({
    config, store: testStore(config), clock: clockAt(),
    setupCode: 'ESSAI-2026-SALON', timers: false, assetVersion: () => 'v1', serveStatic: async () => false,
  });
  t.after(() => app.close());
  const handle = toFetchHandler(app.handle);
  const request = (path, { method = 'GET', body, headers = {}, origin = 'https://salon.example', ip = '203.0.113.7', signal } = {}) => handle(new Request(`${origin}${path}`, {
    method,
    signal,
    headers: { 'User-Agent': BROWSER, 'CF-Connecting-IP': ip, ...(body && { 'Content-Type': 'application/json', Origin: origin }), ...headers },
    body: body && JSON.stringify(body),
  }));
  return { app, request };
}

/** Lit un flux en direct jusqu'à trouver le texte attendu. */
async function readUntil(reader, expected) {
  let text = '';
  while (!text.includes(expected)) {
    const { done, value } = await reader.read();
    if (done) break;
    text += Buffer.from(value).toString('utf8');
  }
  return text;
}

test('Cloudflare : les pages passent par l\'adaptateur, en HTTPS, avec les en-têtes du site', async t => {
  const site = cloudflareSite(t);

  const home = await site.request('/', { headers: { 'Accept-Encoding': 'br, gzip' } });
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(home.headers.get('strict-transport-security'), /max-age=31536000/);
  assert.match(home.headers.get('content-security-policy'), /upgrade-insecure-requests/);
  assert.equal(home.headers.get('content-encoding'), null, 'Cloudflare compresse lui-même');
  const html = await home.text();
  assert.match(html, /<!doctype html>/);
  assert.match(html, /\/css\/base\.css\?v=v1/, "l'empreinte calculée à la publication");

  const http = await site.request('/prestations?x=1', { origin: 'http://salon.example' });
  assert.equal(http.status, 308);
  assert.equal(http.headers.get('location'), 'https://salon.example/prestations?x=1');

  const head = await site.request('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  assert.equal((await site.request('/prestations/')).headers.get('location'), '/prestations');
  assert.equal((await site.request('/page-inconnue')).status, 404);
  assert.equal((await site.request('/', { method: 'POST' })).status, 405);
});

test('Cloudflare : réservation, direct, et adresse du visiteur donnée par Cloudflare', async t => {
  const site = cloudflareSite(t);

  const live = await site.request('/api/events');
  assert.equal(live.status, 200);
  assert.match(live.headers.get('content-type'), /text\/event-stream/);
  assert.equal(live.headers.get('connection'), null);
  const reader = live.body.getReader();
  assert.match(await readUntil(reader, 'retry'), /^retry: 3000/);
  assert.equal(site.app.events.count('public'), 1);

  const created = await site.request('/api/bookings', { method: 'POST', body: { serviceId: 'court', date: TUESDAY, time: '10:00', name: 'Léa Dupont', phone: '0612345678' } });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).booking.name, 'Léa Dupont');
  assert.match(await readUntil(reader, 'event: slots'), new RegExp(`data: \\{"date":"${TUESDAY}"\\}`));

  // La page se ferme : le flux est oublié, qu'elle cesse de lire ou que Cloudflare signale son départ.
  await reader.cancel();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(site.app.events.count('public'), 0);
  const leaving = new AbortController();
  await site.request('/api/events', { signal: leaving.signal });
  assert.equal(site.app.events.count('public'), 1);
  leaving.abort();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(site.app.events.count('public'), 0);

  // L'adresse vient de Cloudflare : un « X-Forwarded-For » inventé par le visiteur n'y change rien.
  const attempt = n => site.request('/api/bookings', { method: 'POST', body: { serviceId: 'court' }, headers: { 'X-Forwarded-For': `198.51.100.${n}` } });
  for (let n = 1; n < 8; n++) assert.equal((await attempt(n)).status, 400);
  assert.equal((await attempt(8)).status, 429, 'limite par adresse atteinte');
  const other = await site.request('/api/bookings', { method: 'POST', body: { serviceId: 'court' }, ip: '203.0.113.8' });
  assert.equal(other.status, 400, 'une autre adresse a encore droit à ses essais');
});

test('Cloudflare : le code de configuration est le secret SETUP_CODE ; un nouveau secret, un nouveau mot de passe', async () => {
  const store = testStore(testConfig());

  for (const secret of ['', 'COURT']) {
    const auth = createAuth({ store, setupCode: secret });
    assert.equal(auth.codeSource, 'secret');
    assert.equal(auth.setupCode(), null);
    const refused = await auth.setup(secret, password());
    assert.equal(refused.status, 503, 'secret absent ou trop court : pas de configuration');
    assert.match(refused.error, /SETUP_CODE/);
  }

  const first = password();
  let auth = createAuth({ store, setupCode: 'essai-2026-salon' });
  assert.equal((await auth.setup('MAUVAIS-CODE', first)).status, 403);
  assert.equal((await auth.setup('ESSAI 2026 SALON', first)).ok, true);
  assert.equal((await auth.setup('ESSAI 2026 SALON', first)).status, 409);
  const session = auth.createSession();
  const cookie = { headers: { cookie: `salon_session=${session.token}` } };

  // Le site redémarre (mise à jour, mise en veille) : la session tient toujours.
  auth = createAuth({ store, setupCode: 'essai-2026-salon' });
  assert.equal(auth.isConfigured(), true);
  assert.equal(auth.readSession(cookie).id, session.id);
  assert.equal(createAuth({ store, setupCode: '' }).isConfigured(), true, 'secret retiré : rien ne change');

  // Mot de passe oublié : un nouveau secret dans les réglages de Cloudflare.
  const second = password();
  auth = createAuth({ store, setupCode: 'nouveau-code-2027' });
  assert.equal(auth.isConfigured(), false);
  assert.equal((await auth.setup('essai-2026-salon', second)).status, 403, "l'ancien code ne sert plus");
  assert.equal((await auth.setup('nouveau-code-2027', second)).ok, true);
  assert.equal(auth.readSession(cookie), null, 'les appareils connectés avec l\'ancien mot de passe sont déconnectés');
  assert.equal((await auth.login(first)).status, 401);
  assert.equal((await auth.login(second)).ok, true);
});

test('Cloudflare : les données dans la base SQLite, en morceaux, accents et émojis compris', async t => {
  let DatabaseSync;
  // SQLite est encore marqué « expérimental » dans Node.js 22 : on tait cet avertissement.
  const { emitWarning } = process;
  process.emitWarning = (warning, ...rest) => (/SQLite/.test(String(warning)) ? undefined : emitWarning.call(process, warning, ...rest));
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return t.skip('SQLite absent de cette version de Node.js');
  } finally {
    process.emitWarning = emitWarning;
  }

  // Comme ctx.storage.sql de Cloudflare : la requête s'exécute aussitôt, les lignes se lisent ensuite.
  const db = new DatabaseSync(':memory:');
  const sql = {
    exec(query, ...params) {
      const result = db.prepare(query).all(...params);
      return { toArray: () => result };
    },
  };
  const rows = key => db.prepare('SELECT COUNT(*) AS n FROM donnees WHERE nom = ?').get(key).n;

  const backend = sqlBackend(sql);
  assert.equal(backend.read('essai', 'rien'), 'rien');
  const big = { text: 'Coupe été, à 9h 😀 '.repeat(Math.ceil(CHUNK / 10)) };
  backend.write('essai', big);
  assert.ok(rows('essai') > 1, 'trop gros pour une seule ligne');
  assert.deepEqual(backend.read('essai', null), big);
  backend.write('essai', { text: 'court' });
  assert.equal(rows('essai'), 1, 'les morceaux en trop sont effacés');
  assert.deepEqual(backend.read('essai', null), { text: 'court' });

  const store = createStore(sqlBackend(sql));
  store.bookings.add({ id: 'abc', name: 'Zoé Lefèvre', note: 'Frange 💇' });
  store.sessions.set('empreinte', { expires: 123 });
  const reopened = createStore(sqlBackend(sql));
  assert.equal(reopened.bookings.get('abc').note, 'Frange 💇');
  assert.deepEqual(reopened.sessions.get('empreinte'), { expires: 123 });
  assert.equal(reopened.sessions.get('toString'), null);
});
