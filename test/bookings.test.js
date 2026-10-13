'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBookings, normalizePhone } = require('../src/bookings');
const { testConfig, testStore, clockAt, TUESDAY, MONDAY } = require('./helpers');

function setup(clock = clockAt()) {
  const config = testConfig();
  const store = testStore(config);
  return { config, store, bookings: createBookings({ config, store, clock }) };
}

const valid = (extra = {}) => ({ serviceId: 'court', date: TUESDAY, time: '10:00', name: 'Léa Dupont', phone: '0612345678', ...extra });

test('normalisation des numéros de téléphone', () => {
  assert.equal(normalizePhone('0612345678'), '06 12 34 56 78');
  assert.equal(normalizePhone('06.12.34.56.78'), '06 12 34 56 78');
  assert.equal(normalizePhone('+33 6 12 34 56 78'), '06 12 34 56 78');
  assert.equal(normalizePhone('+32470123456'), '+32470123456');
  assert.equal(normalizePhone('061234567'), null, 'numéro français incomplet');
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone(''), null);
});

test('une réservation en ligne valide est enregistrée « à confirmer »', () => {
  const { bookings, store } = setup();
  const result = bookings.create(valid({ note: '  cheveux   longs\u0007 ' }));
  assert.equal(result.ok, true);
  assert.equal(result.booking.status, 'pending');
  assert.equal(result.booking.source, 'online');
  assert.equal(result.booking.phone, '06 12 34 56 78');
  assert.equal(result.booking.note, 'cheveux longs');
  assert.equal(store.bookings.all().length, 1);
  assert.deepEqual(Object.keys(bookings.publicView(result.booking)).sort(),
    ['attending', 'cancelledBy', 'date', 'duration', 'end', 'name', 'price', 'priceFrom', 'serviceName', 'status', 'time'], 'aucun identifiant ni téléphone renvoyé au public');
});

test('les saisies invalides sont refusées champ par champ', () => {
  const { bookings } = setup();
  const result = bookings.create(valid({ name: '<script>', phone: '12' }));
  assert.equal(result.status, 400);
  assert.ok(result.fields.name && result.fields.phone);
  assert.equal(bookings.create(valid({ serviceId: 'inconnu' })).status, 400);
  assert.equal(bookings.create(valid({ date: '2026-02-30' })).status, 400);
  assert.equal(bookings.create(valid({ time: '25:00' })).status, 400);
});

test('deux personnes ne peuvent pas prendre le même créneau', () => {
  const { bookings } = setup();
  assert.equal(bookings.create(valid()).ok, true);
  const second = bookings.create(valid({ name: 'Marc Petit', phone: '0698765432' }));
  assert.equal(second.status, 409);
  assert.equal(second.code, 'slot_taken');
  const overlapping = bookings.create(valid({ serviceId: 'moyen', time: '09:30', phone: '0698765432' }));
  assert.equal(overlapping.status, 409);
});

test('jour fermé, créneau hors grille ou trop proche : refus', () => {
  const { bookings } = setup(clockAt(TUESDAY, 9 * 60));
  assert.equal(bookings.create(valid({ date: MONDAY })).status, 409);
  assert.equal(bookings.create(valid({ time: '10:15' })).status, 409);
  assert.equal(bookings.create(valid({ time: '10:00' })).status, 409, 'moins de 2 h à l’avance');
  assert.equal(bookings.create(valid({ time: '11:00' })).ok, true);
});

test('limite de rendez-vous à venir par numéro de téléphone', () => {
  const { bookings } = setup();
  for (const time of ['09:00', '10:00', '11:00']) assert.equal(bookings.create(valid({ time })).ok, true);
  const fourth = bookings.create(valid({ time: '14:00' }));
  assert.equal(fourth.status, 429);
  assert.equal(bookings.create(valid({ time: '14:00', phone: '0700000000' })).ok, true);
});

test('la coiffeuse peut noter un rendez-vous sans téléphone ni délai, directement confirmé', () => {
  const { bookings } = setup(clockAt(TUESDAY, 15 * 60));
  const result = bookings.create({ serviceId: 'court', date: TUESDAY, time: '15:00', name: 'Client de passage' }, { mode: 'salon' });
  assert.equal(result.ok, true);
  assert.equal(result.booking.status, 'confirmed');
  assert.equal(result.booking.phone, '');
  assert.equal(bookings.create({ serviceId: 'court', date: TUESDAY, time: '15:00', name: 'Autre client' }, { mode: 'salon' }).status, 409);
});

test('annuler libère le créneau ; réactiver échoue si le créneau a été repris', () => {
  const { bookings } = setup();
  const first = bookings.create(valid()).booking;
  assert.equal(bookings.setStatus(first.id, 'cancelled').ok, true);
  const second = bookings.create(valid({ name: 'Marc Petit', phone: '0698765432' }));
  assert.equal(second.ok, true);
  assert.equal(bookings.setStatus(first.id, 'confirmed').status, 409);
  assert.equal(bookings.setStatus(second.booking.id, 'confirmed').booking.status, 'confirmed');
  assert.equal(bookings.setStatus('inconnu', 'confirmed').status, 404);
  assert.equal(bookings.setStatus(first.id, 'nimporte').status, 400);
});

test('les vieux rendez-vous sont effacés après la durée de conservation', () => {
  const { bookings, store } = setup();
  store.bookings.add({ id: 'vieux', date: '2025-01-10', start: 600, duration: 30, status: 'confirmed' });
  store.bookings.add({ id: 'recent', date: '2026-09-10', start: 600, duration: 30, status: 'confirmed' });
  assert.equal(bookings.purgeOld(), 1);
  assert.deepEqual(store.bookings.all().map(b => b.id), ['recent']);
});

test('les données survivent à un redémarrage', () => {
  const { bookings, config } = setup();
  bookings.create(valid());
  const reopened = testStore(config);
  assert.equal(reopened.bookings.all().length, 1);
  assert.equal(reopened.bookings.all()[0].name, 'Léa Dupont');
});
