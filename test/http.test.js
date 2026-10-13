'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startSite, TUESDAY } = require('./helpers');

const start = () => startSite();

const booking = (extra = {}) => ({ serviceId: 'court', date: TUESDAY, time: '10:00', name: 'Léa Dupont', phone: '0612345678', ...extra });
const sessionCookie = res => res.headers['set-cookie'][0].split(';')[0];
const username = 'cyrille';

test('pages : en-têtes de sécurité, 404, méthodes refusées', async t => {
  const site = await start();
  t.after(site.stop);

  for (const path of ['/', '/prestations', '/galerie', '/nous-trouver', '/reservation', '/mentions-legales', '/salon']) {
    const res = await site.request('GET', path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /<!doctype html>/);
  }

  const home = await site.request('GET', '/');
  const csp = home.headers['content-security-policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/, 'aucun script en ligne ni domaine tiers');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.equal(home.headers['x-frame-options'], 'DENY');
  assert.doesNotMatch(home.text, /<script(?![^>]*(\ssrc=|type="application\/(ld\+)?json"))[^>]*>/, 'pas de script exécutable en ligne');
  assert.doesNotMatch(home.text, /\sstyle="|\son[a-z]+="/, 'ni style ni gestionnaire en ligne');

  const salon = await site.request('GET', '/salon');
  assert.match(salon.headers['cache-control'], /no-store/);
  assert.match(salon.headers['x-robots-tag'], /noindex/);

  assert.equal((await site.request('GET', '/inconnue')).status, 404);
  assert.equal((await site.request('POST', '/')).status, 405);
  assert.equal((await site.request('GET', '/prestations/')).status, 308);
  assert.match((await site.request('GET', '/robots.txt')).text, /Disallow: \/salon/);
});

test('fichiers statiques : jamais hors du dossier public', async t => {
  const site = await start();
  t.after(site.stop);

  const css = await site.request('GET', '/css/base.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);
  assert.equal((await site.request('GET', '/css/base.css', { headers: { 'If-None-Match': css.headers.etag } })).status, 304);

  for (const path of ['/..%2fserver.js', '/%2e%2e/server.js', '/css/..%2f..%2fsalon.config.js', '/css/%2e%2e/%2e%2e/package.json', '/.env', '/js/../../data/compte.json']) {
    const res = await site.request('GET', path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.text, /require\(|"scripts"/, path);
  }
});

test('réservation : disponibilités, protection CSRF, conflit, données publiques', async t => {
  const site = await start();
  t.after(site.stop);

  const before = await site.request('GET', `/api/availability?service=court&date=${TUESDAY}`);
  assert.equal(before.status, 200);
  assert.equal(before.json.slots.find(s => s.time === '10:00').available, true);
  assert.equal((await site.request('GET', '/api/availability?service=court&date=hier')).status, 400);
  assert.equal((await site.request('GET', '/api/availability/month?service=court&month=2026-10')).json.days.length, 31);

  assert.equal((await site.request('POST', '/api/bookings', { body: booking(), sameOrigin: false })).status, 403, 'sans origine');
  assert.equal((await site.request('POST', '/api/bookings', { body: booking(), headers: { Origin: 'https://site-pirate.example' } })).status, 403, 'origine étrangère');
  assert.equal((await site.request('POST', '/api/bookings', { body: booking({ website: 'http://spam' }) })).status, 400, 'champ piège');
  assert.equal((await site.request('POST', '/api/bookings', { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal(site.store.bookings.all().length, 0);

  const created = await site.request('POST', '/api/bookings', { body: booking() });
  assert.equal(created.status, 201);
  assert.equal(created.json.booking.time, '10:00');
  assert.ok(!('phone' in created.json.booking) && !('id' in created.json.booking));

  const after = await site.request('GET', `/api/availability?service=court&date=${TUESDAY}`);
  assert.equal(after.json.slots.find(s => s.time === '10:00').available, false);
  assert.ok(!after.text.includes('Dupont') && !after.text.includes('06 12'), 'aucune donnée personnelle côté public');

  const conflict = await site.request('POST', '/api/bookings', { body: booking({ name: 'Marc Petit', phone: '0698765432' }) });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.code, 'slot_taken');

  const next = await site.request('GET', '/api/next-slot');
  assert.equal(next.json.slot.label, 'demain à 9h');
});

test('espace salon : fermé sans session, configuration, connexion, actions, déconnexion', async t => {
  const site = await start();
  t.after(site.stop);
  const password = crypto.randomBytes(12).toString('base64url');
  await site.request('POST', '/api/bookings', { body: booking() });

  for (const [method, path] of [['GET', '/api/salon/data'], ['GET', '/api/salon/events'], ['POST', '/api/salon/bookings'], ['DELETE', '/api/salon/bookings/abcdef123'], ['POST', '/api/salon/closures'], ['POST', '/api/salon/password']]) {
    assert.equal((await site.request(method, path, { body: method === 'GET' ? undefined : {} })).status, 401, `${method} ${path}`);
  }
  assert.deepEqual((await site.request('GET', '/api/salon/session')).json, { configured: false, authenticated: false, username: false, codeSource: 'console' });

  assert.equal((await site.request('POST', '/api/salon/login', { body: { username, password } })).status, 409, 'pas encore configuré');
  assert.equal((await site.request('POST', '/api/salon/setup', { body: { code: 'AAAA-AAAA', username, password } })).status, 403);
  assert.equal((await site.request('POST', '/api/salon/setup', { body: { code: site.app.auth.setupCode(), password } })).status, 400, 'identifiant obligatoire');
  const setup = await site.request('POST', '/api/salon/setup', { body: { code: site.app.auth.setupCode(), username, password } });
  assert.equal(setup.status, 200);
  const cookieHeader = setup.headers['set-cookie'][0];
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  const cookie = sessionCookie(setup);
  const authed = { headers: { Cookie: cookie } };

  assert.deepEqual((await site.request('GET', '/api/salon/session', authed)).json, { configured: true, authenticated: true, username: true });
  const data = await site.request('GET', '/api/salon/data', authed);
  assert.equal(data.json.bookings.length, 1);
  assert.equal(data.json.bookings[0].phone, '06 12 34 56 78');
  const { id } = data.json.bookings[0];

  assert.equal((await site.request('PATCH', `/api/salon/bookings/${id}`, { ...authed, body: { status: 'confirmed' }, sameOrigin: false })).status, 403, 'CSRF même connecté');
  assert.equal((await site.request('PATCH', `/api/salon/bookings/${id}`, { ...authed, body: { status: 'confirmed' } })).json.booking.status, 'confirmed');

  const manual = await site.request('POST', '/api/salon/bookings', { ...authed, body: { serviceId: 'moyen', date: TUESDAY, time: '14:00', name: 'Client du salon' } });
  assert.equal(manual.status, 201);
  assert.equal(manual.json.booking.source, 'salon');

  assert.equal((await site.request('POST', '/api/salon/closures', { ...authed, body: { date: '2026-10-20', reason: 'Congés' } })).status, 201);
  assert.equal((await site.request('GET', '/api/availability?service=court&date=2026-10-20')).json.closed, true);
  assert.equal((await site.request('DELETE', '/api/salon/closures/2026-10-20', authed)).status, 200);
  assert.equal((await site.request('GET', '/api/availability?service=court&date=2026-10-20')).json.closed, false);

  // Des congés saisis en une fois : annoncés à la une, puis rouverts d'un coup.
  const holidays = await site.request('POST', '/api/salon/closures', { ...authed, body: { date: '2026-10-20', until: '2026-10-24', reason: 'Congés' } });
  assert.equal(holidays.status, 201);
  assert.equal(holidays.json.closures.length, 5);
  assert.match((await site.request('GET', '/')).text, /Fermé du mardi 20 au samedi 24 octobre : congés/);
  assert.equal((await site.request('POST', '/api/salon/closures', { ...authed, body: { date: '2026-10-20', until: '2026-10-19' } })).status, 400);
  assert.equal((await site.request('POST', '/api/salon/closures', { ...authed, body: { date: '2026-10-20', until: '2027-01-20' } })).status, 400);
  assert.equal((await site.request('DELETE', '/api/salon/closures/2026-10-20?until=2026-10-24', authed)).status, 200);
  assert.equal((await site.request('GET', '/api/availability?service=court&date=2026-10-22')).json.closed, false);
  assert.doesNotMatch((await site.request('GET', '/')).text, /Fermé du mardi 20/);

  // Un jour particulier : ouvert seulement de 14h à 16h. Pas annoncé comme une fermeture.
  const special = await site.request('POST', '/api/salon/closures', { ...authed, body: { date: '2026-10-20', reason: 'Formation le matin', hours: [{ start: '14:00', end: '16:00' }] } });
  assert.equal(special.status, 201);
  assert.deepEqual(special.json.closure.hours, [{ start: 840, end: 960 }]);
  const shortened = (await site.request('GET', '/api/availability?service=court&date=2026-10-20')).json;
  assert.equal(shortened.closed, false);
  assert.deepEqual(shortened.slots.map(s => s.time), ['14:00', '14:30', '15:00', '15:30']);
  assert.doesNotMatch((await site.request('GET', '/')).text, /Formation le matin/);
  assert.equal((await site.request('POST', '/api/salon/closures', { ...authed, body: { date: '2026-10-20', until: '2026-10-21', hours: [{ start: '14:00', end: '16:00' }] } })).status, 400);
  assert.equal((await site.request('POST', '/api/salon/closures', { ...authed, body: { date: '2026-10-20', hours: [{ start: '16:00', end: '14:00' }] } })).status, 400);
  assert.equal((await site.request('DELETE', '/api/salon/closures/2026-10-20', authed)).status, 200);
  assert.equal((await site.request('GET', '/api/availability?service=court&date=2026-10-20')).json.slots.length, 18);

  assert.equal((await site.request('DELETE', `/api/salon/bookings/${id}`, authed)).status, 200);
  assert.equal((await site.request('DELETE', `/api/salon/bookings/${id}`, authed)).status, 404);

  assert.equal((await site.request('POST', '/api/salon/logout', authed)).status, 200);
  assert.equal((await site.request('GET', '/api/salon/data', authed)).status, 401, 'le jeton ne vaut plus rien après déconnexion');

  assert.equal((await site.request('POST', '/api/salon/login', { body: { username: 'quelqu-un-d-autre', password } })).status, 401);
  const login = await site.request('POST', '/api/salon/login', { body: { username, password } });
  assert.equal(login.status, 200);
  assert.equal((await site.request('GET', '/api/salon/data', { headers: { Cookie: sessionCookie(login) } })).status, 200);
});

test('connexion : blocage après plusieurs échecs', async t => {
  const site = await start();
  t.after(site.stop);
  const password = crypto.randomBytes(12).toString('base64url');
  await site.request('POST', '/api/salon/setup', { body: { code: site.app.auth.setupCode(), username, password } });

  const statuses = [];
  for (let i = 0; i < 6; i++) {
    statuses.push((await site.request('POST', '/api/salon/login', { body: { username, password: `faux-mot-de-passe-${i}` } })).status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  const blocked = await site.request('POST', '/api/salon/login', { body: { username, password } });
  assert.equal(blocked.status, 429, 'même le bon mot de passe attend la fin du blocage');
  assert.ok(Number(blocked.headers['retry-after']) > 0);
});
