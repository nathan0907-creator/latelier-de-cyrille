'use strict';

const { daysBetween, frTime, formatLong } = require('./time');

/**
 * Rappel par SMS la veille du rendez-vous, sans abonnement payant : les SMS partent d'un téléphone
 * Android du salon (celui de la coiffeuse, ou un vieux téléphone avec une carte SIM à SMS illimités),
 * grâce à l'application gratuite et libre « SMS Gateway for Android » (https://sms-gate.app).
 * Le site passe le message au relais de l'application, qui le fait envoyer par le téléphone.
 *
 * Réglages (variables d'environnement, ou secrets du Worker sur Cloudflare) :
 *   SMS_GATE_USER, SMS_GATE_PASSWORD : l'identifiant et le mot de passe affichés par l'application,
 *                                      rubrique « Cloud server » ;
 *   SMS_GATE_URL (facultatif)        : un autre relais que celui de sms-gate.app.
 * Sans identifiant, pas de SMS : rien d'autre ne change.
 */

const DEFAULT_URL = 'https://api.sms-gate.app/3rdparty/v1';
/** Le rappel part 24 h avant le rendez-vous, comme l'e-mail. */
const DAY_BEFORE = 1440;

/** « 06 12 34 56 78 » → « +33612345678 » ; un numéro déjà international reste tel quel ; null sinon. */
function international(phone) {
  const compact = String(phone || '').replace(/[\s.\-()]/g, '');
  if (/^0[1-9]\d{8}$/.test(compact)) return `+33${compact.slice(1)}`;
  if (/^\+\d{9,15}$/.test(compact)) return compact;
  return null;
}

function createSms({ config, store, clock, user = '', password = '', url = '', request = fetch }) {
  const enabled = Boolean(user && password);
  const endpoint = `${(url || DEFAULT_URL).replace(/\/+$/, '')}/messages`;
  const minutesUntil = (booking, now) => daysBetween(now.date, booking.date) * 1440 + booking.start - now.minutes;

  /** « Bonjour Léa, petit rappel : rendez-vous demain, mardi 13 octobre, à 14h30 chez L'atelier de Cyrille (Coupe). … » */
  function reminderText(booking) {
    const call = config.contact.phone ? ` Un empêchement ? Prévenez au ${config.contact.phone}.` : '';
    return `Bonjour ${booking.name.split(' ')[0]}, petit rappel : rendez-vous demain, ${formatLong(booking.date)}, à ${frTime(booking.start)} `
      + `chez ${config.name} (${booking.serviceName}).${call}`;
  }

  /** Envoie un SMS. Renvoie { ok, status }. */
  async function send(phone, text) {
    if (!enabled) return { ok: false, status: 'désactivé' };
    const to = international(phone);
    if (!to) return { ok: false, status: 'numéro invalide' };
    try {
      const response = await request(endpoint, {
        method: 'POST',
        headers: { Authorization: `Basic ${btoa(`${user}:${password}`)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ textMessage: { text }, phoneNumbers: [to] }),
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: response.ok, status: response.status };
    } catch (err) {
      return { ok: false, status: err.message };
    }
  }

  /** Les rendez-vous à rappeler par SMS : à venir, avec un numéro, pas encore rappelés. */
  const toRemind = () => store.bookings.all().filter(b => b.phone && b.status !== 'cancelled' && !b.smsReminded);

  /** Envoie les rappels de la veille arrivés à échéance. */
  async function tick() {
    if (!enabled) return 0;
    let sent = 0;
    for (const booking of toRemind()) {
      const remaining = minutesUntil(booking, clock());
      if (remaining > DAY_BEFORE) continue;
      // Rendez-vous déjà tout proche (le site était arrêté) : trop tard pour « demain ».
      if (remaining > 60) {
        const result = await send(booking.phone, reminderText(booking));
        if (result.ok) sent += 1;
        else console.error(`[sms] envoi refusé (${result.status})`);
      }
      store.bookings.update(booking.id, { smsReminded: true });
    }
    return sent;
  }

  /** Un rendez-vous pris ou déplacé à moins de 24 h : pas de rappel « demain ». Sinon, il est (de nouveau) prévu. */
  function schedule(booking) {
    const remindLater = minutesUntil(booking, clock()) > DAY_BEFORE;
    if (Boolean(booking.smsReminded) === !remindLater) return;
    store.bookings.update(booking.id, { smsReminded: !remindLater });
  }

  /** Dans combien de minutes un rappel par SMS doit partir, ou null. */
  function nextDue() {
    if (!enabled) return null;
    const now = clock();
    let next = null;
    for (const booking of toRemind()) {
      const due = Math.max(0, minutesUntil(booking, now) - DAY_BEFORE);
      if (next === null || due < next) next = due;
    }
    return next;
  }

  /** Pour l'espace salon : en service ou non, et le texte envoyé (sur un exemple). */
  const status = sample => ({ enabled, example: reminderText(sample) });

  return { enabled, send, tick, schedule, nextDue, status, reminderText };
}

module.exports = { createSms, international };
