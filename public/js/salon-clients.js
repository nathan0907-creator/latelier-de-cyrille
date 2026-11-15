// Espace salon : le fichier clients. Les fiches se déduisent des rendez-vous — une personne, c'est
// un numéro de téléphone, ou un nom quand il n'y a pas de numéro. La coiffeuse y ajoute une note
// et peut marquer quelqu'un « à ne plus reprendre » ; seuls ces deux réglages sont enregistrés.

import { h, icon, debounce, formatLong, capitalize, frTime, euros } from './lib.js';

const NOTE_MAX = 1000;
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDay = date => DAY.format(new Date(`${date}T00:00:00Z`));
const plural = (count, one, many) => `${count} ${count > 1 ? many : one}`;
const isActive = booking => booking.status !== 'cancelled';
const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.start - a.start;

/** « Léa  DUPONT-Martin » → « lea dupont martin » (la même règle que le serveur : src/clients.js). */
const normalizeName = name => String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const digitsOf = phone => String(phone || '').replace(/\D/g, '');

/**
 * Range les rendez-vous par personne. Un rendez-vous noté sans téléphone rejoint la fiche qui porte
 * le même nom, quand il n'y en a qu'une ; sinon il forme une fiche à part, rangée par nom.
 */
export function groupClients(bookings, today, records = {}) {
  const byKey = new Map();
  // Les fiches créées à la main existent avant leur premier rendez-vous.
  for (const [key, record] of Object.entries(records)) if (record.manual) byKey.set(key, { key, bookings: [], record });
  const add = (key, booking) => {
    if (!byKey.has(key)) byKey.set(key, { key, bookings: [] });
    byKey.get(key).bookings.push(booking);
  };
  for (const booking of bookings) if (digitsOf(booking.phone)) add(`tel:${digitsOf(booking.phone)}`, booking);

  const named = new Map(); // nom → fiches avec téléphone qui le portent
  for (const client of byKey.values()) {
    if (!client.key.startsWith('tel:')) continue;
    const names = [...client.bookings.map(b => b.name), client.record?.name].filter(Boolean);
    for (const name of new Set(names.map(normalizeName))) {
      if (!named.has(name)) named.set(name, []);
      named.get(name).push(client.key);
    }
  }
  for (const booking of bookings) {
    if (digitsOf(booking.phone)) continue;
    const name = normalizeName(booking.name);
    const same = named.get(name) || [];
    add(same.length === 1 ? same[0] : `nom:${name}`, booking);
  }

  return [...byKey.values()].map(client => {
    const all = client.bookings.sort(newestFirst);
    const kept = all.filter(isActive);
    const past = kept.filter(b => b.date < today);
    const upcoming = kept.filter(b => b.date >= today);
    const counts = new Map();
    for (const booking of kept) counts.set(booking.serviceName, (counts.get(booking.serviceName) || 0) + 1);
    const usual = [...counts].sort((a, b) => b[1] - a[1])[0];
    const name = all[0]?.name || client.record.name;
    return {
      key: client.key,
      name,
      sortName: normalizeName(name),
      names: new Set([...all.map(b => b.name), client.record?.name].filter(Boolean).map(normalizeName)),
      phone: all.find(b => b.phone)?.phone || client.record?.phone || '',
      manual: Boolean(client.record),
      bookings: all,
      past,
      upcoming,
      cancelled: all.filter(b => !isActive(b)),
      last: past[0] || null,
      first: past[past.length - 1] || null,
      next: upcoming[upcoming.length - 1] || null,
      usual: usual && usual[1] > 1 ? usual[0] : '',
    };
  });
}

export function createClientsView({ state, call, toast, field, view, openSheet, openDetail, openNewBooking, statusBadge, priceText, telHref }) {
  let search = '';
  let order = 'name';
  let body = null;
  let count = null;
  let open = null; // la fiche ouverte : { key, sheet, dirty }

  const clients = () => groupClients(state.bookings, state.today, state.clients);
  const saved = key => state.clients[key] || { note: '', blocked: false };
  const blockedBadge = () => h('span', { class: 'badge badge--blocked' }, 'Ne plus reprendre');

  const summary = client => {
    const parts = [client.past.length ? plural(client.past.length, 'visite', 'visites') : 'Pas encore de visite'];
    if (client.next) parts.push(`prochain rendez-vous le ${shortDay(client.next.date)}`);
    else if (client.last) parts.push(`dernière le ${shortDay(client.last.date)}`);
    return parts.join(' · ');
  };

  function mount() {
    const input = h('input', { type: 'search', placeholder: 'Nom ou téléphone', value: search, autocomplete: 'off' });
    input.addEventListener('input', debounce(() => {
      search = input.value;
      render();
    }, 150));
    const orders = [['name', 'De A à Z'], ['recent', 'Dernière visite']];
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Classer les fiches' }, orders.map(([key, label]) => h('button', {
      type: 'button', class: 'chip', dataset: { order: key }, 'aria-pressed': String(order === key),
      onclick: () => {
        order = key;
        for (const chip of chips.children) chip.setAttribute('aria-pressed', String(chip.dataset.order === key));
        render();
      },
    }, label)));
    count = h('p', { class: 'clients-count', 'aria-live': 'polite' });
    body = h('div', {});
    view().replaceChildren(
      h('p', { class: 'view-lead' }, 'Chaque personne qui a pris rendez-vous a sa fiche : ses coordonnées, ses rendez-vous, et vos notes. Pour quelqu’un qui n’en a pas encore, créez-la à la main.'),
      h('div', { class: 'list-tools' }, chips,
        h('div', { class: 'clients-tools' },
          h('label', { class: 'search' }, icon('search'), h('span', { class: 'sr-only' }, 'Rechercher une fiche'), input),
          h('button', { type: 'button', class: 'btn btn--small btn--accent', onclick: () => openNewClient() }, icon('plus'), h('span', {}, 'Nouvelle fiche')))),
      count,
      body);
    render();
  }

  function render() {
    if (!body?.isConnected) return;
    const query = normalizeName(search);
    const digits = digitsOf(search);
    const all = clients();
    const found = all.filter(client => (!query && !digits)
      || (query && [...client.names].some(name => name.includes(query)))
      || (digits.length >= 2 && digitsOf(client.phone).includes(digits)));
    const lastDate = client => (client.last || client.next)?.date || '';
    found.sort(order === 'recent'
      ? (a, b) => lastDate(b).localeCompare(lastDate(a)) || a.sortName.localeCompare(b.sortName)
      : (a, b) => a.sortName.localeCompare(b.sortName));

    count.textContent = search.trim() ? `${plural(found.length, 'fiche trouvée', 'fiches trouvées')} sur ${all.length}` : plural(all.length, 'fiche', 'fiches');
    if (!found.length) {
      body.replaceChildren(h('p', { class: 'empty' }, all.length ? 'Aucune fiche ne correspond à cette recherche.' : 'Aucune fiche pour le moment : la première se créera avec le premier rendez-vous.'));
      return;
    }
    body.replaceChildren(...found.map(client => h('article', { class: 'row row--client' },
      h('div', { class: 'row-main' },
        h('p', { class: 'row-name' }, h('span', {}, client.name), saved(client.key).blocked ? blockedBadge() : null),
        h('p', { class: 'row-meta' },
          client.phone ? [h('a', { class: 'link', href: telHref(client.phone) }, client.phone), ' · '] : null,
          summary(client)),
        saved(client.key).note ? h('p', { class: 'row-note' }, saved(client.key).note.split('\n')[0]) : null),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn--small btn--outline', 'aria-label': `Fiche de ${client.name}`, onclick: () => openClient(client.key) }, h('span', {}, 'Fiche'))))));
  }

  /**
   * Une fiche créée à la main : le nom, le téléphone, une note. « Créer et prendre rendez-vous »
   * enchaîne sur la saisie d'un rendez-vous, nom et téléphone déjà remplis.
   */
  function openNewClient() {
    const sheet = openSheet({ eyebrow: 'Fichier clients', title: 'Nouvelle fiche' });
    const error = h('p', { class: 'notice notice--error', role: 'alert', hidden: true });
    const name = h('input', { type: 'text', maxlength: '60', autocomplete: 'off', required: true });
    const phone = h('input', { type: 'tel', inputmode: 'tel', maxlength: '30', autocomplete: 'off' });
    const note = h('textarea', { rows: '3', maxlength: String(NOTE_MAX), placeholder: 'Formule de couleur, habitudes, allergie…' });
    const create = h('button', { type: 'submit', class: 'btn btn--small', value: 'fiche' }, h('span', {}, 'Créer la fiche'), icon('check'));
    const createAndBook = h('button', { type: 'submit', class: 'btn btn--small btn--outline', value: 'rdv' }, icon('plus'), h('span', {}, 'Créer et prendre rendez-vous'));
    const actions = h('div', { class: 'sheet-actions' }, create, createAndBook);

    const form = h('form', { class: 'sheet-form client-form', novalidate: true },
      field({ id: 'nouvelle-fiche-nom', label: 'Nom du client', control: name }),
      field({ id: 'nouvelle-fiche-telephone', label: 'Téléphone', optional: true, control: phone }),
      field({ id: 'nouvelle-fiche-note', label: 'Vos notes', optional: true, control: note }),
      error,
      actions);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      error.hidden = true;
      const book = event.submitter === createAndBook;
      if (!name.value.trim()) {
        error.textContent = 'Indiquez le nom du client.';
        error.hidden = false;
        name.focus();
        return;
      }
      create.disabled = true;
      createAndBook.disabled = true;
      try {
        const result = await call('/api/salon/clients', { method: 'POST', body: { name: name.value, phone: phone.value, note: note.value } });
        state.clients = result.clients;
        render();
        const client = clients().find(c => c.key === result.key);
        toast(`La fiche de ${client?.name || name.value.trim()} est créée.`);
        if (book) openNewBooking({ name: client?.name || name.value.trim(), phone: client?.phone || '' });
        else openClient(result.key);
      } catch (err) {
        error.replaceChildren(err.data?.fields ? Object.values(err.data.fields).join(' ') : err.message);
        // Elle existe déjà : un lien pour l'ouvrir.
        if (err.data?.code === 'exists' && err.data.key) {
          error.append(' ', h('button', { type: 'button', class: 'link', onclick: () => openClient(err.data.key) }, 'Ouvrir sa fiche'));
        }
        error.hidden = false;
        create.disabled = false;
        createAndBook.disabled = false;
      }
    });
    sheet.body.replaceChildren(form);
    name.focus();
  }

  /** La fiche d'un rendez-vous donné (pour y venir depuis l'agenda). */
  const clientOf = booking => clients().find(client => client.bookings.some(b => b.id === booking.id)) || null;

  function openClient(key) {
    const client = clients().find(c => c.key === key);
    if (!client) return;
    const sheet = openSheet({ eyebrow: 'Fiche client', title: client.name });
    const entry = { key, sheet, dirty: false };
    sheet.dialog.addEventListener('close', () => {
      if (open === entry) open = null;
    });
    open = entry;
    renderClient();
  }

  function renderClient() {
    const client = clients().find(c => c.key === open.key);
    if (!client) {
      open.sheet.dialog.close();
      return;
    }
    const record = saved(client.key);
    const row = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value));
    const error = h('p', { class: 'notice notice--error', role: 'alert', hidden: true });
    const note = h('textarea', { rows: '4', maxlength: String(NOTE_MAX), placeholder: 'Formule de couleur, habitudes, allergie…' });
    note.value = record.note;
    const blockedId = 'fiche-ne-plus-reprendre';
    const blocked = h('input', { type: 'checkbox', id: blockedId, checked: record.blocked });
    const submit = h('button', { type: 'submit', class: 'btn btn--small' }, h('span', {}, 'Enregistrer'), icon('check'));
    const entry = open;
    const touched = () => { entry.dirty = true; };
    note.addEventListener('input', touched);
    blocked.addEventListener('change', touched);

    const form = h('form', { class: 'sheet-form client-form', novalidate: true },
      field({ id: 'fiche-note', label: 'Vos notes', hint: 'Vous seule les voyez.', control: note }),
      h('label', { class: 'check', for: blockedId }, blocked, h('span', {}, 'Ne plus reprendre')),
      h('p', { class: 'field-hint' }, 'Coché, la personne ne peut plus réserver en ligne avec ce numéro. Décochez pour la reprendre.'),
      error,
      h('div', { class: 'sheet-actions' }, submit));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      try {
        const result = await call('/api/salon/clients', { method: 'PUT', body: { key: client.key, note: note.value, blocked: blocked.checked } });
        state.clients = result.clients;
        entry.dirty = false;
        toast(`La fiche de ${client.name} est enregistrée.`);
        if (open === entry) renderClient();
        render();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        submit.disabled = false;
      }
    });

    const history = client.bookings.map(booking => h('li', {},
      h('button', { type: 'button', class: `history-item${isActive(booking) ? '' : ' history-item--cancelled'}`, onclick: () => openDetail(booking.id) },
        h('span', { class: 'history-when' }, h('strong', {}, shortDay(booking.date)), h('span', {}, frTime(booking.start))),
        h('span', { class: 'history-what' }, h('span', {}, booking.serviceName), h('span', {}, priceText(booking))),
        booking.date >= state.today || !isActive(booking) ? statusBadge(booking) : null)));
    const spent = client.past.reduce((sum, booking) => sum + booking.price, 0);
    // Une fiche créée à la main, sans rendez-vous : on peut la supprimer.
    const removable = client.manual && !client.bookings.length;
    const remove = async () => {
      try {
        const result = await call('/api/salon/clients', { method: 'DELETE', body: { key: client.key } });
        state.clients = result.clients;
        entry.sheet.dialog.close();
        toast(`La fiche de ${client.name} est supprimée.`);
        render();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    };
    const removeBox = h('div', { class: 'sheet-actions', hidden: true },
      h('p', { class: 'sheet-question' }, `Supprimer la fiche de ${client.name} ?`),
      h('button', { type: 'button', class: 'btn btn--small btn--danger', onclick: remove }, h('span', {}, 'Oui, supprimer'), icon('trash')),
      h('button', { type: 'button', class: 'btn btn--small btn--outline', onclick: () => { removeBox.hidden = true; } }, h('span', {}, 'Non')));

    open.sheet.heading.textContent = client.name;
    open.sheet.body.replaceChildren(...[
      record.blocked ? h('p', { class: 'sheet-actions' }, blockedBadge()) : null,
      // Posé par le site : annulation de dernière minute, ou rendez-vous non honoré.
      record.blocked && record.reason ? h('p', { class: 'notice notice--error' }, `${record.reason}.`) : null,
      h('dl', { class: 'detail-list' },
        client.phone ? row('Téléphone', h('a', { class: 'link', href: telHref(client.phone) }, client.phone)) : null,
        row('Visites', client.past.length ? `${client.past.length}, depuis le ${shortDay(client.first.date)}` : 'Aucune pour le moment'),
        client.last ? row('Dernière visite', `${capitalize(formatLong(client.last.date))} · ${client.last.serviceName}`) : null,
        client.next ? row('Prochain rendez-vous', `${capitalize(formatLong(client.next.date))} à ${frTime(client.next.start)}`) : null,
        client.usual ? row('Prestation habituelle', client.usual) : null,
        client.past.length ? row('Total des visites', `${euros(spent)} (tarifs de la carte)`) : null,
        client.cancelled.length ? row('Rendez-vous annulés', String(client.cancelled.length)) : null),
      form,
      h('section', { class: 'history', 'aria-labelledby': 'fiche-historique' },
        h('h3', { id: 'fiche-historique', class: 'history-title' }, 'Historique', h('small', {}, plural(client.bookings.length, 'rendez-vous', 'rendez-vous'))),
        history.length ? h('ul', { class: 'history-list' }, history) : h('p', { class: 'field-hint' }, 'Aucun rendez-vous pour le moment.')),
      h('div', { class: 'sheet-actions' },
        h('button', { type: 'button', class: `btn btn--small${history.length ? ' btn--outline' : ''}`, onclick: () => openNewBooking({ name: client.name, phone: client.phone }) },
          icon('plus'), h('span', {}, 'Nouveau rendez-vous')),
        removable ? h('button', { type: 'button', class: 'btn btn--small btn--outline', onclick: () => { removeBox.hidden = false; } }, icon('trash'), h('span', {}, 'Supprimer la fiche')) : null),
      removable ? removeBox : null,
    ].filter(Boolean));
  }

  /** Après un changement de données : la liste, et la fiche ouverte si rien n'y est en cours de saisie. */
  function refresh() {
    render();
    if (open && !open.dirty) renderClient();
  }

  return { mount, render: refresh, openClient, clientOf, isBlocked: booking => Boolean(saved(clientOf(booking)?.key).blocked) };
}
