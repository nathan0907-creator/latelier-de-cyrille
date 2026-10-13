// Page 4, « Prendre rendez-vous » : on choisit une prestation dans le tableau des tarifs,
// on arrache une languette (le créneau), on renvoie le coupon (ses coordonnées).
// Les disponibilités viennent toujours du serveur et se mettent à jour en direct.

import {
  h, api, ApiError, animate, reducedMotion, readPageData, debounce, addDays, addMonths, mondayIndex, daysInMonth,
  formatLong, formatMonth, capitalize, toMinutes, frTime, durationLabel, euros,
} from './lib.js';

const root = document.querySelector('[data-booking]');
const data = readPageData();
const services = new Map(data.services.map(service => [service.id, service]));

const $ = selector => root.querySelector(selector);
const $$ = selector => [...root.querySelectorAll(selector)];

const firstMonth = data.today.slice(0, 7);
const lastMonth = data.lastDate.slice(0, 7);

const state = {
  step: 1, // 1, 2, 3 ou 'done'
  service: null,
  month: firstMonth,
  date: null,
  time: null,
  days: new Map(), // date → { state, free }
  slots: [],
  confirmed: null,
  submitting: false,
  moving: false,
};

const el = {
  stepper: $('.stepper'),
  progress: $('[data-progress]'),
  calMonth: $('[data-cal-month]'),
  calGrid: $('[data-cal-grid]'),
  calPrev: $('[data-cal-prev]'),
  calNext: $('[data-cal-next]'),
  slotsTitle: $('[data-slots-title]'),
  slotsHint: $('[data-slots-hint]'),
  slotsBody: $('[data-slots-body]'),
  slotsNotice: $('[data-slots-notice]'),
  proceed: $('[data-continue]'),
  form: $('[data-form]'),
  formError: $('[data-form-error]'),
  submit: $('[data-submit]'),
  submitLabel: $('[data-submit-label]'),
  doneText: $('[data-done-text]'),
  doneRecap: $('[data-done-recap]'),
  bar: $('[data-booking-bar]'),
  remind: $('[data-remind]'),
  remindLabel: $('[data-remind-label]'),
  remindNote: $('[data-remind-note]'),
  notifyField: $('[data-notify-field]'),
  manage: $('[data-manage]'),
  mine: $('[data-mine]'),
  mineCancelled: $('[data-mine-cancelled]'),
};

const panel = step => $(`[data-step="${step}"]`);
const priceText = service => `${service.priceFrom ? 'dès ' : ''}${euros(service.price)}`;

// ── Étapes ────────────────────────────────────────────────────────────────

function canReach(step) {
  if (state.step === 'done') return false;
  if (step === 1) return true;
  if (step === 2) return Boolean(state.service);
  return Boolean(state.service && state.date && state.time);
}

function renderStepper() {
  const current = state.step === 'done' ? 4 : state.step;
  for (const button of $$('.stepper-item')) {
    const step = Number(button.dataset.goto);
    button.disabled = !canReach(step);
    button.classList.toggle('is-done', step < current);
    if (step === current) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  el.progress.style.transform = `scaleX(${Math.min(current, 3) / 3})`;
  el.proceed.disabled = !state.time;
}

async function goTo(step, { focus = true } = {}) {
  if (state.moving || step === state.step) return;
  if (step !== 'done' && !canReach(step)) return;

  const from = panel(state.step);
  const to = panel(step);
  const direction = step === 'done' || step > state.step ? 1 : -1;
  state.moving = true;
  state.step = step;
  renderStepper();
  renderBar();

  // La sortie est plus brève que l'entrée : on quitte vite, on arrive en douceur.
  await animate(from, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-28 * direction}px)` }],
    { duration: 190, easing: 'cubic-bezier(.6, 0, .9, .3)' }).finished;
  from.hidden = true;
  to.hidden = false;
  root.classList.toggle('is-done', step === 'done');
  animate(to, [{ opacity: 0, transform: `translateX(${36 * direction}px)` }, { opacity: 1, transform: 'none' }], { duration: 560 });
  state.moving = false;

  if (focus) {
    to.querySelector('h2').focus({ preventScroll: true });
    const top = el.stepper.getBoundingClientRect().top;
    if (top < 0 || top > innerHeight * 0.55) {
      scrollTo({ top: scrollY + top - 96, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }
}

// ── Récapitulatif ─────────────────────────────────────────────────────────

function setSummary(key, text) {
  const target = $(`[data-sum="${key}"]`);
  if (target.textContent === text) return;
  target.textContent = text;
  animate(target, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 420 });
}

function renderSummary() {
  const { service, date, time } = state;
  setSummary('service', service ? service.name : 'À choisir');
  setSummary('date', date ? capitalize(formatLong(date)) : '—');
  setSummary('time', time ? `${frTime(time)} – ${frTime(toMinutes(time) + service.duration)}` : '—');
  setSummary('duration', service ? durationLabel(service.duration) : '—');
  setSummary('price', service ? priceText(service) : '—');
  renderBar();
}

// Téléphone : le même récapitulatif, en une ligne, collé en bas de l'écran.
function renderBar() {
  const { service, date, time } = state;
  el.bar.hidden = !service || state.step === 'done';
  if (el.bar.hidden) return;
  const when = [date && capitalize(formatLong(date)), time && frTime(time)].filter(Boolean).join(' · ');
  el.bar.querySelector('[data-bar="service"]').textContent = service.name;
  el.bar.querySelector('[data-bar="when"]').textContent = when || 'Jour et heure à choisir';
  el.bar.querySelector('[data-bar="price"]').textContent = priceText(service);
}

// ── Étape 1 : la prestation ───────────────────────────────────────────────

function selectService(id, { focus = true } = {}) {
  const service = services.get(id);
  if (!service) return;
  const changed = state.service?.id !== id;
  state.service = service;
  for (const card of $$('.service-card')) card.setAttribute('aria-pressed', String(card.dataset.service === id));

  if (changed) {
    // Une autre durée change les créneaux possibles : on repart des disponibilités du serveur.
    state.time = null;
    state.days.clear();
    state.slots = [];
    hideNotice();
    renderCalendar();
    renderSlots();
    loadMonth();
    if (state.date) loadSlots();
  }
  renderSummary();
  renderStepper();
  // La ligne choisie se surligne un instant avant de passer à la suite.
  setTimeout(() => goTo(2, { focus }), reducedMotion ? 0 : 320);
}

// ── Étape 2 : calendrier ──────────────────────────────────────────────────

let monthRequest = 0;

async function loadMonth() {
  if (!state.service) return;
  const request = ++monthRequest;
  try {
    const { days } = await api(`/api/availability/month?service=${state.service.id}&month=${state.month}`);
    if (request !== monthRequest) return;
    for (const day of days) state.days.set(day.date, day);
    renderCalendar();
  } catch (err) {
    if (request === monthRequest) showNotice(err.message);
  }
}

function dayLabel(date, info) {
  const base = capitalize(formatLong(date));
  if (!info) return base;
  if (info.state === 'open') return `${base}, ${info.free} créneau${info.free > 1 ? 'x' : ''} libre${info.free > 1 ? 's' : ''}`;
  if (info.state === 'full') return `${base}, complet`;
  if (info.state === 'closed') return `${base}, fermé`;
  return `${base}, indisponible`;
}

function renderCalendar(direction = 0) {
  el.calMonth.textContent = capitalize(formatMonth(state.month));
  el.calPrev.disabled = state.month <= firstMonth;
  el.calNext.disabled = state.month >= lastMonth;

  const dates = daysInMonth(state.month);
  const cells = Array.from({ length: mondayIndex(dates[0]) }, () => h('span', { 'aria-hidden': 'true' }));
  let loaded = true;
  for (const date of dates) {
    const info = state.days.get(date);
    if (!info) loaded = false;
    const status = info ? info.state : 'out';
    cells.push(h('button', {
      type: 'button',
      class: `day day--${status}${date === data.today ? ' day--today' : ''}`,
      dataset: { date },
      'aria-label': dayLabel(date, info),
      'aria-pressed': String(date === state.date),
      disabled: status !== 'open',
    }, String(Number(date.slice(8)))));
  }
  el.calGrid.replaceChildren(...cells);
  el.calGrid.classList.toggle('is-loading', !loaded);
  if (direction) {
    animate(el.calGrid, [{ opacity: 0, transform: `translateX(${direction * 18}px)` }, { opacity: 1, transform: 'none' }], { duration: 380 });
  }
}

function changeMonth(delta) {
  const month = addMonths(state.month, delta);
  if (month < firstMonth || month > lastMonth) return;
  state.month = month;
  renderCalendar(delta);
  loadMonth();
}

function selectDate(date) {
  if (state.date === date) return;
  state.date = date;
  state.time = null;
  state.slots = [];
  for (const button of $$('.day[data-date]')) button.setAttribute('aria-pressed', String(button.dataset.date === date));
  hideNotice();
  renderSummary();
  renderStepper();
  loadSlots();
}

// Flèches du clavier : se déplacer de jour en jour (gauche/droite) ou de semaine en semaine (haut/bas).
el.calGrid.addEventListener('keydown', event => {
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
  const from = event.target.dataset?.date;
  if (!delta || !from) return;
  event.preventDefault();
  const wanted = addDays(from, delta);
  const open = $$('.day[data-date]:not(:disabled)');
  const next = delta > 0 ? open.find(b => b.dataset.date >= wanted) : open.reverse().find(b => b.dataset.date <= wanted);
  next?.focus();
});

// ── Étape 2 : l'affichette et ses languettes ──────────────────────────────
// Chaque créneau du jour est une languette. Créneau pris : languette déjà arrachée (désactivée).
// Créneau pris sous vos yeux par quelqu'un d'autre : la languette tombe (classe is-lost).

const HINT_BEFORE = "Choisissez d'abord un jour dans le calendrier.";
const HINT_AFTER = 'Les languettes qui manquent sont déjà prises.';

let slotsRequest = 0;
// Prestation et jour auxquels correspondent les créneaux en mémoire (vide tant que le serveur n'a pas répondu).
let slotsKnownFor = '';
const slotsKey = () => (state.service && state.date ? `${state.service.id}|${state.date}` : '');

async function loadSlots({ live = false } = {}) {
  if (!state.service || !state.date) return;
  const request = ++slotsRequest;
  if (!live) {
    el.slotsTitle.textContent = capitalize(formatLong(state.date));
    el.slotsHint.textContent = HINT_AFTER;
    el.slotsBody.classList.add('is-loading');
  }
  try {
    const result = await api(`/api/availability?service=${state.service.id}&date=${state.date}`);
    if (request !== slotsRequest) return;
    const before = new Map(state.slots.map(slot => [slot.time, slot.available]));
    state.slots = result.slots;
    slotsKnownFor = slotsKey();

    const lost = Boolean(state.time) && !result.slots.some(slot => slot.time === state.time && slot.available);
    if (lost) state.time = null;

    renderSlots({ entrance: !live, before: live ? before : null });
    renderSummary();
    renderStepper();
    if (lost) {
      showNotice("La languette que vous aviez choisie vient d'être arrachée par quelqu'un d'autre. Prenez-en une autre.");
      if (state.step === 3) goTo(2);
    }
  } catch (err) {
    if (request === slotsRequest) showNotice(err.message);
  } finally {
    if (request === slotsRequest) el.slotsBody.classList.remove('is-loading');
  }
}

/** Tant qu'aucun créneau n'est à montrer : une frange de languettes vierges. */
function blankTabs() {
  return h('ul', { class: 'tabs tabs--blank', 'aria-hidden': 'true' },
    Array.from({ length: 8 }, () => h('li', {}, h('span', { class: 'tab' }))));
}

function renderSlots({ entrance = false, before = null } = {}) {
  if (!state.date) {
    el.slotsTitle.textContent = 'Choisissez un jour';
    el.slotsHint.textContent = HINT_BEFORE;
    el.slotsBody.replaceChildren(blankTabs());
    return;
  }
  el.slotsTitle.textContent = capitalize(formatLong(state.date));
  el.slotsHint.textContent = HINT_AFTER;

  if (!state.slots.length) {
    // Réponse du serveur pas encore arrivée : on garde la frange vierge. Sinon, c'est un jour fermé.
    const waiting = slotsKnownFor !== slotsKey();
    el.slotsBody.replaceChildren(waiting ? blankTabs() : h('p', { class: 'slots-empty' }, 'Le salon est fermé ce jour-là.'));
    return;
  }

  const tabs = state.slots.map(slot => {
    const justTaken = before?.get(slot.time) === true && !slot.available;
    return h('button', {
      type: 'button',
      class: `tab${justTaken ? ' is-lost' : ''}`,
      dataset: { time: slot.time },
      'aria-pressed': String(slot.time === state.time),
      'aria-label': slot.available ? frTime(slot.time) : `${frTime(slot.time)}, déjà pris`,
      disabled: !slot.available,
    }, h('span', {}, frTime(slot.time)));
  });
  const full = !state.slots.some(slot => slot.available);
  el.slotsBody.replaceChildren(...[
    full ? h('p', { class: 'slots-empty' }, 'Tout a été arraché ce jour-là. Essayez une autre date.') : null,
    h('ul', { class: 'tabs', 'aria-label': 'Créneaux du jour' }, tabs.map(tab => h('li', {}, tab))),
  ].filter(Boolean));

  // Les languettes se déroulent une à une, de gauche à droite.
  if (entrance) {
    tabs.forEach((tab, i) => animate(tab,
      [{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'none' }],
      { duration: 460, delay: Math.min(i, 24) * 22, fill: 'backwards' }));
  }
}

function selectTime(time) {
  state.time = time;
  for (const tab of $$('.tab[data-time]')) tab.setAttribute('aria-pressed', String(tab.dataset.time === time));
  hideNotice();
  renderSummary();
  renderStepper();
  animate(el.proceed, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 480 });
}

function showNotice(message) {
  el.slotsNotice.textContent = message;
  el.slotsNotice.hidden = false;
}

function hideNotice() {
  el.slotsNotice.hidden = true;
}

// ── Étape 3 : le coupon-réponse ───────────────────────────────────────────

const validators = {
  name: value => (/^\p{L}[\p{L}\p{M}'’ .-]{1,59}$/u.test(value.trim()) ? '' : 'Indiquez votre prénom et votre nom.'),
  phone: value => (/^\+?\d{9,15}$/.test(value.replace(/[\s.\-()]/g, '')) ? '' : 'Indiquez un numéro valide, par exemple 06 12 34 56 78.'),
};

function setFieldError(name, message) {
  const field = el.form.querySelector(`[data-field="${name}"]`);
  if (!field) return;
  const input = field.querySelector('input, textarea');
  const error = field.querySelector('.field-error');
  field.classList.toggle('is-invalid', Boolean(message));
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
  if (error) {
    error.textContent = message;
    error.hidden = !message;
  }
}

function validateField(name) {
  const message = validators[name](el.form.elements[name].value);
  setFieldError(name, message);
  return !message;
}

for (const name of Object.keys(validators)) {
  const input = el.form.elements[name];
  input.addEventListener('blur', () => {
    if (input.value.trim()) validateField(name);
  });
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid')) validateField(name);
  });
}

function setSubmitting(busy) {
  state.submitting = busy;
  el.submit.disabled = busy;
  el.submitLabel.textContent = busy ? 'Envoi en cours…' : 'Envoyer le coupon';
}

el.form.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.submitting) return;
  el.formError.hidden = true;

  const invalid = Object.keys(validators).filter(name => !validateField(name));
  if (invalid.length) {
    el.form.elements[invalid[0]].focus();
    return;
  }

  const fields = el.form.elements;
  setSubmitting(true);
  // La case « Me prévenir » est cochée : on demande l'accord du navigateur maintenant, pendant
  // que le clic sur « Envoyer » est encore tout frais (les navigateurs l'exigent).
  let notifications = 'non';
  if (canRemind && fields.notify.checked) {
    try {
      notifications = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    } catch {
      notifications = 'denied';
    }
  }
  try {
    const { booking, reminder } = await api('/api/bookings', {
      method: 'POST',
      body: {
        serviceId: state.service.id,
        date: state.date,
        time: state.time,
        name: fields.name.value,
        phone: fields.phone.value,
        note: fields.note.value,
        website: fields.website.value,
      },
    });
    showConfirmation(booking, reminder);
    // Accord donné : les notifications s'activent toutes seules, sans bouton à presser.
    if (notifications === 'granted' && remind.ref) toggleReminder();
  } catch (err) {
    if (err.status === 409) {
      // Quelqu'un a été plus rapide : retour au choix de l'horaire, disponibilités fraîches.
      state.time = null;
      renderSummary();
      await Promise.all([loadMonth(), loadSlots()]);
      showNotice(err.message);
      goTo(2);
    } else if (err.data.fields) {
      for (const [name, message] of Object.entries(err.data.fields)) setFieldError(name, message);
      const first = Object.keys(err.data.fields).find(name => fields[name]);
      if (first) fields[first].focus();
    } else {
      el.formError.textContent = err.message;
      el.formError.hidden = false;
    }
  } finally {
    setSubmitting(false);
  }
});

// ── Confirmation ──────────────────────────────────────────────────────────

/** L'adresse de la page personnelle du rendez-vous (revoir, annuler). */
const manageUrl = ref => `/rendez-vous?r=${encodeURIComponent(ref)}`;
const MINE_KEY = 'mes-rendez-vous';

/** Les rendez-vous à venir pris depuis cet appareil (gardés dans le navigateur, pas sur le serveur). */
function myBookings() {
  try {
    return JSON.parse(localStorage.getItem(MINE_KEY) || '[]').filter(item => item && item.ref && item.date >= data.today);
  } catch {
    return [];
  }
}

function rememberBooking(booking, ref) {
  try {
    const list = [...myBookings().filter(item => item.ref !== ref), { ref, date: booking.date, time: booking.time }];
    localStorage.setItem(MINE_KEY, JSON.stringify(list.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 5)));
  } catch {
    // Stockage indisponible : le lien de la confirmation suffit.
  }
}

/** En haut de la page : « Vous avez rendez-vous mardi 13 octobre à 14h30 », avec le lien pour l'annuler. */
function showMine() {
  const [next] = myBookings();
  el.mine.hidden = !next;
  if (!next) return;
  el.mine.querySelector('[data-mine-text]').textContent = `Vous avez rendez-vous ${formatLong(next.date)} à ${frTime(next.time)}.`;
  el.mine.querySelector('[data-mine-link]').href = manageUrl(next.ref);
}

/**
 * Les rendez-vous gardés sur cet appareil, relus auprès du salon : un rendez-vous déplacé prend sa
 * nouvelle heure ; un rendez-vous annulé par le salon disparaît, et le client le lit en haut de page.
 */
async function refreshMine() {
  const saved = myBookings();
  if (!saved.length) return;
  let answer;
  try {
    answer = await api('/api/bookings/mine', { method: 'POST', body: { refs: saved.map(item => item.ref) } });
  } catch {
    return; // hors ligne : on garde ce qu'on sait
  }
  const cancelled = [];
  const kept = [];
  for (const item of saved) {
    const found = answer.bookings.find(entry => entry.ref === item.ref)?.booking;
    if (!found) continue; // effacé par le salon
    if (found.status === 'cancelled') {
      if (found.cancelledBy !== 'client') cancelled.push({ ...item, date: found.date, time: found.time });
      continue;
    }
    kept.push({ ref: item.ref, date: found.date, time: found.time });
  }
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(kept.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))));
  } catch {
    // Stockage indisponible.
  }
  showMine();
  el.mineCancelled.hidden = !cancelled.length;
  if (cancelled.length) {
    const [first] = cancelled;
    el.mineCancelled.querySelector('[data-mine-cancelled-text]').textContent = `Le salon a dû annuler votre rendez-vous ${formatLong(first.date)} à ${frTime(first.time)}. Choisissez un autre créneau ci-dessous.`;
    el.mineCancelled.querySelector('[data-mine-cancelled-link]').href = manageUrl(first.ref);
  }
}

function showConfirmation(booking, reminder) {
  state.confirmed = booking;
  state.manage = reminder?.ref ? manageUrl(reminder.ref) : '';
  el.manage.hidden = !state.manage;
  if (state.manage) {
    el.manage.querySelector('[data-manage-link]').href = state.manage;
    rememberBooking(booking, reminder.ref);
  }
  offerReminder(reminder);
  const firstName = booking.name.split(' ')[0];
  el.doneText.textContent = `Merci ${firstName}. À ${formatLong(booking.date)}, ${frTime(booking.time)}.`;
  const row = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value));
  el.doneRecap.replaceChildren(
    row('Prestation', booking.serviceName),
    row('Date', capitalize(formatLong(booking.date))),
    row('Heure', `${frTime(booking.time)} – ${frTime(booking.end)}`),
    row('Durée', durationLabel(booking.duration)),
    row('Tarif', priceText(booking)),
  );
  goTo('done');
}

// ── Rappel par notification ───────────────────────────────────────────────
// Le navigateur s'abonne aux notifications du site ; le serveur enverra le rappel aux échéances
// prévues (la veille, puis deux heures avant), même si le site est fermé sur l'appareil.

const remind = { ref: null, endpoint: null, busy: false };
const canRemind = Boolean(data.push?.key) && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const listing = new Intl.ListFormat('fr', { type: 'conjunction' });
const REMIND_FALLBACK = 'Ajoutez plutôt le rendez-vous à votre agenda.';

/** « quand le salon confirme, puis 2 h avant » : ce que les notifications annoncent. */
const notifyMoments = when => listing.format(['quand le salon confirme', ...when.map(moment => `en rappel ${moment}`)]);

/** Le bouton n'apparaît que si l'appareil sait recevoir des notifications. */
function offerReminder(reminder) {
  const offered = canRemind && Boolean(reminder?.ref);
  remind.ref = offered ? reminder.ref : null;
  el.remind.hidden = !offered;
  el.remindNote.hidden = !offered;
  if (offered) el.remindNote.textContent = `Une notification sur cet appareil : ${notifyMoments(reminder.when)}.`;
}

const fromBase64Url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
const toBase64Url = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '');

async function pushSubscription() {
  const registration = await navigator.serviceWorker.register(data.push.worker);
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // Abonnement pris avec une ancienne clé du serveur : il ne servirait plus à rien, on le refait.
  const key = subscription?.options?.applicationServerKey;
  if (subscription && key && toBase64Url(key) !== data.push.key) {
    await subscription.unsubscribe();
    subscription = null;
  }
  return subscription || registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(data.push.key) });
}

async function toggleReminder() {
  if (remind.busy || !remind.ref) return;
  remind.busy = true;
  el.remind.disabled = true;
  try {
    if (remind.endpoint) {
      await api('/api/reminders', { method: 'DELETE', body: { ref: remind.ref, endpoint: remind.endpoint } });
      remind.endpoint = null;
      el.remindNote.textContent = 'Notifications retirées.';
    } else if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') {
      el.remindNote.textContent = `Les notifications sont bloquées dans ce navigateur. ${REMIND_FALLBACK}`;
    } else {
      const subscription = await pushSubscription();
      const { when } = await api('/api/reminders', { method: 'POST', body: { ref: remind.ref, subscription: subscription.toJSON() } });
      remind.endpoint = subscription.endpoint;
      el.remindNote.textContent = `Notifications activées sur cet appareil : ${notifyMoments(when)}.`;
    }
  } catch (err) {
    el.remindNote.textContent = err instanceof ApiError && err.status ? err.message : `Le rappel n'a pas pu être activé sur cet appareil. ${REMIND_FALLBACK}`;
  } finally {
    remind.busy = false;
    el.remind.disabled = false;
    el.remind.setAttribute('aria-pressed', String(Boolean(remind.endpoint)));
    el.remindLabel.textContent = remind.endpoint ? 'Notifications activées' : 'Me prévenir';
  }
}

/** Fichier .ics : ajoute le rendez-vous, avec ses rappels, à l'agenda du téléphone ou de l'ordinateur. */
function downloadCalendar() {
  const booking = state.confirmed;
  if (!booking) return;
  const stamp = time => `${booking.date.replaceAll('-', '')}T${time.replace(':', '')}00`;
  const text = value => value.replace(/[\\;,]/g, match => `\\${match}`).replace(/\n/g, '\\n');
  const uid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rendez-vous salon//FR',
    'BEGIN:VEVENT',
    `UID:${uid}@rendez-vous`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}`,
    `DTSTART:${stamp(booking.time)}`,
    `DTEND:${stamp(booking.end)}`,
    `SUMMARY:${text(`${booking.serviceName} · ${data.salon.name}`)}`,
    `LOCATION:${text(data.salon.address)}`,
    `DESCRIPTION:${text(`Tarif : ${priceText(booking)}. Un empêchement ? ${data.salon.phone}${state.manage ? ` · Revoir ou annuler : ${location.origin}${state.manage}` : ''}`)}`,
    ...(state.manage ? [`URL:${location.origin}${state.manage}`] : []),
    // L'agenda sonne aux mêmes échéances que les notifications du site.
    ...(data.reminders || []).flatMap(minutes => [
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(`${booking.serviceName} · ${data.salon.name}`)}`, `TRIGGER:-PT${minutes}M`, 'END:VALARM',
    ]),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
  const link = h('a', { href: url, download: 'rendez-vous.ics' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Temps réel ────────────────────────────────────────────────────────────

function connect() {
  if (!('EventSource' in window)) return;
  const source = new EventSource('/api/events');
  const refreshMonth = debounce(loadMonth, 300);
  const refreshAll = () => {
    if (state.step === 'done') return;
    loadMonth();
    loadSlots({ live: true });
  };

  source.addEventListener('slots', event => {
    if (state.step === 'done') return;
    let date;
    try {
      ({ date } = JSON.parse(event.data));
    } catch {
      return;
    }
    if (typeof date !== 'string') return;
    if (date.slice(0, 7) === state.month) refreshMonth();
    if (date === state.date) loadSlots({ live: true });
  });

  // Après une coupure de connexion, on rattrape ce qui a pu changer entre-temps.
  let dropped = false;
  source.addEventListener('error', () => { dropped = true; });
  source.addEventListener('open', () => {
    if (dropped) refreshAll();
    dropped = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshAll();
  });
  addEventListener('pagehide', () => source.close());
}

// ── Démarrage ─────────────────────────────────────────────────────────────

root.addEventListener('click', event => {
  // Dans le tableau des prestations, toute la ligne est cliquable (le bouton reste la cible au clavier).
  const button = event.target.closest('button') || event.target.closest('.prices--pick tbody tr')?.querySelector('.service-card');
  if (!button || button.disabled) return;
  if (button.dataset.service) selectService(button.dataset.service);
  else if (button.dataset.goto) goTo(Number(button.dataset.goto));
  else if (button.dataset.date) selectDate(button.dataset.date);
  else if (button.dataset.time) selectTime(button.dataset.time);
  else if (button === el.calPrev) changeMonth(-1);
  else if (button === el.calNext) changeMonth(1);
  else if (button === el.proceed) goTo(3);
  else if (button.hasAttribute('data-ics')) downloadCalendar();
  else if (button === el.remind) toggleReminder();
});

// Liens directs :
//   /reservation?service=coupe-homme   depuis une ligne du tableau des tarifs (une, carte) ;
//   /reservation?date=2026-10-13       depuis une languette de l'affichette de la une.
const params = new URLSearchParams(location.search);
const presetDate = params.get('date') || '';
if (/^\d{4}-\d{2}-\d{2}$/.test(presetDate) && presetDate >= (data.firstDate || data.today) && presetDate <= data.lastDate) {
  state.date = presetDate;
  state.month = presetDate.slice(0, 7);
}

// La case « Me prévenir » n'a de sens que sur un appareil qui sait recevoir des notifications.
el.notifyField.hidden = !canRemind;
showMine();
refreshMine();

renderStepper();
renderCalendar();
renderSlots();
renderSummary();
connect();

const presetService = params.get('service');
if (services.has(presetService)) selectService(presetService, { focus: false });
