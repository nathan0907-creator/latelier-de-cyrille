'use strict';

// Fichier clients : une note et un « ne plus reprendre » par personne, rangés par téléphone ou par nom.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { clientKey, normalizeName } = require('../src/clients');
const { startSite, TUESDAY } = require('./helpers');

test('fichier clients : une personne se reconnaît à son téléphone, sinon à son nom', () => {
  assert.equal(clientKey({ name: 'Léa Dupont', phone: '06 12 34 56 78' }), 'tel:0612345678');
  assert.equal(clientKey({ name: '  Léa  DUPONT-Martin ', phone: '' }), 'nom:lea dupont martin');
  assert.equal(normalizeName('Éloïse O\'Brien'), 'eloise o brien');
});

test('fichier clients : note et « ne plus reprendre » enregistrés, réservés à la coiffeuse', async t => {
  const site = await startSite();
  t.after(site.stop);
  const booked = await site.request('POST', '/api/bookings', { body: { serviceId: 'court', date: TUESDAY, time: '10:00', name: 'Léa Dupont', phone: '0612345678' } });
  assert.equal(booked.status, 201);
  const key = 'tel:0612345678';

  // Sans être connecté : rien.
  assert.equal((await site.request('PUT', '/api/salon/clients', { body: { key, note: 'x', blocked: false } })).status, 401);

  const password = crypto.randomBytes(12).toString('base64url');
  const setup = await site.request('POST', '/api/salon/setup', { body: { code: site.app.auth.setupCode(), username: 'cyrille', password } });
  const call = (method, target, body) => site.request(method, target, { headers: { Cookie: setup.headers['set-cookie'][0].split(';')[0] }, ...(body && { body }) });
  assert.deepEqual((await call('GET', '/api/salon/data')).json.clients, {});

  const saved = await call('PUT', '/api/salon/clients', { key, note: '  Couleur 6.3 + 20 vol\r\nPeau sensible\u0007  ', blocked: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.clients[key].note, 'Couleur 6.3 + 20 vol\nPeau sensible');
  assert.equal(saved.json.clients[key].blocked, true);
  assert.equal((await call('GET', '/api/salon/data')).json.clients[key].blocked, true);

  // Une fiche inconnue, une note trop longue : refus.
  assert.equal((await call('PUT', '/api/salon/clients', { key: 'tel:0700000000', note: 'x', blocked: false })).status, 404);
  assert.equal((await call('PUT', '/api/salon/clients', { key: '__proto__', note: 'x', blocked: false })).status, 404);
  assert.equal((await call('PUT', '/api/salon/clients', { key, note: 'x'.repeat(1001), blocked: false })).status, 400);
  assert.equal((await call('PUT', '/api/salon/clients', { key, blocked: false })).status, 400);

  // Rien de la fiche ne sort côté public.
  const reference = booked.json.reference || booked.json.ref;
  const pages = await Promise.all(['/', '/reservation', `/rendez-vous?r=${encodeURIComponent(reference || '')}`].map(target => site.request('GET', target)));
  for (const page of pages) assert.doesNotMatch(page.body || '', /Couleur 6\.3|Peau sensible/);

  // Une fiche vidée n'est pas gardée ; une fiche sans rendez-vous est effacée à l'entretien.
  assert.deepEqual((await call('PUT', '/api/salon/clients', { key, note: '', blocked: false })).json.clients, {});
  await call('PUT', '/api/salon/clients', { key, note: 'à garder', blocked: false });
  site.app.maintain();
  assert.equal(site.app.clients.all()[key].note, 'à garder');
  const id = (await call('GET', '/api/salon/data')).json.bookings[0].id;
  assert.equal((await call('DELETE', `/api/salon/bookings/${id}`)).status, 200);
  site.app.maintain();
  assert.deepEqual(site.app.clients.all(), {});
});
