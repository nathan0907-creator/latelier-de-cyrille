'use strict';

// Jours fériés fermés d'office, pages par prestation, connexion qui dure.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { easter, holidaysOf, holidaysBetween } = require('../src/holidays');
const { startSite } = require('./helpers');

/** Démarre le site et connecte la coiffeuse. */
async function salon(options) {
  const site = await startSite(options);
  const password = crypto.randomBytes(12).toString('base64url');
  const setup = await site.request('POST', '/api/salon/setup', { body: { code: site.app.auth.setupCode(), username: 'cyrille', password } });
  const cookie = setup.headers['set-cookie'][0].split(';')[0];
  const call = (method, target, body) => site.request(method, target, { headers: { Cookie: cookie }, ...(body !== undefined && { body }) });
  return { ...site, call, cookie };
}

const ARMISTICE = '2026-11-11'; // un mercredi, jour travaillé dans le salon de test
const NOEL = '2026-12-25'; // un vendredi

test('jours fériés : les onze de l\'année, Pâques compris', () => {
  assert.deepEqual([2024, 2025, 2026, 2027, 2038].map(easter), ['2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28', '2038-04-25']);
  assert.deepEqual(holidaysOf(2026).map(day => `${day.date} ${day.name}`), [
    "2026-01-01 Jour de l'An", '2026-04-06 Lundi de Pâques', '2026-05-01 Fête du Travail', '2026-05-08 Victoire de 1945',
    '2026-05-14 Ascension', '2026-05-25 Lundi de Pentecôte', '2026-07-14 Fête nationale', '2026-08-15 Assomption',
    '2026-11-01 Toussaint', '2026-11-11 Armistice de 1918', '2026-12-25 Noël',
  ]);
  assert.deepEqual(holidaysBetween('2026-12-20', '2027-04-01').map(day => day.date), ['2026-12-25', '2027-01-01', '2027-03-29']);
  // 2035 : l'Ascension tombe le 3 mai, avant le 8 mai — la liste reste dans l'ordre du calendrier.
  const dates = holidaysOf(2035).map(day => day.date);
  assert.deepEqual(dates, [...dates].sort());
});

test('jours fériés : fermés d\'office, annoncés sur le site, sans rien avoir à saisir', async t => {
  const site = await salon();
  t.after(site.stop);

  // Aucune fermeture saisie, et pourtant le 11 novembre est fermé.
  assert.deepEqual((await site.call('GET', '/api/salon/data')).json.closures, []);
  assert.equal((await site.request('GET', `/api/availability?service=court&date=${ARMISTICE}`)).json.closed, true);
  assert.equal((await site.request('GET', '/api/availability?service=court&date=2026-11-10')).json.closed, false);
  const month = (await site.request('GET', '/api/availability/month?service=court&month=2026-11')).json.days;
  assert.equal(month.find(day => day.date === ARMISTICE).state, 'closed');
  const refused = await site.request('POST', '/api/bookings', { body: { serviceId: 'court', date: ARMISTICE, time: '10:00', name: 'Léa Dupont', phone: '0612345678' } });
  assert.equal(refused.status, 409, 'on ne réserve pas un jour férié');
  assert.equal((await site.call('POST', '/api/salon/bookings', { serviceId: 'court', date: ARMISTICE, time: '10:00', name: 'Client du salon' })).status, 409);

  // Le bandeau de la une, « En bref » et la page de réservation l'annoncent ; les moteurs de recherche aussi.
  const home = (await site.request('GET', '/')).text;
  assert.match(home, /Fermé le mercredi 11 novembre : jour férié \(Armistice de 1918\)/);
  assert.match((await site.request('GET', '/reservation')).text, /Fermé le mercredi 11 novembre : jour férié \(Armistice de 1918\)/);
  const [shop] = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(home)[1])['@graph'];
  assert.deepEqual(shop.specialOpeningHoursSpecification.map(day => [day.validFrom, day.validThrough, day.opens, day.closes]), [
    [ARMISTICE, ARMISTICE, '00:00', '00:00'], [NOEL, NOEL, '00:00', '00:00'], ['2027-01-01', '2027-01-01', '00:00', '00:00'],
  ]);

  // Dans l'espace salon : les jours fériés à venir qui tombent un jour travaillé (pas le dimanche 1er novembre,
  // ni le lundi de Pâques : le salon de test est fermé le lundi).
  const { holidays } = (await site.call('GET', '/api/salon/data')).json;
  assert.equal(holidays.auto, true);
  assert.deepEqual(holidays.list.map(day => `${day.date} ${day.open}`), [
    '2026-11-11 false', '2026-12-25 false', '2027-01-01 false', '2027-05-01 false', '2027-05-06 false', '2027-05-08 false', '2027-07-14 false',
  ]);
});

test('jours fériés : la coiffeuse en ouvre un, ou arrête la fermeture automatique', async t => {
  const site = await salon();
  t.after(site.stop);
  // Vu de l'espace salon : la réservation en ligne, elle, ne va pas au-delà de 60 jours dans le salon de test.
  const closed = async date => (await site.call('GET', `/api/availability?service=court&date=${date}&salon=1`)).json.closed;

  assert.equal((await site.request('PUT', '/api/salon/holidays', { body: { date: ARMISTICE, open: true } })).status, 401, 'réservé à la coiffeuse');
  assert.equal((await site.call('PUT', '/api/salon/holidays', { date: '2026-11-10', open: true })).status, 400, "pas un jour férié");
  assert.equal((await site.call('PUT', '/api/salon/holidays', { date: '2026-11-01', open: true })).status, 400, 'férié, mais un dimanche : rien à ouvrir');
  assert.equal((await site.call('PUT', '/api/salon/holidays', {})).status, 400);

  // Elle travaille le 11 novembre : le jour redevient réservable, aux horaires habituels du mercredi.
  const opened = await site.call('PUT', '/api/salon/holidays', { date: ARMISTICE, open: true });
  assert.equal(opened.status, 200);
  assert.equal(opened.json.holidays.list.find(day => day.date === ARMISTICE).open, true);
  assert.equal(await closed(ARMISTICE), false);
  assert.equal(await closed(NOEL), true, 'les autres restent fermés');
  assert.doesNotMatch((await site.request('GET', '/')).text, /11 novembre : jour férié/);
  assert.equal((await site.request('POST', '/api/bookings', { body: { serviceId: 'court', date: ARMISTICE, time: '10:00', name: 'Léa Dupont', phone: '0612345678' } })).status, 201);

  // Elle change d'avis.
  await site.call('PUT', '/api/salon/holidays', { date: ARMISTICE, open: false });
  assert.equal(await closed(ARMISTICE), true);

  // Fermeture automatique arrêtée : plus aucun jour férié n'est fermé d'office.
  const off = await site.call('PUT', '/api/salon/holidays', { auto: false });
  assert.equal(off.json.holidays.auto, false);
  assert.ok(off.json.holidays.list.every(day => day.open));
  assert.equal(await closed(ARMISTICE), false);
  assert.equal(await closed(NOEL), false);
  assert.doesNotMatch((await site.request('GET', '/')).text, /jour férié/);
  await site.call('PUT', '/api/salon/holidays', { auto: true });
  assert.equal(await closed(NOEL), true);

  // Des congés saisis qui englobent Noël gardent leur motif : une seule annonce, « congés ».
  assert.equal((await site.call('POST', '/api/salon/closures', { date: '2026-12-22', until: '2026-12-26', reason: 'Congés' })).status, 201);
  const home = (await site.request('GET', '/')).text;
  assert.match(home, /Fermé du mardi 22 au samedi 26 décembre : congés/);
  assert.doesNotMatch(home, /jour férié \(Noël\)/);
});

test('jours fériés : un jour ouvert le reste si les horaires changent, un jour de repos ne s\'annonce pas', async t => {
  const site = await salon();
  t.after(site.stop);
  // Le salon ouvre désormais le lundi : le lundi de Pâques 2027 devient un jour férié à régler.
  const { hours } = (await site.call('GET', '/api/salon/settings')).json;
  assert.equal((await site.call('PUT', '/api/salon/settings', { hours: { ...hours, 1: [['09:00', '18:00']] } })).status, 200);
  const list = (await site.call('GET', '/api/salon/data')).json.holidays.list.map(day => day.date);
  assert.ok(list.includes('2027-03-29'), 'lundi de Pâques');
  assert.equal((await site.request('GET', '/api/availability?service=court&date=2027-03-29')).json.closed, true);
});

test('référencement : une page par prestation, reliée à la carte et décrite aux moteurs de recherche', async t => {
  const site = await startSite();
  t.after(site.stop);

  const page = await site.request('GET', '/prestations/moyen');
  assert.equal(page.status, 200);
  const text = page.text.replace(/&#39;/g, "'");
  assert.match(text, /<title>Moyen à Paris · Salon de test<\/title>/);
  assert.match(text, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/prestations\/moyen">/);
  assert.equal((text.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(text, /href="\/reservation\?service=moyen"/, 'le bouton réserve cette prestation');
  assert.match(text, /href="\/prestations\/court"/, 'les autres prestations de la catégorie sont liées');
  assert.doesNotMatch(text, /href="\/prestations\/moyen"/, 'la page ne se lie pas à elle-même');
  const description = /<meta name="description" content="([^"]*)"/.exec(text)[1];
  assert.match(description, /^Moyen à Paris chez Salon de test : 40 €, 1 h\./);
  assert.ok(description.length <= 165, `${description.length} caractères`);

  const graph = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page.text)[1])['@graph'];
  const crumbs = graph.find(node => node['@type'] === 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map(step => step.name), ['Salon de test', 'Prestations et tarifs', 'Moyen']);
  assert.match(crumbs.itemListElement[1].item, /\/prestations$/);
  const offer = graph.find(node => node['@type'] === 'Service');
  assert.equal(offer.name, 'Moyen');
  assert.deepEqual(offer.offers, { '@type': 'Offer', priceCurrency: 'EUR', price: 40 });
  assert.equal(offer.provider['@id'], graph[0]['@id']);

  // La carte et la une mènent à ces pages ; la page de réservation, elle, garde ses boutons « Choisir ».
  assert.match((await site.request('GET', '/prestations')).text, /<a class="prices-name" href="\/prestations\/long">Long<\/a>/);
  assert.doesNotMatch((await site.request('GET', '/reservation')).text, /prices-name/);

  assert.equal((await site.request('GET', '/prestations/inconnue')).status, 404);
  assert.equal((await site.request('GET', '/prestations/moyen/')).headers.location, '/prestations/moyen');
  assert.equal((await site.request('GET', '/prestations/Moyen')).status, 404);
});

test('connexion : une fois connectée, la coiffeuse le reste (la session se prolonge toute seule)', async t => {
  const site = await salon();
  t.after(site.stop);
  // Connexion du jour : rien à prolonger.
  assert.equal((await site.call('GET', '/api/salon/data')).headers['set-cookie'], undefined);

  // Trois semaines plus tard, elle rouvre son espace : la session repart pour 400 jours.
  const [id] = Object.keys(JSON.parse(require('node:fs').readFileSync(require('node:path').join(site.config.dataDir, 'sessions.json'), 'utf8')));
  const before = site.store.sessions.get(id).expires;
  site.store.sessions.set(id, { expires: before - 21 * 24 * 3600 * 1000 });
  const later = await site.call('GET', '/api/salon/data');
  assert.equal(later.status, 200);
  assert.match(later.headers['set-cookie'][0], new RegExp(`^${site.cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${400 * 24 * 3600}$`));
  assert.ok(site.store.sessions.get(id).expires >= before);

  // Se déconnecter y met fin pour de bon.
  assert.equal((await site.call('POST', '/api/salon/logout', {})).status, 200);
  assert.equal((await site.call('GET', '/api/salon/data')).status, 401);
});
