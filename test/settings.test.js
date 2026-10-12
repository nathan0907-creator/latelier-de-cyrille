'use strict';

// Ce que la coiffeuse règle depuis son espace : tarifs, horaires, photos, déplacement d'un rendez-vous.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { startSite, TUESDAY, SATURDAY } = require('./helpers');
const { imageSize } = require('../src/images');
const { nearestRatio } = require('../src/settings');

/** Démarre le site et connecte la coiffeuse : renvoie de quoi appeler son espace. */
async function salon(options) {
  const site = await startSite(options);
  const password = crypto.randomBytes(12).toString('base64url');
  const setup = await site.request('POST', '/api/salon/setup', { body: { code: site.app.auth.setupCode(), username: 'cyrille', password } });
  const authed = { headers: { Cookie: setup.headers['set-cookie'][0].split(';')[0] } };
  const call = (method, target, body) => site.request(method, target, { ...authed, ...(body !== undefined && { body }) });
  return { ...site, call };
}

/** Une image JPEG minimale, aux dimensions voulues (l'en-tête suffit au serveur pour la mesurer). */
function jpeg(width, height, weight = 400) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]), sof, crypto.randomBytes(weight), Buffer.from([0xff, 0xd9])]);
}

const upload = (...images) => ({ files: images.map(image => ({ data: image.toString('base64') })) });

test('tarifs : la carte se modifie depuis l\'espace salon, le site et les créneaux suivent aussitôt', async t => {
  const site = await salon();
  t.after(site.stop);

  assert.equal((await site.request('GET', '/api/salon/settings')).status, 401, 'réservé à la coiffeuse');
  assert.equal((await site.request('PUT', '/api/salon/settings', { body: { hours: {} } })).status, 401);

  const before = (await site.call('GET', '/api/salon/settings')).json;
  assert.deepEqual(before.categories.map(c => c.name), ['Test']);
  assert.deepEqual(before.categories[0].items.map(s => [s.id, s.duration, s.price]), [['court', 30, 20], ['moyen', 60, 40], ['long', 150, 90]]);

  const saved = await site.call('PUT', '/api/salon/settings', { services: {
    priceNote: 'Tarifs « à partir de ».',
    categories: [
      { name: 'Coupes', items: [
        { id: 'court', name: 'Coupe courte', duration: 60, price: '24,50', featured: true },
        { name: 'Coupe & brushing d\'été', duration: 90, prices: [30, 35, 45] },
      ] },
      { name: 'Couleurs', items: [{ id: 'long', name: 'Balayage', duration: 150, price: 95, priceFrom: true }] },
    ],
  } });
  assert.equal(saved.status, 200);
  const items = saved.json.categories.flatMap(c => c.items);
  assert.deepEqual(items.map(s => s.id), ['court', 'coupe-brushing-d-ete', 'long'], 'les identifiants existants sont gardés, les nouveaux sont fabriqués');
  assert.equal(items[0].price, 24.5);
  assert.equal(items[0].featured, true);
  assert.deepEqual(items[1].prices, [30, 35, 45]);
  assert.equal(items[2].priceFrom, true);

  // Le site public : nouveaux noms et prix, l'ancienne prestation « moyen » a disparu.
  const card = (await site.request('GET', '/prestations')).text;
  assert.match(card, /Coupe courte/);
  assert.match(card, /24,50 €/);
  assert.match(card, /Coupe &amp; brushing d&#39;été/);
  assert.match(card, /dès 95 €/);
  assert.match(card, /Tarifs « à partir de »\./);
  assert.doesNotMatch(card, />Moyen</);
  assert.match((await site.request('GET', '/')).text, /Coupe courte/, 'la prestation mise en avant est à la une');

  // Les créneaux suivent la nouvelle durée : une coupe d'une heure ne démarre plus à midi (pause à 12h30).
  const slots = (await site.request('GET', `/api/availability?service=court&date=${TUESDAY}`)).json.slots.map(s => s.time);
  assert.ok(slots.includes('11:30') && !slots.includes('12:00'));
  assert.equal((await site.request('GET', `/api/availability?service=moyen&date=${TUESDAY}`)).status, 400, 'prestation supprimée');
  assert.equal((await site.request('POST', '/api/bookings', { body: { serviceId: 'coupe-brushing-d-ete', date: TUESDAY, time: '14:00', name: 'Léa Dupont', phone: '0612345678' } })).json.booking.price, 30);

  // Les réglages survivent à un redémarrage : ils sont sur le disque.
  assert.ok(fs.existsSync(path.join(site.config.dataDir, 'reglages.json')));
  const { createApp } = require('../src/app');
  const again = createApp({ config: site.config, store: require('../src/store').createStore(site.config.dataDir) });
  t.after(() => again.close());
  assert.deepEqual(again.config.services.map(s => s.name), ['Coupe courte', "Coupe & brushing d'été", 'Balayage']);
});

test('tarifs : ce qui est incohérent est refusé, avec un message clair', async t => {
  const site = await salon();
  t.after(site.stop);
  const save = categories => site.call('PUT', '/api/salon/settings', { services: { categories } });
  const item = extra => ({ name: 'Coupe', duration: 30, price: 20, ...extra });

  for (const [categories, expected] of [
    [[], /au moins une catégorie/],
    [[{ name: '', items: [item()] }], /catégorie doit avoir un nom/],
    [[{ name: 'Coupes', items: [] }], /est vide/],
    [[{ name: 'Coupes', items: [item({ name: ' ' })] }], /prestation doit avoir un nom/],
    [[{ name: 'Coupes', items: [item({ duration: 45 })] }], /multiple de 30 minutes/],
    [[{ name: 'Coupes', items: [item({ duration: 0 })] }], /multiple de 30 minutes/],
    [[{ name: 'Coupes', items: [item({ price: 'gratuit' })] }], /Indiquez le prix/],
    [[{ name: 'Coupes', items: [item({ price: -5 })] }], /Indiquez le prix/],
    [[{ name: 'Coupes', items: [item({ price: undefined, prices: [10, 20, 30, 40] })] }], /Indiquez le prix/],
    [[{ name: 'Coupes', items: [item()] }, { name: 'coupes', items: [item()] }], /apparaît deux fois/],
  ]) {
    const res = await save(categories);
    assert.equal(res.status, 400, JSON.stringify(categories));
    assert.match(res.json.error, expected);
  }
  // Rien n'a bougé : la carte d'origine est toujours là.
  assert.deepEqual((await site.call('GET', '/api/salon/settings')).json.categories[0].items.map(s => s.id), ['court', 'moyen', 'long']);

  // Deux prestations du même nom : chacune a son identifiant.
  const twins = await save([{ name: 'Coupes', items: [item(), item(), item({ name: '<script>alert(1)</script>' })] }]);
  assert.deepEqual(twins.json.categories[0].items.map(s => s.id), ['coupe', 'coupe-2', 'script-alert-1-script']);
  assert.doesNotMatch((await site.request('GET', '/prestations')).text, /<script>alert/, 'un nom saisi ne devient jamais du code');
});

test('horaires : modifiés depuis l\'espace salon, appliqués aux créneaux et affichés sur le site', async t => {
  const site = await salon();
  t.after(site.stop);
  const before = (await site.call('GET', '/api/salon/settings')).json.hours;
  assert.deepEqual(before[2], [['09:00', '12:30'], ['13:30', '19:00']]);
  assert.deepEqual(before[1], []);

  const hours = { ...before, 1: [['10:00', '16:00']], 2: [['09:00', '13:00']], 6: [] };
  const saved = await site.call('PUT', '/api/salon/settings', { hours });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.hours[1], [['10:00', '16:00']]);

  const tuesday = (await site.request('GET', `/api/availability?service=court&date=${TUESDAY}`)).json.slots.map(s => s.time);
  assert.equal(tuesday.at(-1), '12:30', 'le mardi finit maintenant à 13h');
  assert.equal((await site.request('GET', `/api/availability?service=court&date=${SATURDAY}`)).json.closed, true, 'le samedi est fermé');
  assert.equal((await site.request('GET', '/api/availability?service=court&date=2026-10-19')).json.slots[0].time, '10:00', 'le lundi est ouvert');
  const page = (await site.request('GET', '/nous-trouver')).text;
  assert.match(page, /10h – 16h/);
  assert.match((await site.call('GET', '/api/salon/data')).json.hours[1][0].start.toString(), /^600$/);

  for (const bad of [
    { ...before, 2: [['09:15', '12:00']] },
    { ...before, 2: [['14:00', '12:00']] },
    { ...before, 2: [['09:00', '13:00'], ['12:00', '18:00']] },
    { ...before, 2: [['9h', '12h']] },
    { ...before, 2: 'toute la journée' },
    { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
  ]) {
    const res = await site.call('PUT', '/api/salon/settings', { hours: bad });
    assert.equal(res.status, 400, JSON.stringify(bad[2]));
    assert.match(res.json.error, /horaires|ouvert/i, 'le refus est expliqué');
  }
  assert.deepEqual((await site.call('GET', '/api/salon/settings')).json.hours[2], [['09:00', '13:00']], 'un refus ne change rien');
});

test('photos : dépôt, description, ordre, photo de la une, suppression', async t => {
  const site = await salon();
  t.after(site.stop);
  const media = path.join(site.config.dataDir, 'photos');

  assert.equal((await site.request('POST', '/api/salon/photos', { body: upload(jpeg(1200, 1600)) })).status, 401, 'réservé à la coiffeuse');

  // Une photo en hauteur, avec deux versions réduites.
  const first = await site.call('POST', '/api/salon/photos', upload(jpeg(480, 640), jpeg(1200, 1600), jpeg(800, 1067)));
  assert.equal(first.status, 201);
  assert.match(first.json.photo.src, /^\/media\/photo-[a-z0-9]+\.jpg$/);
  assert.deepEqual([first.json.photo.width, first.json.photo.height, first.json.photo.ratio], [1200, 1600, '3/4']);
  assert.equal(fs.readdirSync(media).length, 3);
  const second = await site.call('POST', '/api/salon/photos', upload(jpeg(1000, 1000)));
  assert.equal(second.json.photo.ratio, '1/1');

  const served = await site.request('GET', first.json.photo.src);
  assert.equal(served.status, 200);
  assert.equal(served.headers['content-type'], 'image/jpeg');
  assert.equal((await site.request('GET', '/media/../compte.json')).status, 404);
  assert.equal((await site.request('GET', '/media/reglages.json')).status, 404);

  const gallery = [
    { src: first.json.photo.src, alt: 'Balayage miel sur cheveux longs' },
    { src: second.json.photo.src, alt: 'Carré plongeant' },
  ];
  assert.equal((await site.call('PUT', '/api/salon/settings', { photos: { gallery: [{ src: gallery[0].src, alt: '' }] } })).status, 400, 'description obligatoire');
  assert.equal((await site.call('PUT', '/api/salon/settings', { photos: { gallery: [{ src: '/media/inconnue.jpg', alt: 'x' }] } })).status, 400);
  assert.equal((await site.call('PUT', '/api/salon/settings', { photos: { gallery: [{ src: '/../salon.config.js', alt: 'x' }] } })).status, 400);
  assert.equal((await site.call('PUT', '/api/salon/settings', { photos: { gallery: [] } })).status, 400);

  const saved = await site.call('PUT', '/api/salon/settings', { photos: { gallery, hero: gallery[1].src, second: gallery[0].src } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.photos.hero, gallery[1].src);
  assert.equal(saved.json.photos.second, gallery[0].src);
  assert.match(saved.json.photos.gallery[0].thumb, /-480\.jpg$/, 'la vignette est la plus petite version');

  const home = (await site.request('GET', '/')).text;
  assert.match(home, /alt="Carré plongeant"[^>]*fetchpriority="high"/, 'la photo choisie est la grande photo de la une');
  assert.match(home, new RegExp(`srcset="${gallery[0].src.replace('.jpg', '-480.jpg')} 480w, ${gallery[0].src.replace('.jpg', '-800.jpg')} 800w, ${gallery[0].src} 1200w"`));
  assert.match((await site.request('GET', '/galerie')).text, /Balayage miel sur cheveux longs/);

  // Supprimer une photo de la liste efface aussi ses fichiers.
  const fewer = await site.call('PUT', '/api/salon/settings', { photos: { gallery: [gallery[1]], hero: gallery[0].src } });
  assert.equal(fewer.status, 200);
  assert.equal(fewer.json.photos.hero, gallery[1].src, 'une photo retirée ne peut plus être à la une');
  assert.equal(fewer.json.photos.second, '');
  assert.deepEqual(fs.readdirSync(media), [path.basename(gallery[1].src)]);
  assert.equal((await site.request('GET', gallery[0].src)).status, 404);
});

test('photos : seules de vraies images, de taille raisonnable, sont acceptées', async t => {
  const site = await salon();
  t.after(site.stop);
  const send = body => site.call('POST', '/api/salon/photos', body);

  assert.equal((await send({})).status, 400);
  assert.equal((await send({ files: [{ data: Buffer.from('<?php echo 1; ?>').toString('base64') }] })).status, 400);
  assert.equal((await send({ files: [{ data: Buffer.from('<svg onload="alert(1)"/>').toString('base64') }] })).status, 400);
  assert.equal((await send(upload(jpeg(200, 200)))).status, 400, 'trop petite');
  assert.equal((await send(upload(jpeg(4000, 3000)))).status, 413, 'trop grande');
  assert.equal((await send(upload(jpeg(1200, 1600), jpeg(800, 800)))).status, 400, "la version réduite n'a pas la même forme");
  assert.equal((await send(upload(jpeg(1200, 1600), jpeg(1200, 1600)))).status, 400);
  assert.equal((await send(upload(...Array.from({ length: 6 }, () => jpeg(1200, 1600))))).status, 400);
  assert.equal(fs.existsSync(path.join(site.config.dataDir, 'photos')) ? fs.readdirSync(path.join(site.config.dataDir, 'photos')).length : 0, 0, "rien n'a été écrit");

  // Un PNG n'est pas accepté tel quel (le navigateur convertit avant d'envoyer), un WebP l'est.
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 4, 0, 0, 0, 4, 0]), zlib.deflateSync(Buffer.alloc(64))]);
  assert.deepEqual(imageSize(png), { width: 1024, height: 1024 });
  assert.equal((await send(upload(png))).status, 400);
  const webp = Buffer.alloc(64);
  webp.write('RIFF', 0, 'latin1');
  webp.write('WEBPVP8X', 8, 'latin1');
  webp.writeUIntLE(1199, 24, 3);
  webp.writeUIntLE(899, 27, 3);
  const ok = await send(upload(webp));
  assert.equal(ok.status, 201);
  assert.deepEqual([ok.json.photo.width, ok.json.photo.height, ok.json.photo.ratio], [1200, 900, '4/3']);
  assert.match(ok.json.photo.src, /\.webp$/);
});

test('formats de photo : le plus proche des dimensions réelles', () => {
  assert.deepEqual([[1600, 900], [1200, 900], [1000, 1000], [1080, 1350], [1496, 2000], [900, 1600]].map(([w, h]) => nearestRatio(w, h)),
    ['16/9', '4/3', '1/1', '4/5', '3/4', '3/4']);
});

test('planning : la coiffeuse déplace un rendez-vous, le créneau quitté se libère', async t => {
  const site = await salon();
  t.after(site.stop);
  const book = body => site.request('POST', '/api/bookings', { body: { serviceId: 'moyen', date: TUESDAY, name: 'Léa Dupont', phone: '0612345678', ...body } });
  await book({ time: '10:00' });
  await book({ time: '15:00', phone: '0698765432', name: 'Camille Martin' });
  const [lea, camille] = (await site.call('GET', '/api/salon/data')).json.bookings;

  assert.equal((await site.request('PATCH', `/api/salon/bookings/${lea.id}`, { body: { date: TUESDAY, time: '11:00' } })).status, 401);
  assert.equal((await site.request('GET', `/api/salon/bookings/${lea.id}/slots?date=${TUESDAY}`)).status, 401);

  // Les créneaux proposés pour le déplacer : le sien est libre (il ne se gêne pas lui-même), celui de Camille non.
  const slots = (await site.call('GET', `/api/salon/bookings/${lea.id}/slots?date=${TUESDAY}`)).json.slots;
  const free = time => slots.find(s => s.time === time).available;
  assert.equal(free('10:00'), true);
  assert.equal(free('10:30'), true);
  assert.equal(free('14:30'), false);
  assert.equal(free('15:00'), false);

  const move = body => site.call('PATCH', `/api/salon/bookings/${lea.id}`, body);
  assert.equal((await move({ date: TUESDAY, time: '15:30' })).status, 409, 'chevauche le rendez-vous de Camille');
  assert.equal((await move({ date: TUESDAY, time: '12:00' })).status, 409, 'déborde sur la pause de midi');
  assert.equal((await move({ date: '2026-10-12', time: '10:00' })).status, 409, 'jour de fermeture');
  assert.equal((await move({ date: '2026-10-01', time: '10:00' })).status, 400, 'date passée');
  assert.equal((await move({ date: TUESDAY, time: 'midi' })).status, 400);
  assert.equal((await site.call('PATCH', '/api/salon/bookings/inconnu-123', { date: TUESDAY, time: '11:00' })).status, 404);

  const moved = await move({ date: SATURDAY, time: '09:30' });
  assert.equal(moved.status, 200);
  assert.deepEqual([moved.json.booking.date, moved.json.booking.time, moved.json.booking.start, moved.json.booking.name], [SATURDAY, '09:30', 570, 'Léa Dupont']);
  assert.equal(moved.json.booking.duration, 60, 'la durée ne change pas');

  const tuesday = (await site.request('GET', `/api/availability?service=moyen&date=${TUESDAY}`)).json.slots;
  assert.equal(tuesday.find(s => s.time === '10:00').available, true, "l'ancien créneau est de nouveau proposé");
  const saturday = (await site.request('GET', `/api/availability?service=moyen&date=${SATURDAY}`)).json.slots;
  assert.equal(saturday.find(s => s.time === '09:30').available, false);
  assert.equal(camille.time, '15:00');
});
