'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { testConfig } = require('./helpers');

const withService = service => testConfig({ services: [{ category: 'Test', items: [service] }] }).services[0];

test('prix selon la longueur : le plus bas sert à la réservation, affiché « dès »', () => {
  const tiered = withService({ id: 'balayage', name: 'Balayage', duration: 120, prices: [75, 85, 100] });
  assert.deepEqual([tiered.price, tiered.priceFrom, tiered.prices], [75, true, [75, 85, 100]]);

  const flat = withService({ id: 'pointes', name: 'Pointes', duration: 30, price: 10 });
  assert.deepEqual([flat.price, flat.priceFrom, flat.prices], [10, false, null]);
});

test('prix selon la longueur : deux ou trois montants, rien d\'autre', () => {
  assert.throws(() => withService({ id: 'x', name: 'X', duration: 30, prices: [10] }));
  assert.throws(() => withService({ id: 'x', name: 'X', duration: 30, prices: [10, 20, 30, 40] }));
  assert.throws(() => withService({ id: 'x', name: 'X', duration: 30, prices: [10, 'vingt'] }));
  assert.throws(() => withService({ id: 'x', name: 'X', duration: 30 }));
});
