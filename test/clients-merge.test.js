'use strict';

// Fichier clients : une même personne ne doit pas se retrouver sur deux fiches (et perdre ses notes).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startSite, TUESDAY } = require('./helpers');

async function signedIn(t) {
  const site = await startSite();
  t.after(site.stop);
  const password = crypto.randomBytes(12).toString('base64url');
  const setup = await site.request('POST', '/api/salon/setup', { body: { code: site.app.auth.setupCode(), username: 'cyrille', password } });
  const cookie = setup.headers['set-cookie'][0].split(';')[0];
  const call = (method, target, body) => site.request(method, target, { headers: { Cookie: cookie }, ...(body && { body }) });
  return { site, call };
}

test('les notes d\'une fiche « au nom » suivent quand la personne revient avec son numéro', async t => {
  const { site, call } = await signedIn(t);
  // Premier rendez-vous noté au salon, sans numéro : fiche au nom, avec une note.
  await call('POST', '/api/salon/bookings', { serviceId: 'court', date: TUESDAY, time: '10:00', name: 'Léa Dupont' });
  await call('PUT', '/api/salon/clients', { key: 'nom:lea dupont', note: 'Couleur 6.3', blocked: false });

  // Elle reprend rendez-vous en ligne, avec son numéro : la note est sur la fiche du numéro.
  const online = await site.request('POST', '/api/bookings', { body: { serviceId: 'court', date: TUESDAY, time: '15:00', name: 'Léa  DUPONT', phone: '06 12 34 56 78' } });
  assert.equal(online.status, 201);
  const clients = site.app.clients.all();
  assert.equal(clients['tel:0612345678'].note, 'Couleur 6.3');
  assert.equal(clients['nom:lea dupont'], undefined);
  // L'entretien ne l'efface pas.
  site.app.maintain();
  assert.equal(site.app.clients.all()['tel:0612345678'].note, 'Couleur 6.3');
});

test('rattrapage à l\'entretien : une fiche au nom rejoint la seule fiche avec numéro de ce nom', async t => {
  const { site } = await signedIn(t);
  site.store.bookings.add({ id: 'a1', date: TUESDAY, time: '10:00', start: 600, duration: 30, name: 'Inès Martin', phone: '', status: 'confirmed', serviceName: 'Court', price: 20 });
  site.store.bookings.add({ id: 'a2', date: TUESDAY, time: '11:00', start: 660, duration: 30, name: 'Inès Martin', phone: '06 11 11 11 11', status: 'confirmed', serviceName: 'Court', price: 20 });
  site.store.clients.set('nom:ines martin', { note: 'Allergie', blocked: false });
  site.store.clients.set('tel:0611111111', { note: 'Brushing', blocked: false });
  site.app.maintain();
  assert.equal(site.app.clients.all()['tel:0611111111'].note, 'Brushing\n\nAllergie');
  assert.equal(site.app.clients.all()['nom:ines martin'], undefined);
});

test('réunir deux fiches : rendez-vous renommés, notes gardées, numéro conservé', async t => {
  const { site, call } = await signedIn(t);
  const a = (await call('POST', '/api/salon/bookings', { serviceId: 'court', date: TUESDAY, time: '10:00', name: 'Zoé Petit', phone: '0622222222' })).json.booking;
  const b = (await call('POST', '/api/salon/bookings', { serviceId: 'court', date: TUESDAY, time: '11:00', name: 'Zoé' })).json.booking;
  await call('PUT', '/api/salon/clients', { key: 'tel:0622222222', note: 'Frange', blocked: false });
  await call('PUT', '/api/salon/clients', { key: 'nom:zoe', note: 'Pointes', blocked: true });

  assert.equal((await call('POST', '/api/salon/clients/merge', { from: { key: 'nom:zoe', ids: [b.id] }, into: { key: 'nom:zoe', ids: [b.id] } })).status, 400);
  assert.equal((await site.request('POST', '/api/salon/clients/merge', { body: {} })).status, 401);

  const merged = await call('POST', '/api/salon/clients/merge', { from: { key: 'nom:zoe', ids: [b.id] }, into: { key: 'tel:0622222222', ids: [a.id] } });
  assert.equal(merged.status, 200);
  assert.equal(merged.json.key, 'tel:0622222222');
  assert.deepEqual(merged.json.bookings.map(x => [x.name, x.phone]), [['Zoé Petit', '06 22 22 22 22']]);
  const record = merged.json.clients['tel:0622222222'];
  assert.equal(record.note, 'Frange\n\nPointes');
  assert.equal(record.blocked, true, 'un « ne plus reprendre » est gardé');
  assert.equal(merged.json.clients['nom:zoe'], undefined);
  site.app.maintain();
  assert.equal(site.app.clients.all()['tel:0622222222'].note, 'Frange\n\nPointes');
});
