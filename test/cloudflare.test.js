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
    const refused = await auth.setup(secret, password(), 'cyrille');
    assert.equal(refused.status, 503, 'secret absent ou trop court : pas de configuration');
    assert.match(refused.error, /SETUP_CODE/);
  }

  const first = password();
  let auth = createAuth({ store, setupCode: 'essai-2026-salon' });
  assert.equal((await auth.setup('MAUVAIS-CODE', first, 'cyrille')).status, 403);
  assert.equal((await auth.setup('ESSAI 2026 SALON', first, 'cyrille')).ok, true);
  assert.equal((await auth.setup('ESSAI 2026 SALON', first, 'cyrille')).status, 409);
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
  assert.equal((await auth.setup('essai-2026-salon', second, 'cyrille')).status, 403, "l'ancien code ne sert plus");
  assert.equal((await auth.setup('nouveau-code-2027', second, 'cyrille.salon')).ok, true);
  assert.equal(auth.readSession(cookie), null, 'les appareils connectés avec l\'ancien mot de passe sont déconnectés');
  assert.equal((await auth.login('cyrille.salon', first)).status, 401);
  assert.equal((await auth.login('cyrille', second)).status, 401, "l'identifiant est celui choisi avec le nouveau code");
  assert.equal((await auth.login('cyrille.salon', second)).ok, true);
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

test('Cloudflare : tarifs, horaires et photos réglés depuis l\'espace salon, rangés dans la base', async t => {
  let DatabaseSync;
  const { emitWarning } = process;
  process.emitWarning = (warning, ...rest) => (/SQLite/.test(String(warning)) ? undefined : emitWarning.call(process, warning, ...rest));
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return t.skip('SQLite absent de cette version de Node.js');
  } finally {
    process.emitWarning = emitWarning;
  }

  // Comme ctx.storage.sql de Cloudflare : il ne prend et ne rend les octets que sous forme d'ArrayBuffer.
  const db = new DatabaseSync(':memory:');
  const sql = {
    exec(query, ...params) {
      for (const param of params) assert.ok(param === null || ['string', 'number'].includes(typeof param) || param instanceof ArrayBuffer, 'valeur acceptée par Cloudflare');
      const rows = db.prepare(query).all(...params.map(param => (param instanceof ArrayBuffer ? new Uint8Array(param) : param)));
      return { toArray: () => rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value]))) };
    },
  };

  // En ligne, la configuration arrive toute prête d'un fichier JSON (cloudflare/build.js) : plus de
  // fonctions ni d'objets partagés, et aucun dossier de l'ordinateur.
  const prepared = JSON.parse(JSON.stringify({ ...testConfig({}, { TRUST_PROXY: '1' }), dataDir: '', publicDir: '' }));
  const open = () => {
    const app = createApp({
      config: prepared, store: createStore(sqlBackend(sql)), clock: clockAt(),
      setupCode: 'ESSAI-2026-SALON', timers: false, assetVersion: () => 'v1', serveStatic: async () => false,
    });
    t.after(() => app.close());
    return { app, handle: toFetchHandler(app.handle) };
  };
  let site = open();
  const origin = 'https://salon.example';
  let cookie = '';
  const request = (path, { method = 'GET', body } = {}) => site.handle(new Request(`${origin}${path}`, {
    method,
    headers: { 'User-Agent': BROWSER, 'CF-Connecting-IP': '203.0.113.7', ...(cookie && { Cookie: cookie }), ...(body && { 'Content-Type': 'application/json', Origin: origin }) },
    body: body && JSON.stringify(body),
  }));

  // Le compte : un identifiant et un mot de passe, créés avec le secret SETUP_CODE.
  const secret = password();
  assert.equal((await (await request('/api/salon/session')).json()).username, false);
  const setup = await request('/api/salon/setup', { method: 'POST', body: { code: 'essai-2026-salon', username: 'Cyrille', password: secret } });
  assert.equal(setup.status, 200);
  cookie = setup.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await request('/api/salon/session')).json()).username, true);

  // La carte et les horaires.
  const before = await (await request('/api/salon/settings')).json();
  assert.deepEqual(before.categories[0].items.map(item => item.id), ['court', 'moyen', 'long']);
  const saved = await request('/api/salon/settings', { method: 'PUT', body: {
    services: { categories: [{ name: 'Coupes', items: [{ id: 'court', name: 'Coupe d\'été', duration: 60, price: 26, featured: true }, { name: 'Brushing', duration: 30, prices: [18, 22, 28] }] }] },
    hours: { ...before.hours, 1: [['10:00', '16:00']] },
  } });
  assert.equal(saved.status, 200);
  const after = await saved.json();
  assert.deepEqual(after.categories[0].items.map(item => [item.id, item.featured]), [['court', true], ['brushing', false]]);
  assert.deepEqual(after.hours[1], [['10:00', '16:00']]);
  assert.match(await (await request('/prestations')).text(), /Coupe d&#39;été[\s\S]*26 €/);
  assert.match(await (await request('/')).text(), /Coupe d&#39;été/, 'la prestation mise en avant est à la une');

  // Une photo : envoyée, rangée dans la base, servie avec le bon type et gardée un an par le navigateur.
  const jpeg = (width, height) => Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    crypto.randomBytes(3000), Buffer.from([0xff, 0xd9]),
  ]);
  const main = jpeg(1200, 1600);
  const uploaded = await request('/api/salon/photos', { method: 'POST', body: { files: [{ data: main.toString('base64') }, { data: jpeg(480, 640).toString('base64') }] } });
  assert.equal(uploaded.status, 201);
  const { photo } = await uploaded.json();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos').get().n, 2);

  const served = await request(photo.src);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/jpeg');
  assert.equal(served.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(main), "les octets rendus sont ceux qui ont été envoyés");
  assert.equal((await request('/media/photo-inconnue.jpg')).status, 404);
  assert.equal((await request('/media/donnees')).status, 404);

  const gallery = await request('/api/salon/settings', { method: 'PUT', body: { photos: { gallery: [{ src: photo.src, alt: 'Balayage miel' }], hero: photo.src } } });
  assert.equal(gallery.status, 200);
  const home = await (await request('/')).text();
  assert.match(home, new RegExp(`srcset="${photo.src.replace('.jpg', '-480.jpg')} 480w, ${photo.src} 1200w"`));
  assert.match(home, /alt="Balayage miel"/);

  // Le site se rendort puis se réveille : tout est encore là, lu dans la base.
  site = open();
  assert.deepEqual(site.app.config.services.map(service => service.name), ["Coupe d'été", 'Brushing']);
  assert.equal(site.app.config.photos.hero.src, photo.src);
  assert.equal((await request(photo.src)).status, 200);
  assert.equal((await request('/api/salon/settings')).status, 200, 'la session tient toujours');

  // Une autre photo remplace la première : ses fichiers quittent la base.
  const other = await (await request('/api/salon/photos', { method: 'POST', body: { files: [{ data: jpeg(1000, 1000).toString('base64') }] } })).json();
  assert.equal((await request('/api/salon/settings', { method: 'PUT', body: { photos: { gallery: [{ src: other.photo.src, alt: 'Carré plongeant' }] } } })).status, 200);
  assert.deepEqual(db.prepare('SELECT nom FROM photos').all().map(row => `/media/${row.nom}`), [other.photo.src]);
  assert.equal((await request(photo.src)).status, 404);
});
