'use strict';

// Fichier clients de l'espace salon. Les fiches se déduisent des rendez-vous (une personne = un
// numéro de téléphone, ou un nom quand il n'y a pas de numéro) ; seuls la note de la coiffeuse et
// le « ne plus reprendre » sont enregistrés ici, rangés par clé de fiche.

const { cleanText, normalizePhone } = require('./bookings');

const NOTE_MAX = 1000;
const NAME_RE = /^\p{L}[\p{L}\p{M}'’ .-]{1,59}$/u;

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
  /** Ce qu'une fiche créée à la main garde quoi qu'il arrive : le nom et le téléphone saisis. */
  const identityOf = record => (record?.manual ? { name: record.name, phone: record.phone, manual: true, createdAt: record.createdAt } : {});

  /**
   * Crée une fiche à la main (une personne qui n'a pas encore de rendez-vous en ligne : une
   * habituée, quelqu'un qui a appelé…). Ses rendez-vous, saisis ensuite, s'y rangent tout seuls.
   */
  function create(input) {
    const name = cleanText(input?.name, 60);
    const fields = {};
    if (!NAME_RE.test(name)) fields.name = 'Indiquez un prénom et un nom (lettres uniquement).';
    let phone = '';
    if (cleanText(input?.phone, 30)) {
      phone = normalizePhone(input.phone);
      if (!phone) fields.phone = 'Indiquez un numéro valide, par exemple 06 12 34 56 78.';
    }
    if (Object.keys(fields).length) return { ...failure(400, 'Vérifiez les informations saisies.'), fields };
    const key = clientKey({ name, phone });
    if (known().has(key) || recordOf(key)?.manual) {
      return { ...failure(409, phone ? 'Une fiche existe déjà avec ce numéro.' : 'Une fiche existe déjà à ce nom.'), code: 'exists', key };
    }
    const note = typeof input.note === 'string' ? input.note.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, NOTE_MAX) : '';
    const now = new Date().toISOString();
    // Une personne déjà marquée « ne plus reprendre » le reste.
    const { blocked = false, reason = '', markedAt = '' } = recordOf(key) || {};
    store.clients.set(key, { name, phone, manual: true, createdAt: now, note, blocked, ...(reason && { reason, markedAt }), updatedAt: now });
    return { ok: true, key, clients: store.clients.all() };
  }

  /** Supprime une fiche créée à la main, tant qu'aucun rendez-vous n'y est rangé. */
  function remove(key) {
    const record = typeof key === 'string' ? recordOf(key) : null;
    if (!record?.manual) return failure(404, 'Fiche introuvable.');
    if (known().has(key)) return failure(409, 'Cette fiche a des rendez-vous : elle ne peut pas être supprimée.');
    store.clients.set(key, null);
    return { ok: true, clients: store.clients.all() };
  }

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
    const identity = identityOf(recordOf(key));
    store.clients.set(key, note || blocked || identity.manual ? { ...identity, note, blocked, ...(reason && { reason, markedAt }), updatedAt: new Date().toISOString() } : null);
    return { ok: true, clients: store.clients.all() };
  }

  /**
   * Quand les rendez-vous d'une personne sont effacés (durée de conservation), sa fiche l'est aussi,
   * sauf un « ne plus reprendre » : il reste jusqu'à ce que la coiffeuse le retire.
   */
  function purge() {
    const keys = known();
    // Une fiche créée à la main reste aussi : la coiffeuse la supprime elle-même.
    return store.clients.removeWhere((key, record) => !keys.has(key) && !record.blocked && !record.manual);
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

  return { create, remove, save, purge, mark, isBlocked, all: () => store.clients.all() };
}

module.exports = { createClients, clientKey, normalizeName, NOTE_MAX };
