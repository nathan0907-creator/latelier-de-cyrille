// Outils partagés par la réservation et l'espace salon.

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const EASE_OUT = 'cubic-bezier(.16, 1, .3, 1)';

// ── DOM ───────────────────────────────────────────────────────────────────

/**
 * Crée un élément : h('button', { class: 'btn', onclick: fn }, 'Texte', enfant…).
 * Le texte passe toujours par textContent : rien de ce que saisit un visiteur
 * n'est interprété comme du HTML.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  el.append(...children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false));
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Icône de la planche incluse dans la page (voir src/views/icons.js). */
export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function readPageData() {
  const node = document.getElementById('page-data');
  return node ? JSON.parse(node.textContent) : {};
}

export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Animation discrète, ignorée si le visiteur préfère moins de mouvement. */
export function animate(el, keyframes, options = {}) {
  if (reducedMotion || !el.animate) return { finished: Promise.resolve() };
  const animation = el.animate(keyframes, { easing: EASE_OUT, ...options });
  // Le bon déroulement ne doit jamais dépendre de la fin d'une animation : dans un onglet en
  // arrière-plan elle ne progresse pas, et une animation interrompue rejette « finished ».
  // « finished » est donc toujours tenu, au plus tard juste après la durée prévue.
  const limit = (Number(options.duration) || 0) + (Number(options.delay) || 0) + 120;
  return {
    finished: Promise.race([
      animation.finished.catch(() => {}),
      new Promise(resolve => setTimeout(resolve, limit)),
    ]),
  };
}

// ── API ───────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || 'Une erreur est survenue. Réessayez dans un instant.');
    this.status = status;
    this.data = data || {};
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'Connexion impossible. Vérifiez votre réseau et réessayez.' });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

// ── Dates (chaînes « AAAA-MM-JJ », calculées en UTC pour ne dépendre d'aucun fuseau) ──

export const pad2 = n => String(n).padStart(2, '0');

const toUTC = date => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUTC = d => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

export function addDays(date, n) {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** 0 = lundi … 6 = dimanche */
export const mondayIndex = date => (toUTC(date).getUTCDay() + 6) % 7;

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${pad2(i + 1)}`);
}

const formatter = options => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...options });
const LONG = formatter({ weekday: 'long', day: 'numeric', month: 'long' });
const SHORT = formatter({ weekday: 'short', day: 'numeric', month: 'short' });
const MONTH = formatter({ month: 'long', year: 'numeric' });

/** « mardi 13 octobre » */
export const formatLong = date => LONG.format(toUTC(date));
/** « mar. 13 oct. » */
export const formatShort = date => SHORT.format(toUTC(date));
/** « octobre 2026 » */
export const formatMonth = month => MONTH.format(toUTC(`${month}-01`));

export const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);

// ── Heures, durées, prix ──────────────────────────────────────────────────

export const toMinutes = time => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};
export const fromMinutes = minutes => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

/** « 09:30 » ou 570 → « 9h30 » */
export function frTime(value) {
  const minutes = typeof value === 'number' ? value : toMinutes(value);
  return `${Math.floor(minutes / 60)}h${pad2(minutes % 60)}`;
}

/** 90 → « 1 h 30 » */
export function durationLabel(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${pad2(rest)}` : ''}`;
}

export const euros = amount => `${Number.isInteger(amount) ? amount : amount.toFixed(2).replace('.', ',')} €`;
