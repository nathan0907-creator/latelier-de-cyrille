'use strict';

// Rappel par SMS la veille, par le téléphone du salon (SMS Gateway for Android).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { international } = require('../src/sms');
const { testConfig, testStore, clockAt, TUESDAY } = require('./helpers');

test('SMS : numéros au format international', () => {
  assert.equal(international('06 12 34 56 78'), '+33612345678');
  assert.equal(international('+32 470 12 34 56'), '+32470123456');
  assert.equal(international('12'), null);
});

async function startWith({ now, sent, user = 'u', password = 'p' }) {
  const { createApp } = require('../src/app');
  const config = testConfig();
  const store = testStore(config);
  const clock = () => now.value;
  const smsRequest = async (url, options) => {
    sent.push({ url, auth: options.headers.Authorization, body: JSON.parse(options.body) });
    return { ok: true, status: 202 };
  };
  const app = createApp({ config, store, clock, smsGate: { user, password }, smsRequest });
  const server = http.createServer(app.handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (method, target, body, cookie) => fetch(`${origin}${target}`, {
    method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie && { Cookie: cookie }) }, ...(body && { body: JSON.stringify(body) }),
  }).then(async res => ({ status: res.status, headers: res.headers, json: await res.json().catch(() => null) }));
  const stop = () => new Promise(resolve => { app.close(); server.close(resolve); });
  return { app, store, request, stop };
}

test('SMS : rappel envoyé 24 h avant, une seule fois, pas aux annulés ni sans numéro', async t => {
  const sent = [];
  const now = { value: clockAt()() }; // lundi 10h
  const site = await startWith({ now, sent });
  t.after(site.stop);
  const booked = await site.request('POST', '/api/bookings', { serviceId: 'court', date: TUESDAY, time: '14:00', name: 'Léa Dupont', phone: '06 12 34 56 78' });
  assert.equal(booked.status, 201);

  await site.app.tick();
  assert.equal(sent.length, 0, 'trop tôt');
  assert.ok(site.app.nextDue() <= 240);

  now.value = { date: '2026-10-12', minutes: 14 * 60 }; // lundi 14h : 24 h avant
  await site.app.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.sms-gate.app/3rdparty/v1/messages');
  assert.equal(sent[0].auth, `Basic ${btoa('u:p')}`);
  assert.deepEqual(sent[0].body.phoneNumbers, ['+33612345678']);
  assert.match(sent[0].body.textMessage.text, /^Bonjour Léa, petit rappel : rendez-vous demain, mardi 13 octobre, à 14h chez Salon de test \(Court\)\. Un empêchement \? Prévenez au 01 99 00 00 00\.$/);

  await site.app.tick();
  assert.equal(sent.length, 1, 'une seule fois');
});

test('SMS : sans identifiants, rien ne part ; l\'espace salon le dit', async t => {
  const sent = [];
  const now = { value: clockAt()() };
  const site = await startWith({ now, sent, user: '', password: '' });
  t.after(site.stop);
  const password = crypto.randomBytes(12).toString('base64url');
  const setup = await site.request('POST', '/api/salon/setup', { code: site.app.auth.setupCode(), username: 'cyrille', password });
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const status = await site.request('GET', '/api/salon/sms', null, cookie);
  assert.equal(status.json.enabled, false);
  assert.match(status.json.example, /^Bonjour Léa/);
  assert.equal((await site.request('POST', '/api/salon/sms/test', { to: '0612345678' }, cookie)).status, 409);
  await site.request('POST', '/api/bookings', { serviceId: 'court', date: TUESDAY, time: '11:00', name: 'Léa Dupont', phone: '0612345678' });
  now.value = { date: '2026-10-12', minutes: 11 * 60 };
  await site.app.tick();
  assert.equal(sent.length, 0);
});
