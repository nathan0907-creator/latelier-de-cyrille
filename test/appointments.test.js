'use strict';

// Réservation au plus tard la veille, page « Votre rendez-vous », annulation par le client,
// notifications quand le salon confirme, déplace ou annule.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { createApp } = require('../src/app');
const { testConfig, testStore, startSite, clockAt, MONDAY, TUESDAY } = require('./helpers');

const booking = (extra = {}) => ({ serviceId: 'court', date: TUESDAY, time: '10:00', name: 'Léa Dupont', phone: '0612345678', ...extra });

/** Un site dont les notifications sont notées au lieu de partir sur Internet, coiffeuse connectée. */
async function salon({ overrides = {} } = {}) {
  const config = testConfig(overrides);
  const store = testStore(config);
  const sent = [];
  const app = createApp({
    config, store, clock: clockAt(),
    sendPush: async (subscription, message) => {
      sent.push({ endpoint: subscription.endpoint, ...message });
      return { ok: true, status: 201, gone: false };
    },
  });
  const server = http.createServer(app.handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, target, { body, cookie } = {}) => {
    const res = await fetch(`${origin}${target}`, {
      method, redirect: 'manual',
      headers: { ...(body && { 'Content-Type': 'application/json', Origin: origin }), ...(method !== 'GET' && { Origin: origin }), ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* pas du JSON */ }
    return { status: res.status, headers: res.headers, text, json };
  };
  const password = crypto.randomBytes(12).toString('base64url');
  const setup = await request('POST', '/api/salon/setup', { body: { code: app.auth.setupCode(), username: 'cyrille', password } });
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const call = (method, target, body) => request(method, target, { body, cookie });
  const stop = () => new Promise(resolve => { app.close(); server.close(resolve); });
  /** Les notifications partent sans faire attendre la réponse : on leur laisse un instant. */
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  return { app, store, request, call, stop, sent, settle, origin };
}

const subscription = name => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'), auth: Buffer.alloc(16, 9).toString('base64url') },
});

test('la veille : en ligne, aucun rendez-vous pour le jour même', async t => {
  const open = await startSite();
  t.after(open.stop);
  assert.equal((await open.request('GET', `/api/availability?service=court&date=${TUESDAY}`)).json.closed, false);

  // Horloge des tests : lundi 12 octobre, 10h. Le salon de test est fermé le lundi : on avance au mardi.
  const config = testConfig({ booking: { slotStep: 30, dayBefore: true } });
  const app = createApp({ config, store: testStore(config), clock: clockAt(TUESDAY, 600) });
  t.after(() => app.close());
  const server = http.createServer(app.handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = async target => (await fetch(`${origin}${target}`)).json();
  const post = async (target, body) => fetch(`${origin}${target}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

  // Mardi, 10h : aujourd'hui n'est plus réservable (alors qu'il reste de la place), demain l'est.
  assert.deepEqual(await get(`/api/availability?service=court&date=${TUESDAY}`), { date: TUESDAY, closed: true, slots: [] });
  const tomorrow = await get('/api/availability?service=court&date=2026-10-14');
  assert.equal(tomorrow.closed, false);
  assert.equal(tomorrow.slots[0].available, true, 'dès 9h demain : la veille suffit, même le soir');
  const month = (await get('/api/availability/month?service=court&month=2026-10')).days;
  assert.equal(month.find(day => day.date === TUESDAY).state, 'out');
  assert.equal(month.find(day => day.date === '2026-10-14').state, 'open');
  assert.equal((await get('/api/next-slot')).slot.label, 'demain à 9h');

  assert.equal((await post('/api/bookings', booking({ date: TUESDAY, time: '15:00' }))).status, 409, 'refusé aussi côté serveur');
  assert.equal((await post('/api/bookings', booking({ date: '2026-10-14', time: '09:00' }))).status, 201);

  const page = await (await fetch(`${origin}/reservation`)).text();
  assert.match(page, /En ligne, on réserve au plus tard la veille\./);
  assert.match(page, /"firstDate":"2026-10-14"/);
  assert.match(await (await fetch(`${origin}/conditions`)).text(), /on réserve au plus tard la veille/);
});

test('votre rendez-vous : une page personnelle, ouverte par la référence reçue à la réservation', async t => {
  const site = await salon();
  t.after(site.stop);
  const created = await site.request('POST', '/api/bookings', { body: booking() });
  const { ref } = created.json.reminder;
  assert.equal(created.json.booking.status, 'pending');

  const page = await site.request('GET', `/rendez-vous?r=${encodeURIComponent(ref)}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('x-robots-tag'), /noindex/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer', 'le lien personnel ne fuit pas vers les autres sites');
  const text = page.text.replace(/&#39;/g, "'");
  assert.match(text, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(text, /En attente de confirmation par le salon/);
  assert.match(text, /mardi 13 octobre/);
  assert.match(text, /10h – 10h30/);
  assert.match(text, /Léa Dupont/);
  assert.match(text, /data-cancel-ask/);
  assert.doesNotMatch(text, /06 12 34 56 78|0612345678/, 'pas de téléphone sur la page');

  // Une référence fausse, tronquée ou absente : rien n'est montré.
  const [id, signature] = ref.split('.');
  for (const bad of ['', '?r=', `?r=${id}`, `?r=${id}.${signature.slice(0, -2)}xx`, '?r=n-importe.quoi']) {
    const res = await site.request('GET', `/rendez-vous${bad}`);
    assert.equal(res.status, 404, bad);
    assert.match(res.text, /Rendez-vous <em>introuvable<\/em>/);
    assert.doesNotMatch(res.text, /Léa Dupont/);
  }

  // Le salon confirme : la page le dit.
  const [{ id: bookingId }] = (await site.call('GET', '/api/salon/data')).json.bookings;
  await site.call('PATCH', `/api/salon/bookings/${bookingId}`, { status: 'confirmed' });
  assert.match((await site.request('GET', `/rendez-vous?r=${ref}`)).text, /Confirmé par le salon/);
});

test('annulation par le client : le créneau se libère, le salon est prévenu en direct', async t => {
  const site = await salon();
  t.after(site.stop);
  const { ref } = (await site.request('POST', '/api/bookings', { body: booking() })).json.reminder;
  const slotFree = async () => (await site.request('GET', `/api/availability?service=court&date=${TUESDAY}`)).json.slots.find(slot => slot.time === '10:00').available;
  assert.equal(await slotFree(), false);
  await site.request('POST', '/api/reminders', { body: { ref, subscription: subscription('lea') } });
  assert.equal(site.store.reminders.all().length, 1);

  assert.equal((await site.request('POST', '/api/bookings/cancel', { body: { ref: 'faux.faux' } })).status, 404);
  assert.equal((await site.request('POST', '/api/bookings/cancel', { body: {} })).status, 404);
  const cross = await fetch(`${site.origin}/api/bookings/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://ailleurs.example' }, body: JSON.stringify({ ref }) });
  assert.equal(cross.status, 403, "refusé depuis un autre site");

  const cancelled = await site.request('POST', '/api/bookings/cancel', { body: { ref } });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.booking.status, 'cancelled');
  assert.equal(await slotFree(), true, 'le créneau est de nouveau proposé');
  assert.equal(site.store.reminders.all().length, 0, 'plus de rappel pour un rendez-vous annulé');
  assert.equal(site.sent.length, 0, "le client n'est pas prévenu de sa propre annulation");

  const [saved] = (await site.call('GET', '/api/salon/data')).json.bookings;
  assert.deepEqual([saved.status, saved.cancelledBy], ['cancelled', 'client'], "l'espace salon sait qui a annulé");
  assert.equal((await site.request('POST', '/api/bookings/cancel', { body: { ref } })).status, 409, 'déjà annulé');

  const page = (await site.request('GET', `/rendez-vous?r=${ref}`)).text;
  assert.match(page, /Rendez-vous annulé/);
  assert.doesNotMatch(page, /data-cancel-ask/);

  // La coiffeuse le rétablit (le client a rappelé) : il n'est plus « annulé par le client ».
  await site.call('PATCH', `/api/salon/bookings/${saved.id}`, { status: 'confirmed' });
  assert.equal((await site.call('GET', '/api/salon/data')).json.bookings[0].cancelledBy, '');
});

test('annulation par le client : impossible une fois le rendez-vous passé', async t => {
  const config = testConfig();
  const store = testStore(config);
  const now = { date: MONDAY, minutes: 600 };
  const app = createApp({ config, store, clock: () => ({ ...now }) });
  t.after(() => app.close());
  const server = http.createServer(app.handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (target, body) => {
    const res = await fetch(`${origin}${target}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  const { ref } = (await post('/api/bookings', booking())).json.reminder;

  // Mardi, 9h59 : encore possible. Mardi, 10h : le rendez-vous a commencé.
  Object.assign(now, { date: TUESDAY, minutes: 600 });
  assert.equal((await post('/api/bookings/cancel', { ref })).status, 409);
  const page = await (await fetch(`${origin}/rendez-vous?r=${ref}`)).text();
  assert.match(page, /Rendez-vous passé/);
  assert.doesNotMatch(page, /data-cancel-ask/);
  now.minutes = 599;
  assert.equal((await post('/api/bookings/cancel', { ref })).status, 200);
});

test('notifications : le client est prévenu quand le salon confirme, déplace ou annule', async t => {
  const site = await salon();
  t.after(site.stop);
  const { ref } = (await site.request('POST', '/api/bookings', { body: booking() })).json.reminder;
  const other = (await site.request('POST', '/api/bookings', { body: booking({ time: '15:00', phone: '0698765432', name: 'Camille Martin' }) })).json.reminder;
  // Léa a activé les notifications sur deux appareils, Camille sur aucun.
  await site.request('POST', '/api/reminders', { body: { ref, subscription: subscription('telephone') } });
  await site.request('POST', '/api/reminders', { body: { ref, subscription: subscription('ordinateur') } });
  const [lea, camille] = (await site.call('GET', '/api/salon/data')).json.bookings;

  // Le salon valide le rendez-vous de Léa.
  assert.equal((await site.call('PATCH', `/api/salon/bookings/${lea.id}`, { status: 'confirmed' })).status, 200);
  await site.settle();
  assert.equal(site.sent.length, 2, 'une notification par appareil');
  assert.deepEqual([...new Set(site.sent.map(message => message.title))], ['Rendez-vous confirmé']);
  assert.equal(site.sent[0].body, 'Mardi 13 octobre à 10h · Court · Salon de test');
  assert.equal(site.sent[0].url, `rendez-vous?r=${ref}`, 'un appui ouvre sa page personnelle');

  // Confirmer une seconde fois ne redit rien ; confirmer Camille, qui n'a rien activé, non plus.
  await site.call('PATCH', `/api/salon/bookings/${lea.id}`, { status: 'confirmed' });
  await site.call('PATCH', `/api/salon/bookings/${camille.id}`, { status: 'confirmed' });
  await site.settle();
  assert.equal(site.sent.length, 2);
  assert.ok(other.ref);

  // Le salon déplace le rendez-vous.
  site.sent.length = 0;
  await site.call('PATCH', `/api/salon/bookings/${lea.id}`, { date: '2026-10-15', time: '11:00' });
  await site.settle();
  assert.deepEqual(site.sent.map(message => message.title), ['Rendez-vous déplacé', 'Rendez-vous déplacé']);
  assert.match(site.sent[0].body, /^Nouveau rendez-vous : jeudi 15 octobre à 11h · Court/);

  // Le salon annule : le client l'apprend, puis ses appareils sont oubliés.
  site.sent.length = 0;
  await site.call('PATCH', `/api/salon/bookings/${lea.id}`, { status: 'cancelled' });
  await site.settle();
  assert.deepEqual(site.sent.map(message => message.title), ['Rendez-vous annulé', 'Rendez-vous annulé']);
  assert.match(site.sent[0].body, /^Le salon a dû annuler votre rendez-vous du jeudi 15 octobre à 11h\. Pour en reprendre un : 01 99 00 00 00$/);
  assert.equal((await site.call('GET', '/api/salon/data')).json.bookings[0].cancelledBy, 'salon');
  await site.app.reminders.tick();
  assert.equal(site.store.reminders.all().length, 0);
});
