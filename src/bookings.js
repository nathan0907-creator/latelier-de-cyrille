'use strict';

const crypto = require('node:crypto');
const { isValidDate, toMinutes, fromMinutes, addDays } = require('./time');
const { slotProblem, hasConflict, daySlots } = require('./availability');

const NAME_RE = /^\p{L}[\p{L}\p{M}'’ .-]{1,59}$/u;
const STATUSES = ['pending', 'confirmed', 'cancelled'];

/** Retire les caractères de contrôle, réduit les espaces et tronque. */
function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** « 0612345678 », « +33 6 12 34 56 78 » → « 06 12 34 56 78 ». Numéro étranger : format international exigé. */
function normalizePhone(raw) {
  const compact = String(raw ?? '').replace(/[\s.\-()]/g, '');
  if (!/^\+?\d{9,15}$/.test(compact)) return null;
  let national = compact;
  if (compact.startsWith('+33')) national = `0${compact.slice(3)}`;
  else if (compact.startsWith('0033')) national = `0${compact.slice(4)}`;
  if (/^0[1-9]\d{8}$/.test(national)) return national.replace(/(\d{2})(?=\d)/g, '$1 ');
  return compact.startsWith('+') ? compact : null;
}

const failure = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });

/** closures : donne tous les jours fermés (fermetures saisies et jours fériés, voir src/holidays.js). */
function createBookings({ config, store, clock, closures = () => store.closures.all() }) {
  /**
   * Crée un rendez-vous. mode « public » : réservation en ligne (téléphone obligatoire,
   * délai minimum, limite par numéro). mode « salon » : saisi par la coiffeuse.
   */
  function create(input, { mode = 'public' } = {}) {
    const service = config.services.find(s => s.id === input.serviceId);
    if (!service) return failure(400, 'Prestation inconnue.');
    if (!isValidDate(input.date)) return failure(400, 'Date invalide.');
    const start = toMinutes(input.time);
    if (start === null) return failure(400, 'Horaire invalide.');

    const fields = {};
    const name = cleanText(input.name, 60);
    if (!NAME_RE.test(name)) fields.name = 'Indiquez un prénom et un nom (lettres uniquement).';

    let phone = '';
    if (mode === 'public' || cleanText(input.phone, 30)) {
      phone = normalizePhone(input.phone);
      if (!phone) fields.phone = 'Indiquez un numéro valide, par exemple 06 12 34 56 78.';
    }
    const note = cleanText(input.note, 200);
    if (Object.keys(fields).length) return failure(400, 'Vérifiez les informations saisies.', { fields });

    const now = clock();
    const problem = slotProblem({
      config, bookings: store.bookings.all(), closures: closures(),
      service, date: input.date, start, now, mode,
    });
    if (problem === 'taken') {
      return failure(409, "Ce créneau vient d'être réservé. Choisissez-en un autre.", { code: 'slot_taken' });
    }
    if (problem) return failure(409, "Ce créneau n'est plus disponible.", { code: 'slot_unavailable' });

    if (mode === 'public') {
      const upcoming = store.bookings.all()
        .filter(b => b.phone === phone && b.status !== 'cancelled' && b.date >= now.date).length;
      if (upcoming >= config.booking.maxActivePerPhone) {
        return failure(429, `Vous avez déjà ${upcoming} rendez-vous à venir. Appelez le salon pour en ajouter un autre.`, { code: 'too_many' });
      }
    }

    const booking = store.bookings.add({
      id: crypto.randomBytes(9).toString('base64url'),
      date: input.date,
      time: fromMinutes(start),
      start,
      duration: service.duration,
      serviceId: service.id,
      serviceName: service.name,
      price: service.price,
      priceFrom: service.priceFrom,
      name,
      phone,
      note,
      status: mode === 'salon' ? 'confirmed' : 'pending',
      source: mode === 'salon' ? 'salon' : 'online',
      createdAt: new Date().toISOString(),
    });
    return { ok: true, booking };
  }

  function setStatus(id, status) {
    if (!STATUSES.includes(status)) return failure(400, 'Statut invalide.');
    const booking = store.bookings.get(id);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    const reactivating = booking.status === 'cancelled' && status !== 'cancelled';
    if (reactivating && booking.date >= clock().date
      && hasConflict(store.bookings.all(), booking.date, booking.start, booking.duration, booking.id)) {
      return failure(409, 'Ce créneau a été repris par un autre rendez-vous.', { code: 'slot_taken' });
    }
    return { ok: true, booking: store.bookings.update(id, { status }) };
  }

  /** Les créneaux où ce rendez-vous pourrait être déplacé ce jour-là (lui-même ne se gêne pas). */
  function movableSlots(id, date) {
    const booking = store.bookings.get(id);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    if (!isValidDate(date)) return failure(400, 'Date invalide.');
    const day = daySlots({
      config, bookings: store.bookings.all().filter(b => b.id !== id), closures: closures(),
      service: { duration: booking.duration }, date, now: clock(), mode: 'salon',
    });
    return { ok: true, closed: day.closed, slots: day.slots.map(({ time, available }) => ({ time, available })) };
  }

  /** Déplace un rendez-vous à un autre jour ou une autre heure (par la coiffeuse). */
  function move(id, { date, time }) {
    const booking = store.bookings.get(id);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    if (!isValidDate(date)) return failure(400, 'Date invalide.');
    const start = toMinutes(time);
    if (start === null) return failure(400, 'Horaire invalide.');
    if (date < clock().date) return failure(400, 'Choisissez une date à venir.');
    const problem = slotProblem({
      config, bookings: store.bookings.all().filter(b => b.id !== id), closures: closures(),
      service: { duration: booking.duration }, date, start, now: clock(), mode: 'salon',
    });
    if (problem === 'taken') return failure(409, 'Ce créneau est déjà pris par un autre rendez-vous.', { code: 'slot_taken' });
    if (problem) return failure(409, 'Le salon est fermé à ce moment-là.', { code: 'slot_unavailable' });
    const from = { date: booking.date, time: booking.time };
    return { ok: true, from, booking: store.bookings.update(id, { date, time: fromMinutes(start), start }) };
  }

  function remove(id) {
    const booking = store.bookings.remove(id);
    return booking ? { ok: true, booking } : failure(404, 'Rendez-vous introuvable.');
  }

  /** Efface les rendez-vous plus anciens que la durée de conservation. */
  function purgeOld() {
    const limit = addDays(clock().date, -config.booking.retentionDays);
    return store.bookings.removeWhere(b => b.date < limit);
  }

  /** Ce que le client a le droit de voir de son rendez-vous. */
  const publicView = b => ({
    date: b.date, time: b.time, end: fromMinutes(b.start + b.duration),
    serviceName: b.serviceName, duration: b.duration, price: b.price, priceFrom: Boolean(b.priceFrom), name: b.name,
  });

  return { create, setStatus, move, movableSlots, remove, purgeOld, publicView };
}

module.exports = { createBookings, normalizePhone, cleanText };
