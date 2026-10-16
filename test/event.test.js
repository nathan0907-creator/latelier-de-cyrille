'use strict';

// L'événement du mois : préparé depuis l'espace salon, affiché sur la une, sur sa page et dans
// l'encart d'arrivée ; caché tant qu'il est masqué, et après son dernier jour.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startSite, TUESDAY } = require('./helpers');
const { readLink } = require('../src/salon-event');
const { richText } = require('../src/views/event');

async function salon() {
  const site = await startSite();
  const password = crypto.randomBytes(12).toString('base64url');
  const setup = await site.request('POST', '/api/salon/setup', { body: { code: site.app.auth.setupCode(), username: 'cyrille', password } });
  const cookie = setup.headers['set-cookie'][0].split(';')[0];
  const call = (method, target, body) => site.request(method, target, { headers: { Cookie: cookie }, ...(body !== undefined && { body }) });
  return { ...site, call };
}

function jpeg(width, height) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]), sof, crypto.randomBytes(400), Buffer.from([0xff, 0xd9])]);
}
const upload = image => ({ files: [{ data: image.toString('base64') }] });

const halloween = (extra = {}) => ({
  enabled: true, popup: true, theme: 'soiree', kicker: '', title: 'Soirée _Halloween_', date: TUESDAY, endDate: '', time: 'de 18h à 22h',
  summary: 'Coiffures de sorcière et bonbons.', text: 'Venez **déguisés** !\n- Maquillage\n- Bonbons', images: [], buttonLabel: '', buttonLink: '', booking: true, ...extra,
});

test("événement : réservé à la coiffeuse, affiché sur la une, sa page et l'encart", async t => {
  const site = await salon();
  t.after(site.stop);
  assert.equal((await site.request('GET', '/api/salon/event')).status, 401);
  assert.equal((await site.request('PUT', '/api/salon/event', { body: halloween() })).status, 401);
  assert.equal((await site.request('GET', '/evenement')).status, 404, "pas d'événement : pas de page");
  assert.doesNotMatch((await site.request('GET', '/')).text, /data-event-pop/);

  const saved = await site.call('PUT', '/api/salon/event', halloween());
  assert.equal(saved.status, 200);
  assert.equal(saved.json.kicker, "L'événement du mois", 'surtitre par défaut');
  assert.equal(saved.json.buttonLabel, "Plus d'infos", 'bouton par défaut');

  const home = (await site.request('GET', '/')).text;
  assert.match(home, /class="container section event-feature"/);
  assert.match(home, /data-event-pop data-event-rev="[^"]+"/);
  assert.match(home, /class="event-pop event--soiree"/);
  assert.match(home, /<em>Halloween<\/em>/, 'le mot entouré de _ est en écriture');
  assert.match(home, /href="\/evenement"/, "le bouton d'infos mène à la page");
  assert.match(home, /<b>Soirée Halloween · Mardi 13 octobre · de 18h à 22h<\/b>/, 'annoncé dans le bandeau, sans les marques');

  const page = await site.request('GET', '/evenement');
  assert.equal(page.status, 200);
  assert.match(page.text, /<strong>déguisés<\/strong>/);
  assert.match(page.text, /<ul><li>Maquillage<\/li><li>Bonbons<\/li><\/ul>/);
  assert.match(page.text, /"@type":"Event","@id":"[^"]+","name":"Soirée Halloween"/, 'signalé aux moteurs de recherche');
  assert.match(page.text, /<title>Soirée Halloween · Salon de test<\/title>/);
  assert.match(page.text, /href="\/reservation"/);
  assert.doesNotMatch(page.text, /data-event-pop/, "pas d'encart sur sa propre page");
  assert.match((await site.request('GET', '/sitemap.xml')).text, /\/evenement<\/loc>/);

  // Lien externe pour le bouton d'infos.
  await site.call('PUT', '/api/salon/event', halloween({ buttonLink: 'facebook.com/events/123', buttonLabel: 'Sur Facebook' }));
  assert.match((await site.request('GET', '/')).text, /href="https:\/\/facebook\.com\/events\/123"\s+target="_blank" rel="noopener"/);

  // Masqué : plus rien côté public, mais la coiffeuse garde l'aperçu.
  await site.call('PUT', '/api/salon/event', halloween({ enabled: false }));
  assert.doesNotMatch((await site.request('GET', '/')).text, /event-feature|data-event-pop/);
  assert.equal((await site.request('GET', '/evenement')).status, 404);
  const preview = await site.call('GET', '/evenement');
  assert.equal(preview.status, 200);
  assert.match(preview.text, /Aperçu/);
  assert.match(preview.text, /noindex/);
  assert.doesNotMatch((await site.request('GET', '/sitemap.xml')).text, /\/evenement</);
});

test('événement : passé, il disparaît tout seul ; les saisies douteuses sont refusées', async t => {
  const site = await salon();
  t.after(site.stop);
  const past = await site.call('PUT', '/api/salon/event', halloween({ date: '2026-10-01', endDate: '2026-10-05' }));
  assert.equal(past.json.over, true);
  assert.doesNotMatch((await site.request('GET', '/')).text, /event-feature/);
  // Sans date, il reste jusqu'à ce qu'elle le masque.
  await site.call('PUT', '/api/salon/event', halloween({ date: '' }));
  assert.match((await site.request('GET', '/')).text, /event-feature/);

  for (const [bad, why] of [
    [{ title: '' }, /titre/],
    [{ date: '2026-02-30' }, /date/],
    [{ date: TUESDAY, endDate: '2026-10-01' }, /fin/],
    [{ date: '', endDate: TUESDAY }, /début/],
    [{ buttonLink: 'javascript:alert(1)' }, /adresse/],
    [{ images: [{ src: '/media/inconnue.jpg', alt: 'x' }] }, /introuvable/],
    [{ text: 'x'.repeat(4001) }, /trop long/],
  ]) {
    const res = await site.call('PUT', '/api/salon/event', halloween(bad));
    assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 60));
    assert.match(res.json.error, why);
  }
});

test('événement : texte échappé, liens acceptés avec prudence', () => {
  assert.equal(String(richText('<script>alert(1)</script> **gras** et *italique*')), '<p>&lt;script&gt;alert(1)&lt;/script&gt; <strong>gras</strong> et <em>italique</em></p>');
  assert.equal(String(richText('Un _mot_ en écriture, mais pas mon_adresse_mail')), '<p>Un <em class="script">mot</em> en écriture, mais pas mon_adresse_mail</p>');
  assert.equal(String(richText('a\n\n- un\n- deux\nb')), '<p>a</p><ul><li>un</li><li>deux</li></ul><p>b</p>');
  assert.equal(readLink(''), '');
  assert.equal(readLink('/reservation'), '/reservation');
  assert.equal(readLink('www.facebook.com/salon'), 'https://www.facebook.com/salon');
  assert.equal(readLink('tel:0745075016'), 'tel:0745075016');
  for (const bad of ['javascript:alert(1)', '//ailleurs.example', 'data:text/html,x', 'ftp://x.example', 'pas une adresse']) assert.equal(readLink(bad), null, bad);
});

test("événement : ses photos sont gardées quand on réorganise la galerie, effacées quand on les retire", async t => {
  const site = await salon();
  t.after(site.stop);
  const { photo } = (await site.call('POST', '/api/salon/photos', upload(jpeg(1200, 900)))).json;
  assert.equal((await site.call('PUT', '/api/salon/event', halloween({ images: [{ src: photo.src, alt: '' }] }))).status, 400, 'description obligatoire');
  const saved = await site.call('PUT', '/api/salon/event', halloween({ images: [{ src: photo.src, alt: 'Coiffure de sorcière' }] }));
  assert.equal(saved.status, 200);
  assert.equal(saved.json.images[0].ratio, '4/3');

  // La galerie est réenregistrée : la photo de l'événement ne doit pas partir avec les inutiles.
  const salonPhoto = (await site.call('POST', '/api/salon/photos', upload(jpeg(1200, 1600)))).json.photo;
  assert.equal((await site.call('PUT', '/api/salon/settings', { photos: { hero: salonPhoto.src, gallery: [{ src: salonPhoto.src, alt: 'Le salon' }] } })).status, 200);
  assert.equal((await site.request('GET', photo.src)).status, 200);
  assert.match((await site.request('GET', '/evenement')).text, new RegExp(photo.src.replace(/[.]/g, '\\.')));

  await site.call('PUT', '/api/salon/event', halloween({ images: [] }));
  assert.equal((await site.request('GET', photo.src)).status, 404, 'retirée : effacée');
});
