'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fail, buildHours, buildServices } = require('./config-parts');
const { describePhoto } = require('./images');

/** Lit salon.config.js, le vérifie et renvoie une configuration prête à l'emploi. */
function loadConfig(raw = require('../salon.config.js'), env = process.env) {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) fail('« name » est obligatoire.');

  const booking = {
    slotStep: 30, minNoticeMinutes: 120, maxDaysAhead: 60, maxActivePerPhone: 3,
    retentionDays: 365, appointmentOnly: '', noShow: '', reminders: [1440, 120], ...raw.booking,
  };
  if (!Array.isArray(booking.reminders) || booking.reminders.some(m => !Number.isInteger(m) || m < 10)) {
    fail('« booking.reminders » doit lister des délais en minutes (au moins 10).');
  }
  if (!Number.isInteger(booking.slotStep) || booking.slotStep < 5) fail('« booking.slotStep » doit être un entier ≥ 5.');

  const hours = buildHours(raw.hours, booking.slotStep);
  const { services, categories } = buildServices(raw.services, booking.slotStep);

  const address = { street: '', postalCode: '', city: '', mapsQuery: '', access: [], ...raw.address };
  const fullAddress = `${address.street}, ${address.postalCode} ${address.city}`.trim();
  const query = encodeURIComponent(address.mapsQuery || fullAddress);

  const publicDir = path.join(__dirname, '..', 'public');
  // Chaque photo locale reçoit ses dimensions et ses versions réduites (voir src/images.js).
  const photos = Object.fromEntries(Object.entries({ gallery: [], ...raw.photos }).map(([key, value]) =>
    [key, Array.isArray(value) ? value.map(photo => describePhoto(photo, publicDir)) : describePhoto(value, publicDir)]));
  const imageHosts = new Set();
  const collect = photo => {
    if (photo && /^https:\/\//.test(photo.src || '')) imageHosts.add(new URL(photo.src).origin);
  };
  Object.values(photos).forEach(value => (Array.isArray(value) ? value.forEach(collect) : collect(value)));

  const siteUrl = (raw.siteUrl || '').replace(/\/+$/, '');

  // Date de la dernière mise à jour du contenu (plan du site) : celle du fichier de configuration.
  let updated = '';
  try {
    updated = fs.statSync(path.join(__dirname, '..', 'salon.config.js')).mtime.toISOString().slice(0, 10);
  } catch { /* fichier introuvable : la date du jour sera prise */ }

  return Object.freeze({
    name: raw.name.trim(),
    owner: raw.owner || '',
    tagline: raw.tagline || '',
    // Le métier, tel qu'il s'écrit dans les titres lus par les moteurs de recherche.
    trade: raw.tagline || 'Salon de coiffure',
    description: raw.description || '',
    siteUrl,
    updated,
    contact: { phone: '', email: '', instagram: '', google: '', ...raw.contact },
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
    // Image montrée quand on partage le site (réseaux sociaux, messageries) : 1200 × 630.
    shareImage: fs.existsSync(path.join(publicDir, 'img', 'partage.jpg')) ? '/img/partage.jpg' : '',
    // Référencement : communes voisines, codes de vérification des moteurs de recherche.
    seo: { nearby: [], googleVerification: '', bingVerification: '', ...raw.seo },
    imageHosts: [...imageHosts],
    legal: { company: raw.name, status: '', siret: '', publisher: '', host: '', ...raw.legal },

    port: Number(env.PORT) || 3000,
    // Port imposé par PORT : on n'en essaie pas d'autre s'il est occupé.
    portFixed: Boolean(Number(env.PORT)),
    host: env.HOST || '0.0.0.0',
    trustProxy: env.TRUST_PROXY === '1',
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
    publicDir,
  });
}

module.exports = { loadConfig };
