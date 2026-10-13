// Espace salon : connexion, agenda du jour, liste des rendez-vous, fichier clients (salon-clients.js),
// fermetures, fréquentation, et les réglages que la coiffeuse fait elle-même (tarifs, horaires, photos : salon-reglages.js).
// Rien n'est chargé tant que la coiffeuse n'est pas connectée ; ensuite tout arrive en direct.

import {
  h, icon, api, animate, readPageData, debounce, addDays, addMonths, daysInMonth, mondayIndex, formatLong, formatShort,
  formatMonth, capitalize, pad2, fromMinutes, frTime, durationLabel, euros,
} from './lib.js';
import { createSettingsViews } from './salon-reglages.js';
import { createClientsView } from './salon-clients.js';

const root = document.querySelector('[data-salon]');
const toastBox = document.querySelector('[data-toasts]');
const config = readPageData();
const BASE_TITLE = document.title;
const ALERTS_KEY = 'salon-alertes';

const state = {
  today: '',
  nowMinutes: 0,
  bookings: [],
  closures: [],
  clients: {}, // notes et « ne plus reprendre », par clé de fiche
  holidays: { auto: true, list: [] }, // jours fériés à venir, fermés d'office sauf ceux qu'elle ouvre
  tab: 'day',
  day: '',
  filter: 'upcoming',
  search: '',
  fresh: new Set(), // rendez-vous à mettre en évidence quelques secondes
  alerts: readAlertsPreference(),
};

const refs = {};
// Le compte a-t-il un identifiant ? (Un compte créé avant leur arrivée n'a qu'un mot de passe.)
let accountHasUsername = true;
let source = null;
let clock = null;
let detail = null;
let audio = null;

// ── Petits outils ─────────────────────────────────────────────────────────

/** 0 = dimanche … 6 = samedi, comme les horaires de la configuration. */
const weekday = date => (mondayIndex(date) + 1) % 7;
const isActive = booking => booking.status !== 'cancelled';
const byTime = (a, b) => a.date.localeCompare(b.date) || a.start - b.start;
const bookingsOn = date => state.bookings.filter(b => b.date === date).sort(byTime);
const telHref = phone => `tel:${phone.replace(/[^\d+]/g, '')}`;
const hoursLabel = booking => `${frTime(booking.start)} – ${frTime(booking.start + booking.duration)}`;
const whenLabel = booking => `${capitalize(formatLong(booking.date))} à ${frTime(booking.start)}`;
const plural = (count, one, many) => `${count} ${count > 1 ? many : one}`;

/** La fermeture d'un jour : saisie par la coiffeuse (congés…), ou jour férié fermé d'office. */
function closureOn(date) {
  const saved = state.closures.find(c => c.date === date);
  if (saved) return saved;
  const holiday = state.holidays.list.find(day => day.date === date && !day.open);
  return holiday ? { date, reason: `jour férié (${holiday.name})` } : null;
}

const STATUS = { pending: 'À confirmer', confirmed: 'Confirmé', cancelled: 'Annulé' };
const statusBadge = booking => h('span', { class: `badge badge--${booking.status}` }, STATUS[booking.status]);

function readAlertsPreference() {
  try {
    return localStorage.getItem(ALERTS_KEY) === 'oui';
  } catch {
    return false;
  }
}

function field({ id, label, optional = false, hint = '', control }) {
  control.id = id;
  if (hint) control.setAttribute('aria-describedby', `${id}-aide`);
  return h('div', { class: 'field' },
    h('label', { for: id }, label, optional ? h('span', { class: 'optional' }, ' (facultatif)') : null),
    control,
    hint ? h('p', { class: 'field-hint', id: `${id}-aide` }, hint) : null);
}

/** « 13 € », ou « dès 25 € » quand le prix dépend de la longueur des cheveux. */
const priceText = item => `${item.priceFrom ? 'dès ' : ''}${euros(item.price)}`;

function brand() {
  return h('a', { class: 'brand', href: '/', 'aria-label': `${config.name}, voir le site` }, config.name);
}

/** Appel réservé à une session connectée : une session expirée ramène à la connexion. */
async function call(path, options) {
  try {
    return await api(path, options);
  } catch (err) {
    if (err.status === 401) signedOut('Votre session a expiré. Reconnectez-vous.');
    throw err;
  }
}

// ── Messages ──────────────────────────────────────────────────────────────

function toast(message, { title = '', detail: more = '', action = null, type = '', duration = 6500 } = {}) {
  const box = h('div', { class: `toast${type ? ` toast--${type}` : ''}` });
  const dismiss = () => {
    if (!box.isConnected || box.classList.contains('is-leaving')) return;
    box.classList.add('is-leaving');
    setTimeout(() => box.remove(), 350);
  };
  box.append(...[
    title && h('strong', {}, title),
    h('span', {}, message),
    more && h('span', {}, more),
    action && h('button', { type: 'button', class: 'link', onclick: () => { action.run(); dismiss(); } }, action.label),
  ].filter(Boolean));
  toastBox.append(box);
  setTimeout(dismiss, duration);
}

/** Deux notes brèves, produites par le navigateur (aucun fichier son). */
function chime() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const start = audio.currentTime;
    for (const [frequency, at] of [[880, 0], [1174.66, 0.15]]) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(0.18, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.5);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start + at);
      oscillator.stop(start + at + 0.55);
    }
  } catch {
    // Pas de son disponible : l'alerte visuelle suffit.
  }
}

async function toggleAlerts() {
  state.alerts = !state.alerts;
  try {
    localStorage.setItem(ALERTS_KEY, state.alerts ? 'oui' : 'non');
  } catch {
    // Préférence non mémorisée (navigation privée).
  }
  refs.bell.setAttribute('aria-pressed', String(state.alerts));
  if (!state.alerts) {
    toast('Alertes désactivées.');
    return;
  }
  chime();
  let system = false;
  if ('Notification' in window) {
    if (Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
    system = Notification.permission === 'granted';
  }
  toast(system
    ? 'Un son et une notification à chaque nouveau rendez-vous.'
    : 'Un son à chaque nouveau rendez-vous, tant que cette page reste ouverte.', { title: 'Alertes activées' });
}

function announce(booking) {
  toast(`${booking.name} · ${booking.serviceName}`, {
    title: 'Nouveau rendez-vous',
    detail: whenLabel(booking),
    action: { label: 'Voir le rendez-vous', run: () => openDetail(booking.id) },
    duration: 9000,
  });
  if (!state.alerts) return;
  chime();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('Nouveau rendez-vous', { body: `${booking.name} · ${booking.serviceName}\n${whenLabel(booking)}`, tag: booking.id });
    } catch {
      // Certains navigateurs mobiles refusent ce constructeur : le son et le message restent.
    }
  }
}

// ── Connexion ─────────────────────────────────────────────────────────────

/** Où trouver le code de configuration, selon l'endroit où tourne le site. */
const CODE_HINTS = {
  console: 'Il est affiché dans la fenêtre du serveur, au démarrage.',
  secret: "C'est la valeur du secret SETUP_CODE, dans les réglages du site sur Cloudflare.",
};
let codeSource = 'console';

function showAuth(mode, notice = '') {
  disconnect();
  closeSheets();
  document.title = BASE_TITLE;
  const setup = mode === 'setup';
  const error = h('p', { class: 'notice notice--error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn--accent' },
    h('span', {}, setup ? "Créer l'accès" : 'Se connecter'), icon('arrow-right'));

  const fail = message => {
    error.textContent = message;
    error.hidden = false;
  };

  const withUsername = setup || accountHasUsername;
  const form = h('form', { class: 'auth-form', novalidate: true },
    setup && field({
      id: 'acces-code',
      label: 'Code de configuration',
      hint: CODE_HINTS[codeSource] || CODE_HINTS.console,
      control: h('input', { name: 'code', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '64', required: true }),
    }),
    withUsername
      ? field({
        id: 'acces-identifiant',
        label: setup ? 'Choisissez un identifiant' : 'Identifiant',
        hint: setup ? 'Votre prénom ou votre adresse e-mail, par exemple. Il vous sera demandé à chaque connexion.' : '',
        control: h('input', { name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '60', required: true }),
      })
      // Compte ancien, sans identifiant : ce champ caché aide le gestionnaire de mots de passe à s'y retrouver.
      : h('input', { class: 'sr-only', type: 'text', name: 'username', autocomplete: 'username', value: 'salon', tabindex: '-1', 'aria-hidden': 'true', readonly: true }),
    field({
      id: 'acces-mot-de-passe',
      label: setup ? 'Choisissez un mot de passe' : 'Mot de passe',
      hint: setup ? '10 caractères au minimum. Une phrase facile à retenir convient très bien.' : '',
      control: h('input', { name: 'password', type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true }),
    }),
    setup && field({
      id: 'acces-confirmation',
      label: 'Confirmez le mot de passe',
      control: h('input', { name: 'confirm', type: 'password', autocomplete: 'new-password', required: true }),
    }),
    error,
    submit);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.hidden = true;
    const values = Object.fromEntries(new FormData(form));
    if (withUsername && values.username.trim().length < 3) return fail(setup ? 'Choisissez un identifiant de 3 caractères au moins.' : 'Saisissez votre identifiant.');
    if (setup && values.password.length < 10) return fail('Le mot de passe doit contenir au moins 10 caractères.');
    if (setup && values.password !== values.confirm) return fail('Les deux mots de passe ne sont pas identiques.');
    if (!values.password) return fail('Saisissez votre mot de passe.');
    submit.disabled = true;
    try {
      await api(setup ? '/api/salon/setup' : '/api/salon/login', {
        method: 'POST',
        body: setup ? { code: values.code, username: values.username, password: values.password } : { username: values.username, password: values.password },
      });
      if (setup) accountHasUsername = true;
      await enter();
    } catch (err) {
      fail(err.message);
      submit.disabled = false;
    }
    return undefined;
  });

  root.replaceChildren(h('div', { class: 'auth' },
    h('div', { class: 'auth-card' },
      brand(),
      h('p', { class: 'eyebrow' }, 'Espace salon'),
      h('h1', { class: 'auth-title' }, setup ? 'Première connexion' : `Bonjour${config.owner ? ` ${config.owner}` : ''}`),
      h('p', { class: 'auth-lead' }, setup
        ? "Créez l'identifiant et le mot de passe qui protégeront l'agenda et les coordonnées de vos clients."
        : 'Connectez-vous pour voir vos rendez-vous.'),
      notice && h('p', { class: 'notice' }, notice),
      form,
      h('a', { class: 'link', href: '/' }, 'Retour au site'))));
  form.querySelector('input:not([readonly])').focus();
}

function signedOut(message) {
  if (!state.today) return; // déjà sur l'écran de connexion
  state.today = '';
  showAuth('login', message);
}

async function logout() {
  try {
    await api('/api/salon/logout', { method: 'POST' });
  } catch {
    // Même si le serveur ne répond pas, on quitte l'écran.
  }
  state.today = '';
  showAuth('login');
}

// ── Données et temps réel ─────────────────────────────────────────────────

async function loadData() {
  const data = await call('/api/salon/data');
  const followToday = !state.day || state.day === state.today;
  state.today = data.today;
  state.nowMinutes = data.nowMinutes;
  state.bookings = data.bookings;
  state.closures = data.closures;
  state.clients = data.clients || {};
  state.holidays = data.holidays || state.holidays;
  // La carte et les horaires peuvent avoir été modifiés depuis l'ouverture de la page.
  config.services = data.services;
  config.hours = data.hours;
  if (followToday) state.day = data.today;
}

function upsert(booking) {
  const index = state.bookings.findIndex(b => b.id === booking.id);
  if (index === -1) state.bookings.push(booking);
  else state.bookings[index] = booking;
  refresh();
}

function drop(id) {
  state.bookings = state.bookings.filter(b => b.id !== id);
  refresh();
}

function markFresh(id) {
  state.fresh.add(id);
  setTimeout(() => state.fresh.delete(id), 3000);
}

function setLive(live) {
  refs.live?.classList.toggle('is-off', !live);
  if (refs.live) refs.live.lastElementChild.textContent = live ? 'En direct' : 'Reconnexion…';
}

function disconnect() {
  source?.close();
  source = null;
  clearInterval(clock);
}

function connect() {
  disconnect();
  let dropped = false;
  source = new EventSource('/api/salon/events');

  source.addEventListener('open', () => {
    setLive(true);
    if (dropped) loadData().then(refresh).catch(() => {});
    dropped = false;
  });

  source.addEventListener('error', async () => {
    dropped = true;
    setLive(false);
    try {
      const session = await api('/api/salon/session');
      if (!session.authenticated) signedOut('Votre session a expiré. Reconnectez-vous.');
    } catch {
      // Serveur injoignable : EventSource réessaie tout seul.
    }
  });

  source.addEventListener('booking', event => {
    const { kind, booking } = JSON.parse(event.data);
    if (kind === 'deleted') {
      drop(booking.id);
      return;
    }
    const known = state.bookings.find(b => b.id === booking.id);
    const isNew = kind === 'created' && !known;
    // Le client vient d'annuler lui-même, depuis sa page « Votre rendez-vous ».
    const clientCancelled = booking.cancelledBy === 'client' && booking.status === 'cancelled' && known && known.status !== 'cancelled';
    if (isNew) markFresh(booking.id);
    upsert(booking);
    if (isNew && booking.source === 'online') announce(booking);
    if (clientCancelled) {
      if (state.alerts) chime();
      toast(`${booking.name} · ${whenLabel(booking)}`, {
        title: 'Annulé par le client', detail: 'Le créneau est de nouveau proposé en ligne.', duration: 15_000,
        action: { label: 'Voir', run: () => openDetail(booking.id) },
      });
    }
  });

  // Une fiche client modifiée depuis un autre appareil.
  source.addEventListener('clients', event => {
    state.clients = JSON.parse(event.data).clients;
    refresh();
  });

  source.addEventListener('closures', event => {
    const data = JSON.parse(event.data);
    state.closures = data.closures;
    state.holidays = data.holidays || state.holidays;
    refresh();
  });

  // L'heure avance : la ligne « maintenant » suit, et les données sont resynchronisées de temps en temps.
  let minutes = 0;
  clock = setInterval(() => {
    minutes += 1;
    state.nowMinutes += 1;
    if (state.nowMinutes >= 1440 || minutes % 10 === 0) loadData().then(refresh).catch(() => {});
    else placeNowLine();
  }, 60_000);
}

async function enter() {
  await loadData();
  mountDashboard();
  connect();
}

// ── Tableau de bord ───────────────────────────────────────────────────────

const TABS = [
  { key: 'day', label: 'Journée', icon: 'calendar' },
  { key: 'list', label: 'Rendez-vous', icon: 'list' },
  { key: 'clients', label: 'Clients', icon: 'users' },
  { key: 'closures', label: 'Fermetures', icon: 'ban' },
  { key: 'prices', label: 'Tarifs', icon: 'tag' },
  { key: 'hours', label: 'Horaires', icon: 'clock' },
  { key: 'photos', label: 'Photos', icon: 'image' },
  { key: 'audience', label: 'Fréquentation', icon: 'eye' },
];

// Tarifs, horaires, photos : après un enregistrement, l'agenda relit la carte et les horaires.
const settingsViews = createSettingsViews({
  call, toast, field,
  view: () => refs.view,
  onSaved: async () => {
    await loadData();
    renderStats();
  },
});

// Le fichier clients : une fiche par personne, déduite des rendez-vous.
const clientsView = createClientsView({
  state, call, toast, field, openSheet, openDetail, openNewBooking, statusBadge, priceText, telHref,
  view: () => refs.view,
});

function mountDashboard() {
  refs.live = h('span', { class: 'salon-live' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', {}, 'En direct'));
  refs.bell = h('button', {
    type: 'button', class: 'icon-btn', 'aria-pressed': String(state.alerts),
    'aria-label': 'Alertes à chaque nouveau rendez-vous', title: 'Alertes à chaque nouveau rendez-vous', onclick: toggleAlerts,
  }, icon('bell'));
  refs.stats = h('section', { class: 'stats', 'aria-label': "En un coup d'œil" });
  refs.pending = h('span', { class: 'count', hidden: true });
  refs.tabs = h('nav', { class: 'views', 'aria-label': 'Vues' }, TABS.map(tab => h('button', {
    type: 'button', class: 'view-tab', dataset: { tab: tab.key }, 'aria-pressed': 'false', onclick: () => setTab(tab.key),
  }, icon(tab.icon), tab.label, tab.key === 'list' ? refs.pending : null)));
  refs.view = h('section', { class: 'view' });

  root.replaceChildren(
    h('header', { class: 'salon-bar' },
      brand(),
      refs.live,
      h('div', { class: 'salon-bar-actions' },
        h('button', { type: 'button', class: 'btn btn--small btn--accent', onclick: () => openNewBooking() }, icon('plus'), h('span', {}, 'Rendez-vous')),
        refs.bell,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Changer le mot de passe', title: 'Changer le mot de passe', onclick: openPassword }, icon('lock')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Se déconnecter', title: 'Se déconnecter', onclick: logout }, icon('logout')))),
    h('div', { class: 'salon-body' },
      h('h1', { class: 'sr-only' }, 'Espace salon'),
      refs.stats,
      refs.tabs,
      refs.view));

  setTab(state.tab);
  renderStats();
}

function renderStats() {
  const active = state.bookings.filter(isActive);
  const today = active.filter(b => b.date === state.today);
  const weekEnd = addDays(state.today, 6);
  const pending = active.filter(b => b.status === 'pending' && b.date >= state.today).length;
  const cards = [
    { value: today.length, label: "Aujourd'hui" },
    { value: pending, label: 'À confirmer', alert: pending > 0 },
    { value: active.filter(b => b.date >= state.today && b.date <= weekEnd).length, label: 'Sur 7 jours' },
    { value: euros(today.reduce((sum, b) => sum + b.price, 0)), label: "À encaisser aujourd'hui" },
  ];
  refs.stats.replaceChildren(...cards.map(card => h('div', { class: `stat${card.alert ? ' stat--alert' : ''}` },
    h('strong', {}, String(card.value)), h('span', {}, card.label))));

  refs.pending.hidden = pending === 0;
  refs.pending.textContent = String(pending);
  refs.pending.setAttribute('aria-label', `${pending} à confirmer`);
  document.title = `${pending ? `(${pending}) ` : ''}${BASE_TITLE}`;
}

const VIEWS = {
  day: { mount: mountDay, render: renderDay },
  list: { mount: mountList, render: renderList },
  clients: { mount: clientsView.mount, render: () => {} }, // redessiné par refresh(), avec la fiche ouverte
  closures: { mount: mountClosures, render: renderClosures },
  audience: { mount: mountAudience, render: () => {} },
  // Ces vues sont des formulaires : l'arrivée d'un rendez-vous ne doit pas les redessiner.
  prices: { mount: settingsViews.mountPrices, render: () => {} },
  hours: { mount: settingsViews.mountHours, render: () => {} },
  photos: { mount: settingsViews.mountPhotos, render: () => {} },
};

function setTab(tab) {
  state.tab = tab;
  for (const button of refs.tabs.querySelectorAll('.view-tab')) button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
  VIEWS[tab].mount();
  animate(refs.view, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 420 });
}

/** Après tout changement de données : chiffres, vue courante et fiche ouverte. */
function refresh() {
  if (!state.today || !refs.view) return;
  renderStats();
  VIEWS[state.tab].render();
  clientsView.render();
  refreshDetail();
}

// ── Vue « Journée » ───────────────────────────────────────────────────────

function mountDay() {
  refs.dayTitle = h('h2', { class: 'day-title', 'aria-live': 'polite' });
  refs.todayButton = h('button', { type: 'button', class: 'btn btn--small btn--outline', onclick: () => setDay(state.today) }, h('span', {}, "Aujourd'hui"));
  refs.dayPicker = h('input', {
    type: 'date', class: 'day-picker', 'aria-label': 'Aller à une date',
    onchange: event => { if (event.target.value) setDay(event.target.value); },
  });
  refs.dayBody = h('div', {});
  refs.view.replaceChildren(
    h('div', { class: 'day-nav' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Jour précédent', onclick: () => setDay(addDays(state.day, -1)) }, icon('chevron-left')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Jour suivant', onclick: () => setDay(addDays(state.day, 1)) }, icon('chevron-right')),
      refs.dayTitle,
      refs.todayButton,
      refs.dayPicker),
    refs.dayBody);
  renderDay();
}

function setDay(date) {
  state.day = date;
  renderDay();
  animate(refs.dayBody, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
}

function renderDay() {
  const date = state.day;
  refs.dayTitle.textContent = capitalize(formatLong(date));
  refs.todayButton.disabled = date === state.today;
  refs.dayPicker.value = date;

  const closure = closureOn(date);
  const ranges = dayRanges(date);
  const all = bookingsOn(date);
  const active = all.filter(isActive);
  const cancelled = all.filter(b => !isActive(b));
  const parts = [];
  const why = closure?.reason ? ` (${closure.reason})` : '';

  if (closure && !closure.hours) parts.push(h('p', { class: 'banner' }, icon('ban'), `Salon fermé ce jour-là${closure.reason ? ` : ${closure.reason}` : ''}.`));
  else if (closure) parts.push(h('p', { class: 'banner' }, icon('clock'), `Ce jour-là, le salon est ${specialLabel(date, ranges)}${why}.`));
  else if (!ranges.length) parts.push(h('p', { class: 'banner' }, icon('ban'), 'Jour de fermeture habituel.'));

  if (ranges.length || active.length) parts.push(timeline(date, ranges, active));
  else parts.push(h('p', { class: 'empty' }, 'Aucun rendez-vous ce jour-là.'));

  if (cancelled.length) {
    parts.push(h('details', { class: 'cancelled-box' },
      h('summary', {}, plural(cancelled.length, 'rendez-vous annulé', 'rendez-vous annulés')),
      cancelled.map(bookingRow)));
  }
  refs.dayBody.replaceChildren(...parts);
  placeNowLine();
}

function timeline(date, ranges, bookings) {
  const step = config.slotStep;
  // Les heures habituelles restent visibles (hachurées) quand certaines sont bloquées ce jour-là.
  const span = [...ranges, ...usualHours(date)];
  let from = span.length ? Math.min(...span.map(range => range.start)) : 9 * 60;
  let to = span.length ? Math.max(...span.map(range => range.end)) : 18 * 60;
  for (const booking of bookings) {
    from = Math.min(from, Math.floor(booking.start / step) * step);
    to = Math.max(to, Math.ceil((booking.start + booking.duration) / step) * step);
  }

  const rows = [];
  for (let minute = from; minute < to; minute += step) {
    const open = ranges.some(range => minute >= range.start && minute < range.end);
    rows.push(h('div', { class: `timeline-row${open ? '' : ' is-closed'}${minute % 60 === 0 ? ' is-hour' : ''}` },
      h('span', { class: 'timeline-time' }, minute % 60 === 0 ? frTime(minute) : ''),
      open && date >= state.today
        ? h('button', {
          type: 'button', class: 'timeline-add', 'aria-label': `Ajouter un rendez-vous à ${frTime(minute)}`,
          onclick: () => openNewBooking({ date, time: fromMinutes(minute) }),
        }, icon('plus'))
        : null));
  }

  const layer = h('div', { class: 'timeline-layer' }, bookings.map(booking => {
    const block = h('button', {
      type: 'button',
      class: `block block--${booking.status}${state.fresh.has(booking.id) ? ' is-fresh' : ''}`,
      'aria-label': `${booking.name}, ${booking.serviceName}, ${hoursLabel(booking)}, ${STATUS[booking.status]}`,
      onclick: () => openDetail(booking.id),
    },
    h('span', { class: 'block-name' }, booking.name),
    h('span', { class: 'block-meta' }, `${hoursLabel(booking)} · ${booking.serviceName}`),
    booking.status === 'pending' ? statusBadge(booking) : null);
    // Avec des temps de pose, le bloc s'arrête à la première pose : la place est libre pour quelqu'un d'autre…
    const pauses = booking.pauses || (booking.pauseDuration ? [{ after: booking.pauseAfter, duration: booking.pauseDuration }] : []);
    const place = (el, begin, end) => {
      el.style.top = `calc(${(booking.start + begin - from) / step} * var(--row-h))`;
      el.style.height = `calc(${(end - begin) / step} * var(--row-h) - 4px)`;
      return el;
    };
    place(block, 0, pauses.length ? pauses[0].after : booking.duration);
    // … et un bloc marque chaque reprise, après une pose.
    return [block, ...pauses.map((pause, i) => {
      const resume = pause.after + pause.duration;
      return place(h('button', {
        type: 'button', class: `block block--${booking.status} block--rest`,
        'aria-label': `${booking.name}, suite après la pose, à ${frTime(booking.start + resume)}`,
        onclick: () => openDetail(booking.id),
      }, h('span', { class: 'block-name' }, booking.name), h('span', { class: 'block-meta' }, `Suite après la pose · ${frTime(booking.start + resume)}`)),
      resume, pauses[i + 1] ? pauses[i + 1].after : booking.duration);
    })];
  }));

  refs.nowLine = null;
  if (date === state.today) {
    refs.nowLine = h('div', { class: 'timeline-now', 'aria-hidden': 'true', hidden: true }, h('span', {}));
    refs.nowLine.dataset.from = String(from);
    refs.nowLine.dataset.to = String(to);
    layer.append(refs.nowLine);
  }
  return h('div', { class: 'timeline' }, rows, layer);
}

/** Place (ou cache) le trait doré de l'heure courante sur l'agenda d'aujourd'hui. */
function placeNowLine() {
  const line = refs.nowLine;
  if (!line || !line.isConnected) return;
  const from = Number(line.dataset.from);
  const to = Number(line.dataset.to);
  line.hidden = state.nowMinutes < from || state.nowMinutes > to;
  line.style.top = `calc(${(state.nowMinutes - from) / config.slotStep} * var(--row-h))`;
  line.firstElementChild.textContent = frTime(state.nowMinutes);
}

// ── Vue « Tous les rendez-vous » ──────────────────────────────────────────

const FILTERS = [
  { key: 'upcoming', label: 'À venir', test: b => isActive(b) && b.date >= state.today },
  { key: 'pending', label: 'À confirmer', test: b => b.status === 'pending' && b.date >= state.today },
  { key: 'past', label: 'Passés', test: b => isActive(b) && b.date < state.today, newestFirst: true },
  { key: 'cancelled', label: 'Annulés', test: b => !isActive(b), newestFirst: true },
];

function mountList() {
  refs.chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrer les rendez-vous' }, FILTERS.map(filter => h('button', {
    type: 'button', class: 'chip', dataset: { filter: filter.key }, 'aria-pressed': String(state.filter === filter.key),
    onclick: () => {
      state.filter = filter.key;
      for (const chip of refs.chips.children) chip.setAttribute('aria-pressed', String(chip.dataset.filter === filter.key));
      renderList();
    },
  }, filter.label)));
  const search = h('input', { type: 'search', placeholder: 'Nom ou téléphone', value: state.search, autocomplete: 'off' });
  search.addEventListener('input', debounce(() => {
    state.search = search.value;
    renderList();
  }, 150));
  refs.listBody = h('div', {});
  refs.view.replaceChildren(
    h('div', { class: 'list-tools' },
      refs.chips,
      h('label', { class: 'search' }, icon('search'), h('span', { class: 'sr-only' }, 'Rechercher un client'), search)),
    refs.listBody);
  renderList();
}

function renderList() {
  const filter = FILTERS.find(f => f.key === state.filter);
  const query = state.search.trim().toLowerCase();
  const digits = query.replace(/\D/g, '');
  const matches = booking => !query
    || booking.name.toLowerCase().includes(query)
    || (digits.length >= 2 && booking.phone.replace(/\D/g, '').includes(digits));

  const found = state.bookings.filter(b => filter.test(b) && matches(b)).sort(byTime);
  if (filter.newestFirst) found.reverse();
  if (!found.length) {
    refs.listBody.replaceChildren(h('p', { class: 'empty' }, query ? 'Aucun rendez-vous ne correspond à cette recherche.' : 'Aucun rendez-vous ici pour le moment.'));
    return;
  }

  const nodes = [];
  let current = '';
  for (const booking of found) {
    if (booking.date !== current) {
      current = booking.date;
      const tag = current === state.today ? "Aujourd'hui" : current === addDays(state.today, 1) ? 'Demain' : '';
      nodes.push(h('h2', { class: 'group-title' }, capitalize(formatLong(current)), tag ? h('small', {}, tag) : null));
    }
    nodes.push(bookingRow(booking));
  }
  refs.listBody.replaceChildren(...nodes);
}

function bookingRow(booking) {
  return h('article', { class: `row row--${booking.status}${state.fresh.has(booking.id) ? ' is-fresh' : ''}` },
    h('div', { class: 'row-time' }, h('strong', {}, frTime(booking.start)), h('span', {}, `jusqu'à ${frTime(booking.start + booking.duration)}`)),
    h('div', { class: 'row-main' },
      h('p', { class: 'row-name' }, h('span', {}, booking.name), statusBadge(booking)),
      h('p', { class: 'row-meta' }, `${booking.serviceName} · ${priceText(booking)}`,
        booking.phone ? [' · ', h('a', { class: 'link', href: telHref(booking.phone) }, booking.phone)] : null),
      booking.note ? h('p', { class: 'row-note' }, `« ${booking.note} »`) : null),
    h('div', { class: 'row-actions' },
      booking.status === 'pending'
        ? h('button', { type: 'button', class: 'btn btn--small', 'aria-label': `Confirmer le rendez-vous de ${booking.name}`, onclick: () => quickConfirm(booking.id) }, h('span', {}, 'Confirmer'), icon('check'))
        : null,
      h('button', { type: 'button', class: 'btn btn--small btn--outline', 'aria-label': `Détails du rendez-vous de ${booking.name}`, onclick: () => openDetail(booking.id) }, h('span', {}, 'Détails'))));
}

async function quickConfirm(id) {
  try {
    const { booking } = await call(`/api/salon/bookings/${id}`, { method: 'PATCH', body: { status: 'confirmed' } });
    upsert(booking);
  } catch (err) {
    toast(err.message, { type: 'error' });
  }
}

// ── Vue « Fermetures » ────────────────────────────────────────────────────
// Un calendrier : un clic sur un jour pour le fermer, bloquer quelques heures ou changer ses horaires.
// Un jour particulier remplace les horaires habituels : sans « hours », fermé toute la journée ;
// avec, ouvert seulement pendant ces plages.

function mountClosures() {
  state.closureMonth ||= state.today.slice(0, 7);
  const move = n => {
    state.closureMonth = addMonths(state.closureMonth, n);
    renderClosures();
    animate(refs.closureCalendar, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  };
  refs.closureTitle = h('h2', { class: 'day-title', 'aria-live': 'polite' });
  refs.closurePrev = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mois précédent', onclick: () => move(-1) }, icon('chevron-left'));
  refs.closureCalendar = h('div', { class: 'cal', role: 'group', 'aria-labelledby': 'mois-fermetures' });
  refs.closureTitle.id = 'mois-fermetures';
  refs.closureList = h('div', {});
  refs.holidayList = h('section', { class: 'holidays', 'aria-labelledby': 'feries-titre' });
  refs.view.replaceChildren(
    h('p', { class: 'view-lead' }, "Touchez un jour pour le fermer, bloquer quelques heures ou changer ses horaires. Ces heures ne sont plus proposées à la réservation, et une fermeture d'une journée ou plus est annoncée sur le site. Les rendez-vous déjà pris restent enregistrés : pensez à prévenir les clients concernés."),
    h('div', { class: 'day-nav' },
      refs.closurePrev,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mois suivant', onclick: () => move(1) }, icon('chevron-right')),
      refs.closureTitle),
    refs.closureCalendar,
    h('h3', { class: 'group-title' }, 'À venir'),
    refs.closureList,
    refs.holidayList);
  renderClosures();
}

/**
 * Jours fériés : le salon est fermé ces jours-là sans rien avoir à saisir. La coiffeuse peut en
 * ouvrir un (elle travaille ce jour-là), ou arrêter la fermeture automatique.
 */
function renderHolidays() {
  const { auto, list } = state.holidays;
  const change = async (body, message) => {
    try {
      const { holidays } = await call('/api/salon/holidays', { method: 'PUT', body });
      state.holidays = holidays;
      refresh();
      toast(message);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  };
  const toggle = h('input', {
    type: 'checkbox', id: 'feries-auto', checked: auto,
    onchange: event => change({ auto: event.target.checked }, event.target.checked
      ? 'Le salon est fermé les jours fériés. C\'est annoncé sur le site.'
      : 'Les jours fériés sont ouverts comme les autres jours.'),
  });
  refs.holidayList.replaceChildren(
    h('h2', { class: 'group-title', id: 'feries-titre' }, 'Jours fériés'),
    h('label', { class: 'check', for: 'feries-auto' }, toggle, h('span', {}, 'Fermer le salon les jours fériés')),
    h('p', { class: 'view-lead' }, auto
      ? "Ces jours-là sont fermés d'office et annoncés sur le site, sans rien avoir à saisir. Vous travaillez l'un d'eux ? Ouvrez-le : il sera proposé à la réservation, à vos horaires habituels."
      : 'La fermeture automatique est arrêtée : les jours fériés sont ouverts à vos horaires habituels. Pour en fermer un, touchez-le dans le calendrier ci-dessus.'),
    ...list.map(day => {
      const affected = day.open ? 0 : bookingsOn(day.date).filter(isActive).length;
      return h('article', { class: 'row row--closure' },
        h('div', { class: 'row-time' }, h('strong', {}, capitalize(formatShort(day.date))), h('span', {}, day.date.slice(0, 4))),
        h('div', { class: 'row-main' },
          h('p', { class: 'row-name' }, h('span', {}, day.name),
            h('span', { class: `badge ${day.open ? 'badge--confirmed' : 'badge--neutral'}` }, day.open ? 'Ouvert' : 'Fermé'),
            affected ? h('span', { class: 'badge badge--pending' }, `${plural(affected, 'rendez-vous', 'rendez-vous')} à déplacer`) : null)),
        auto ? h('div', { class: 'row-actions' },
          h('button', {
            type: 'button', class: 'btn btn--small btn--outline',
            'aria-label': day.open ? `Refermer le ${formatLong(day.date)}` : `Ouvrir le ${formatLong(day.date)}`,
            onclick: () => change({ date: day.date, open: !day.open }, day.open
              ? `Le salon sera fermé le ${formatLong(day.date)} (${day.name}).`
              : `Le salon sera ouvert le ${formatLong(day.date)} (${day.name}).`),
          }, h('span', {}, day.open ? 'Refermer' : 'Ouvrir ce jour-là'))) : null);
    }),
    ...(list.length ? [] : [h('p', { class: 'empty' }, 'Aucun jour férié ne tombe un jour travaillé dans les douze mois à venir.')]));
}

const usualHours = date => config.hours[weekday(date)] || [];
/** Les plages d'ouverture d'un jour : ses horaires particuliers, sinon les horaires habituels. */
const dayRanges = date => {
  const closure = closureOn(date);
  return closure ? closure.hours || [] : usualHours(date);
};
/** 570 → « 9h30 », 540 → « 9h » */
const shortTime = minutes => `${Math.floor(minutes / 60)}h${minutes % 60 ? pad2(minutes % 60) : ''}`;
const rangeLabel = range => `${shortTime(range.start)} – ${shortTime(range.end)}`;
const rangesLabel = ranges => ranges.map(rangeLabel).join(' et ');

/** Les rendez-vous d'un jour qui tombent en dehors de ces plages d'ouverture. */
const outside = (date, ranges) => bookingsOn(date).filter(isActive)
  .filter(b => !ranges.some(range => b.start >= range.start && b.start + b.duration <= range.end)).length;

/** Les horaires habituels moins quelques heures bloquées. */
const withoutBlock = (ranges, from, to) => ranges.flatMap(range => [
  { start: range.start, end: Math.min(range.end, from) },
  { start: Math.max(range.start, to), end: range.end },
]).filter(range => range.end > range.start);

/** Les heures bloquées d'un jour, si ses horaires sont les habituels moins une seule tranche. */
function blockOf(date, hours) {
  const usual = usualHours(date);
  for (const range of usual) {
    for (let from = range.start; from < range.end; from += config.slotStep) {
      for (let to = from + config.slotStep; to <= range.end; to += config.slotStep) {
        if (JSON.stringify(withoutBlock(usual, from, to)) === JSON.stringify(hours)) return { from, to };
      }
    }
  }
  return null;
}

/** Ce qui change un jour particulier, en clair : « fermé de 9h30 à 11h » ou « ouvert 14h – 16h ». */
function specialLabel(date, hours) {
  const block = blockOf(date, hours);
  return block ? `fermé de ${shortTime(block.from)} à ${shortTime(block.to)}` : `ouvert ${rangesLabel(hours)}`;
}

function renderClosures() {
  const month = state.closureMonth;
  refs.closureTitle.textContent = capitalize(formatMonth(month));
  refs.closurePrev.disabled = month <= state.today.slice(0, 7);
  const days = daysInMonth(month);
  refs.closureCalendar.replaceChildren(
    ...['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map(name => h('span', { class: 'cal-head', 'aria-hidden': 'true' }, name)),
    ...Array.from({ length: mondayIndex(days[0]) }, () => h('span', { 'aria-hidden': 'true' })),
    ...days.map(calendarDay));
  renderClosureList();
  renderHolidays();
}

function calendarDay(date) {
  const closure = closureOn(date);
  const ranges = dayRanges(date);
  const kind = closure ? (closure.hours ? 'special' : 'closed') : ranges.length ? 'open' : 'off';
  const count = bookingsOn(date).filter(isActive).length;
  const block = kind === 'special' ? blockOf(date, ranges) : null;
  const summary = {
    closed: `fermé${closure?.reason ? ` (${closure.reason})` : ''}`,
    special: kind === 'special' ? specialLabel(date, ranges) : '',
    open: `ouvert, ${rangesLabel(ranges)}`,
    off: "fermé d'habitude",
  }[kind];
  return h('button', {
    type: 'button',
    class: `cal-day cal-day--${kind}${date === state.today ? ' is-today' : ''}`,
    disabled: date < state.today,
    'aria-label': `${capitalize(formatLong(date))} : ${summary}${count ? `, ${plural(count, 'rendez-vous', 'rendez-vous')}` : ''}`,
    onclick: () => openDayHours(date),
  },
  h('span', { class: 'cal-num' }, String(Number(date.slice(8)))),
  kind === 'closed' || kind === 'off' ? h('span', { class: 'cal-note' }, 'Fermé') : null,
  block ? [h('span', { class: 'cal-note' }, 'Fermé'), h('span', { class: 'cal-note' }, `${shortTime(block.from)}–${shortTime(block.to)}`)] : null,
  kind === 'special' && !block ? ranges.map(range => h('span', { class: 'cal-note' }, `${shortTime(range.start)}–${shortTime(range.end)}`)) : null,
  count ? h('span', { class: 'cal-count' }, plural(count, 'rdv', 'rdv')) : null);
}

/** La liste des fermetures et des jours particuliers à venir, sous le calendrier. */
function renderClosureList() {
  const upcoming = state.closures.filter(c => c.date >= state.today);
  const items = [
    ...closurePeriods(upcoming.filter(c => !c.hours)).map(period => ({ date: period.from, period })),
    ...upcoming.filter(c => c.hours).map(closure => ({ date: closure.date, closure })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  if (!items.length) {
    refs.closureList.replaceChildren(h('p', { class: 'empty' }, 'Aucune fermeture ni horaire particulier prévus.'));
    return;
  }
  const restore = (from, to, message) => async () => {
    try {
      const { closures } = await call(`/api/salon/closures/${from}?until=${to}`, { method: 'DELETE' });
      state.closures = closures;
      refresh();
      toast(message);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  };
  refs.closureList.replaceChildren(...items.map(({ period, closure }) => {
    if (closure) {
      const moved = outside(closure.date, closure.hours);
      return h('article', { class: 'row row--closure' },
        h('div', { class: 'row-time' }, h('strong', {}, capitalize(formatShort(closure.date)))),
        h('div', { class: 'row-main' },
          h('p', { class: 'row-name' }, h('span', {}, capitalize(specialLabel(closure.date, closure.hours))),
            moved ? h('span', { class: 'badge badge--pending' }, `${plural(moved, 'rendez-vous', 'rendez-vous')} à déplacer`) : null),
          closure.reason ? h('p', { class: 'row-meta' }, closure.reason) : null),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn--small btn--outline', onclick: () => openDayHours(closure.date) }, h('span', {}, 'Modifier')),
          h('button', {
            type: 'button', class: 'btn btn--small btn--outline', 'aria-label': `Horaires habituels le ${formatLong(closure.date)}`,
            onclick: restore(closure.date, closure.date, `Horaires habituels rétablis le ${formatLong(closure.date)}.`),
          }, h('span', {}, 'Horaires habituels'))));
    }
    const single = period.from === period.to;
    const affected = period.dates.reduce((total, day) => total + bookingsOn(day).filter(isActive).length, 0);
    return h('article', { class: 'row row--closure' },
      h('div', { class: 'row-time' },
        h('strong', {}, capitalize(formatShort(period.from))),
        single ? null : h('span', {}, `au ${formatShort(period.to)}`)),
      h('div', { class: 'row-main' },
        h('p', { class: 'row-name' }, h('span', {}, period.reason || 'Salon fermé'),
          single ? null : h('span', { class: 'badge badge--neutral' }, plural(period.dates.length, 'jour', 'jours')),
          affected ? h('span', { class: 'badge badge--pending' }, `${plural(affected, 'rendez-vous', 'rendez-vous')} à déplacer`) : null)),
      h('div', { class: 'row-actions' },
        h('button', {
          type: 'button', class: 'btn btn--small btn--outline', 'aria-label': `Rouvrir ${periodLabel(period)}`,
          onclick: restore(period.from, period.to, `Le salon est de nouveau ouvert ${periodLabel(period)}.`),
        }, h('span', {}, 'Rouvrir'))));
  }));
}

/** « le mardi 20 octobre » ou « du mardi 20 octobre au samedi 31 octobre » */
const periodLabel = period => (period.from === period.to
  ? `le ${formatLong(period.from)}`
  : `du ${formatLong(period.from)} au ${formatLong(period.to)}`);

/**
 * Regroupe les jours fermés en périodes, comme sur le site : même motif, et rien d'autre entre
 * deux jours que des jours de fermeture habituelle.
 */
function closurePeriods(list) {
  const usuallyClosed = day => !closureOn(day) && !usualHours(day).length;
  const periods = [];
  for (const closure of list) {
    const reason = (closure.reason || '').trim();
    const last = periods.at(-1);
    let joins = Boolean(last) && last.reason.toLowerCase() === reason.toLowerCase();
    for (let day = joins ? addDays(last.to, 1) : closure.date; joins && day < closure.date; day = addDays(day, 1)) {
      if (!usuallyClosed(day)) joins = false;
    }
    if (joins) {
      last.to = closure.date;
      last.dates.push(closure.date);
    } else {
      periods.push({ from: closure.date, to: closure.date, reason, dates: [closure.date] });
    }
  }
  return periods;
}

// — Un jour du calendrier : fermé, quelques heures bloquées, ou d'autres horaires —

function openDayHours(date) {
  const usual = usualHours(date);
  const closure = closureOn(date);
  const saved = state.closures.find(c => c.date === date);
  // Un jour férié fermé d'office : « comme d'habitude » l'ouvre.
  const holiday = state.holidays.list.find(day => day.date === date);
  const eyebrow = holiday ? `${holiday.name} · ${usual.length ? `d'habitude ${rangesLabel(usual)}` : "fermé d'habitude"}`
    : usual.length ? `D'habitude : ${rangesLabel(usual)}` : "Fermé d'habitude";
  const sheet = openSheet({ eyebrow, title: capitalize(formatLong(date)) });
  const error = h('p', { class: 'notice notice--error', role: 'alert', hidden: true });
  const warning = h('p', { class: 'notice', hidden: true });

  const step = config.slotStep;
  const timeSelect = (name, value) => {
    const select = h('select', { name });
    for (let minute = 6 * 60; minute <= 22 * 60; minute += step) {
      select.append(h('option', { value: String(minute), selected: minute === value }, shortTime(minute)));
    }
    return select;
  };
  const first = usual[0] || { start: 9 * 60, end: 18 * 60 };
  const block = closure?.hours ? blockOf(date, closure.hours) : null;
  const special = closure?.hours && !block ? closure.hours : null;
  const blockFrom = timeSelect('blockFrom', block?.from ?? 12 * 60);
  const blockTo = timeSelect('blockTo', block?.to ?? 14 * 60);
  const opens = timeSelect('opens', special ? special[0].start : first.start);
  const closes = timeSelect('closes', special ? special.at(-1).end : (usual.at(-1) || first).end);
  const until = h('input', { name: 'until', type: 'date', min: date });
  const reason = h('input', { name: 'reason', type: 'text', maxlength: '80', placeholder: 'Congés, formation, rendez-vous…', value: saved?.reason || '' });

  const modes = [
    { key: 'usual', label: usual.length ? `Ouvert comme d'habitude${holiday ? ', même férié' : ''}` : "Fermé, comme d'habitude" },
    { key: 'closed', label: 'Fermé toute la journée', extra: field({ id: 'jour-jusqu', label: "Jusqu'au", optional: true, hint: 'Pour des congés : le dernier jour de fermeture.', control: until }) },
    usual.length ? { key: 'block', label: 'Fermé quelques heures', extra: h('div', { class: 'field-row' }, field({ id: 'jour-bloque-de', label: 'Fermé de', control: blockFrom }), field({ id: 'jour-bloque-a', label: 'À', control: blockTo })) } : null,
    { key: 'hours', label: usual.length ? 'Autres horaires ce jour-là' : 'Ouvert ce jour-là', extra: h('div', { class: 'field-row' }, field({ id: 'jour-ouvre', label: 'Ouvre à', control: opens }), field({ id: 'jour-ferme', label: 'Ferme à', control: closes })) },
  ].filter(Boolean);
  let mode = closure ? (closure.hours ? (block ? 'block' : 'hours') : 'closed') : 'usual';

  const choices = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Ce jour-là' });
  const reasonField = field({ id: 'jour-motif', label: 'Motif', optional: true, hint: 'Affiché sur le site pour une fermeture.', control: reason });

  /** Les plages d'ouverture choisies, ou une erreur. [] : fermé toute la journée. */
  function chosen() {
    if (mode === 'usual') return { ranges: usual };
    if (mode === 'closed') return { ranges: [] };
    if (mode === 'block') {
      const from = Number(blockFrom.value);
      const to = Number(blockTo.value);
      if (to <= from) return { error: "L'heure de réouverture doit suivre l'heure de fermeture." };
      const ranges = withoutBlock(usual, from, to);
      if (JSON.stringify(ranges) === JSON.stringify(usual)) return { error: 'Ces heures sont déjà en dehors des horaires du salon.' };
      return { ranges };
    }
    const from = Number(opens.value);
    const to = Number(closes.value);
    if (to <= from) return { error: "L'heure de fermeture doit suivre l'heure d'ouverture." };
    return { ranges: [{ start: from, end: to }] };
  }

  function update() {
    for (const choice of choices.children) {
      const selected = choice.dataset.mode === mode;
      choice.classList.toggle('is-selected', selected);
      choice.querySelector('input').checked = selected;
      const extra = choice.querySelector('.choice-extra');
      if (extra) extra.hidden = !selected;
    }
    reasonField.hidden = mode === 'usual';
    error.hidden = true;
    const result = chosen();
    let moved = result.ranges ? outside(date, result.ranges) : 0;
    if (mode === 'closed' && until.value > date) {
      for (let day = addDays(date, 1); day <= until.value; day = addDays(day, 1)) moved += bookingsOn(day).filter(isActive).length;
    }
    warning.hidden = !moved;
    warning.textContent = `${plural(moved, 'rendez-vous déjà pris tombe', 'rendez-vous déjà pris tombent')} pendant les heures fermées : ils restent enregistrés, pensez à prévenir les clients.`;
  }

  for (const option of modes) {
    const input = h('input', { type: 'radio', name: 'mode', value: option.key });
    input.addEventListener('change', () => {
      mode = option.key;
      update();
    });
    choices.append(h('div', { class: 'choice', dataset: { mode: option.key } },
      h('label', { class: 'choice-label' }, input, h('span', {}, option.label)),
      option.extra ? h('div', { class: 'choice-extra' }, option.extra) : null));
  }
  for (const control of [blockFrom, blockTo, opens, closes, until]) control.addEventListener('change', update);

  const submit = h('button', { type: 'submit', class: 'btn' }, h('span', {}, 'Enregistrer'), icon('check'));
  const form = h('form', { class: 'sheet-form', novalidate: true }, choices, reasonField, warning, error, h('div', { class: 'sheet-actions' }, submit));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const result = chosen();
    if (result.error) {
      error.textContent = result.error;
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    try {
      let closures;
      let message;
      if (mode === 'usual') {
        if (saved) ({ closures } = await call(`/api/salon/closures/${date}`, { method: 'DELETE' }));
        if (holiday && !holiday.open && usual.length) ({ holidays: state.holidays } = await call('/api/salon/holidays', { method: 'PUT', body: { date, open: true } }));
        message = usual.length ? `Horaires habituels le ${formatLong(date)}.` : `Le ${formatLong(date)} reste fermé, comme d'habitude.`;
      } else if (!result.ranges.length) {
        const period = { from: date, to: until.value > date ? until.value : date };
        ({ closures } = await call('/api/salon/closures', { method: 'POST', body: { date, until: period.to, reason: reason.value } }));
        message = `Le salon sera fermé ${periodLabel(period)}. C'est annoncé sur le site.`;
      } else {
        const hours = result.ranges.map(range => ({ start: fromMinutes(range.start), end: fromMinutes(range.end) }));
        ({ closures } = await call('/api/salon/closures', { method: 'POST', body: { date, reason: reason.value, hours } }));
        message = `Le ${formatLong(date)}, le salon sera ${specialLabel(date, result.ranges)}.`;
      }
      if (closures) state.closures = closures;
      sheet.dialog.close();
      refresh();
      toast(message);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
    }
  });

  sheet.body.replaceChildren(form);
  update();
  choices.querySelector('input:checked')?.focus();
}

// ── Vue « Fréquentation » ─────────────────────────────────────────────────
// Les visites du site, comptées par le site lui-même : ni cookie, ni service extérieur.

const PAGE_NAMES = {
  '/': 'La une', '/prestations': 'La carte', '/galerie': 'En images', '/reservation': 'Prendre rendez-vous',
  '/nous-trouver': 'Pratique', '/mentions-legales': 'Mentions légales', '/confidentialite': 'Confidentialité', '/conditions': "Conditions d'utilisation",
};

async function mountAudience() {
  const body = h('div', { class: 'audience' }, h('p', { class: 'empty' }, 'Chargement…'));
  refs.view.replaceChildren(
    h('p', { class: 'view-lead' }, "Les visites du site sur les 30 derniers jours. Le site les compte lui-même, sans cookie : les robots, vos propres visites et les personnes qui refusent d'être suivies ne sont pas comptés."),
    body);

  let data;
  try {
    data = await call('/api/salon/stats?jours=30');
  } catch (err) {
    body.replaceChildren(h('p', { class: 'notice notice--error', role: 'alert' }, err.message));
    return;
  }
  if (state.tab !== 'audience') return;

  const { totals, devices } = data;
  const most = Math.max(1, ...data.days.map(day => day.visitors));
  const phones = devices.mobile + devices.desktop ? Math.round((devices.mobile / (devices.mobile + devices.desktop)) * 100) : 0;
  const cards = [
    { value: totals.visitors, label: 'Visiteurs' },
    { value: totals.views, label: 'Pages vues' },
    { value: totals.bookings, label: 'Réservations en ligne' },
    { value: `${phones} %`, label: 'Sur téléphone' },
  ];
  const ranking = (title, items) => h('section', { class: 'audience-list' },
    h('h2', { class: 'group-title' }, title),
    items.length
      ? h('ol', {}, items.map(item => h('li', {}, h('span', {}, PAGE_NAMES[item.name] || item.name), h('strong', {}, String(item.count)))))
      : h('p', { class: 'empty' }, 'Aucune visite comptée pour le moment.'));

  body.replaceChildren(
    h('div', { class: 'stats' }, cards.map(card => h('div', { class: 'stat' }, h('strong', {}, String(card.value)), h('span', {}, card.label)))),
    h('figure', { class: 'chart' },
      h('figcaption', { class: 'group-title' }, 'Visiteurs par jour'),
      h('div', { class: 'chart-bars', role: 'img', 'aria-label': `Visiteurs par jour depuis le ${formatLong(data.days[0].date)} : ${totals.visitors} au total.` },
        data.days.map(day => {
          const bar = h('span', { class: `chart-bar${day.visitors ? '' : ' is-empty'}`, title: `${capitalize(formatShort(day.date))} : ${plural(day.visitors, 'visiteur', 'visiteurs')}` });
          bar.style.height = `${Math.max(2, (day.visitors / most) * 100)}%`;
          return bar;
        })),
      h('p', { class: 'chart-axis' }, h('span', {}, capitalize(formatShort(data.days[0].date))), h('span', {}, "Aujourd'hui"))),
    h('div', { class: 'audience-cols' },
      ranking('Pages les plus vues', data.pages),
      ranking("D'où viennent les visiteurs", data.sources)));
}

// ── Fenêtres ──────────────────────────────────────────────────────────────

function closeSheets() {
  for (const sheet of document.querySelectorAll('dialog.sheet')) sheet.close();
}

function openSheet({ eyebrow, title, onClose }) {
  closeSheets();
  const heading = h('h2', { id: 'fenetre-titre' }, title);
  const body = h('div', { class: 'sheet-body' });
  const dialog = h('dialog', { class: 'sheet', 'aria-labelledby': 'fenetre-titre' },
    h('div', { class: 'sheet-head' },
      h('div', {}, eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null, heading),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fermer', onclick: () => dialog.close() }, icon('close'))),
    body);
  // Un clic sur le fond (la boîte elle-même, hors de son contenu) ferme la fenêtre.
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, body, heading };
}

// — Fiche d'un rendez-vous —

function openDetail(id) {
  const booking = state.bookings.find(b => b.id === id);
  if (!booking) return;
  const sheet = openSheet({ eyebrow: 'Rendez-vous', title: booking.name });
  const entry = { id, sheet, asking: null, error: '' };
  // La fermeture est signalée après coup : on n'efface la fiche courante que si c'est bien celle-ci.
  sheet.dialog.addEventListener('close', () => {
    if (detail === entry) detail = null;
  });
  detail = entry;
  renderDetail();
}

function refreshDetail() {
  if (!detail) return;
  if (!state.bookings.some(b => b.id === detail.id)) detail.sheet.dialog.close();
  // En plein déplacement, on ne redessine pas : le jour et l'heure en cours de choix seraient perdus.
  else if (detail.asking !== 'move') renderDetail();
}

async function detailAction(run) {
  const current = detail;
  current.error = '';
  current.asking = null;
  try {
    await run();
  } catch (err) {
    current.error = err.message;
  }
  if (detail === current) renderDetail({ focus: true });
}

function renderDetail({ focus = false } = {}) {
  const booking = state.bookings.find(b => b.id === detail.id);
  if (!booking) return; // supprimé entre-temps : la fenêtre est en train de se fermer
  const row = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value));
  const received = new Date(booking.createdAt);
  const setStatus = status => detailAction(async () => {
    const result = await call(`/api/salon/bookings/${booking.id}`, { method: 'PATCH', body: { status } });
    upsert(result.booking);
  });
  const ask = question => {
    detail.asking = question;
    renderDetail({ focus: true });
  };
  const button = (label, variant, onclick, iconName) => h('button', { type: 'button', class: `btn btn--small ${variant}`, onclick },
    h('span', {}, label), iconName ? icon(iconName) : null);

  /** De quoi déplacer le rendez-vous : un jour, puis une heure parmi celles qui restent libres. */
  const moveControls = () => {
    const day = h('input', { type: 'date', min: state.today, required: true });
    day.value = booking.date >= state.today ? booking.date : state.today;
    const slot = h('select', { required: true });
    const go = button('Déplacer ici', '', () => detailAction(async () => {
      const result = await call(`/api/salon/bookings/${booking.id}`, { method: 'PATCH', body: { date: day.value, time: slot.value } });
      state.day = result.booking.date;
      upsert(result.booking);
      toast(`${result.booking.name} · ${whenLabel(result.booking)}`, { title: 'Rendez-vous déplacé' });
    }), 'check');
    go.disabled = true;
    let request = 0;
    const loadTimes = async () => {
      const current = ++request;
      go.disabled = true;
      slot.replaceChildren(h('option', { value: '' }, day.value ? 'Chargement…' : 'Choisissez une date'));
      if (!day.value) return;
      try {
        const result = await call(`/api/salon/bookings/${booking.id}/slots?date=${day.value}`);
        if (current !== request) return;
        // Son propre créneau n'est pas proposé : déplacer, c'est aller ailleurs.
        const free = result.slots.filter(s => s.available && !(day.value === booking.date && s.time === booking.time));
        if (!free.length) {
          slot.replaceChildren(h('option', { value: '' }, result.closed ? 'Salon fermé ce jour-là' : 'Aucun créneau libre'));
          return;
        }
        slot.replaceChildren(...free.map(s => h('option', { value: s.time }, frTime(s.time))));
        go.disabled = false;
      } catch (err) {
        if (current === request) slot.replaceChildren(h('option', { value: '' }, err.message));
      }
    };
    day.addEventListener('change', loadTimes);
    loadTimes();
    return [
      h('p', { class: 'sheet-question' }, `Déplacer ce rendez-vous (${durationLabel(booking.duration)}) au :`),
      h('div', { class: 'field-row sheet-move' },
        field({ id: 'deplacer-date', label: 'Jour', control: day }),
        field({ id: 'deplacer-heure', label: 'Heure', control: slot })),
      go,
      button('Ne pas déplacer', 'btn--outline', () => ask(null)),
    ];
  };

  let actions;
  if (detail.asking === 'move') {
    actions = moveControls();
  } else if (detail.asking === 'cancel') {
    actions = [
      h('p', { class: 'sheet-question' }, 'Annuler ce rendez-vous ? Le créneau sera de nouveau proposé en ligne.'),
      button('Oui, annuler', 'btn--danger', () => setStatus('cancelled')),
      button('Non, le garder', 'btn--outline', () => ask(null)),
    ];
  } else if (detail.asking === 'delete') {
    actions = [
      h('p', { class: 'sheet-question' }, 'Supprimer définitivement ce rendez-vous ?'),
      button('Oui, supprimer', 'btn--danger', () => detailAction(async () => {
        await call(`/api/salon/bookings/${booking.id}`, { method: 'DELETE' });
        drop(booking.id);
      })),
      button('Non', 'btn--outline', () => ask(null)),
    ];
  } else if (booking.status === 'cancelled') {
    actions = [
      button('Rétablir', '', () => setStatus('confirmed'), 'check'),
      button('Supprimer', 'btn--danger', () => ask('delete'), 'trash'),
    ];
  } else {
    actions = [
      booking.status === 'pending' ? button('Confirmer', '', () => setStatus('confirmed'), 'check') : null,
      button('Déplacer', 'btn--outline', () => ask('move'), 'move'),
      button('Annuler le rendez-vous', 'btn--danger', () => ask('cancel')),
    ];
  }

  const actionBar = h('div', { class: 'sheet-actions' }, actions);
  detail.sheet.heading.textContent = booking.name;
  detail.sheet.body.replaceChildren(...[
    h('p', { class: 'sheet-actions' }, statusBadge(booking),
      booking.status === 'cancelled' && booking.cancelledBy === 'client' ? h('span', { class: 'badge badge--neutral' }, 'Par le client') : null,
      h('span', { class: 'badge badge--neutral' }, booking.source === 'salon' ? 'Saisi au salon' : 'Réservé en ligne'),
      clientsView.isBlocked(booking) ? h('span', { class: 'badge badge--blocked' }, 'Ne plus reprendre') : null),
    h('dl', { class: 'detail-list' },
      row('Prestation', booking.serviceName),
      row('Date', capitalize(formatLong(booking.date))),
      row('Heure', hoursLabel(booking)),
      row('Durée', durationLabel(booking.duration)),
      row('Tarif', priceText(booking)),
      booking.phone ? row('Téléphone', h('a', { class: 'link', href: telHref(booking.phone) }, booking.phone)) : null,
      booking.note ? row('Message', booking.note) : null,
      row('Reçu le', `${received.toLocaleDateString('fr-FR')} à ${received.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`),
      row('Fiche client', h('button', { type: 'button', class: 'link', onclick: () => clientsView.openClient(clientsView.clientOf(booking)?.key) }, 'Voir son historique'))),
    detail.error ? h('p', { class: 'notice notice--error', role: 'alert' }, detail.error) : null,
    actionBar,
  ].filter(Boolean));
  if (focus) actionBar.querySelector('button')?.focus();
}

// — Nouveau rendez-vous, saisi par la coiffeuse —

function openNewBooking({ date = '', time = '', name: knownName = '', phone: knownPhone = '' } = {}) {
  const sheet = openSheet({ eyebrow: 'Saisie au salon', title: 'Nouveau rendez-vous' });
  const error = h('p', { class: 'notice notice--error', role: 'alert', hidden: true });
  const categories = [...new Set(config.services.map(service => service.category))];
  const service = h('select', { name: 'serviceId', required: true }, categories.map(category => h('optgroup', { label: category },
    config.services.filter(s => s.category === category).map(s => h('option', { value: s.id }, `${s.name} · ${durationLabel(s.duration)} · ${priceText(s)}`)))));
  const day = h('input', { name: 'date', type: 'date', min: state.today, required: true });
  day.value = date || (state.day >= state.today ? state.day : state.today);
  const slot = h('select', { name: 'time', required: true });
  const name = h('input', { name: 'name', type: 'text', maxlength: '60', autocomplete: 'off', required: true });
  const phone = h('input', { name: 'phone', type: 'tel', inputmode: 'tel', maxlength: '30', autocomplete: 'off' });
  // Depuis une fiche client : le nom et le téléphone sont déjà connus.
  name.value = knownName;
  phone.value = knownPhone;
  const note = h('input', { name: 'note', type: 'text', maxlength: '200', autocomplete: 'off' });
  const submit = h('button', { type: 'submit', class: 'btn', disabled: true }, h('span', {}, 'Enregistrer'), icon('check'));

  const fail = message => {
    error.textContent = message;
    error.hidden = false;
  };

  let request = 0;
  let wanted = time;
  async function loadTimes() {
    const current = ++request;
    submit.disabled = true;
    if (!day.value) {
      slot.replaceChildren(h('option', { value: '' }, 'Choisissez une date'));
      return;
    }
    slot.replaceChildren(h('option', { value: '' }, 'Chargement…'));
    try {
      const result = await call(`/api/availability?service=${service.value}&date=${day.value}&salon=1`);
      if (current !== request) return;
      const free = result.slots.filter(s => s.available);
      if (!free.length) {
        slot.replaceChildren(h('option', { value: '' }, result.closed ? 'Salon fermé ce jour-là' : 'Aucun créneau libre'));
        return;
      }
      slot.replaceChildren(...free.map(s => h('option', { value: s.time, selected: s.time === wanted }, frTime(s.time))));
      submit.disabled = false;
    } catch (err) {
      if (current === request) fail(err.message);
    }
  }
  slot.addEventListener('change', () => { wanted = slot.value; });
  service.addEventListener('change', loadTimes);
  day.addEventListener('change', loadTimes);

  const form = h('form', { class: 'sheet-form', novalidate: true },
    field({ id: 'nouveau-prestation', label: 'Prestation', control: service }),
    h('div', { class: 'field-row' },
      field({ id: 'nouveau-date', label: 'Date', control: day }),
      field({ id: 'nouveau-heure', label: 'Heure', control: slot })),
    field({ id: 'nouveau-nom', label: 'Nom du client', control: name }),
    field({ id: 'nouveau-telephone', label: 'Téléphone', optional: true, control: phone }),
    field({ id: 'nouveau-note', label: 'Note', optional: true, control: note }),
    error,
    h('div', { class: 'sheet-actions' }, submit));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.hidden = true;
    if (!name.value.trim()) {
      fail('Indiquez le nom du client.');
      name.focus();
      return;
    }
    submit.disabled = true;
    try {
      const { booking } = await call('/api/salon/bookings', {
        method: 'POST',
        body: { serviceId: service.value, date: day.value, time: slot.value, name: name.value, phone: phone.value, note: note.value },
      });
      markFresh(booking.id);
      state.day = booking.date;
      sheet.dialog.close();
      upsert(booking);
      toast(`${booking.name} · ${whenLabel(booking)}`, { title: 'Rendez-vous enregistré' });
    } catch (err) {
      fail(err.data?.fields ? Object.values(err.data.fields).join(' ') : err.message);
      if (err.status === 409) await loadTimes();
      else submit.disabled = false;
    }
  });

  sheet.body.replaceChildren(form);
  loadTimes();
  (knownName ? service : name).focus();
}

// — Mot de passe —

function openPassword() {
  const sheet = openSheet({ eyebrow: 'Sécurité', title: 'Changer le mot de passe' });
  const error = h('p', { class: 'notice notice--error', role: 'alert', hidden: true });
  const current = h('input', { name: 'current', type: 'password', autocomplete: 'current-password', required: true });
  const next = h('input', { name: 'next', type: 'password', autocomplete: 'new-password', required: true });
  const confirm = h('input', { name: 'confirm', type: 'password', autocomplete: 'new-password', required: true });
  const submit = h('button', { type: 'submit', class: 'btn' }, h('span', {}, 'Changer le mot de passe'), icon('lock'));

  const fail = message => {
    error.textContent = message;
    error.hidden = false;
  };

  const form = h('form', { class: 'sheet-form', novalidate: true },
    h('input', { class: 'sr-only', type: 'text', name: 'username', autocomplete: 'username', value: 'salon', tabindex: '-1', 'aria-hidden': 'true', readonly: true }),
    field({ id: 'mdp-actuel', label: 'Mot de passe actuel', control: current }),
    field({ id: 'mdp-nouveau', label: 'Nouveau mot de passe', hint: '10 caractères au minimum.', control: next }),
    field({ id: 'mdp-confirmation', label: 'Confirmez le nouveau mot de passe', control: confirm }),
    error,
    h('div', { class: 'sheet-actions' }, submit));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.hidden = true;
    if (next.value.length < 10) return fail('Le nouveau mot de passe doit contenir au moins 10 caractères.');
    if (next.value !== confirm.value) return fail('Les deux mots de passe ne sont pas identiques.');
    submit.disabled = true;
    try {
      await call('/api/salon/password', { method: 'POST', body: { current: current.value, next: next.value } });
      sheet.dialog.close();
      toast('Les autres appareils connectés ont été déconnectés.', { title: 'Mot de passe modifié' });
    } catch (err) {
      fail(err.message);
      submit.disabled = false;
    }
    return undefined;
  });

  sheet.body.replaceChildren(form);
  current.focus();
}

// ── Démarrage ─────────────────────────────────────────────────────────────

async function start() {
  try {
    const session = await api('/api/salon/session');
    codeSource = session.codeSource || codeSource;
    accountHasUsername = !session.configured || session.username;
    if (!session.configured) showAuth('setup');
    else if (!session.authenticated) showAuth('login');
    else await enter();
  } catch (err) {
    root.replaceChildren(h('p', { class: 'notice notice--error', role: 'alert' }, err.message));
  }
}

start();
