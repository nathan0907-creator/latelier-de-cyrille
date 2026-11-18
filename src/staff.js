'use strict';

const crypto = require('node:crypto');
const { cleanText } = require('./bookings');

// Les employées du salon. La coiffeuse a toujours sa ligne dans l'agenda ; chaque employée ajoutée
// depuis l'espace salon en reçoit une autre, où se notent ses rendez-vous (saisis au salon :
// la réservation en ligne reste chez la coiffeuse).

const MAX_STAFF = 8;
const NAME_RE = /^\p{L}[\p{L}\p{M}'’ .-]{0,39}$/u;

const failure = (status, error) => ({ ok: false, status, error });

function createStaff({ store, clock }) {
  const all = () => store.staff.all();

  function add(input) {
    const name = cleanText(input?.name, 40);
    if (!NAME_RE.test(name)) return failure(400, 'Indiquez son prénom (lettres uniquement).');
    if (all().length >= MAX_STAFF) return failure(400, `Pas plus de ${MAX_STAFF} employées.`);
    const person = { id: crypto.randomBytes(6).toString('base64url'), name, createdAt: new Date().toISOString() };
    store.staff.set([...all(), person]);
    return { ok: true, person, staff: all() };
  }

  /**
   * Retire une employée. Ses rendez-vous à venir ne sont pas perdus : ils reviennent sur la ligne
   * de la coiffeuse (renvoyés dans « moved » pour prévenir l'espace salon). Les passés gardent
   * la trace de qui s'en est occupé.
   */
  function remove(id) {
    const person = all().find(p => p.id === id);
    if (!person) return failure(404, 'Employée introuvable.');
    store.staff.set(all().filter(p => p.id !== id));
    const today = clock().date;
    const moved = store.bookings.updateWhere(b => b.staff === id && b.date >= today, { staff: '' });
    // Les passés : son nom reste lisible, même une fois sa ligne retirée.
    store.bookings.updateWhere(b => b.staff === id, { staff: '', staffName: person.name });
    return { ok: true, person, moved, staff: all() };
  }

  return { all, add, remove };
}

module.exports = { createStaff, MAX_STAFF };
