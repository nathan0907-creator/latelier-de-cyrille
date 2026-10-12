'use strict';

// La liste de contrôle du site, vérifiée à chaque lancement des tests : référencement,
// liens, images, HTTPS, fichiers privés, fréquentation, rappels.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startSite, BROWSER, TUESDAY } = require('./helpers');

const PUBLIC_PAGES = ['/', '/prestations', '/galerie', '/reservation', '/nous-trouver', '/mentions-legales', '/confidentialite', '/conditions'];

const attr = (html, pattern) => (pattern.exec(html) || [])[1] || '';
const decode = text => text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

test('référencement : chaque page a son titre, sa description, son adresse et un seul grand titre', async t => {
  const site = await startSite();
  t.after(site.stop);

  const titles = new Set();
  const descriptions = new Set();
  for (const path of PUBLIC_PAGES) {
    const { text, status } = await site.request('GET', path);
    assert.equal(status, 200, path);
    const title = decode(attr(text, /<title>([^<]*)<\/title>/));
    const description = decode(attr(text, /<meta name="description" content="([^"]*)"/));
    assert.ok(title.length >= 20 && title.length <= 65, `${path} : titre de ${title.length} caractères (« ${title} »)`);
    assert.ok(description.length >= 70 && description.length <= 165, `${path} : description de ${description.length} caractères`);
    assert.ok(!titles.has(title), `${path} : titre en double`);
    assert.ok(!descriptions.has(description), `${path} : description en double`);
    titles.add(title);
    descriptions.add(description);

    assert.equal(attr(text, /<link rel="canonical" href="([^"]*)"/), `${site.origin}${path}`, `${path} : adresse canonique`);
    assert.match(text, /<html lang="fr">/);
    assert.match(text, /<meta name="robots" content="index, follow/);
    assert.match(text, /<meta name="viewport" content="width=device-width, initial-scale=1/);
    assert.equal((text.match(/<h1[\s>]/g) || []).length, 1, `${path} : un seul <h1>`);

    // Partage sur les réseaux : titre, description et image en adresse complète.
    assert.equal(decode(attr(text, /<meta property="og:title" content="([^"]*)"/)), title);
    assert.equal(attr(text, /<meta property="og:image" content="([^"]*)"/), `${site.origin}/img/partage.jpg`);
    assert.match(text, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(text, /<link rel="icon" href="\/favicon\.ico"/);
    assert.match(text, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
  }

  const home = (await site.request('GET', '/')).text;
  assert.match(decode(attr(home, /<title>([^<]*)<\/title>/)), /^Test à Paris · Salon de test$|à Paris · Salon de test$/);
});

test('référencement : données structurées du salon, plan du site, robots.txt', async t => {
  const site = await startSite();
  t.after(site.stop);

  const read = async path => JSON.parse(attr((await site.request('GET', path)).text, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/))['@graph'];
  const [salon, website] = await read('/');
  assert.equal(salon['@type'], 'HairSalon');
  assert.equal(salon.name, 'Salon de test');
  assert.equal(salon.telephone, '+33199000000');
  assert.equal(salon.address.addressLocality, 'Paris');
  assert.equal(salon.url, `${site.origin}/`);
  assert.equal(salon.priceRange, '20 € – 90 €');
  assert.equal(salon.potentialAction.target.urlTemplate, `${site.origin}/reservation`);
  assert.equal(salon.openingHoursSpecification.length, 9, 'neuf plages horaires dans la semaine de test');
  assert.equal(salon.hasOfferCatalog.itemListElement[0].itemListElement.length, 3, 'la carte est jointe à la une');
  assert.equal(website['@type'], 'WebSite');

  const [, crumbs] = await read('/nous-trouver');
  assert.equal(crumbs['@type'], 'BreadcrumbList');
  assert.equal(crumbs.itemListElement[1].item, `${site.origin}/nous-trouver`);

  const robots = await site.request('GET', '/robots.txt');
  assert.match(robots.headers['content-type'], /text\/plain/);
  assert.match(robots.text, /^User-agent: \*\nAllow: \/\nDisallow: \/salon\nDisallow: \/api\/\n\nSitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml\n$/);

  const sitemap = await site.request('GET', '/sitemap.xml');
  assert.match(sitemap.headers['content-type'], /application\/xml/);
  const listed = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g)].map(m => m[1].replace(site.origin, ''));
  assert.deepEqual(listed, ['/', '/prestations', '/galerie', '/nous-trouver', '/reservation']);

  // L'espace de la coiffeuse et les pages introuvables restent hors des moteurs de recherche.
  const salonPage = await site.request('GET', '/salon');
  assert.match(salonPage.headers['x-robots-tag'], /noindex/);
  assert.match(salonPage.text, /<meta name="robots" content="noindex, nofollow">/);
  const missing = await site.request('GET', '/page-qui-n-existe-pas');
  assert.equal(missing.status, 404);
  assert.match(missing.text, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(missing.text, /href="\/reservation"/, 'la page 404 ramène vers le site');
});

test('liens : aucune adresse interne cassée, aucune ancre dans le vide', async t => {
  const site = await startSite();
  t.after(site.stop);

  const pages = new Map();
  const queue = ['/'];
  const assets = new Set();
  const anchors = [];
  while (queue.length) {
    const path = queue.shift();
    if (pages.has(path)) continue;
    const res = await site.request('GET', path);
    assert.equal(res.status, 200, `page ${path}`);
    pages.set(path, res.text);
    for (const [, raw] of res.text.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      const target = decode(raw);
      const [beforeHash, hash] = target.split('#');
      const pathname = beforeHash.split('?')[0];
      if (/\.[a-z0-9]+$/i.test(pathname)) assets.add(beforeHash);
      else if (pathname !== '/salon') {
        queue.push(pathname);
        if (hash) anchors.push({ from: path, pathname, hash });
      }
    }
    for (const [, set] of res.text.matchAll(/(?:srcset|imagesrcset)="([^"]*)"/g)) {
      for (const candidate of set.split(',')) assets.add(candidate.trim().split(' ')[0]);
    }
  }
  assert.ok(pages.size >= 8, `${pages.size} pages parcourues`);
  for (const file of assets) {
    if (!file.startsWith('/')) continue;
    assert.equal((await site.request('GET', file)).status, 200, `fichier ${file}`);
  }
  for (const { from, pathname, hash } of anchors) {
    assert.match(pages.get(pathname), new RegExp(`id="${hash}"`), `${from} → ${pathname}#${hash}`);
  }
  // Les liens vers l'extérieur s'ouvrent à part, sans donner la main sur la page d'origine.
  for (const [path, html] of pages) {
    for (const [tag] of html.matchAll(/<a [^>]*href="https?:\/\/[^>]*>/g)) {
      assert.match(tag, /target="_blank" rel="noopener"/, `${path} : ${tag}`);
    }
  }
});

test('images : toutes décrites, la grande photo de la une chargée en priorité', async t => {
  const site = await startSite();
  t.after(site.stop);
  for (const path of PUBLIC_PAGES) {
    const { text } = await site.request('GET', path);
    for (const [tag] of text.matchAll(/<img\b[^>]*>/g)) {
      assert.match(tag, /\balt="/, `${path} : image sans texte alternatif : ${tag.slice(0, 80)}`);
      // Seule la visionneuse de la galerie a une image vide au départ (remplie à l'ouverture).
      if (!/data-lightbox-image/.test(tag)) assert.doesNotMatch(tag, /\balt=""/, `${path} : texte alternatif vide`);
    }
  }
  const home = (await site.request('GET', '/')).text;
  assert.match(home, /<img[^>]+fetchpriority="high"/);
  assert.match(home, /<link rel="preload" as="image"[^>]+fetchpriority="high">/);
});

test('vitesse : styles et scripts versionnés gardés un an, pages compressées', async t => {
  const site = await startSite();
  t.after(site.stop);
  const home = await site.request('GET', '/', { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(home.headers['content-encoding'], 'br');
  const css = attr((await site.request('GET', '/')).text, /<link rel="stylesheet" href="(\/css\/base\.css\?v=[\w-]+)"/);
  assert.ok(css, 'la feuille de style porte une empreinte');
  assert.equal((await site.request('GET', css)).headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal((await site.request('GET', '/css/base.css')).headers['cache-control'], 'no-cache');
  assert.equal((await site.request('GET', '/sw.js')).headers['cache-control'], 'no-cache', 'le fichier des notifications se met à jour tout de suite');
  assert.match((await site.request('GET', '/img/partage.jpg')).headers['content-type'], /image\/jpeg/);
});

test('HTTPS : derrière le serveur frontal, tout est renvoyé vers https et vers une seule adresse', async t => {
  const local = await startSite();
  t.after(local.stop);
  assert.equal((await local.request('GET', '/', { headers: { 'X-Forwarded-Proto': 'http' } })).status, 200, 'en local, rien ne change');

  const online = await startSite({ overrides: { siteUrl: 'https://www.salon-de-test.fr' }, env: { TRUST_PROXY: '1' } });
  t.after(online.stop);
  const viaHttp = await online.request('GET', '/prestations?x=1', { headers: { Host: 'www.salon-de-test.fr', 'X-Forwarded-Proto': 'http' } });
  assert.equal(viaHttp.status, 308);
  assert.equal(viaHttp.headers.location, 'https://www.salon-de-test.fr/prestations?x=1');
  const bareDomain = await online.request('GET', '/reservation', { headers: { Host: 'salon-de-test.fr', 'X-Forwarded-Proto': 'https' } });
  assert.equal(bareDomain.status, 308);
  assert.equal(bareDomain.headers.location, 'https://www.salon-de-test.fr/reservation');

  assert.equal((await online.request('GET', '/api/site')).status, 200, "une requête locale (surveillance, lanceur) n'est pas redirigée");
  const ok = await online.request('GET', '/', { headers: { Host: 'www.salon-de-test.fr', 'X-Forwarded-Proto': 'https' } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers['strict-transport-security'], /max-age=31536000/);
  assert.match(ok.headers['content-security-policy'], /upgrade-insecure-requests/);
  assert.equal(attr(ok.text, /<link rel="canonical" href="([^"]*)"/), 'https://www.salon-de-test.fr/');
  assert.match((await online.request('GET', '/robots.txt', { headers: { Host: 'www.salon-de-test.fr', 'X-Forwarded-Proto': 'https' } })).text, /Sitemap: https:\/\/www\.salon-de-test\.fr\/sitemap\.xml/);
});

test('rien de privé ne sort : ni fichiers du serveur, ni données, ni clés dans les pages', async t => {
  const site = await startSite();
  t.after(site.stop);
  await site.request('POST', '/api/bookings', { body: { serviceId: 'court', date: TUESDAY, time: '10:00', name: 'Léa Dupont', phone: '0612345678' } });

  for (const path of ['/salon.config.js', '/server.js', '/package.json', '/src/app.js', '/data/rendez-vous.json', '/data/rappels.json', '/data/compte.json',
    '/.git/config', '/.env', '/..%2fsalon.config.js', '/css/..%2f..%2fpackage.json', '/test/helpers.js']) {
    assert.equal((await site.request('GET', path)).status, 404, path);
  }
  for (const path of ['/api/salon/data', '/api/salon/stats', '/api/salon/events']) {
    assert.equal((await site.request('GET', path)).status, 401, path);
  }

  // Les pages ne contiennent que la clé publique des notifications, jamais la clé privée ni le secret.
  const identity = site.store.reminders.identity();
  const page = (await site.request('GET', '/reservation')).text;
  assert.ok(page.includes(identity.publicKey));
  assert.ok(!page.includes(identity.privateKey));
  assert.ok(!page.includes(identity.secret));
  assert.ok(!page.includes('0612345678') && !page.includes('06 12 34 56 78'), 'aucun numéro de client dans une page publique');
});

test('fréquentation : visites comptées sans cookie, robots et refus de suivi écartés', async t => {
  const site = await startSite();
  t.after(site.stop);
  const visit = (path, headers = {}) => site.request('GET', path, { headers: { 'User-Agent': BROWSER, ...headers } });

  const first = await visit('/', { Referer: 'https://www.google.fr/search?q=coiffeuse' });
  assert.equal(first.headers['set-cookie'], undefined, 'aucun cookie déposé chez le visiteur');
  await visit('/prestations', { Referer: `${site.origin}/` });
  await visit('/reservation');
  await site.request('GET', '/', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } });
  await visit('/', { DNT: '1' });
  await visit('/', { 'Sec-GPC': '1' });
  await site.request('GET', '/');
  await visit('/page-inconnue');
  await visit('/css/base.css');
  await site.request('POST', '/api/bookings', { body: { serviceId: 'court', date: TUESDAY, time: '11:00', name: 'Léa Dupont', phone: '0612345678' } });

  const summary = site.app.stats.summary(7);
  assert.deepEqual(summary.totals, { views: 3, visitors: 1, bookings: 1 });
  assert.deepEqual(summary.pages.map(p => p.name).sort(), ['/', '/prestations', '/reservation']);
  assert.deepEqual(summary.sources, [{ name: 'google.fr', count: 1 }]);
  assert.deepEqual(summary.devices, { mobile: 1, desktop: 0 });
  assert.equal(summary.days.length, 7);

  // Rien de personnel sur le disque : des compteurs, pas d'adresse ni d'empreinte.
  site.app.stats.save();
  const saved = JSON.stringify(site.store.stats.days());
  assert.ok(!saved.includes('127.0.0.1') && !saved.includes('Pixel'));
});

test('rappels : la réservation donne sa référence ; le serveur refuse les abonnements douteux', async t => {
  const site = await startSite();
  t.after(site.stop);
  const created = await site.request('POST', '/api/bookings', { body: { serviceId: 'court', date: TUESDAY, time: '15:00', name: 'Léa Dupont', phone: '0612345678' } });
  assert.equal(created.status, 201);
  assert.match(created.json.reminder.ref, /^[\w-]+\.[\w-]+$/);
  assert.deepEqual(created.json.reminder.when, ['la veille', '2 h avant']);
  assert.equal(created.json.booking.id, undefined, "l'identifiant interne ne sort que dans la référence signée");

  const subscription = endpoint => ({ endpoint, keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'), auth: Buffer.alloc(16, 9).toString('base64url') } });
  const send = (body, method = 'POST') => site.request(method, '/api/reminders', { body });

  assert.equal((await send({ ref: 'faux.faux', subscription: subscription('https://fcm.googleapis.com/fcm/send/a') })).status, 404);
  assert.equal((await send({ ref: created.json.reminder.ref, subscription: subscription('http://127.0.0.1:9/interne') })).status, 400);
  assert.equal((await send({ ref: created.json.reminder.ref, subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/a' } })).status, 400);
  assert.equal((await site.request('POST', '/api/reminders', { body: { ref: created.json.reminder.ref }, sameOrigin: false })).status, 403, "refusé depuis un autre site");

  const ok = await send({ ref: created.json.reminder.ref, subscription: subscription('https://fcm.googleapis.com/fcm/send/a') });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.json, { ok: true, when: ['la veille', '2 h avant'] });
  assert.equal(site.store.reminders.all().length, 1);

  const removed = await send({ ref: created.json.reminder.ref, endpoint: 'https://fcm.googleapis.com/fcm/send/a' }, 'DELETE');
  assert.equal(removed.status, 200);
  assert.equal(site.store.reminders.all().length, 0);
});

test('règles du salon : affichées quand elles sont renseignées, absentes sinon', async t => {
  const plain = await startSite();
  t.after(plain.stop);
  assert.doesNotMatch((await plain.request('GET', '/')).text, /house-rule/);

  const strict = await startSite({ overrides: { booking: { slotStep: 30, appointmentOnly: 'Uniquement sur rendez-vous', noShow: 'Un seul rendez-vous non honoré et la personne ne sera pas reprise.' } } });
  t.after(strict.stop);
  for (const path of ['/', '/prestations', '/reservation', '/conditions']) {
    assert.match((await strict.request('GET', path)).text, /Un seul rendez-vous non honoré et la personne ne sera pas reprise\./, path);
  }
  const home = (await strict.request('GET', '/')).text;
  assert.match(home, /<p class="house-rule"[^>]*>\s*<strong>Uniquement sur rendez-vous<\/strong>/);
  assert.doesNotMatch(home, /règle sur place|régler sur place/i);
});
