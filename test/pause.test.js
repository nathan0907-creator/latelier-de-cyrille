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
  { id: 'couleur', name: 'Couleur', duration: 90, pauses: [{ after: 30, duration: 30 }], price: 50 },
  { id: 'ombre', name: 'Ombré racine', duration: 180, pauses: [{ after: 30, duration: 30 }, { after: 90, duration: 30 }], price: 95 },
] }];
const client = (extra = {}) => ({ date: TUESDAY, name: 'Léa Dupont', phone: '0612345678', ...extra });

test('temps de pose : la coiffeuse est occupée avant et après, libre pendant', () => {
  assert.deepEqual(busyParts(840, { duration: 90, pauses: [{ after: 30, duration: 30 }] }), [[840, 870], [900, 930]]);
  assert.deepEqual(busyParts(840, { duration: 90, pauseAfter: 30, pauseDuration: 30 }), [[840, 870], [900, 930]], 'ancien rendez-vous, à une seule pose');
  assert.deepEqual(busyParts(600, { duration: 180, pauses: [{ after: 30, duration: 30 }, { after: 90, duration: 30 }] }), [[600, 630], [660, 690], [720, 780]]);
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

test('temps de pose : un ombré racine laisse deux poses libres', async t => {
  const site = await startSite({ overrides: { services } });
  t.after(site.stop);
  const free = async (service, time) => (await site.request('GET', `/api/availability?service=${service}&date=${TUESDAY}`)).json.slots.find(slot => slot.time === time).available;

  // Ombré à 14h : application, pose à 14h30, couleur à 15h, pose à 15h30, patine-coupe-brushing de 16h à 17h.
  const booked = await site.request('POST', '/api/bookings', { body: client({ serviceId: 'ombre', time: '14:00' }) });
  assert.equal(booked.status, 201);
  assert.equal(await free('court', '14:00'), false);
  assert.equal(await free('court', '14:30'), true, 'première pose');
  assert.equal(await free('court', '15:00'), false, 'la couleur');
  assert.equal(await free('court', '15:30'), true, 'seconde pose');
  assert.equal(await free('court', '16:00'), false);
  assert.equal(await free('court', '16:30'), false);
  assert.equal(await free('moyen', '14:30'), false);
  assert.equal(await free('couleur', '14:30'), true, 'une couleur : application dans la première pose, fin dans la seconde');
});

test('temps de pose : réglable depuis l\'espace salon, refusé s\'il ne tient pas dans la prestation', async t => {
  const site = await startSite({ overrides: { services } });
  t.after(site.stop);
  const password = crypto.randomBytes(12).toString('base64url');
  const setup = await site.request('POST', '/api/salon/setup', { body: { code: site.app.auth.setupCode(), username: 'cyrille', password } });
  const call = (method, target, body) => site.request(method, target, { headers: { Cookie: setup.headers['set-cookie'][0].split(';')[0] }, ...(body && { body }) });
  const before = (await call('GET', '/api/salon/settings')).json;
  assert.deepEqual(before.categories[0].items.map(item => [item.id, item.pauses.length]), [['court', 0], ['moyen', 0], ['couleur', 1], ['ombre', 2]]);

  const save = pause => call('PUT', '/api/salon/settings', { services: { categories: [{ name: 'Test', items: [{ id: 'couleur', name: 'Couleur', duration: 90, price: 50, ...pause }] }] } });
  const two = (a, b) => ({ pauses: [{ after: a[0], duration: a[1] }, { after: b[0], duration: b[1] }] });
  for (const bad of [{ pauseAfter: 60, pauseDuration: 30 }, { pauseAfter: 0, pauseDuration: 30 }, { pauseAfter: 30, pauseDuration: 45 }, { pauseAfter: 30, pauseDuration: 90 },
    { pauses: [{ after: 60, duration: 30 }] }, two([30, 30], [60, 30]), two([30, 60], [60, 30])]) {
    const res = await save(bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.match(res.json.error, /temps de pose/);
  }
  const saved = await save({ pauseAfter: 30, pauseDuration: 30 });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.categories[0].items[0].pauses, [{ after: 30, duration: 30 }], 'ancienne écriture encore comprise');
  const long = await call('PUT', '/api/salon/settings', { services: { categories: [{ name: 'Test', items: [{ id: 'couleur', name: 'Couleur', duration: 180, price: 50, ...two([90, 30], [30, 30]) }] }] } });
  assert.deepEqual(long.json.categories[0].items[0].pauses, [{ after: 30, duration: 30 }, { after: 90, duration: 30 }], 'deux poses, remises dans l\'ordre');
  const none = await save({ pauses: [] });
  assert.deepEqual(none.json.categories[0].items[0].pauses, []);
});
