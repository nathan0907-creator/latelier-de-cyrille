'use strict';

const crypto = require('node:crypto');
const { addDays } = require('./time');

/** Robots, aperçus de liens et outils automatiques : ils ne comptent pas comme des visites. */
const ROBOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|monitor|uptime|curl|wget|python|okhttp|axios|node|scan|facebookexternalhit|whatsapp/i;
const MOBILE = /Mobi|Android|iPhone|iPod/i;

/** « https://www.google.fr/search?q=… » → « google.fr » ; rien si la visite vient du site lui-même. */
function sourceOf(referrer, ownHost) {
  if (!referrer) return 'Accès direct';
  let host;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return 'Accès direct';
  }
  if (!host || host === String(ownHost || '').split(':')[0].toLowerCase()) return '';
  return host.replace(/^(www|m|l|lm|mobile)\./, '');
}

const emptyDay = () => ({ views: 0, visitors: 0, bookings: 0, pages: {}, sources: {}, devices: { mobile: 0, desktop: 0 } });

/**
 * Mesure de fréquentation intégrée, sans cookie ni service extérieur. On ne garde que des
 * compteurs par jour (pages vues, provenance, type d'appareil) : ni adresse IP, ni identifiant.
 * Pour compter les visiteurs du jour, une empreinte salée est gardée en mémoire jusqu'à minuit
 * seulement, et le sel change chaque jour : impossible de suivre quelqu'un d'un jour à l'autre.
 */
function createStats({ store, clock, keepDays = 400, saveEveryMs = 30_000 }) {
  const days = store.stats.days();
  let today = '';
  let salt = '';
  let seen = new Set();
  let dirty = false;

  function day(date) {
    if (date !== today) {
      today = date;
      salt = crypto.randomBytes(16).toString('hex');
      seen = new Set();
      const limit = addDays(date, -keepDays);
      for (const key of Object.keys(days)) if (key < limit) delete days[key];
    }
    days[date] ||= emptyDay();
    return days[date];
  }

  const bump = (counter, key) => { counter[key] = (counter[key] || 0) + 1; };

  /** Compte une page vue. Renvoie false si la visite n'est pas comptée (robot, refus de suivi). */
  function view({ path, referrer = '', userAgent = '', ip = '', host = '', optOut = false }) {
    if (optOut || !userAgent || ROBOT.test(userAgent)) return false;
    const record = day(clock().date);
    record.views += 1;
    bump(record.pages, path);
    const source = sourceOf(referrer, host);
    const visitor = crypto.createHash('sha256').update(`${salt}|${ip}|${userAgent}`).digest('base64url').slice(0, 16);
    if (!seen.has(visitor)) {
      seen.add(visitor);
      record.visitors += 1;
      bump(record.devices, MOBILE.test(userAgent) ? 'mobile' : 'desktop');
      // La provenance est celle de l'arrivée sur le site, pas de chaque page.
      if (source) bump(record.sources, source);
    }
    dirty = true;
    return true;
  }

  function booking() {
    day(clock().date).bookings += 1;
    dirty = true;
  }

  function save() {
    if (!dirty) return;
    dirty = false;
    store.stats.save();
  }

  const timer = setInterval(save, saveEveryMs);
  timer.unref();

  /** Les chiffres des `span` derniers jours, prêts à afficher. */
  function summary(span = 30) {
    const end = clock().date;
    const list = [];
    const totals = { views: 0, visitors: 0, bookings: 0 };
    const pages = {};
    const sources = {};
    const devices = { mobile: 0, desktop: 0 };
    for (let i = span - 1; i >= 0; i--) {
      const date = addDays(end, -i);
      const record = days[date] || emptyDay();
      list.push({ date, views: record.views, visitors: record.visitors, bookings: record.bookings });
      for (const key of Object.keys(totals)) totals[key] += record[key];
      for (const [key, count] of Object.entries(record.pages)) pages[key] = (pages[key] || 0) + count;
      for (const [key, count] of Object.entries(record.sources)) sources[key] = (sources[key] || 0) + count;
      devices.mobile += record.devices.mobile;
      devices.desktop += record.devices.desktop;
    }
    const top = counter => Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
    return { span, days: list, totals, pages: top(pages), sources: top(sources), devices };
  }

  return { view, booking, summary, save, close() { clearInterval(timer); save(); } };
}

module.exports = { createStats, sourceOf };
