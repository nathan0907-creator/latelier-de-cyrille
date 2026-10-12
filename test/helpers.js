'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createStore } = require('../src/store');

/** Configuration de test : mardi → vendredi avec pause déjeuner, samedi en continu. */
function testConfig(overrides = {}, env = {}) {
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
  }, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'salon-test-')), ...env });
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

/** Un navigateur ordinaire : les requêtes sans cet en-tête sont prises pour des robots et ne sont pas comptées. */
const BROWSER = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

/** Démarre le site sur un port libre et renvoie un petit client HTTP. */
async function startSite({ overrides = {}, env = {} } = {}) {
  const { createApp } = require('../src/app');
  const config = testConfig(overrides, env);
  const store = testStore(config);
  const app = createApp({ config, store, clock: clockAt() });
  const server = http.createServer(app.handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  function request(method, target, { body, headers = {}, sameOrigin = true } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const req = http.request(`${origin}${target}`, {
        method,
        headers: {
          ...(payload && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
          ...(sameOrigin && method !== 'GET' && { Origin: origin }),
          ...headers,
        },
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* pas du JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }

  const stop = () => new Promise(resolve => { app.close(); server.close(resolve); });
  return { app, config, store, request, stop, origin };
}

module.exports = { testConfig, testStore, clockAt, startSite, BROWSER, TUESDAY, MONDAY, SATURDAY };
