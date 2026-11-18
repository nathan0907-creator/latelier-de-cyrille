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

  /**
   * Réunit plusieurs fiches enregistrées en une seule : les notes se suivent (sans doublon), un
   * « ne plus reprendre » est gardé, une fiche créée à la main garde son nom et son téléphone.
   */
  function combine(records, identity = {}) {
    const list = records.filter(Boolean);
    if (!list.length && !identity.manual) return null;
    const notes = [...new Set(list.map(r => (r.note || '').trim()).filter(Boolean))];
    const blocked = list.find(r => r.blocked);
    const manual = identity.manual || list.some(r => r.manual);
    return {
      ...(manual && { name: identity.name, phone: identity.phone, manual: true, createdAt: list.find(r => r.createdAt)?.createdAt || new Date().toISOString() }),
      note: notes.join('\n\n').slice(0, NOTE_MAX),
      blocked: Boolean(blocked),
      ...(blocked?.reason && { reason: blocked.reason, markedAt: blocked.markedAt }),
      updatedAt: new Date().toISOString(),
    };
  }

  /** Range une fiche sous une autre clé, en réunissant ce qui s'y trouvait déjà. */
  function moveRecord(from, to, identity) {
    if (from === to || !recordOf(from)) return false;
    const merged = combine([recordOf(to), recordOf(from)], identity);
    store.clients.set(from, null);
    store.clients.set(to, merged);
    return true;
  }

  /**
   * Un rendez-vous avec téléphone vient d'être pris (en ligne ou au salon) : si la personne avait une
   * fiche rangée à son nom (rendez-vous notés sans numéro, ou fiche créée sans numéro), ses notes
   * suivent sur la fiche du numéro au lieu de rester sur une fiche à part.
   */
  function adopt(booking) {
    if (!String(booking.phone || '').replace(/\D/g, '')) return false;
    const byName = `nom:${normalizeName(booking.name)}`;
    const record = recordOf(byName);
    if (!record) return false;
    // Une fiche créée à la main sans numéro : elle reçoit celui-ci.
    const identity = record.manual ? { name: record.name, phone: booking.phone, manual: true } : {};
    return moveRecord(byName, clientKey(booking), identity);
  }

  /**
   * Rattrapage (à l'entretien) : une fiche rangée à un nom, quand une seule personne avec téléphone
   * porte ce nom, rejoint la fiche de son numéro (comme l'espace salon les affiche déjà).
   */
  function reconcile() {
    const phonesByName = new Map();
    for (const booking of store.bookings.all()) {
      if (!String(booking.phone || '').replace(/\D/g, '')) continue;
      const name = normalizeName(booking.name);
      if (!phonesByName.has(name)) phonesByName.set(name, new Map());
      phonesByName.get(name).set(clientKey(booking), booking.phone);
    }
    let moved = 0;
    for (const key of Object.keys(store.clients.all()).filter(k => k.startsWith('nom:'))) {
      const phones = phonesByName.get(key.slice(4));
      if (phones?.size !== 1) continue;
      const [[target, phone]] = phones;
      const record = recordOf(key);
      if (moveRecord(key, target, record.manual ? { name: record.name, phone, manual: true } : {})) moved += 1;
    }
    return moved;
  }

  /**
   * Réunit deux fiches de la même personne (rendez-vous notés avec un autre nom, sans le numéro…).
   * from / into : { key, ids } — la clé de la fiche et ses rendez-vous, tels que l'espace salon
   * les regroupe. Tous les rendez-vous prennent le nom de « into », et son téléphone (ou, s'il n'en
   * a pas, celui de « from ») ; les notes des deux fiches sont gardées.
   */
  function merge(input) {
    const read = side => ({
      key: typeof side?.key === 'string' ? side.key : '',
      ids: Array.isArray(side?.ids) ? side.ids.filter(id => typeof id === 'string').slice(0, 2000) : [],
    });
    const from = read(input?.from);
    const into = read(input?.into);
    if (!from.key || !into.key || from.key === into.key) return failure(400, 'Choisissez deux fiches différentes.');
    const bookingsOf = side => side.ids.map(id => store.bookings.get(id)).filter(Boolean);
    const fromBookings = bookingsOf(from);
    const intoBookings = bookingsOf(into);
    const exists = (side, list) => list.length || recordOf(side.key);
    if (!exists(from, fromBookings) || !exists(into, intoBookings)) return failure(404, 'Fiche introuvable.');

    const newest = list => [...list].sort((a, b) => b.date.localeCompare(a.date) || b.start - a.start);
    const phoneOf = (list, side) => newest(list).find(b => b.phone)?.phone || recordOf(side.key)?.phone || '';
    const name = newest(intoBookings)[0]?.name || recordOf(into.key)?.name || newest(fromBookings)[0]?.name;
    const phone = phoneOf(intoBookings, into) || phoneOf(fromBookings, from);
    const all = [...fromBookings, ...intoBookings];
    const ids = new Set(all.map(b => b.id));
    const changed = store.bookings.updateWhere(b => ids.has(b.id) && (b.name !== name || b.phone !== phone), { name, phone });

    const key = clientKey({ name, phone });
    const manual = [recordOf(from.key), recordOf(into.key)].some(r => r?.manual);
    const merged = combine([recordOf(into.key), recordOf(from.key), key !== into.key && key !== from.key ? recordOf(key) : null], manual ? { name, phone, manual: true } : {});
    for (const old of new Set([from.key, into.key])) store.clients.set(old, null);
    store.clients.set(key, merged);
    return { ok: true, key, changed, clients: store.clients.all() };
  }

  return { create, remove, save, purge, mark, isBlocked, adopt, reconcile, merge, all: () => store.clients.all() };
}

module.exports = { createClients, clientKey, normalizeName, NOTE_MAX };
