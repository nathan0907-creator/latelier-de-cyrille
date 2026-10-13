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
  /** La fiche enregistrée sous cette clé (jamais une propriété héritée comme « __proto__ »). */
  const recordOf = key => (Object.hasOwn(store.clients.all(), key) ? store.clients.all()[key] : null);

  /** Enregistre la note et le « ne plus reprendre » d'une fiche ; une fiche vidée n'est pas gardée. */
  function save(input) {
    const key = typeof input?.key === 'string' ? input.key : '';
    // Une fiche marquée reste modifiable même quand ses rendez-vous ont été effacés.
    if (!known().has(key) && !recordOf(key)) return failure(404, 'Fiche introuvable : cette personne n\'a plus de rendez-vous enregistré.');
    if (typeof input.note !== 'string' || input.note.length > NOTE_MAX * 2) return failure(400, `La note est trop longue (${NOTE_MAX} caractères au plus).`);
    // Les retours à la ligne sont gardés, pas les autres caractères de commande.
    const note = input.note.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
    if (note.length > NOTE_MAX) return failure(400, `La note est trop longue (${NOTE_MAX} caractères au plus).`);
    const blocked = input.blocked === true;
    // La raison d'un « ne plus reprendre » posé par le site (annulation tardive, absence) est gardée
    // tant que la coiffeuse ne le retire pas.
    const { reason = '', markedAt = '' } = blocked ? recordOf(key) || {} : {};
    store.clients.set(key, note || blocked ? { note, blocked, ...(reason && { reason, markedAt }), updatedAt: new Date().toISOString() } : null);
    return { ok: true, clients: store.clients.all() };
  }

  /**
   * Quand les rendez-vous d'une personne sont effacés (durée de conservation), sa fiche l'est aussi,
   * sauf un « ne plus reprendre » : il reste jusqu'à ce que la coiffeuse le retire.
   */
  function purge() {
    const keys = known();
    return store.clients.removeWhere((key, record) => !keys.has(key) && !record.blocked);
  }

  /**
   * Annulation de dernière minute, rendez-vous non honoré : la fiche passe en « ne plus reprendre »,
   * avec la raison. La réservation en ligne n'est plus possible avec ce numéro.
   */
  function mark(booking, reason) {
    const key = clientKey(booking);
    const record = recordOf(key) || { note: '' };
    const now = new Date().toISOString();
    store.clients.set(key, { ...record, blocked: true, reason, markedAt: now, updatedAt: now });
    return store.clients.all();
  }

  /** Cette personne (téléphone, ou nom sans téléphone) est-elle marquée « ne plus reprendre » ? */
  const isBlocked = person => Boolean(recordOf(clientKey(person))?.blocked);

  return { save, purge, mark, isBlocked, all: () => store.clients.all() };
}

module.exports = { createClients, clientKey, normalizeName, NOTE_MAX };
