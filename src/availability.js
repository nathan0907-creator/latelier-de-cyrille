'use strict';

const { addDays, daysBetween, weekday, daysInMonth, fromMinutes, toMinutes } = require('./time');

/** Un rendez-vous annulé libère son créneau. */
const isActive = booking => booking.status !== 'cancelled';

/**
 * Les plages d'ouverture d'un jour. Un jour particulier, choisi par la coiffeuse (une « fermeture »),
 * remplace les horaires habituels : sans « hours », fermé toute la journée ; avec, ouvert seulement
 * pendant ces plages (quelques heures bloquées, ou d'autres horaires ce jour-là).
 */
function openRanges(config, closures, date) {
  const closure = closures.find(c => c.date === date);
  if (closure) return closure.hours || [];
  return config.hours[weekday(date)];
}

/** Fermé toute la journée (et non quelques heures seulement). */
const isFullClosure = closure => !closure.hours;

/**
 * Les horaires d'un jour particulier, envoyés par l'espace salon : [{ start: '09:30', end: '12:00' }, …].
 * Renvoie { hours } (en minutes, dans l'ordre) ou { error }.
 */
function readDayHours(input, slotStep) {
  if (!Array.isArray(input) || !input.length || input.length > 3) return { error: 'Indiquez une à trois plages horaires.' };
  const hours = input.map(range => ({ start: toMinutes(range?.start), end: toMinutes(range?.end) }));
  if (hours.some(range => range.start === null || range.end === null)) return { error: 'Heure invalide.' };
  if (hours.some(range => range.end <= range.start)) return { error: "L'heure de fermeture doit suivre l'heure d'ouverture." };
  if (hours.some(range => range.start % slotStep || range.end % slotStep)) return { error: `Choisissez des heures par tranches de ${slotStep} minutes.` };
  hours.sort((a, b) => a.start - b.start);
  for (let i = 1; i < hours.length; i++) {
    if (hours[i].start < hours[i - 1].end) return { error: 'Les plages horaires se chevauchent.' };
  }
  return { hours };
}

const lastBookableDate = (config, today) => addDays(today, config.booking.maxDaysAhead);

/** Premier jour réservable en ligne : aujourd'hui, ou demain quand on réserve au plus tard la veille. */
const firstBookableDate = (config, today) => (config.booking.dayBefore ? addDays(today, 1) : today);

/** Les temps de pose d'une prestation ou d'un rendez-vous (les anciens rendez-vous n'en notaient qu'un). */
const pausesOf = item => item.pauses || (item.pauseDuration ? [{ after: item.pauseAfter, duration: item.pauseDuration }] : []);

/**
 * Les moments où un rendez-vous occupe vraiment la coiffeuse. Une prestation avec temps de pose
 * (une couleur, par exemple) la laisse libre pendant chaque pose : « after » minutes après le début,
 * pendant « duration » minutes. Elle peut alors prendre quelqu'un d'autre.
 */
function busyParts(start, item) {
  const parts = [];
  let from = start;
  for (const pause of pausesOf(item)) {
    parts.push([from, start + pause.after]);
    from = start + pause.after + pause.duration;
  }
  parts.push([from, start + item.duration]);
  return parts;
}

/** Deux rendez-vous se gênent si la coiffeuse est occupée par les deux au même moment. */
const clash = (a, b) => a.some(([from, to]) => b.some(([otherFrom, otherTo]) => from < otherTo && otherFrom < to));

function hasConflict(bookings, date, start, item, ignoreId = null) {
  const wanted = busyParts(start, item);
  return bookings.some(b => b.date === date && isActive(b) && b.id !== ignoreId && clash(wanted, busyParts(b.start, b)));
}

/**
 * Créneaux d'une journée pour une prestation.
 * - mode « public » : fenêtre de réservation et délai minimum appliqués ;
 * - mode « salon »  : la coiffeuse note un rendez-vous n'importe quand un jour ouvert, dès aujourd'hui.
 * Un créneau n'est proposé que si la prestation tient entièrement dans une plage d'ouverture.
 */
function daySlots({ config, bookings, closures, service, date, now, mode = 'public' }) {
  const salon = mode === 'salon';
  if (date < now.date || (!salon && (date < firstBookableDate(config, now.date) || date > lastBookableDate(config, now.date)))) {
    return { closed: true, slots: [] };
  }
  const ranges = openRanges(config, closures, date);
  if (!ranges.length) return { closed: true, slots: [] };

  const taken = bookings.filter(b => b.date === date && isActive(b));
  const earliest = salon
    ? -Infinity
    : now.minutes + config.booking.minNoticeMinutes - daysBetween(now.date, date) * 1440;

  const slots = [];
  for (const range of ranges) {
    for (let start = range.start; start + service.duration <= range.end; start += config.booking.slotStep) {
      const wanted = busyParts(start, service);
      const free = start >= earliest && !taken.some(b => clash(wanted, busyParts(b.start, b)));
      slots.push({ time: fromMinutes(start), start, available: free });
    }
  }
  return { closed: false, slots };
}

/** État de chaque jour d'un mois : « out » (hors fenêtre), « closed », « full » ou « open ». */
function monthSummary({ config, bookings, closures, service, month, now }) {
  const first = firstBookableDate(config, now.date);
  const last = lastBookableDate(config, now.date);
  return daysInMonth(month).map(date => {
    if (date < first || date > last) return { date, state: 'out', free: 0 };
    const { closed, slots } = daySlots({ config, bookings, closures, service, date, now });
    if (closed) return { date, state: 'closed', free: 0 };
    const free = slots.filter(s => s.available).length;
    return { date, state: free ? 'open' : 'full', free };
  });
}

/** Premier créneau libre pour une prestation, ou null. */
function nextSlot({ config, bookings, closures, service, now }) {
  for (let offset = 0; offset <= config.booking.maxDaysAhead; offset++) {
    const date = addDays(now.date, offset);
    const { slots } = daySlots({ config, bookings, closures, service, date, now });
    const slot = slots.find(s => s.available);
    if (slot) return { date, time: slot.time, start: slot.start };
  }
  return null;
}

/** Les prochains jours où il reste au moins un créneau pour cette prestation. */
function nextOpenDays({ config, bookings, closures, service, now, count = 6 }) {
  const days = [];
  for (let offset = 0; offset <= config.booking.maxDaysAhead && days.length < count; offset++) {
    const date = addDays(now.date, offset);
    const { slots } = daySlots({ config, bookings, closures, service, date, now });
    const free = slots.filter(s => s.available).length;
    if (free) days.push({ date, free });
  }
  return days;
}

/** null si le créneau est réservable, sinon la raison : « closed », « invalid » ou « taken ». */
function slotProblem(options) {
  const { closed, slots } = daySlots(options);
  if (closed) return 'closed';
  const slot = slots.find(s => s.start === options.start);
  if (!slot) return 'invalid';
  return slot.available ? null : 'taken';
}

/** Le salon est-il ouvert maintenant, et sinon quand rouvre-t-il ? */
function openStatus({ config, closures, now }) {
  const current = openRanges(config, closures, now.date).find(r => now.minutes >= r.start && now.minutes < r.end);
  if (current) return { open: true, until: current.end };
  for (let offset = 0; offset <= 14; offset++) {
    const date = addDays(now.date, offset);
    const next = openRanges(config, closures, date).find(r => offset > 0 || r.start > now.minutes);
    if (next) return { open: false, date, offset, at: next.start };
  }
  return { open: false };
}

/**
 * Fermetures exceptionnelles en cours ou à venir, regroupées en périodes (« du 20 au 31 octobre »).
 * Deux jours fermés font partie de la même période s'ils ont le même motif et si tous les jours qui
 * les séparent sont des jours de fermeture habituelle (le dimanche au milieu des congés, par exemple).
 * Chaque période indique si elle est en cours et quel jour le salon rouvre.
 */
function closurePeriods({ config, closures, now, horizon = 90 }) {
  const today = now.date;
  const limit = addDays(today, horizon);
  // Un jour où seules quelques heures sont bloquées n'est pas une fermeture.
  const usuallyClosed = date => !closures.some(c => c.date === date) && !config.hours[weekday(date)].length;
  const isClosed = date => !openRanges(config, closures, date).length;

  const periods = [];
  for (const closure of closures.filter(isFullClosure).sort((a, b) => a.date.localeCompare(b.date))) {
    const reason = (closure.reason || '').trim();
    const last = periods.at(-1);
    let joins = Boolean(last) && last.reason.toLowerCase() === reason.toLowerCase();
    for (let date = joins ? addDays(last.to, 1) : closure.date; joins && date < closure.date; date = addDays(date, 1)) {
      if (!usuallyClosed(date)) joins = false;
    }
    if (joins) last.to = closure.date;
    else periods.push({ from: closure.date, to: closure.date, reason });
  }

  return periods
    .filter(period => period.to >= today && period.from <= limit)
    .map(period => {
      let reopens = addDays(period.to, 1);
      for (let i = 0; i < 60 && isClosed(reopens); i++) reopens = addDays(reopens, 1);
      return { ...period, current: period.from <= today, reopens: isClosed(reopens) ? null : reopens };
    });
}

module.exports = {
  isActive, pausesOf, busyParts, openRanges, isFullClosure, readDayHours, firstBookableDate, lastBookableDate, hasConflict, daySlots, monthSummary, nextSlot, nextOpenDays, slotProblem, openStatus,
  closurePeriods,
};
