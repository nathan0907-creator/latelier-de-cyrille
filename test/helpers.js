'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createStore } = require('../src/store');

/** Configuration de test : mardi → vendredi avec pause déjeuner, samedi en continu. */
function testConfig(overrides = {}) {
  return loadConfig({
    name: 'Salon de test',
    owner: 'Test',
    timezone: 'Europe/Paris',
    address: { street: '1 rue du Test', postalCode: '75001', city: 'Paris' },
    contact: { phone: '01 99 00 00 00', email: 'test@salon.example' },
    hours: {
      1: [],
      2: [['09:00', '12:30'], ['13:30', '19:00']],
      3: [['09:00', '12:30'], ['13:30', '19:00']],
      4: [['09:00', '12:30'], ['13:30', '19:00']],
      5: [['09:00', '12:30'], ['13:30', '19:00']],
      6: [['09:00', '17:00']],
      0: [],
    },
    booking: { slotStep: 30, minNoticeMinutes: 120, maxDaysAhead: 60, maxActivePerPhone: 3, retentionDays: 365 },
    services: [{
      category: 'Test',
      items: [
        { id: 'court', name: 'Court', duration: 30, price: 20 },
        { id: 'moyen', name: 'Moyen', duration: 60, price: 40 },
        { id: 'long', name: 'Long', duration: 150, price: 90 },
      ],
    }],
    photos: { hero: { src: 'https://images.unsplash.com/photo-test', alt: 'test' }, gallery: [] },
    ...overrides,
  }, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'salon-test-')) });
}

function testStore(config) {
  return createStore(config.dataDir);
}

// Le 2026-10-13 est un mardi, le 2026-10-12 un lundi (fermé), le 2026-10-17 un samedi.
const TUESDAY = '2026-10-13';
const MONDAY = '2026-10-12';
const SATURDAY = '2026-10-17';

/** Horloge figée : lundi 12 octobre 2026 à 10h00. */
const clockAt = (date = MONDAY, minutes = 600) => () => ({ date, minutes });

module.exports = { testConfig, testStore, clockAt, TUESDAY, MONDAY, SATURDAY };
