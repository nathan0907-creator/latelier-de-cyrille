'use strict';

/**
 * Les parties de la configuration qui se vérifient et se recalculent en cours de route : la carte
 * des prestations, les horaires, et la prise en compte des réglages faits depuis l'espace salon.
 * Rien ici ne lit de fichier : ces fonctions servent au démarrage (src/config.js) comme en ligne
 * sur Cloudflare, où la configuration a été préparée à la publication.
 */

const { toMinutes } = require('./time');

function fail(message) {
  throw new Error(`salon.config.js : ${message}`);
}

/** Les horaires de la semaine, vérifiés : pour chaque jour (0 = dimanche), des plages en minutes. */
function buildHours(raw, slotStep) {
  const hours = {};
  for (let day = 0; day < 7; day++) {
    const ranges = (raw?.[day] || []).map(([from, to]) => {
      const start = toMinutes(from);
      const end = toMinutes(to);
      if (start === null || end === null || end <= start) fail(`horaires invalides pour le jour ${day} : ${from} – ${to}.`);
      if (start % slotStep) fail(`l'ouverture ${from} (jour ${day}) doit tomber sur un créneau de ${slotStep} min.`);
      return { start, end };
    }).sort((a, b) => a.start - b.start);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].start < ranges[i - 1].end) fail(`les plages horaires du jour ${day} se chevauchent.`);
    }
    hours[day] = ranges;
  }
  return hours;
}

/** La carte, vérifiée : la liste de toutes les prestations, et les mêmes rangées par catégorie. */
/**
 * Les temps de pose d'une prestation : « after » minutes après le début, la coiffeuse est libre
 * « duration » minutes. Elle travaille avant chaque pose et après la dernière. Renvoie la liste
 * dans l'ordre, ou null si elle ne tient pas dans la prestation.
 * (On lit aussi l'ancienne écriture, à une seule pose : pauseAfter / pauseDuration.)
 */
function readPauses(item, duration, step) {
  const raw = Array.isArray(item.pauses) ? item.pauses
    : Number(item.pauseDuration) ? [{ after: item.pauseAfter, duration: item.pauseDuration }] : [];
  const pauses = raw.map(pause => ({ after: Number(pause?.after), duration: Number(pause?.duration) })).sort((a, b) => a.after - b.after);
  let busyUntil = 0;
  for (const pause of pauses) {
    if (![pause.after, pause.duration].every(m => Number.isInteger(m) && m > 0 && m % step === 0) || pause.after <= busyUntil) return null;
    busyUntil = pause.after + pause.duration;
  }
  return busyUntil < duration ? pauses : null;
}

function buildServices(groups, slotStep) {
  const services = [];
  const categories = [];
  const ids = new Set();
  for (const group of groups || []) {
    if (!group.category) fail('chaque groupe de prestations doit avoir une « category ».');
    const items = [];
    for (const s of group.items || []) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.id || '')) fail(`identifiant de prestation invalide : « ${s.id} » (minuscules, chiffres et tirets).`);
      if (ids.has(s.id)) fail(`identifiant de prestation en double : « ${s.id} ».`);
      if (!s.name) fail(`la prestation « ${s.id} » n'a pas de nom.`);
      if (!Number.isInteger(s.duration) || s.duration <= 0 || s.duration % slotStep) {
        fail(`la durée de « ${s.id} » doit être un multiple de ${slotStep} minutes.`);
      }
      // « prices » : plusieurs tarifs (cheveux courts, mi-longs, longs). Le prix retenu pour
      // la réservation est alors le plus bas, affiché « dès … ».
      const tiers = s.prices === undefined ? null : s.prices;
      if (tiers && (!Array.isArray(tiers) || tiers.length < 2 || tiers.length > 3 || tiers.some(p => typeof p !== 'number' || p < 0))) {
        fail(`les prix de « ${s.id} » sont invalides : indiquez deux ou trois montants.`);
      }
      const pauses = readPauses(s, s.duration, slotStep);
      if (!pauses) fail(`les temps de pose de « ${s.id} » doivent commencer après le début, ne pas se toucher et finir avant la fin de la prestation, par tranches de ${slotStep} minutes.`);
      const price = tiers ? Math.min(...tiers) : s.price;
      if (typeof price !== 'number' || price < 0) fail(`le prix de « ${s.id} » est invalide.`);
      ids.add(s.id);
      const service = Object.freeze({
        id: s.id, name: s.name, description: s.description || '', duration: s.duration, pauses: Object.freeze(pauses.map(Object.freeze)),
        price, prices: tiers ? Object.freeze([...tiers]) : null,
        priceFrom: Boolean(s.priceFrom || tiers), category: group.category,
      });
      services.push(service);
      items.push(service);
    }
    categories.push({ name: group.category, items });
  }
  if (!services.length) fail('ajoutez au moins une prestation.');
  return { services, categories };
}

/**
 * La configuration avec les réglages faits depuis l'espace salon (voir src/settings.js) : la carte,
 * les horaires et les photos enregistrés là-bas remplacent ceux de salon.config.js, après les mêmes
 * vérifications. On part de la configuration déjà prête, sans rien relire sur le disque : cela vaut
 * aussi en ligne sur Cloudflare, où elle a été calculée à la publication.
 */
function withSettings(base, settings = {}) {
  const next = { ...base };
  if (settings.services) {
    Object.assign(next, buildServices(settings.services, base.booking.slotStep));
    next.featuredServices = (settings.featuredServices || []).map(id => next.services.find(s => s.id === id)).filter(Boolean);
  }
  if (typeof settings.priceNote === 'string') next.priceNote = settings.priceNote;
  if (settings.hours) next.hours = buildHours(settings.hours, base.booking.slotStep);
  if (settings.photos) next.photos = { ...base.photos, ...settings.photos };
  return Object.freeze(next);
}

module.exports = { fail, buildHours, buildServices, withSettings, readPauses };
