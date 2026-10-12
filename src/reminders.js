'use strict';

const crypto = require('node:crypto');
const { daysBetween, formatLong, frTime } = require('./time');
const { generateKeys, readSubscription, sendPush } = require('./push');

const failure = (status, error) => ({ ok: false, status, error });

/** 1440 → « la veille », 120 → « 2 h avant », 45 → « 45 min avant » */
function leadLabel(minutes) {
  if (minutes === 1440) return 'la veille';
  if (minutes % 1440 === 0) return `${minutes / 1440} jours avant`;
  return minutes % 60 === 0 ? `${minutes / 60} h avant` : `${minutes} min avant`;
}

/**
 * Rappels de rendez-vous par notification. Le client qui vient de réserver peut demander à être
 * prévenu sur son appareil ; le serveur envoie alors une notification à chaque échéance
 * (par défaut la veille et 2 h avant), puis oublie l'abonnement.
 */
function createReminders({ config, store, clock, send = sendPush }) {
  const leads = [...config.booking.reminders].sort((a, b) => b - a);

  // Clés du serveur et secret des références : créés au premier démarrage, gardés dans data/.
  let identity = store.reminders.identity();
  if (!identity) {
    identity = { ...generateKeys(), secret: crypto.randomBytes(32).toString('base64url') };
    store.reminders.setIdentity(identity);
  }

  // Qui contacter en cas de souci, à la demande des services de notification.
  const subject = config.contact.email ? `mailto:${config.contact.email}` : config.siteUrl || config.contact.facebook || '';

  const minutesUntil = (booking, now) => daysBetween(now.date, booking.date) * 1440 + booking.start - now.minutes;
  const signature = id => crypto.createHmac('sha256', identity.secret).update(id).digest('base64url');

  /** Les échéances encore à venir pour ce rendez-vous (une marge évite un rappel dans la minute). */
  const upcoming = (booking, now) => leads.filter(lead => minutesUntil(booking, now) > lead + 5);

  /**
   * Référence remise au client à la réservation : elle seule permet de demander le rappel
   * de ce rendez-vous, sans rien révéler d'autre.
   */
  function refFor(booking) {
    return { ref: `${booking.id}.${signature(booking.id)}`, when: upcoming(booking, clock()).map(leadLabel) };
  }

  function bookingFor(ref) {
    const [id, given = ''] = String(ref || '').split('.');
    const expected = Buffer.from(signature(id || ''));
    const received = Buffer.from(given);
    if (!id || received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
    const booking = store.bookings.get(id);
    return booking && booking.status !== 'cancelled' ? booking : null;
  }

  function subscribe(ref, input) {
    const booking = bookingFor(ref);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    const subscription = readSubscription(input);
    if (!subscription) return failure(400, "Ce navigateur ne permet pas d'activer le rappel.");
    const pending = upcoming(booking, clock());
    if (!pending.length) return failure(409, 'Ce rendez-vous est trop proche pour programmer un rappel.');
    const others = store.reminders.all().filter(r => r.bookingId === booking.id && r.endpoint !== subscription.endpoint);
    if (others.length >= 3) return failure(429, 'Le rappel est déjà activé sur plusieurs appareils.');
    store.reminders.put({ bookingId: booking.id, ...subscription, pending, createdAt: new Date().toISOString() });
    return { ok: true, when: pending.map(leadLabel) };
  }

  function unsubscribe(ref, endpoint) {
    const booking = bookingFor(ref);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    store.reminders.removeWhere(r => r.bookingId === booking.id && r.endpoint === endpoint);
    return { ok: true };
  }

  function message(booking, now) {
    const offset = daysBetween(now.date, booking.date);
    const day = offset === 0 ? "aujourd'hui" : offset === 1 ? 'demain' : formatLong(booking.date);
    const place = [config.name, config.address.street, config.address.city].filter(Boolean).join(', ');
    return {
      title: `Rendez-vous ${day} à ${frTime(booking.start)}`,
      body: `${booking.serviceName} · ${place}.${config.contact.phone ? ` Un empêchement ? ${config.contact.phone}` : ''}`,
      url: 'nous-trouver',
      tag: `rendez-vous-${booking.id}`,
    };
  }

  /** Envoie les rappels arrivés à échéance et oublie ceux qui n'ont plus lieu d'être. */
  async function tick() {
    let sent = 0;
    for (const reminder of [...store.reminders.all()]) {
      const now = clock();
      const booking = store.bookings.get(reminder.bookingId);
      const remaining = booking ? minutesUntil(booking, now) : 0;
      if (!booking || booking.status === 'cancelled' || remaining <= 0) {
        store.reminders.removeWhere(r => r === reminder);
        continue;
      }
      const pending = reminder.pending.filter(lead => remaining > lead);
      if (pending.length === reminder.pending.length) continue;

      // Plusieurs échéances dépassées d'un coup (le site était arrêté) : un seul message.
      let result;
      try {
        result = await send(reminder, message(booking, now), { keys: identity, subject, ttl: Math.min(remaining, 720) * 60 });
      } catch {
        result = { ok: false };
      }
      if (result.ok) sent += 1;
      const failures = result.ok ? 0 : (reminder.failures || 0) + 1;
      // Envoi impossible pour l'instant : on réessaie à la minute suivante, cinq fois au plus.
      if (!result.ok && !result.gone && failures < 5) {
        store.reminders.update(reminder, { failures });
      } else if (result.gone || !pending.length) {
        store.reminders.removeWhere(r => r === reminder);
      } else {
        store.reminders.update(reminder, { pending, failures: 0 });
      }
    }
    return sent;
  }

  /**
   * Dans combien de minutes un rappel doit partir (0 : maintenant), ou null s'il n'y en a aucun.
   * En ligne, le site dort entre deux visites : il se fait réveiller à ce moment-là.
   */
  function nextDue() {
    const now = clock();
    let next = null;
    for (const reminder of store.reminders.all()) {
      const booking = store.bookings.get(reminder.bookingId);
      const remaining = booking ? minutesUntil(booking, now) : 0;
      // Rendez-vous annulé ou passé (à oublier), envoi à réessayer : tout de suite.
      const due = !booking || booking.status === 'cancelled' || reminder.failures ? 0
        : Math.max(0, remaining - Math.max(0, ...reminder.pending));
      if (next === null || due < next) next = due;
    }
    return next;
  }

  return {
    publicKey: identity.publicKey,
    leads,
    labels: leads.map(leadLabel),
    refFor, subscribe, unsubscribe, tick, nextDue,
    forget: bookingId => store.reminders.removeWhere(r => r.bookingId === bookingId),
  };
}

module.exports = { createReminders, leadLabel };
