'use strict';

// Employées : une ligne chacune dans l'agenda. Fiches clients créées à la main.

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

const slotAt = (result, time) => result.json.slots.find(slot => slot.time === time).available;

test('employées : ajouter, une ligne à part dans l\'agenda, supprimer', async t => {
  const { site, call } = await signedIn(t);
  assert.equal((await site.request('POST', '/api/salon/staff', { body: { name: 'Julie' } })).status, 401, 'réservé au salon');
  assert.equal((await call('POST', '/api/salon/staff', { name: '  ' })).status, 400);

  const added = await call('POST', '/api/salon/staff', { name: 'Julie' });
  assert.equal(added.status, 201);
  const julie = added.json.person.id;
  assert.deepEqual((await call('GET', '/api/salon/data')).json.staff.map(p => p.name), ['Julie']);

  // Cyrille prend quelqu'un à 10h : Julie reste libre à 10h.
  assert.equal((await call('POST', '/api/salon/bookings', { serviceId: 'court', date: TUESDAY, time: '10:00', name: 'Léa Dupont' })).status, 201);
  assert.equal(slotAt(await call('GET', `/api/availability?service=court&date=${TUESDAY}&salon=1`), '10:00'), false);
  assert.equal(slotAt(await call('GET', `/api/availability?service=court&date=${TUESDAY}&salon=1&staff=${julie}`), '10:00'), true);

  // Julie prend quelqu'un à 11h : la réservation en ligne (chez Cyrille) n'est pas gênée.
  const hers = await call('POST', '/api/salon/bookings', { serviceId: 'court', date: TUESDAY, time: '11:00', name: 'Inès Martin', staff: julie });
  assert.equal(hers.status, 201);
  assert.equal(hers.json.booking.staff, julie);
  assert.equal(slotAt(await site.request('GET', `/api/availability?service=court&date=${TUESDAY}`), '11:00'), true);
  assert.equal((await call('POST', '/api/salon/bookings', { serviceId: 'court', date: TUESDAY, time: '11:00', name: 'Zoé Petit', staff: julie })).status, 409, 'Julie est prise');
  assert.equal((await call('POST', '/api/salon/bookings', { serviceId: 'court', date: TUESDAY, time: '12:00', name: 'Zoé Petit', staff: 'inconnue' })).status, 400);
  // En ligne, impossible de choisir une employée : tout va chez Cyrille.
  const online = await site.request('POST', '/api/bookings', { body: { serviceId: 'court', date: TUESDAY, time: '14:00', name: 'Anne Roy', phone: '0612345678', staff: julie } });
  assert.equal(online.status, 201);
  assert.equal(site.store.bookings.all().find(b => b.name === 'Anne Roy').staff, undefined);

  // Changer de ligne : vers Cyrille, déjà prise à 10h → on demande avant de superposer.
  const first = site.store.bookings.all().find(b => b.name === 'Léa Dupont');
  assert.equal((await call('PATCH', `/api/salon/bookings/${first.id}`, { staff: julie })).json.booking.staff, julie);
  const back = await call('PATCH', `/api/salon/bookings/${hers.json.booking.id}`, { staff: '' });
  assert.equal(back.status, 200);
  assert.equal((await call('PATCH', `/api/salon/bookings/${hers.json.booking.id}`, { staff: julie })).status, 200);

  // Supprimer Julie : ses rendez-vous à venir reviennent chez Cyrille.
  const removed = await call('DELETE', `/api/salon/staff/${julie}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.json.moved, 2);
  assert.deepEqual(removed.json.staff, []);
  assert.ok(site.store.bookings.all().every(b => !b.staff));
  assert.equal((await call('DELETE', `/api/salon/staff/${julie}`)).status, 404);
});

test('fichier clients : une fiche créée à la main, avant tout rendez-vous', async t => {
  const { site, call } = await signedIn(t);
  assert.equal((await site.request('POST', '/api/salon/clients', { body: { name: 'Léa Dupont' } })).status, 401);
  assert.equal((await call('POST', '/api/salon/clients', { name: '1234' })).status, 400);
  assert.equal((await call('POST', '/api/salon/clients', { name: 'Léa Dupont', phone: '12' })).status, 400);

  const created = await call('POST', '/api/salon/clients', { name: 'Léa Dupont', phone: '+33 6 12 34 56 78', note: 'Habituée' });
  assert.equal(created.status, 201);
  const key = created.json.key;
  assert.equal(key, 'tel:0612345678');
  assert.deepEqual(
    { name: created.json.clients[key].name, phone: created.json.clients[key].phone, note: created.json.clients[key].note, manual: true },
    { name: 'Léa Dupont', phone: '06 12 34 56 78', note: 'Habituée', manual: true },
  );
  // Deux fois la même personne : refus, avec la fiche existante.
  const twice = await call('POST', '/api/salon/clients', { name: 'Léa D', phone: '0612345678' });
  assert.equal(twice.status, 409);
  assert.equal(twice.json.key, key);

  // La note modifiée garde le nom et le téléphone ; l'entretien ne l'efface pas.
  await call('PUT', '/api/salon/clients', { key, note: '', blocked: false });
  site.app.maintain();
  assert.equal(site.app.clients.all()[key].name, 'Léa Dupont');

  // Un rendez-vous saisi s'y range ; la fiche ne se supprime plus.
  await call('POST', '/api/salon/bookings', { serviceId: 'court', date: TUESDAY, time: '10:00', name: 'Léa Dupont', phone: '06 12 34 56 78' });
  assert.equal((await call('DELETE', '/api/salon/clients', { key })).status, 409);

  // Sans téléphone, rangée par nom ; supprimable tant qu'elle n'a pas de rendez-vous.
  const byName = await call('POST', '/api/salon/clients', { name: 'Inès Martin' });
  assert.equal(byName.json.key, 'nom:ines martin');
  assert.equal((await call('DELETE', '/api/salon/clients', { key: 'nom:ines martin' })).status, 200);
  assert.equal(site.app.clients.all()['nom:ines martin'], undefined);
});
