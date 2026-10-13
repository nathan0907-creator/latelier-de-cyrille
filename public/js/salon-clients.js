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
export function groupClients(bookings, today) {
  const byKey = new Map();
  const add = (key, booking) => {
    if (!byKey.has(key)) byKey.set(key, { key, bookings: [] });
    byKey.get(key).bookings.push(booking);
  };
  for (const booking of bookings) if (digitsOf(booking.phone)) add(`tel:${digitsOf(booking.phone)}`, booking);

  const named = new Map(); // nom → fiches avec téléphone qui le portent
  for (const client of byKey.values()) {
    for (const name of new Set(client.bookings.map(b => normalizeName(b.name)))) {
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
    return {
      key: client.key,
      name: all[0].name,
      sortName: normalizeName(all[0].name),
      names: new Set(all.map(b => normalizeName(b.name))),
      phone: all.find(b => b.phone)?.phone || '',
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

  const clients = () => groupClients(state.bookings, state.today);
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
      h('p', { class: 'view-lead' }, 'Chaque personne qui a pris rendez-vous a sa fiche : ses coordonnées, ses rendez-vous, et vos notes. Elle se remplit toute seule.'),
      h('div', { class: 'list-tools' }, chips,
        h('label', { class: 'search' }, icon('search'), h('span', { class: 'sr-only' }, 'Rechercher une fiche'), input)),
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

    open.sheet.heading.textContent = client.name;
    open.sheet.body.replaceChildren(...[
      record.blocked ? h('p', { class: 'sheet-actions' }, blockedBadge()) : null,
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
        h('ul', { class: 'history-list' }, history)),
      h('div', { class: 'sheet-actions' },
        h('button', { type: 'button', class: 'btn btn--small btn--outline', onclick: () => openNewBooking({ name: client.name, phone: client.phone }) },
          icon('plus'), h('span', {}, 'Nouveau rendez-vous'))),
    ].filter(Boolean));
  }

  /** Après un changement de données : la liste, et la fiche ouverte si rien n'y est en cours de saisie. */
  function refresh() {
    render();
    if (open && !open.dirty) renderClient();
  }

  return { mount, render: refresh, openClient, clientOf, isBlocked: booking => Boolean(saved(clientOf(booking)?.key).blocked) };
}
