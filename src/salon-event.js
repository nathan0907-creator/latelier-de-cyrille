'use strict';

// L'événement du mois (soirée Halloween, journée portes ouvertes…), que la coiffeuse prépare depuis
// son espace : un titre, des dates, une accroche, un texte mis en forme, des photos, un bouton
// d'infos. Il s'affiche sur la une, sur sa page /evenement, et dans un encart à l'ouverture du site.
// Il disparaît tout seul le lendemain de son dernier jour.

const { isValidDate } = require('./time');
const { nearestRatio } = require('./settings');

const failure = (status, error) => ({ ok: false, status, error });
const MAX_IMAGES = 6;
const TEXT_MAX = 4000;
const THEMES = ['clair', 'soiree'];
const DEFAULT_KICKER = "L'événement du mois";
const DEFAULT_BUTTON = "Plus d'infos";

/** Une ligne de texte : sans caractères de commande, espaces resserrées, coupée à max. */
const line = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Le texte mis en forme : retours à la ligne gardés, rien d'autre de caché. */
const block = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
  .split('\n').map(text => text.replace(/[ \t]+$/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();

/** Où mène le bouton d'infos : une page du site, une adresse web, un téléphone ou un e-mail. */
function readLink(value) {
  const link = String(value ?? '').trim();
  if (!link) return '';
  if (link.startsWith('//')) return null;
  if (/^\/[\w\-./?=&%#]*$/.test(link) && !link.startsWith('//')) return link;
  if (/^tel:\+?[\d .-]{6,20}$/.test(link) || /^mailto:[^\s@<>"]+@[^\s@<>"]+$/.test(link)) return link;
  try {
    const url = new URL(/^[a-z]+:/i.test(link) ? link : `https://${link}`);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') ? url.href : null;
  } catch {
    return null;
  }
}

/** Les photos d'un événement : celles qui proviennent de /media/ (déposées depuis l'espace salon). */
const imagesOf = record => (record && Array.isArray(record.images) ? record.images.map(image => image.src) : []);

/**
 * store : le stockage du salon ; clock : l'heure du salon ;
 * describe(src) : les dimensions et versions réduites d'une photo déposée (src/settings.js) ;
 * sweepMedia() : efface les photos déposées qui ne servent plus.
 */
function createSalonEvent({ store, clock, describe, sweepMedia }) {
  const saved = () => store.salonEvent.get();

  /** Le dernier jour où l'événement s'affiche : sa fin, son jour, ou aucun s'il n'est pas daté. */
  const lastDay = event => event.endDate || event.date || '';

  /** L'événement tel qu'il s'affiche sur le site, ou null (pas d'événement, masqué, ou passé). */
  function current({ preview = false } = {}) {
    const event = saved();
    if (!event || !event.title) return null;
    const over = Boolean(lastDay(event)) && lastDay(event) < clock().date;
    if (!preview && (!event.enabled || over)) return null;
    return { ...event, over, hidden: !event.enabled };
  }

  function save(input) {
    if (!input || typeof input !== 'object') return failure(400, 'Rien à enregistrer.');
    const title = line(input.title, 90);
    const enabled = input.enabled === true;
    if (!title && enabled) return failure(400, "Donnez un titre à l'événement (par exemple : Soirée Halloween).");

    const date = String(input.date || '');
    const endDate = String(input.endDate || '');
    if (date && !isValidDate(date)) return failure(400, 'La date de début est invalide.');
    if (endDate && (!isValidDate(endDate) || !date)) return failure(400, 'Indiquez la date de début avant la date de fin.');
    if (endDate && endDate < date) return failure(400, 'La date de fin doit suivre la date de début.');

    const text = block(input.text);
    if (text.length > TEXT_MAX) return failure(400, `Le texte est trop long (${TEXT_MAX} caractères au plus).`);

    const list = Array.isArray(input.images) ? input.images : [];
    if (list.length > MAX_IMAGES) return failure(400, `${MAX_IMAGES} photos au plus.`);
    const images = [];
    for (const item of list) {
      const found = typeof item?.src === 'string' && item.src.startsWith('/media/') ? describe(item.src) : null;
      if (!found) return failure(400, 'Une des photos est introuvable : rechargez la page.');
      if (images.some(image => image.src === item.src)) return failure(400, 'La même photo apparaît deux fois.');
      const alt = line(item.alt, 120);
      if (!alt) return failure(400, 'Décrivez chaque photo en quelques mots : la description est lue par Google et aux personnes malvoyantes.');
      images.push({ src: item.src, alt, ratio: nearestRatio(found.width, found.height), ...found });
    }

    const link = readLink(input.buttonLink);
    if (link === null) return failure(400, "L'adresse du bouton d'infos est invalide (exemple : https://www.facebook.com/…).");

    const record = {
      enabled,
      popup: input.popup !== false,
      theme: THEMES.includes(input.theme) ? input.theme : THEMES[0],
      kicker: line(input.kicker, 60) || DEFAULT_KICKER,
      title,
      date,
      endDate: endDate === date ? '' : endDate,
      time: line(input.time, 60),
      summary: line(input.summary, 220),
      text,
      images,
      buttonLabel: line(input.buttonLabel, 40) || DEFAULT_BUTTON,
      // Sans lien donné, le bouton mène à la page de l'événement.
      buttonLink: link,
      booking: input.booking === true,
      updatedAt: new Date().toISOString(),
    };
    store.salonEvent.set(record);
    sweepMedia();
    return { ok: true, event: snapshot() };
  }

  /** Ce que l'espace salon affiche pour modifier. */
  function snapshot() {
    const event = saved();
    const thumb = image => ((image.variants || [])[0] || image).src;
    return {
      enabled: false, popup: true, theme: THEMES[0], kicker: DEFAULT_KICKER, title: '', date: '', endDate: '', time: '',
      summary: '', text: '', buttonLabel: DEFAULT_BUTTON, buttonLink: '', booking: false, updatedAt: '',
      ...event,
      images: (event?.images || []).map(image => ({ src: image.src, alt: image.alt, ratio: image.ratio, thumb: thumb(image) })),
      over: Boolean(event && lastDay(event) && lastDay(event) < clock().date),
    };
  }

  return { current, save, snapshot };
}

module.exports = { createSalonEvent, imagesOf, readLink, THEMES };
