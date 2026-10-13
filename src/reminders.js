'use strict';

const crypto = require('node:crypto');
const { daysBetween, formatLong, frTime } = require('./time');
const { generateKeys, readSubscription, sendPush } = require('./push');

const failure = (status, error) => ({ ok: false, status, error });
const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);

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

  /** Le rendez-vous que désigne une référence, quel que soit son état ; null si elle est fausse. */
  function find(ref) {
    const [id, given = ''] = String(ref || '').split('.');
    const expected = Buffer.from(signature(id || ''));
    const received = Buffer.from(given);
    if (!id || received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
    return store.bookings.get(id);
  }

  function bookingFor(ref) {
    const booking = find(ref);
    return booking && booking.status !== 'cancelled' ? booking : null;
  }

  function subscribe(ref, input) {
    const booking = bookingFor(ref);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    const subscription = readSubscription(input);
    if (!subscription) return failure(400, "Ce navigateur ne permet pas d'activer le rappel.");
    // Même sans rappel encore possible (rendez-vous tout proche), l'abonnement sert : c'est par lui
    // que le client apprend que le salon a confirmé, déplacé ou annulé.
    const pending = upcoming(booking, clock());
    if (minutesUntil(booking, clock()) <= 0) return failure(409, 'Ce rendez-vous est déjà passé.');
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

  /** L'adresse de la page « Votre rendez-vous » (pour revoir ou annuler), relative au site. */
  const pageOf = booking => `rendez-vous?r=${booking.id}.${signature(booking.id)}`;

  function message(booking, now) {
    const offset = daysBetween(now.date, booking.date);
    const day = offset === 0 ? "aujourd'hui" : offset === 1 ? 'demain' : formatLong(booking.date);
    const place = [config.name, config.address.street, config.address.city].filter(Boolean).join(', ');
    return {
      // La veille : « N'oubliez pas votre rendez-vous demain à 14h30 ».
      title: offset === 1 ? `N'oubliez pas votre rendez-vous demain à ${frTime(booking.start)}` : `Rendez-vous ${day} à ${frTime(booking.start)}`,
      body: `${booking.serviceName} · ${place}. Vous venez ? Confirmez, ou annulez si vous avez un empêchement.`,
      url: pageOf(booking),
      tag: `rendez-vous-${booking.id}`,
      // Deux boutons sous le rappel : « Je viens » (prévient le salon) et « Annuler » (avec une raison).
      ref: `${booking.id}.${signature(booking.id)}`,
      actions: true,
    };
  }

  /** Ce que le salon vient de décider pour un rendez-vous, dit au client. */
  const NEWS = {
    confirmed: booking => ({ title: 'Rendez-vous confirmé', body: `${capitalize(formatLong(booking.date))} à ${frTime(booking.start)} · ${booking.serviceName} · ${config.name}` }),
    moved: booking => ({ title: 'Rendez-vous déplacé', body: `Nouveau rendez-vous : ${formatLong(booking.date)} à ${frTime(booking.start)} · ${booking.serviceName} · ${config.name}` }),
    cancelled: booking => ({
      title: 'Rendez-vous annulé',
      body: `Le salon a dû annuler votre rendez-vous du ${formatLong(booking.date)} à ${frTime(booking.start)}.${config.contact.phone ? ` Pour en reprendre un : ${config.contact.phone}` : ''}`,
    }),
  };

  /**
   * Prévient le client, sur les appareils où il a activé les notifications, que le salon a confirmé,
   * déplacé ou annulé son rendez-vous. Renvoie le nombre de notifications parties.
   */
  async function notify(booking, kind) {
    let sent = 0;
    for (const reminder of store.reminders.all().filter(r => r.bookingId === booking.id)) {
      let result;
      try {
        result = await send(reminder, { ...NEWS[kind](booking), url: pageOf(booking), tag: `rendez-vous-${booking.id}` }, { keys: identity, subject, ttl: 24 * 3600 });
      } catch (err) {
        result = { ok: false, status: err.message };
      }
      if (result.ok) sent += 1;
      // Visible dans le journal (tableau de bord de Cloudflare) : pourquoi un envoi n'est pas parti.
      else console.error(`[notifications] envoi refusé (${result.status}) vers ${new URL(reminder.endpoint).host}`);
      if (result.gone) store.reminders.removeWhere(r => r === reminder);
    }
    return sent;
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
      } catch (err) {
        result = { ok: false, status: err.message };
      }
      if (result.ok) sent += 1;
      // Visible dans le journal (tableau de bord de Cloudflare) : pourquoi un envoi n'est pas parti.
      else console.error(`[rappels] envoi refusé (${result.status}) vers ${new URL(reminder.endpoint).host}`);
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

  /**
   * Alerte la coiffeuse sur ses appareils (nouvelle demande, annulation par un client), même quand
   * l'espace salon est fermé. Renvoie le nombre d'alertes parties.
   */
  async function alertSalon(news) {
    let sent = 0;
    for (const device of [...store.salonDevices.all()]) {
      let result;
      try {
        result = await send(device, { url: 'salon', ...news }, { keys: identity, subject, ttl: 12 * 3600 });
      } catch (err) {
        result = { ok: false, status: err.message };
      }
      if (result.ok) sent += 1;
      // Visible dans le journal (tableau de bord de Cloudflare) : pourquoi un envoi n'est pas parti.
      else console.error(`[alertes] envoi refusé (${result.status}) vers ${new URL(device.endpoint).host}`);
      if (result.gone) store.salonDevices.remove(device.endpoint);
    }
    return sent;
  }

  /** Un appareil de la coiffeuse s'abonne aux alertes. */
  function addSalonDevice(input) {
    const subscription = readSubscription(input);
    if (!subscription) return failure(400, "Ce navigateur ne permet pas de recevoir les alertes.");
    store.salonDevices.put({ ...subscription, createdAt: new Date().toISOString() });
    return { ok: true };
  }

  return {
    publicKey: identity.publicKey,
    alertSalon, addSalonDevice,
    salonDevices: () => store.salonDevices.all().length,
    removeSalonDevice: endpoint => store.salonDevices.remove(String(endpoint || '')),
    leads,
    labels: leads.map(leadLabel),
    refFor, find, pageOf, subscribe, unsubscribe, notify, tick, nextDue,
    forget: bookingId => store.reminders.removeWhere(r => r.bookingId === bookingId),
    /** Après un déplacement : les rappels repartent des échéances de la nouvelle date. */
    reschedule(booking) {
      for (const reminder of store.reminders.all().filter(r => r.bookingId === booking.id)) {
        store.reminders.update(reminder, { pending: upcoming(booking, clock()), failures: 0 });
      }
    },
  };
}

module.exports = { createReminders, leadLabel };
