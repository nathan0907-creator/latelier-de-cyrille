'use strict';

/**
 * Notifications « push » du navigateur, sans bibliothèque : le serveur chiffre le message pour
 * l'appareil du client (RFC 8291) et prouve son identité au service de notification du
 * navigateur avec une paire de clés qui lui est propre (« VAPID », RFC 8292).
 */

const crypto = require('node:crypto');

const b64 = value => Buffer.from(value).toString('base64url');
const unb64 = text => Buffer.from(String(text), 'base64url');

/**
 * Les services de notification des navigateurs. Le serveur n'envoie rien ailleurs : sans cette
 * liste, n'importe qui pourrait lui faire appeler l'adresse de son choix.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge sur Android, Brave, Opera
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, // Firefox
  /^([a-z0-9-]+\.)*push\.apple\.com$/, // Safari (iPhone, iPad, Mac)
  /^([a-z0-9-]+\.)*notify\.windows\.com$/, // Edge sur Windows
];

function isPushEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.port && !url.username && !url.password
    && PUSH_HOSTS.some(pattern => pattern.test(url.hostname));
}

/** L'abonnement tel que l'envoie le navigateur : une adresse et deux clés de la bonne taille. */
function readSubscription(input) {
  const endpoint = typeof input?.endpoint === 'string' ? input.endpoint : '';
  const p256dh = typeof input?.keys?.p256dh === 'string' ? input.keys.p256dh : '';
  const auth = typeof input?.keys?.auth === 'string' ? input.keys.auth : '';
  if (endpoint.length > 1000 || !isPushEndpoint(endpoint)) return null;
  const point = unb64(p256dh);
  if (point.length !== 65 || point[0] !== 4 || unb64(auth).length !== 16) return null;
  return { endpoint, p256dh, auth };
}

/** Paire de clés du serveur ; la clé publique est celle que reçoit le navigateur en s'abonnant. */
function generateKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { publicKey: b64(Buffer.concat([Buffer.from([4]), unb64(jwk.x), unb64(jwk.y)])), privateKey: jwk.d };
}

/** La clé privée du serveur, sous la forme qu'acceptent pour signer Node.js comme Cloudflare. */
function signingKey(keys) {
  const point = unb64(keys.publicKey);
  return {
    key: { kty: 'EC', crv: 'P-256', x: b64(point.subarray(1, 33)), y: b64(point.subarray(33)), d: keys.privateKey },
    format: 'jwk',
    dsaEncoding: 'ieee-p1363',
  };
}

/** En-tête « Authorization » : un jeton signé, valable douze heures pour ce service de notification. */
function vapidHeader(endpoint, keys, subject = '', now = Date.now()) {
  const header = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    ...(subject && { sub: subject }),
  }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), signingKey(keys));
  return `vapid t=${header}.${claims}.${b64(signature)}, k=${keys.publicKey}`;
}

const hkdf = (secret, salt, info, length) => Buffer.from(crypto.hkdfSync('sha256', secret, salt, info, length));

/**
 * Chiffre un message pour un abonnement (codage « aes128gcm »). Seul le navigateur abonné peut
 * le lire : le service de notification qui le transporte n'en voit pas le contenu.
 * salt et localKey ne se fixent que dans les tests.
 */
function encrypt(payload, subscription, { salt = crypto.randomBytes(16), localKey = null } = {}) {
  const clientKey = unb64(subscription.p256dh);
  const ecdh = crypto.createECDH('prime256v1');
  if (localKey) ecdh.setPrivateKey(localKey);
  else ecdh.generateKeys();
  const serverKey = ecdh.getPublicKey();

  const secret = hkdf(ecdh.computeSecret(clientKey), unb64(subscription.auth),
    Buffer.concat([Buffer.from('WebPush: info\0'), clientKey, serverKey]), 32);
  const key = hkdf(secret, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(secret, salt, Buffer.from('Content-Encoding: nonce\0'), 12);

  // Un seul bloc : le message, puis l'octet 2 qui marque le dernier bloc.
  const cipher = crypto.createCipheriv('aes-128-gcm', key, nonce);
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = serverKey.length;
  return Buffer.concat([header, serverKey, sealed]);
}

/**
 * Envoie une notification. Renvoie { ok, status, gone } ; gone : l'abonnement n'existe plus
 * (notifications retirées, navigateur désinstallé), il faut l'oublier.
 */
async function sendPush(subscription, message, { keys, subject = '', ttl = 3600, request = fetch } = {}) {
  if (!isPushEndpoint(subscription.endpoint)) return { ok: false, status: 0, gone: true };
  const response = await request(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidHeader(subscription.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(Math.max(60, Math.round(ttl))),
      Urgency: 'high',
    },
    body: encrypt(JSON.stringify(message), subscription),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: response.ok, status: response.status, gone: response.status === 404 || response.status === 410 };
}

module.exports = { isPushEndpoint, readSubscription, generateKeys, vapidHeader, encrypt, sendPush };
