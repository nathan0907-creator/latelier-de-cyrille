'use strict';

const crypto = require('node:crypto');
const { withSettings, readPauses } = require('./config-parts');
const { imageSize } = require('./images');
const { fromMinutes } = require('./time');

const failure = (status, error) => ({ ok: false, status, error });

/** Retire les caractères de contrôle, réduit les espaces et tronque. */
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** « Ombré complet » → « ombre-complet » : l'identifiant d'une prestation créée depuis l'espace salon. */
function slug(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'prestation';
}

const RATIOS = { '16/9': 16 / 9, '4/3': 4 / 3, '1/1': 1, '4/5': 4 / 5, '3/4': 3 / 4 };

/** Le format d'affichage le plus proche des dimensions réelles de la photo. */
function nearestRatio(width, height) {
  const actual = Math.log(width / height);
  return Object.keys(RATIOS).reduce((best, key) => (Math.abs(Math.log(RATIOS[key]) - actual) < Math.abs(Math.log(RATIOS[best]) - actual) ? key : best));
}

/** Type d'une image d'après ses premiers octets (on ne se fie ni au nom ni au type annoncé). */
function imageKind(buffer) {
  if (buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  return null;
}

/** Une photo déposée : « photo-abc123.webp », ou une de ses versions réduites « photo-abc123-800.webp ». */
const MEDIA_NAME = /^(photo-[a-z0-9]+)(?:-(\d+))?\.(webp|jpg)$/;
const MEDIA_TYPES = { webp: 'image/webp', jpg: 'image/jpeg' };

/** Poids maximal d'un fichier : en ligne, une ligne de la base du salon ne dépasse pas 2 Mo. */
const MAX_BYTES = 1_800_000;

/**
 * Ce que la coiffeuse règle depuis son espace : prestations et tarifs, horaires, photos.
 * Ces réglages sont enregistrés avec les données du salon et passent avant salon.config.js ;
 * tout le reste (nom, adresse, règles de réservation) reste dans ce fichier.
 * `config` est toujours à jour : les pages et les créneaux suivent sans redémarrer le site.
 * Rien n'est lu ni écrit ailleurs que dans le stockage du salon : le même code tourne sur
 * l'ordinateur du salon et en ligne sur Cloudflare.
 */
/**
 * keepMedia() : les autres photos déposées encore utilisées (celles de l'événement du mois),
 * à ne pas effacer avec les photos qui ne servent plus.
 */
function createSettings({ base, store, keepMedia = () => [] }) {
  const media = store.media;
  let overrides = store.settings.get() || {};
  let current;
  try {
    current = withSettings(base, overrides);
  } catch (err) {
    // Des réglages devenus incohérents ne doivent pas empêcher le site de démarrer.
    console.error(`[réglages] ignorés, le site reprend salon.config.js : ${err.message}`);
    overrides = {};
    current = base;
  }

  // Une « fenêtre » sur la configuration du moment : ceux qui la tiennent voient les changements.
  const config = new Proxy({}, {
    get: (_, key) => current[key],
    has: (_, key) => key in current,
    ownKeys: () => Reflect.ownKeys(current),
    getOwnPropertyDescriptor: (_, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
      return descriptor && { ...descriptor, configurable: true };
    },
  });

  function apply(patch) {
    const next = { ...overrides, ...patch, updatedAt: new Date().toISOString() };
    let built;
    try {
      built = withSettings(base, next);
    } catch (err) {
      const message = err.message.replace(/^salon\.config\.js : /, '');
      return failure(400, message.charAt(0).toUpperCase() + message.slice(1));
    }
    overrides = next;
    current = built;
    store.settings.set(next);
    return { ok: true };
  }

  // ── Prestations et tarifs ────────────────────────────────────────────────

  function setServices(input) {
    const step = current.booking.slotStep;
    if (!Array.isArray(input?.categories) || !input.categories.length) return failure(400, 'Ajoutez au moins une catégorie.');
    if (input.categories.length > 10) return failure(400, 'Dix catégories au plus.');

    const known = new Set(current.services.map(service => service.id));
    const used = new Set();
    const featured = [];
    const services = [];
    for (const group of input.categories) {
      const category = clean(group?.name, 40);
      if (!category) return failure(400, 'Chaque catégorie doit avoir un nom.');
      if (services.some(other => other.category.toLowerCase() === category.toLowerCase())) return failure(400, `La catégorie « ${category} » apparaît deux fois.`);
      if (!Array.isArray(group.items) || !group.items.length) return failure(400, `La catégorie « ${category} » est vide : ajoutez une prestation ou supprimez-la.`);
      if (group.items.length > 40) return failure(400, 'Quarante prestations au plus par catégorie.');

      const items = [];
      for (const item of group.items) {
        const name = clean(item?.name, 60);
        if (!name) return failure(400, 'Chaque prestation doit avoir un nom.');
        const duration = Number(item.duration);
        if (!Number.isInteger(duration) || duration < step || duration > 600 || duration % step) {
          return failure(400, `La durée de « ${name} » doit être un multiple de ${step} minutes (10 heures au plus).`);
        }
        // Temps de pose : aucun, ou des poses qui tiennent dans la prestation sans se toucher.
        const pauses = readPauses(item, duration, step);
        if (!pauses || pauses.length > 4) {
          return failure(400, `Les temps de pose de « ${name} » doivent commencer après le début, ne pas se toucher et finir avant la fin de la prestation.`);
        }
        const pause = pauses.length ? { pauses } : {};
        const amounts = (Array.isArray(item.prices) ? item.prices : [item.price]).map(value => Math.round(Number(String(value).replace(',', '.')) * 100) / 100);
        if (![1, 2, 3].includes(amounts.length) || amounts.some(amount => !Number.isFinite(amount) || amount < 0 || amount > 5000)) {
          return failure(400, `Indiquez le prix de « ${name} » (un nombre, en euros).`);
        }
        // Une prestation qui existait garde son identifiant : les liens et les rendez-vous la retrouvent.
        let id = known.has(item.id) && !used.has(item.id) ? item.id : slug(name);
        for (let n = 2; used.has(id); n++) id = `${slug(name)}-${n}`;
        used.add(id);
        if (item.featured) featured.push(id);
        items.push(amounts.length > 1
          ? { id, name, duration, ...pause, prices: amounts }
          : { id, name, duration, ...pause, price: amounts[0], priceFrom: Boolean(item.priceFrom) });
      }
      services.push({ category, items });
    }
    if (featured.length > 8) return failure(400, 'Huit prestations au plus à la une.');
    return apply({ services, featuredServices: featured, priceNote: clean(input.priceNote, 160) });
  }

  // ── Horaires ─────────────────────────────────────────────────────────────

  function setHours(input) {
    const hours = {};
    for (let day = 0; day < 7; day++) {
      const ranges = input?.[day] ?? [];
      if (!Array.isArray(ranges) || ranges.length > 3 || ranges.some(range => !Array.isArray(range) || range.length !== 2 || range.some(time => typeof time !== 'string'))) {
        return failure(400, 'Horaires illisibles.');
      }
      hours[day] = ranges.map(([from, to]) => [from, to]);
    }
    if (!Object.values(hours).some(ranges => ranges.length)) return failure(400, 'Le salon doit être ouvert au moins un jour par semaine.');
    const result = apply({ hours });
    if (result.ok) return result;
    // Les messages de vérification parlent de « jour 2 » : on les redit simplement.
    return failure(400, "Vérifiez les horaires : chaque plage doit finir après son début, tomber sur l'heure ou la demie, et ne pas en chevaucher une autre.");
  }

  // ── Photos ───────────────────────────────────────────────────────────────

  /** Les photos livrées avec le site (public/photos/), telles que salon.config.js les décrit. */
  const shipped = new Map([base.photos.hero, base.photos.second, base.photos.find, ...base.photos.gallery]
    .filter(photo => photo && typeof photo.src === 'string' && photo.src.startsWith('/photos/'))
    .map(photo => [photo.src, photo]));

  /**
   * Dimensions et versions réduites d'une photo que le site sait servir : déposée depuis l'espace
   * salon (/media/…) ou livrée avec le site (/photos/…). null si elle n'existe pas.
   */
  function describe(src) {
    if (typeof src !== 'string') return null;
    if (shipped.has(src)) {
      const { width, height, variants = [] } = shipped.get(src);
      return width && height ? { width, height, variants } : null;
    }
    const match = src.startsWith('/media/') && MEDIA_NAME.exec(src.slice(7));
    if (!match || match[2]) return null;
    const bytes = media.read(match[0]);
    const size = bytes && imageSize(bytes);
    if (!size) return null;
    const variants = media.list()
      .map(name => MEDIA_NAME.exec(name))
      .filter(found => found && found[1] === match[1] && found[2] && found[3] === match[3])
      .map(found => ({ width: Number(found[2]), src: `/media/${found[0]}` }))
      .sort((a, b) => a.width - b.width);
    return { ...size, variants };
  }

  /** Une photo déposée, prête à être envoyée au navigateur : ses octets et son type. */
  function readPhoto(name) {
    const match = MEDIA_NAME.exec(name);
    const bytes = match && media.read(match[0]);
    return bytes ? { bytes, type: MEDIA_TYPES[match[3]] } : null;
  }

  /** Enregistre une photo envoyée par l'espace salon : l'image, puis ses versions réduites. */
  function addPhoto(input) {
    const files = Array.isArray(input?.files) ? input.files : [];
    if (!files.length || files.length > 5) return failure(400, 'Photo illisible.');
    const images = [];
    for (const file of files) {
      if (typeof file?.data !== 'string' || file.data.length > MAX_BYTES * 1.4) return failure(413, 'Cette photo est trop lourde.');
      const buffer = Buffer.from(file.data, 'base64');
      const kind = imageKind(buffer);
      const size = kind && imageSize(buffer);
      if (!kind || !size) return failure(400, "Ce fichier n'est pas une photo que le site sait afficher.");
      images.push({ buffer, kind, ...size });
    }
    images.sort((a, b) => b.width - a.width);
    const [main, ...variants] = images;
    if (main.width > 2400 || main.height > 3200 || main.buffer.length > MAX_BYTES) return failure(413, 'Cette photo est trop grande.');
    if (main.width < 320 || main.height < 320) return failure(400, 'Cette photo est trop petite : choisissez-en une plus grande.');
    for (const variant of variants) {
      const sameShape = Math.abs(variant.width / variant.height - main.width / main.height) < 0.03;
      if (variant.kind !== main.kind || variant.width >= main.width || !sameShape || variant.buffer.length > MAX_BYTES) return failure(400, 'Photo illisible.');
    }

    const name = `photo-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    media.write(`${name}.${main.kind}`, main.buffer);
    for (const variant of variants) media.write(`${name}-${variant.width}.${main.kind}`, variant.buffer);
    return { ok: true, photo: { src: `/media/${name}.${main.kind}`, width: main.width, height: main.height, ratio: nearestRatio(main.width, main.height) } };
  }

  /** Efface les photos déposées qui ne servent plus nulle part (avec leurs versions réduites). */
  function sweepMedia() {
    const photos = current.photos;
    const kept = new Set([...[photos.hero, photos.second, photos.find, ...photos.gallery].map(photo => photo && photo.src), ...keepMedia()]
      .filter(src => src && src.startsWith('/media/'))
      .map(src => MEDIA_NAME.exec(src.slice(7))?.[1]));
    for (const name of media.list()) {
      const match = MEDIA_NAME.exec(name);
      if (!match || !kept.has(match[1])) media.remove(name);
    }
  }

  function setPhotos(input) {
    const list = Array.isArray(input?.gallery) ? input.gallery : [];
    if (!list.length) return failure(400, 'Gardez au moins une photo.');
    if (list.length > 30) return failure(400, 'Trente photos au plus.');
    const gallery = [];
    for (const item of list) {
      const found = describe(item?.src);
      if (!found) return failure(400, 'Une des photos est introuvable : rechargez la page.');
      if (gallery.some(photo => photo.src === item.src)) return failure(400, 'La même photo apparaît deux fois.');
      const alt = clean(item.alt, 120);
      if (!alt) return failure(400, 'Décrivez chaque photo en quelques mots : la description est lue par Google et aux personnes malvoyantes.');
      // Dimensions et versions réduites sont notées avec la photo : les pages n'ont rien à relire.
      gallery.push({ src: item.src, alt, ratio: nearestRatio(found.width, found.height), ...found });
    }
    const pick = src => gallery.find(photo => photo.src === src) || null;
    const hero = pick(input.hero) || gallery[0];
    const second = input.second && input.second !== hero.src ? pick(input.second) : null;
    const result = apply({ photos: { hero, second, gallery } });
    if (result.ok) sweepMedia();
    return result;
  }

  // ── Ce que l'espace salon affiche pour modifier ──────────────────────────

  function snapshot() {
    const thumb = photo => ((photo.variants || [])[0] || photo).src;
    const featured = new Set(current.featuredServices.map(service => service.id));
    return {
      slotStep: current.booking.slotStep,
      categories: current.categories.map(category => ({
        name: category.name,
        items: category.items.map(service => ({
          id: service.id,
          name: service.name,
          duration: service.duration,
          pauses: service.pauses.map(pause => ({ ...pause })),
          ...(service.prices ? { prices: [...service.prices] } : { price: service.price, priceFrom: service.priceFrom }),
          featured: featured.has(service.id),
        })),
      })),
      priceNote: current.priceNote,
      hours: Object.fromEntries(Object.entries(current.hours).map(([day, ranges]) => [day, ranges.map(range => [fromMinutes(range.start), fromMinutes(range.end)])])),
      photos: {
        hero: current.photos.hero ? current.photos.hero.src : '',
        second: current.photos.second ? current.photos.second.src : '',
        gallery: current.photos.gallery.map(photo => ({ src: photo.src, alt: photo.alt || '', ratio: photo.ratio, thumb: thumb(photo) })),
      },
    };
  }

  return {
    config,
    snapshot,
    setServices,
    setHours,
    setPhotos,
    addPhoto,
    readPhoto,
    describe,
    sweepMedia,
    /** Date du dernier changement fait depuis l'espace salon (pour le plan du site). */
    updatedAt: () => overrides.updatedAt || '',
  };
}

module.exports = { createSettings, nearestRatio };
