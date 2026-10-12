'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');
const { findRunningSite, listenOnFreePort } = require('../src/launch');
const { testConfig, testStore } = require('./helpers');

const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => resolve(server.address().port));
});
const close = server => new Promise(resolve => server.close(resolve));

test('port occupé : le site démarre sur le port libre suivant, sauf si le port est imposé', async t => {
  const blocker = http.createServer((req, res) => res.end('autre programme'));
  const taken = await listen(blocker, 0);
  t.after(() => close(blocker));

  const first = http.createServer();
  const port = await listenOnFreePort(first, { port: taken, host: '127.0.0.1' });
  t.after(() => close(first));
  assert.ok(port > taken && port <= taken + 10, `port ${port} choisi après ${taken}`);

  const second = http.createServer();
  await assert.rejects(listenOnFreePort(second, { port: taken, host: '127.0.0.1', fixed: true }), { code: 'EADDRINUSE' });
});

test('double lancement : le site déjà en marche est reconnu à son nom', async t => {
  const config = testConfig();
  const app = createApp({ config, store: testStore(config) });
  const server = http.createServer(app.handle);
  const port = await listen(server, 0);
  t.after(async () => {
    app.close();
    await close(server);
  });

  const here = { ...config, port, portFixed: true };
  assert.equal(await findRunningSite(here), `http://localhost:${port}/`);
  assert.equal(await findRunningSite({ ...here, name: 'Un autre salon' }), null, 'un autre site sur ce port est ignoré');

  const stranger = http.createServer((req, res) => res.end('pas du JSON'));
  const other = await listen(stranger, 0);
  t.after(() => close(stranger));
  assert.equal(await findRunningSite({ ...here, port: other }), null, 'un autre programme est ignoré');
});
