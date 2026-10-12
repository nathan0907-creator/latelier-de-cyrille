'use strict';

const path = require('node:path');
const { toMinutes } = require('./time');

function fail(message) {
  throw new Error(`salon.config.js : ${message}`);
}

/** Lit salon.config.js, le vérifie et renvoie une configuration prête à l'emploi. */
function loadConfig(raw = require('../salon.config.js'), env = process.env) {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) fail('« name » est obligatoire.');

  const booking = {
    slotStep: 30, minNoticeMinutes: 120, maxDaysAhead: 60, maxActivePerPhone: 3,
    retentionDays: 365, paymentNote: '', ...raw.booking,
  };
  if (!Number.isInteger(booking.slotStep) || booking.slotStep < 5) fail('« booking.slotStep » doit être un entier ≥ 5.');

  const hours = {};
  for (let day = 0; day < 7; day++) {
    const ranges = (raw.hours?.[day] || []).map(([from, to]) => {
      const start = toMinutes(from);
      const end = toMinutes(to);
      if (start === null || end === null || end <= start) fail(`horaires invalides pour le jour ${day} : ${from} – ${to}.`);
      if (start % booking.slotStep) fail(`l'ouverture ${from} (jour ${day}) doit tomber sur un créneau de ${booking.slotStep} min.`);
      return { start, end };
    }).sort((a, b) => a.start - b.start);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].start < ranges[i - 1].end) fail(`les plages horaires du jour ${day} se chevauchent.`);
    }
    hours[day] = ranges;
  }

  const services = [];
  const categories = [];
  const ids = new Set();
  for (const group of raw.services || []) {
    if (!group.category) fail('chaque groupe de prestations doit avoir une « category ».');
    const items = [];
    for (const s of group.items || []) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.id || '')) fail(`identifiant de prestation invalide : « ${s.id} » (minuscules, chiffres et tirets).`);
      if (ids.has(s.id)) fail(`identifiant de prestation en double : « ${s.id} ».`);
      if (!s.name) fail(`la prestation « ${s.id} » n'a pas de nom.`);
      if (!Number.isInteger(s.duration) || s.duration <= 0 || s.duration % booking.slotStep) {
        fail(`la durée de « ${s.id} » doit être un multiple de ${booking.slotStep} minutes.`);
      }
      // « prices » : plusieurs tarifs (cheveux courts, mi-longs, longs). Le prix retenu pour
      // la réservation est alors le plus bas, affiché « dès … ».
      const tiers = s.prices === undefined ? null : s.prices;
      if (tiers && (!Array.isArray(tiers) || tiers.length < 2 || tiers.length > 3 || tiers.some(p => typeof p !== 'number' || p < 0))) {
        fail(`les prix de « ${s.id} » sont invalides : indiquez deux ou trois montants.`);
      }
      const price = tiers ? Math.min(...tiers) : s.price;
      if (typeof price !== 'number' || price < 0) fail(`le prix de « ${s.id} » est invalide.`);
      ids.add(s.id);
      const service = Object.freeze({
        id: s.id, name: s.name, description: s.description || '', duration: s.duration,
        price, prices: tiers ? Object.freeze([...tiers]) : null,
        priceFrom: Boolean(s.priceFrom || tiers), category: group.category,
      });
      services.push(service);
      items.push(service);
    }
    categories.push({ name: group.category, items });
  }
  if (!services.length) fail('ajoutez au moins une prestation.');

  const address = { street: '', postalCode: '', city: '', mapsQuery: '', access: [], ...raw.address };
  const fullAddress = `${address.street}, ${address.postalCode} ${address.city}`.trim();
  const query = encodeURIComponent(address.mapsQuery || fullAddress);

  const photos = { gallery: [], ...raw.photos };
  const imageHosts = new Set();
  const collect = photo => {
    if (photo && /^https:\/\//.test(photo.src || '')) imageHosts.add(new URL(photo.src).origin);
  };
  Object.values(photos).forEach(value => (Array.isArray(value) ? value.forEach(collect) : collect(value)));

  const siteUrl = (raw.siteUrl || '').replace(/\/+$/, '');

  return Object.freeze({
    name: raw.name.trim(),
    owner: raw.owner || '',
    tagline: raw.tagline || '',
    description: raw.description || '',
    siteUrl,
    contact: { phone: '', email: '', instagram: '', ...raw.contact },
    address: { ...address, full: fullAddress },
    maps: {
      embed: `https://www.google.com/maps?q=${query}&output=embed`,
      directions: `https://www.google.com/maps/dir/?api=1&destination=${query}`,
      view: `https://www.google.com/maps/search/?api=1&query=${query}`,
    },
    timezone: raw.timezone || 'Europe/Paris',
    hours,
    booking,
    services,
    categories,
    priceNote: raw.priceNote || '',
    // Gros titre de la une ; à défaut, le nom du salon.
    headline: Array.isArray(raw.headline) && raw.headline.length ? raw.headline.map(String) : [raw.name.trim()],
    featuredServices: (raw.featuredServices || []).map(id => services.find(s => s.id === id)).filter(Boolean),
    about: { title: '', paragraphs: [], ...raw.about },
    photos,
    imageHosts: [...imageHosts],
    legal: { company: raw.name, status: '', siret: '', publisher: '', host: '', ...raw.legal },

    port: Number(env.PORT) || 3000,
    // Port imposé par PORT : on n'en essaie pas d'autre s'il est occupé.
    portFixed: Boolean(Number(env.PORT)),
    host: env.HOST || '0.0.0.0',
    trustProxy: env.TRUST_PROXY === '1',
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
    publicDir: path.join(__dirname, '..', 'public'),
  });
}

module.exports = { loadConfig };
