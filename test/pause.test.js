'use strict';

// Temps de pose : pendant la pose d'une couleur, la coiffeuse peut prendre quelqu'un d'autre.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { busyParts } = require('../src/availability');
const { startSite, TUESDAY } = require('./helpers');

const services = [{ category: 'Test', items: [
  { id: 'court', name: 'Court', duration: 30, price: 20 },
  { id: 'moyen', name: 'Moyen', duration: 60, price: 40 },
  { id: 'couleur', name: 'Couleur', duration: 90, pauseAfter: 30, pauseDuration: 30, price: 50 },
] }];
const client = (extra = {}) => ({ date: TUESDAY, name: 'Léa Dupont', phone: '0612345678', ...extra });

test('temps de pose : la coiffeuse est occupée avant et après, libre pendant', () => {
  assert.deepEqual(busyParts(840, { duration: 90, pauseAfter: 30, pauseDuration: 30 }), [[840, 870], [900, 930]]);
  assert.deepEqual(busyParts(840, { duration: 60 }), [[840, 900]]);
});

test('temps de pose : un autre rendez-vous se glisse dans la pose, et seulement là', async t => {
  const site = await startSite({ overrides: { services } });
  t.after(site.stop);
  const book = body => site.request('POST', '/api/bookings', { body: client(body) });
  const free = async (service, time) => (await site.request('GET', `/api/availability?service=${service}&date=${TUESDAY}`)).json.slots.find(slot => slot.time === time).available;

  // Une couleur à 14h : pose de 14h30 à 15h, fin à 15h30.
  assert.equal((await book({ serviceId: 'couleur', time: '14:00' })).status, 201);
  assert.equal(await free('court', '14:00'), false);
  assert.equal(await free('court', '14:30'), true, 'pendant la pose');
  assert.equal(await free('court', '15:00'), false, 'la coiffeuse termine la couleur');
  assert.equal(await free('court', '15:30'), true);
  assert.equal(await free('moyen', '14:30'), false, 'une heure ne tient pas dans trente minutes de pose');
  assert.equal(await free('couleur', '14:30'), true, 'deux couleurs se croisent : chacune dans la pose de l\'autre');
  assert.equal(await free('couleur', '15:00'), false);

  assert.equal((await book({ serviceId: 'moyen', time: '14:30', phone: '0698765432' })).status, 409);
  assert.equal((await book({ serviceId: 'court', time: '14:30', phone: '0698765432' })).status, 201);
  assert.equal(await free('court', '14:30'), false, 'la pose est prise');
  assert.equal(await free('couleur', '14:30'), false);
});

test('temps de pose : réglable depuis l\'espace salon, refusé s\'il ne tient pas dans la prestation', async t => {
  const site = await startSite({ overrides: { services } });
  t.after(site.stop);
  const password = crypto.randomBytes(12).toString('base64url');
  const setup = await site.request('POST', '/api/salon/setup', { body: { code: site.app.auth.setupCode(), username: 'cyrille', password } });
  const call = (method, target, body) => site.request(method, target, { headers: { Cookie: setup.headers['set-cookie'][0].split(';')[0] }, ...(body && { body }) });
  const before = (await call('GET', '/api/salon/settings')).json;
  assert.deepEqual(before.categories[0].items.map(item => [item.id, item.pauseAfter, item.pauseDuration]), [['court', 0, 0], ['moyen', 0, 0], ['couleur', 30, 30]]);

  const save = pause => call('PUT', '/api/salon/settings', { services: { categories: [{ name: 'Test', items: [{ id: 'couleur', name: 'Couleur', duration: 90, price: 50, ...pause }] }] } });
  for (const bad of [{ pauseAfter: 60, pauseDuration: 30 }, { pauseAfter: 0, pauseDuration: 30 }, { pauseAfter: 30, pauseDuration: 45 }, { pauseAfter: 30, pauseDuration: 90 }]) {
    const res = await save(bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.match(res.json.error, /temps de pose/);
  }
  const saved = await save({ pauseAfter: 30, pauseDuration: 30 });
  assert.equal(saved.status, 200);
  const none = await save({ pauseAfter: 30, pauseDuration: 0 });
  assert.deepEqual([none.json.categories[0].items[0].pauseAfter, none.json.categories[0].items[0].pauseDuration], [0, 0]);
});
