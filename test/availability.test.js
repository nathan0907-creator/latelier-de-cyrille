'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { daySlots, monthSummary, nextSlot, slotProblem, openStatus, closurePeriods } = require('../src/availability');
const { testConfig, TUESDAY, MONDAY, SATURDAY } = require('./helpers');

const config = testConfig();
const service = id => config.services.find(s => s.id === id);
const now = { date: MONDAY, minutes: 600 };
const booking = (date, start, duration, extra = {}) => ({ id: `b${start}`, date, start, duration, status: 'confirmed', ...extra });
const times = result => result.slots.filter(s => s.available).map(s => s.time);

test('une prestation ne déborde jamais sur la pause déjeuner ni sur la fermeture', () => {
  const short = daySlots({ config, bookings: [], closures: [], service: service('court'), date: TUESDAY, now });
  assert.equal(short.closed, false);
  assert.equal(short.slots[0].time, '09:00');
  assert.ok(times(short).includes('12:00'));
  assert.ok(!times(short).includes('12:30'), 'pas de créneau pendant la pause');
  assert.equal(short.slots.at(-1).time, '18:30');

  const long = daySlots({ config, bookings: [], closures: [], service: service('long'), date: TUESDAY, now });
  assert.deepEqual(times(long), ['09:00', '09:30', '10:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30']);
});

test('un rendez-vous bloque les créneaux qui le chevauchent, selon la durée demandée', () => {
  const bookings = [booking(TUESDAY, 600, 60)]; // 10:00 → 11:00
  const short = times(daySlots({ config, bookings, closures: [], service: service('court'), date: TUESDAY, now }));
  assert.ok(short.includes('09:30'));
  assert.ok(!short.includes('10:00') && !short.includes('10:30'));
  assert.ok(short.includes('11:00'));

  const medium = times(daySlots({ config, bookings, closures: [], service: service('moyen'), date: TUESDAY, now }));
  assert.ok(medium.includes('09:00'));
  assert.ok(!medium.includes('09:30'), "une heure à 9h30 mordrait sur le rendez-vous de 10h");
  assert.ok(medium.includes('11:00'));
});

test('un rendez-vous annulé libère son créneau', () => {
  const bookings = [booking(TUESDAY, 600, 60, { status: 'cancelled' })];
  assert.ok(times(daySlots({ config, bookings, closures: [], service: service('court'), date: TUESDAY, now })).includes('10:00'));
});

test('jours fermés, fermetures exceptionnelles et fenêtre de réservation', () => {
  const base = { config, bookings: [], service: service('court'), now };
  assert.equal(daySlots({ ...base, closures: [], date: MONDAY }).closed, true, 'lundi fermé');
  assert.equal(daySlots({ ...base, closures: [{ date: TUESDAY }], date: TUESDAY }).closed, true, 'fermeture exceptionnelle');
  assert.equal(daySlots({ ...base, closures: [], date: '2026-10-06' }).closed, true, 'date passée');
  assert.equal(daySlots({ ...base, closures: [], date: '2027-01-12' }).closed, true, 'au-delà de 60 jours');
});

test('le délai minimum écarte les créneaux trop proches, y compris à cheval sur minuit', () => {
  const today = { date: TUESDAY, minutes: 14 * 60 + 10 }; // mardi 14h10 → rien avant 16h10
  const same = times(daySlots({ config, bookings: [], closures: [], service: service('court'), date: TUESDAY, now: today }));
  assert.equal(same[0], '16:30');

  const lateEvening = { date: TUESDAY, minutes: 23 * 60 + 30 }; // mardi 23h30 → rien avant mercredi 1h30
  const tomorrow = times(daySlots({ config, bookings: [], closures: [], service: service('court'), date: '2026-10-14', now: lateEvening }));
  assert.equal(tomorrow[0], '09:00');
});

test('le mode salon ignore le délai minimum et la fenêtre, mais pas les horaires ni les conflits', () => {
  const today = { date: TUESDAY, minutes: 15 * 60 };
  const options = { config, closures: [], service: service('court'), now: today, mode: 'salon' };
  assert.ok(times(daySlots({ ...options, bookings: [], date: TUESDAY })).includes('09:00'));
  assert.equal(daySlots({ ...options, bookings: [], date: '2027-03-02' }).closed, false);
  assert.ok(!times(daySlots({ ...options, bookings: [booking(TUESDAY, 540, 30)], date: TUESDAY })).includes('09:00'));
});

test('résumé du mois : fermé, complet, ouvert, hors fenêtre', () => {
  const full = [booking(SATURDAY, 540, 480)]; // tout le samedi
  const days = monthSummary({ config, bookings: full, closures: [], service: service('court'), month: '2026-10', now });
  const state = date => days.find(d => d.date === date).state;
  assert.equal(days.length, 31);
  assert.equal(state('2026-10-01'), 'out');
  assert.equal(state(MONDAY), 'closed');
  assert.equal(state(TUESDAY), 'open');
  assert.equal(state(SATURDAY), 'full');
  assert.equal(days.find(d => d.date === TUESDAY).free, 18);
});

test('prochain créneau libre et vérification avant réservation', () => {
  const next = nextSlot({ config, bookings: [booking(TUESDAY, 540, 60)], closures: [], service: service('court'), now });
  assert.deepEqual({ date: next.date, time: next.time }, { date: TUESDAY, time: '10:00' });

  const options = { config, bookings: [booking(TUESDAY, 600, 30)], closures: [], service: service('court'), date: TUESDAY, now };
  assert.equal(slotProblem({ ...options, start: 600 }), 'taken');
  assert.equal(slotProblem({ ...options, start: 615 }), 'invalid');
  assert.equal(slotProblem({ ...options, start: 630 }), null);
  assert.equal(slotProblem({ ...options, date: MONDAY, start: 600 }), 'closed');
});

test('statut ouvert / fermé', () => {
  assert.deepEqual(openStatus({ config, closures: [], now: { date: TUESDAY, minutes: 600 } }), { open: true, until: 750 });
  const lunch = openStatus({ config, closures: [], now: { date: TUESDAY, minutes: 780 } });
  assert.deepEqual({ open: lunch.open, offset: lunch.offset, at: lunch.at }, { open: false, offset: 0, at: 810 });
  const monday = openStatus({ config, closures: [], now });
  assert.deepEqual({ open: monday.open, date: monday.date, at: monday.at }, { open: false, date: TUESDAY, at: 540 });
});

test('congés : les jours fermés se regroupent en périodes, avec le jour de réouverture', () => {
  const day = (date, reason = 'Congés') => ({ date, reason });
  // Du mardi 20 au samedi 24, puis du mardi 27 au mercredi 28 : dimanche et lundi (fermés d'habitude) font le lien.
  const closures = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-27', '2026-10-28'].map(d => day(d));
  closures.push(day('2026-11-06', 'Formation'));

  const periods = closurePeriods({ config, closures, now });
  assert.deepEqual(periods.map(p => [p.from, p.to, p.reason, p.current, p.reopens]), [
    ['2026-10-20', '2026-10-28', 'Congés', false, '2026-10-29'],
    ['2026-11-06', '2026-11-06', 'Formation', false, '2026-11-07'],
  ]);

  // Pendant les congés : la période est « en cours ». Une fois passée, elle disparaît.
  assert.equal(closurePeriods({ config, closures, now: { date: '2026-10-22', minutes: 600 } })[0].current, true);
  assert.deepEqual(closurePeriods({ config, closures, now: { date: '2026-11-07', minutes: 600 } }), []);

  // Un jour ouvré entre deux fermetures, ou un autre motif : deux périodes distinctes.
  assert.equal(closurePeriods({ config, closures: [day('2026-10-20'), day('2026-10-22')], now }).length, 2);
  assert.equal(closurePeriods({ config, closures: [day('2026-10-20'), day('2026-10-21', 'Travaux')], now }).length, 2);
});
