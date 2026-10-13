'use strict';

const crypto = require('node:crypto');
const { isValidDate, toMinutes, fromMinutes, addDays, daysBetween } = require('./time');
const { slotProblem, hasConflict, daySlots, pausesOf } = require('./availability');
const { readEmail } = require('./mail');

/** Minutes avant le début d'un rendez-vous (négatif : commencé). */
const minutesUntil = (booking, now) => daysBetween(now.date, booking.date) * 1440 + booking.start - now.minutes;

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
function createBookings({ config, store, clock, closures = () => store.closures.all(), acceptEmail = false, isBlocked = () => false }) {
  /**
   * Crée un rendez-vous. mode « public » : réservation en ligne (téléphone obligatoire,
   * délai minimum, limite par numéro). mode « salon » : saisi par la coiffeuse.
   */
  function create(input, { mode = 'public', site = '' } = {}) {
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
    // L'e-mail, facultatif : seulement quand le site sait en envoyer (src/mail.js).
    let email = '';
    if (acceptEmail && cleanText(input.email, 120)) {
      email = readEmail(input.email);
      if (!email) fields.email = 'Indiquez une adresse e-mail valide, par exemple prenom.nom@gmail.com.';
    }
    const note = cleanText(input.note, 200);
    if (Object.keys(fields).length) return failure(400, 'Vérifiez les informations saisies.', { fields });

    const now = clock();
    const problem = slotProblem({
      config, bookings: store.bookings.all(), closures: closures(),
      service, date: input.date, start, now, mode,
    });
    // La coiffeuse peut prendre deux clientes à la fois : force, depuis son espace seulement.
    if (problem === 'taken' && !(mode === 'salon' && input.force === true)) {
      return failure(409, "Ce créneau vient d'être réservé. Choisissez-en un autre.", { code: 'slot_taken' });
    }
    if (problem && problem !== 'taken') return failure(409, "Ce créneau n'est plus disponible.", { code: 'slot_unavailable' });

    if (mode === 'public') {
      // Une personne marquée « ne plus reprendre » (annulation tardive, absence) ne réserve plus en ligne.
      if (isBlocked({ phone, name })) {
        const call = config.contact.phone ? ` Appelez le salon au ${config.contact.phone}.` : ' Appelez le salon.';
        return failure(403, `La réservation en ligne n'est pas possible avec ce numéro.${call}`, { code: 'blocked' });
      }
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
      // Le temps de pose est noté avec le rendez-vous : il ne change pas si la carte change.
      pauses: service.pauses.map(pause => ({ ...pause })),
      serviceId: service.id,
      serviceName: service.name,
      price: service.price,
      priceFrom: service.priceFrom,
      name,
      phone,
      ...(email && { email }),
      note,
      // L'adresse du site, pour les liens des e-mails envoyés plus tard (le rappel de la veille).
      ...(site && { site }),
      status: mode === 'salon' ? 'confirmed' : 'pending',
      source: mode === 'salon' ? 'salon' : 'online',
      createdAt: new Date().toISOString(),
    });
    return { ok: true, booking };
  }

  /** force : rétablir un rendez-vous annulé même si sa place a été reprise (les deux se superposent). */
  function setStatus(id, status, { force = false } = {}) {
    if (!STATUSES.includes(status)) return failure(400, 'Statut invalide.');
    const booking = store.bookings.get(id);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    const reactivating = booking.status === 'cancelled' && status !== 'cancelled';
    if (reactivating && !force && booking.date >= clock().date
      && hasConflict(store.bookings.all(), booking.date, booking.start, booking, booking.id)) {
      return failure(409, 'Ce créneau a été repris par un autre rendez-vous.', { code: 'slot_taken' });
    }
    // Un rendez-vous rétabli n'est plus « annulé par le client ».
    return { ok: true, previous: booking.status, booking: store.bookings.update(id, { status, cancelledBy: status === 'cancelled' ? 'salon' : '' }) };
  }

  /**
   * Le client annule lui-même son rendez-vous (depuis sa page « Votre rendez-vous »). Possible
   * jusqu'à l'heure du rendez-vous : mieux vaut un créneau libéré tard qu'un rendez-vous manqué.
   */
  function cancelByClient(id, reason) {
    const booking = store.bookings.get(id);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    if (booking.status === 'cancelled') return failure(409, 'Ce rendez-vous est déjà annulé.', { code: 'already_cancelled' });
    const now = clock();
    if (booking.date < now.date || (booking.date === now.date && booking.start <= now.minutes)) {
      return failure(409, 'Ce rendez-vous est déjà passé.', { code: 'past' });
    }
    // La raison est transmise à la coiffeuse : elle sait à quoi s'en tenir.
    const why = cleanText(reason, 200);
    if (why.length < 2) return failure(400, "Indiquez la raison de l'annulation.", { fields: { reason: "Indiquez la raison de l'annulation." } });
    // Moins de lateCancelMinutes avant : une annulation de dernière minute (le client en a été averti).
    const lateCancel = minutesUntil(booking, now) <= config.booking.lateCancelMinutes;
    return {
      ok: true,
      booking: store.bookings.update(id, {
        status: 'cancelled', cancelledBy: 'client', cancelReason: why, cancelledAt: new Date().toISOString(), ...(lateCancel && { lateCancel }),
      }),
    };
  }

  /** Le client n'est pas venu : la coiffeuse le note, une fois l'heure du rendez-vous passée. */
  function markNoShow(id) {
    const booking = store.bookings.get(id);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    if (booking.status === 'cancelled') return failure(409, 'Ce rendez-vous est annulé.', { code: 'already_cancelled' });
    if (minutesUntil(booking, clock()) > 0) return failure(409, "Le rendez-vous n'a pas encore commencé.", { code: 'not_started' });
    return { ok: true, booking: store.bookings.update(id, { noShow: true }) };
  }

  /** Le client confirme qu'il vient (depuis le rappel) : la coiffeuse le voit dans son espace. */
  function attend(id) {
    const booking = store.bookings.get(id);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    if (booking.status === 'cancelled') return failure(409, 'Ce rendez-vous est annulé.', { code: 'already_cancelled' });
    return { ok: true, booking: store.bookings.update(id, { attending: new Date().toISOString() }) };
  }

  /**
   * Rallonge ou raccourcit un rendez-vous (par la coiffeuse). force : même s'il déborde sur un
   * autre rendez-vous (elle a choisi de les superposer).
   */
  function resize(id, duration, { force = false } = {}) {
    const booking = store.bookings.get(id);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    const step = config.booking.slotStep;
    const lastPause = Math.max(0, ...pausesOf(booking).map(pause => pause.after + pause.duration));
    if (!Number.isInteger(duration) || duration % step || duration <= lastPause || duration > 12 * 60) {
      return failure(400, `Choisissez une durée par tranches de ${step} minutes${lastPause ? `, après la dernière pose` : ''}.`);
    }
    if (!force && duration > booking.duration && booking.status !== 'cancelled'
      && hasConflict(store.bookings.all(), booking.date, booking.start, { ...booking, duration }, booking.id)) {
      return failure(409, 'Le rendez-vous rallongé déborderait sur un autre rendez-vous.', { code: 'slot_taken' });
    }
    return { ok: true, booking: store.bookings.update(id, { duration }) };
  }

  /** Les créneaux où ce rendez-vous pourrait être déplacé ce jour-là (lui-même ne se gêne pas). */
  function movableSlots(id, date) {
    const booking = store.bookings.get(id);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    if (!isValidDate(date)) return failure(400, 'Date invalide.');
    const day = daySlots({
      config, bookings: store.bookings.all().filter(b => b.id !== id), closures: closures(),
      service: booking, date, now: clock(), mode: 'salon',
    });
    return { ok: true, closed: day.closed, slots: day.slots.map(({ time, available }) => ({ time, available })) };
  }

  /**
   * Déplace un rendez-vous à un autre jour ou une autre heure (par la coiffeuse). force : même sur un
   * créneau déjà pris (elle superpose les deux rendez-vous), tant que le salon est ouvert.
   */
  function move(id, { date, time, force = false }) {
    const booking = store.bookings.get(id);
    if (!booking) return failure(404, 'Rendez-vous introuvable.');
    if (!isValidDate(date)) return failure(400, 'Date invalide.');
    const start = toMinutes(time);
    if (start === null) return failure(400, 'Horaire invalide.');
    if (date < clock().date) return failure(400, 'Choisissez une date à venir.');
    const problem = slotProblem({
      config, bookings: store.bookings.all().filter(b => b.id !== id), closures: closures(),
      service: booking, date, start, now: clock(), mode: 'salon',
    });
    if (problem === 'taken' && !force) return failure(409, 'Ce créneau est déjà pris par un autre rendez-vous.', { code: 'slot_taken' });
    if (problem && problem !== 'taken') return failure(409, 'Le salon est fermé à ce moment-là.', { code: 'slot_unavailable' });
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
    status: b.status, attending: Boolean(b.attending), cancelledBy: b.status === 'cancelled' ? b.cancelledBy || 'salon' : '',
  });

  return { create, setStatus, cancelByClient, markNoShow, attend, resize, move, movableSlots, remove, purgeOld, publicView };
}

module.exports = { createBookings, normalizePhone, cleanText };
