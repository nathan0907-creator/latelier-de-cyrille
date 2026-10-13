'use strict';

// Fichier clients de l'espace salon. Les fiches se déduisent des rendez-vous (une personne = un
// numéro de téléphone, ou un nom quand il n'y a pas de numéro) ; seuls la note de la coiffeuse et
// le « ne plus reprendre » sont enregistrés ici, rangés par clé de fiche.

const NOTE_MAX = 1000;

const failure = (status, error) => ({ ok: false, status, error });

/** « Léa  DUPONT-Martin » → « lea dupont martin » : deux écritures d'un même nom se retrouvent. */
const normalizeName = name => String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** La clé de la fiche d'un rendez-vous : le téléphone s'il y en a un, sinon le nom. */
function clientKey(booking) {
  const digits = String(booking.phone || '').replace(/\D/g, '');
  return digits ? `tel:${digits}` : `nom:${normalizeName(booking.name)}`;
}

function createClients({ store }) {
  const known = () => new Set(store.bookings.all().map(clientKey));

  /** Enregistre la note et le « ne plus reprendre » d'une fiche ; une fiche vidée n'est pas gardée. */
  function save(input) {
    const key = typeof input?.key === 'string' ? input.key : '';
    if (!known().has(key)) return failure(404, 'Fiche introuvable : cette personne n\'a plus de rendez-vous enregistré.');
    if (typeof input.note !== 'string' || input.note.length > NOTE_MAX * 2) return failure(400, `La note est trop longue (${NOTE_MAX} caractères au plus).`);
    // Les retours à la ligne sont gardés, pas les autres caractères de commande.
    const note = input.note.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
    if (note.length > NOTE_MAX) return failure(400, `La note est trop longue (${NOTE_MAX} caractères au plus).`);
    const blocked = input.blocked === true;
    store.clients.set(key, note || blocked ? { note, blocked, updatedAt: new Date().toISOString() } : null);
    return { ok: true, clients: store.clients.all() };
  }

  /** Quand les rendez-vous d'une personne sont effacés (durée de conservation), sa fiche l'est aussi. */
  function purge() {
    const keys = known();
    return store.clients.removeWhere(key => !keys.has(key));
  }

  return { save, purge, all: () => store.clients.all() };
}

module.exports = { createClients, clientKey, normalizeName, NOTE_MAX };
