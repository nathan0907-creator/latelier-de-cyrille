'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { isPushEndpoint, readSubscription, generateKeys, vapidHeader, encrypt } = require('../src/push');
const { createReminders, leadLabel } = require('../src/reminders');
const { createBookings } = require('../src/bookings');
const { testConfig, testStore, MONDAY, TUESDAY } = require('./helpers');

const unb64 = text => Buffer.from(text, 'base64url');

/** Ce que fait le navigateur à la réception : il déchiffre avec sa clé privée (RFC 8291). */
function decrypt(body, { privateKey, auth }) {
  const salt = body.subarray(0, 16);
  const keyLength = body[20];
  const serverKey = body.subarray(21, 21 + keyLength);
  const sealed = body.subarray(21 + keyLength);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(privateKey);
  const hkdf = (secret, s, info, length) => Buffer.from(crypto.hkdfSync('sha256', secret, s, info, length));
  const secret = hkdf(ecdh.computeSecret(serverKey), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverKey]), 32);
  const decipher = crypto.createDecipheriv('aes-128-gcm', hkdf(secret, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hkdf(secret, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, 'marque de dernier bloc');
  return plain.subarray(0, -1).toString('utf8');
}

/** Un abonnement comme en fabrique un navigateur, avec de quoi déchiffrer côté test. */
function browser(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    privateKey: ecdh.getPrivateKey(),
    auth,
    subscription: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
  };
}

test('chiffrement : conforme à l\'exemple de la RFC 8291', () => {
  const body = encrypt('When I grow up, I want to be a watermelon', {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  }, {
    salt: unb64('DGv6ra1nlYgDCS1FRnbzlw'),
    localKey: unb64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
  });
  assert.equal(body.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('chiffrement : le navigateur abonné retrouve le message, et lui seul', () => {
  const client = browser();
  const message = JSON.stringify({ title: 'Rendez-vous demain à 14h30', body: 'Coupe · L\'atelier, été comme hiver' });
  const body = encrypt(message, readSubscription(client.subscription));
  assert.equal(decrypt(body, client), message);
  assert.notDeepEqual(body, encrypt(message, readSubscription(client.subscription)), 'jamais deux fois le même chiffré');
  assert.throws(() => decrypt(body, { privateKey: browser().privateKey, auth: client.auth }));
});

test('identité du serveur : jeton signé, vérifiable avec la clé publique', () => {
  const keys = generateKeys();
  const now = Date.UTC(2026, 9, 12, 8, 0);
  const header = vapidHeader('https://updates.push.services.mozilla.com/wpush/v2/xyz', keys, 'mailto:salon@example.fr', now);
  const { t, k } = /^vapid t=(?<t>[\w.-]+), k=(?<k>[\w-]+)$/.exec(header).groups;
  assert.equal(k, keys.publicKey);
  const [head, claims, signature] = t.split('.');
  assert.deepEqual(JSON.parse(unb64(head)), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(unb64(claims)), { aud: 'https://updates.push.services.mozilla.com', exp: now / 1000 + 12 * 3600, sub: 'mailto:salon@example.fr' });
  const point = unb64(keys.publicKey);
  const publicKey = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
  assert.ok(crypto.verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, unb64(signature)));
});

test('adresses de notification : seuls les services des navigateurs sont acceptés', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGuQyavXutnMH',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ]) assert.equal(isPushEndpoint(ok), true, ok);
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://fcm.googleapis.com.exemple.fr/fcm/send/abc',
    'https://exemple.fr/?https://fcm.googleapis.com',
    'https://admin@fcm.googleapis.com/x',
    'https://localhost/x', 'https://127.0.0.1/x', 'https://192.168.1.10/x', 'https://[::1]/x',
    'file:///etc/passwd', 'pas une adresse', '',
  ]) assert.equal(isPushEndpoint(bad), false, bad);

  const client = browser();
  assert.ok(readSubscription(client.subscription));
  assert.equal(readSubscription({ ...client.subscription, endpoint: 'https://exemple.fr/push' }), null);
  assert.equal(readSubscription({ endpoint: client.subscription.endpoint, keys: { p256dh: 'abc', auth: 'abc' } }), null);
  assert.equal(readSubscription(null), null);
});

/** Un salon avec une horloge qu'on avance à la main, et un facteur qui note ce qu'il porte. */
function setup() {
  const config = testConfig();
  const store = testStore(config);
  const now = { date: MONDAY, minutes: 600 }; // lundi 12 octobre, 10h
  const clock = () => ({ ...now });
  const sent = [];
  let reply = { ok: true, status: 201, gone: false };
  const reminders = createReminders({
    config, store, clock,
    send: async (subscription, message, options) => {
      sent.push({ endpoint: subscription.endpoint, message, options });
      return reply;
    },
  });
  const bookings = createBookings({ config, store, clock });
  const book = (extra = {}) => bookings.create({ serviceId: 'court', date: TUESDAY, time: '14:30', name: 'Léa Dupont', phone: '0612345678', ...extra }).booking;
  return { config, store, reminders, bookings, book, now, sent, answer: next => { reply = next; } };
}

test('rappels : le site en ligne sait quand se réveiller pour le prochain', async () => {
  const salon = setup();
  assert.equal(salon.reminders.nextDue(), null, 'aucun rappel demandé');
  const booking = salon.book(); // mardi 14h30
  salon.reminders.subscribe(salon.reminders.refFor(booking).ref, browser().subscription);
  assert.equal(salon.reminders.nextDue(), 270, 'lundi 10h : la veille part dans 4 h 30');

  salon.now.minutes = 14 * 60 + 30;
  assert.equal(salon.reminders.nextDue(), 0);
  await salon.reminders.tick();
  assert.equal(salon.reminders.nextDue(), 22 * 60, 'puis 2 h avant, mardi 12h30');

  Object.assign(salon.now, { date: TUESDAY, minutes: 12 * 60 + 30 });
  salon.answer({ ok: false, status: 503, gone: false });
  await salon.reminders.tick();
  assert.equal(salon.reminders.nextDue(), 0, 'envoi manqué : on réessaie tout de suite');
});

test('rappels : la veille et 2 h avant, une seule fois chacun', async () => {
  const salon = setup();
  const booking = salon.book(); // mardi 14h30, réservé le lundi à 10h
  const { ref, when } = salon.reminders.refFor(booking);
  assert.deepEqual(when, ['la veille', '2 h avant']);
  assert.deepEqual(salon.reminders.subscribe(ref, browser().subscription), { ok: true, when: ['la veille', '2 h avant'] });

  assert.equal(await salon.reminders.tick(), 0, 'lundi 10h : trop tôt');
  salon.now.minutes = 14 * 60 + 29;
  assert.equal(await salon.reminders.tick(), 0, 'lundi 14h29 : une minute trop tôt');

  salon.now.minutes = 14 * 60 + 30;
  assert.equal(await salon.reminders.tick(), 1, 'lundi 14h30 : la veille');
  assert.equal(salon.sent[0].message.title, 'Rendez-vous demain à 14h30');
  assert.match(salon.sent[0].message.body, /^Court · Salon de test, 1 rue du Test, Paris\. Vous venez \? Confirmez, ou annulez si vous avez un empêchement\.$/);
  assert.equal(salon.sent[0].message.ref, ref, 'les boutons « Je viens » et « Annuler » agissent sur ce rendez-vous');
  assert.equal(salon.sent[0].message.actions, true);
  assert.equal(salon.sent[0].options.keys.publicKey, salon.reminders.publicKey);
  assert.equal(await salon.reminders.tick(), 0, 'pas de doublon');

  Object.assign(salon.now, { date: TUESDAY, minutes: 12 * 60 + 30 });
  assert.equal(await salon.reminders.tick(), 1, 'mardi 12h30 : deux heures avant');
  assert.equal(salon.sent[1].message.title, "Rendez-vous aujourd'hui à 14h30");
  assert.equal(salon.store.reminders.all().length, 0, "l'abonnement est oublié après le dernier rappel");
  assert.equal(await salon.reminders.tick(), 0);
});

test('rappels : seule la bonne référence ouvre le droit au rappel', () => {
  const salon = setup();
  const booking = salon.book();
  const other = salon.book({ time: '16:00', phone: '0698765432' });
  const { ref } = salon.reminders.refFor(booking);
  const client = browser();
  const forged = `${other.id}.${ref.split('.')[1]}`;
  for (const bad of [forged, booking.id, `${booking.id}.`, 'x.y', '', null]) {
    assert.equal(salon.reminders.subscribe(bad, client.subscription).status, 404, String(bad));
  }
  assert.equal(salon.reminders.subscribe(ref, { ...client.subscription, endpoint: 'https://exemple.fr/push' }).status, 400);
  assert.equal(salon.store.reminders.all().length, 0);

  // Le même appareil qui redemande ne crée pas de doublon ; quatre appareils, c'est trop.
  salon.reminders.subscribe(ref, client.subscription);
  salon.reminders.subscribe(ref, client.subscription);
  assert.equal(salon.store.reminders.all().length, 1);
  salon.reminders.subscribe(ref, browser('https://fcm.googleapis.com/fcm/send/2').subscription);
  salon.reminders.subscribe(ref, browser('https://fcm.googleapis.com/fcm/send/3').subscription);
  assert.equal(salon.reminders.subscribe(ref, browser('https://fcm.googleapis.com/fcm/send/4').subscription).status, 429);

  assert.deepEqual(salon.reminders.unsubscribe(ref, client.subscription.endpoint), { ok: true });
  assert.equal(salon.store.reminders.all().length, 2);
});

test('rappels : rendez-vous proche, annulé, supprimé, abonnement disparu', async () => {
  const salon = setup();

  // Réservé pour le jour même : il ne reste que le rappel des deux heures… ou aucun.
  Object.assign(salon.now, { date: TUESDAY, minutes: 9 * 60 });
  const soon = salon.book({ time: '14:30' });
  assert.deepEqual(salon.reminders.refFor(soon).when, ['2 h avant']);
  const tooClose = salon.book({ time: '11:00', phone: '0698765432' });
  assert.deepEqual(salon.reminders.refFor(tooClose).when, []);
  // Trop proche pour un rappel, mais l'abonnement est accepté : il sert à dire que le salon a confirmé.
  assert.deepEqual(salon.reminders.subscribe(salon.reminders.refFor(tooClose).ref, browser().subscription), { ok: true, when: [] });
  salon.now.minutes = 11 * 60;
  assert.equal(salon.reminders.subscribe(salon.reminders.refFor(tooClose).ref, browser().subscription).status, 409, 'rendez-vous commencé');
  assert.equal(await salon.reminders.tick(), 0);
  salon.now.minutes = 9 * 60;

  // Annulé par le salon : plus aucun message, l'abonnement est effacé.
  salon.reminders.subscribe(salon.reminders.refFor(soon).ref, browser().subscription);
  salon.bookings.setStatus(soon.id, 'cancelled');
  salon.now.minutes = 12 * 60 + 30;
  assert.equal(await salon.reminders.tick(), 0);
  assert.equal(salon.store.reminders.all().length, 0);
  assert.equal(salon.reminders.subscribe(salon.reminders.refFor(soon).ref, browser().subscription).status, 404);

  // Le navigateur a retiré l'autorisation : le service répond « disparu », on oublie.
  Object.assign(salon.now, { date: MONDAY, minutes: 600 });
  const later = salon.book({ date: '2026-10-15', time: '10:00' });
  salon.reminders.subscribe(salon.reminders.refFor(later).ref, browser().subscription);
  salon.answer({ ok: false, status: 410, gone: true });
  Object.assign(salon.now, { date: '2026-10-14', minutes: 600 });
  assert.equal(await salon.reminders.tick(), 0);
  assert.equal(salon.store.reminders.all().length, 0);
});

test('rappels : après un arrêt du site, un seul message ; une panne passagère est retentée', async () => {
  const salon = setup();
  const booking = salon.book();
  salon.reminders.subscribe(salon.reminders.refFor(booking).ref, browser().subscription);

  // Le site redémarre une heure avant le rendez-vous : les deux échéances sont dépassées.
  Object.assign(salon.now, { date: TUESDAY, minutes: 13 * 60 + 30 });
  salon.answer({ ok: false, status: 503, gone: false });
  assert.equal(await salon.reminders.tick(), 0);
  assert.equal(salon.store.reminders.all().length, 1, 'on réessaiera');
  salon.answer({ ok: true, status: 201, gone: false });
  assert.equal(await salon.reminders.tick(), 1);
  assert.equal(salon.sent.length, 2);
  assert.equal(salon.store.reminders.all().length, 0);
  assert.equal(await salon.reminders.tick(), 0);
});

test('rappels : les clés du serveur survivent à un redémarrage', () => {
  const salon = setup();
  const again = createReminders({ config: salon.config, store: testStore(salon.config), clock: () => ({ ...salon.now }) });
  assert.equal(again.publicKey, salon.reminders.publicKey);
  assert.equal(again.refFor(salon.book()).ref.split('.').length, 2);
});

test('libellés des échéances', () => {
  assert.deepEqual([1440, 2880, 120, 60, 45].map(leadLabel), ['la veille', '2 jours avant', '2 h avant', '1 h avant', '45 min avant']);
});
