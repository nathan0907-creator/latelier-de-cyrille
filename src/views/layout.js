'use strict';

const { html, raw, jsonForScript } = require('./html');
const { icon, sprite } = require('./icons');
const { PAGES, edition, capitalize, hoursTable, openBadge, telHref, buttonLabel, euros } = require('./components');
const { fromMinutes } = require('../time');

// Les quatre familles de la gazette :
//   Grand Hotel            le titre et les mots en écriture : une cursive d'enseigne des années trente
//   League Gothic          les gros titres : l'« Alternate Gothic » des unes, en capitales étroites
//   Old Standard TT        titres secondaires et texte : le romain des imprimés du début du XXe siècle
//   Archivo Narrow         surtitres, étiquettes, boutons : une grotesque étroite
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@400..700&family=Grand+Hotel&family=League+Gothic&family=Old+Standard+TT:ital,wght@0,400;0,700;1,400&display=swap';

const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** « 07 45 07 50 16 » → « +33745075016 », la forme que lisent les moteurs de recherche. */
const internationalPhone = phone => {
  const digits = phone.replace(/[^\d+]/g, '');
  return /^0\d{9}$/.test(digits) ? `+33${digits.slice(1)}` : digits;
};

/**
 * Données structurées lues par les moteurs de recherche : la fiche du salon (adresse, horaires,
 * téléphone, réservation), sa carte de prestations sur les pages qui la montrent, et le fil
 * d'Ariane des pages intérieures.
 */
function structuredData(site, { catalog = false, crumb = '', trail = [], schema = null } = {}) {
  const { config, origin, path } = site;
  const at = target => `${origin}${target}`;
  const prices = config.services.flatMap(service => service.prices || [service.price]);
  const images = [config.shareImage, config.photos.hero && config.photos.hero.src].filter(Boolean).map(src => (src.startsWith('/') ? at(src) : src));

  const salon = {
    '@type': 'HairSalon',
    '@id': at('/#salon'),
    name: config.name,
    description: config.description,
    url: at('/'),
    ...(config.contact.phone && { telephone: internationalPhone(config.contact.phone) }),
    ...(config.contact.email && { email: config.contact.email }),
    ...(images.length && { image: images }),
    logo: at('/img/icone-512.png'),
    priceRange: `${euros(Math.min(...prices))} – ${euros(Math.max(...prices))}`,
    currenciesAccepted: 'EUR',
    address: {
      '@type': 'PostalAddress',
      streetAddress: config.address.street,
      postalCode: config.address.postalCode,
      addressLocality: config.address.city,
      addressCountry: 'FR',
    },
    areaServed: [config.address.city, ...config.seo.nearby].map(name => ({ '@type': 'City', name })),
    hasMap: config.maps.view,
    openingHoursSpecification: Object.entries(config.hours).flatMap(([day, ranges]) =>
      ranges.map(range => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: `https://schema.org/${SCHEMA_DAYS[day]}`,
        opens: fromMinutes(range.start),
        closes: fromMinutes(range.end),
      }))),
    // Les autres pages du salon (Facebook, fiche Google…) : les moteurs de recherche font le lien.
    ...((config.contact.facebook || config.contact.instagram || config.contact.google) && { sameAs: [config.contact.facebook, config.contact.instagram, config.contact.google].filter(Boolean) }),
    // Congés, jours fériés : les jours de fermeture à venir, pour que les horaires affichés par les
    // moteurs de recherche soient justes ces jours-là (ouverture et fermeture à minuit = fermé).
    ...((site.closures || []).length && {
      specialOpeningHoursSpecification: site.closures.map(period => ({
        '@type': 'OpeningHoursSpecification',
        validFrom: period.from,
        validThrough: period.to,
        opens: '00:00',
        closes: '00:00',
      })),
    }),
    potentialAction: {
      '@type': 'ReserveAction',
      name: 'Prendre rendez-vous',
      target: { '@type': 'EntryPoint', urlTemplate: at('/reservation'), inLanguage: 'fr-FR', actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'] },
      result: { '@type': 'Reservation', name: 'Rendez-vous au salon' },
    },
    ...(catalog && {
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: 'Prestations et tarifs',
        itemListElement: config.categories.map(category => ({
          '@type': 'OfferCatalog',
          name: category.name,
          itemListElement: category.items.map(service => ({
            '@type': 'Offer',
            price: service.price,
            priceCurrency: 'EUR',
            itemOffered: { '@type': 'Service', name: service.name },
          })),
        })),
      },
    }),
  };

  const graph = [salon];
  if (path === '/') {
    graph.push({ '@type': 'WebSite', '@id': at('/#site'), url: at('/'), name: config.name, inLanguage: 'fr-FR', publisher: { '@id': salon['@id'] } });
  } else if (crumb) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [{ name: config.name, path: '/' }, ...trail, { name: crumb, path }]
        .map((step, i) => ({ '@type': 'ListItem', position: i + 1, name: step.name, item: at(step.path) })),
    });
  }
  if (schema) graph.push(...schema({ at, salon: salon['@id'] }));
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Le titre de la gazette, en écriture d'enseigne. */
function brand(config, href = '/') {
  return html`<a class="brand" href="${href}" aria-label="${config.name}, retour à la une">${config.name}</a>`;
}

/**
 * Rideau d'ouverture, joué une fois par visite (voir boot.js) : le journal du jour,
 * coupé en deux d'un coup de ciseaux ; les deux moitiés s'écartent sur la une.
 */
function intro(site) {
  const { config, now } = site;
  const half = side => html`<div class="intro-half intro-half--${side}"><p>${config.name}</p></div>`;
  return html`<div class="intro" aria-hidden="true">
    ${half('top')}${half('bottom')}
    <p class="intro-date">Édition du ${edition(now).date}</p>
    <span class="intro-cut">${icon('scissors')}</span>
  </div>`;
}

function header(site) {
  const { config, path } = site;
  return html`<header class="site-header" data-header>
    <div class="site-header-inner">
      ${brand(config)}
      <nav class="site-nav" id="menu" aria-label="Pages du journal">
        <ul>
          ${PAGES.map(page => html`<li><a ${page.path === '/reservation' ? raw('class="nav-book"') : ''} href="${page.path}" ${path === page.path ? raw('aria-current="page"') : ''}><span class="nav-num">${page.number}</span>${page.label}</a></li>`)}
        </ul>
        <p class="nav-meta">${config.address.street}, ${config.address.postalCode} ${config.address.city}<br>
          <a href="${telHref(config.contact.phone)}">${config.contact.phone}</a></p>
      </nav>
      <a class="btn btn--small btn--accent header-cta" href="/reservation">${buttonLabel('Rendez-vous')}${icon('arrow-right')}</a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="menu" data-menu-toggle>
        <span class="menu-toggle-label">Sommaire</span>
        <span class="menu-toggle-bars" aria-hidden="true"><span></span><span></span></span>
      </button>
    </div>
  </header>`;
}

/**
 * Téléphone : la réservation reste à portée de pouce, dans une barre en bas de l'écran
 * (elle apparaît quand on a commencé à faire défiler la page).
 */
function dock(site) {
  if (site.path === '/reservation') return '';
  return html`<a class="dock" href="/reservation" data-dock>
    <span class="dock-text">
      <span class="dock-label">Prochain créneau</span>
      <span class="dock-slot" data-next-slot-label>${site.next ? site.next.label : 'voir les disponibilités'}</span>
    </span>
    <span class="dock-go">Réserver ${icon('arrow-right')}</span>
  </a>`;
}

/**
 * Avis sur les cookies. Le site n'en dépose aucun pour suivre ses visiteurs ; la seule chose à
 * accepter ou refuser est le plan Google Maps. Les deux boutons ont le même poids, et le choix
 * se modifie à tout moment depuis le pied de page (voir site.js).
 */
function cookieNotice() {
  return html`<section class="cookies" aria-label="Cookies" data-cookies hidden>
    <p class="cookies-text"><strong>Cookies.</strong> Ce site ne vous suit pas : ni publicité, ni traceur. Seul le plan Google Maps de la page Pratique dépose des cookies de Google. Les acceptez-vous&nbsp;?</p>
    <div class="cookies-actions">
      <button type="button" class="btn btn--small" data-cookies-choice="non">${buttonLabel('Refuser')}</button>
      <button type="button" class="btn btn--small" data-cookies-choice="oui">${buttonLabel('Accepter')}</button>
      <a class="link" href="/confidentialite#cookies">En savoir plus</a>
    </div>
  </section>`;
}

/** Bas de page : « tournez la page », comme dans un journal. */
function pager(path) {
  const index = PAGES.findIndex(page => page.path === path);
  if (index === -1) return '';
  const previous = PAGES[index - 1];
  const next = PAGES[index + 1];
  return html`<nav class="pager container" aria-label="Tourner les pages">
    ${previous
      ? html`<a class="pager-link pager-link--prev" href="${previous.path}">${icon('arrow-right')}<span><small>Page ${previous.number}</small>${previous.label}</span></a>`
      : html`<span></span>`}
    ${next
      ? html`<a class="pager-link pager-link--next" href="${next.path}"><span><small>Tournez la page · page ${next.number}</small>${next.label}</span>${icon('arrow-right')}</a>`
      : html`<a class="pager-link pager-link--next" href="/"><span><small>Fin du journal</small>Revenir à la une</span>${icon('arrow-right')}</a>`}
  </nav>`;
}

function footer(site) {
  const { config, now, status, path } = site;
  return html`<footer class="site-footer">
    ${pager(path)}
    <div class="ours">
      <div class="container ours-grid">
        <div class="ours-col ours-brand">
          ${brand(config)}
          <p>${config.tagline}${config.tagline ? ' · ' : ''}${config.address.city}</p>
          ${config.booking.appointmentOnly ? html`<p class="ours-rule">${config.booking.appointmentOnly}</p>` : ''}
          ${openBadge(status)}
        </div>
        <div class="ours-col">
          <h2 class="ours-title">Adresse</h2>
          <address>${config.address.street}<br>${config.address.postalCode} ${config.address.city}</address>
          <a class="link" href="/nous-trouver">Plan et itinéraire</a>
        </div>
        <div class="ours-col">
          <h2 class="ours-title">Horaires</h2>
          ${hoursTable(config, now)}
        </div>
        <div class="ours-col">
          <h2 class="ours-title">Contact</h2>
          <ul class="ours-list">
            ${config.contact.phone ? html`<li><a class="link" href="${telHref(config.contact.phone)}">${config.contact.phone}</a></li>` : ''}
            ${config.contact.email ? html`<li><a class="link" href="mailto:${config.contact.email}">${config.contact.email}</a></li>` : ''}
            ${config.contact.messenger ? html`<li><a class="link" href="${config.contact.messenger}" target="_blank" rel="noopener">Messenger</a></li>` : ''}
            ${config.contact.facebook ? html`<li><a class="link" href="${config.contact.facebook}" target="_blank" rel="noopener">Facebook</a></li>` : ''}
            ${config.contact.instagram ? html`<li><a class="link" href="${config.contact.instagram}" target="_blank" rel="noopener">Instagram</a></li>` : ''}
            ${config.contact.google ? html`<li><a class="link" href="${config.contact.google}" target="_blank" rel="noopener">Avis Google</a></li>` : ''}
          </ul>
        </div>
      </div>
      <div class="container ours-bottom">
        <p>© ${now.date.slice(0, 4)} ${config.name} · ${capitalize(edition(now).date)}</p>
        <ul>
          <li><a href="/mentions-legales">L'ours : mentions légales</a></li>
          <li><a href="/confidentialite">Confidentialité</a></li>
          <li><a href="/conditions">Conditions d'utilisation</a></li>
          <li><button type="button" class="ours-button" data-cookies-open>Cookies</button></li>
          <li><a href="/salon" rel="nofollow">La rédaction</a></li>
        </ul>
      </div>
    </div>
  </footer>`;
}

/** Grande photo de la une : le navigateur la demande dès la lecture de l'en-tête, avant les styles. */
function preloadImage(photo, sizes) {
  if (!photo || !photo.src) return '';
  const sources = (photo.variants || []).length ? [...photo.variants, { width: photo.width, src: photo.src }] : [];
  return html`<link rel="preload" as="image" href="${photo.src}" ${sources.length ? html`imagesrcset="${sources.map(s => `${s.src} ${s.width}w`).join(', ')}" imagesizes="${sizes}"` : ''} fetchpriority="high">`;
}

/**
 * Gabarit commun.
 *   bare    : page sans en-tête ni pied de page du site (espace salon) ;
 *   crumb   : nom de la page dans le fil d'Ariane des moteurs de recherche ;
 *   trail   : les pages entre la une et celle-ci, dans ce fil ([{ name, path }]) ;
 *   schema  : données structurées propres à la page (une fonction qui en renvoie la liste) ;
 *   catalog : joindre la carte des prestations aux données structurées ;
 *   preload : { photo, sizes } de la grande image à charger en priorité.
 */
function layout(site, {
  title, description, body, bodyClass = '', styles = [], scripts = [],
  data = null, bare = false, noindex = false, crumb = '', trail = [], schema = null, catalog = false, preload = null,
}) {
  const { config, path } = site;
  const asset = site.asset || (file => file);
  const origin = site.origin || config.siteUrl;
  // Sans titre propre (la une) : le métier et la ville d'abord, ce que tapent les clients.
  const fullTitle = title ? `${title} · ${config.name}` : `${config.trade} à ${config.address.city} · ${config.name}`;
  const metaDescription = description || config.description;
  const url = `${origin}${path === '/' ? '/' : path}`;
  const shareImage = config.shareImage ? `${origin}${config.shareImage}` : '';

  return html`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${fullTitle}</title>
<meta name="description" content="${metaDescription}">
${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : raw('<meta name="robots" content="index, follow, max-image-preview:large">')}
${noindex || !origin ? '' : html`<link rel="canonical" href="${url}">`}
${config.seo.googleVerification ? html`<meta name="google-site-verification" content="${config.seo.googleVerification}">` : ''}
${config.seo.bingVerification ? html`<meta name="msvalidate.01" content="${config.seo.bingVerification}">` : ''}
<meta name="theme-color" content="#f5eee1">
<meta name="color-scheme" content="only light">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="${config.name}">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${metaDescription}">
${origin ? html`<meta property="og:url" content="${url}">` : ''}
${shareImage ? html`<meta property="og:image" content="${shareImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${config.name}, ${config.trade.toLowerCase()} à ${config.address.city}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${shareImage}">` : raw('<meta name="twitter:card" content="summary">')}
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/img/icone-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="${bare ? '/salon.webmanifest' : '/site.webmanifest'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${preload ? preloadImage(preload.photo, preload.sizes) : ''}
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${asset('/css/base.css')}">
${styles.map(href => html`<link rel="stylesheet" href="${asset(href)}">`)}
<script src="${asset('/js/boot.js')}"></script>
${bare || !origin ? '' : html`<script type="application/ld+json">${jsonForScript(structuredData({ ...site, origin }, { catalog, crumb, trail, schema }))}</script>`}
</head>
<body class="${bodyClass}">
${sprite}
<a class="skip-link" href="#contenu">Aller au contenu</a>
${bare ? '' : html`${intro(site)}<span class="scroll-progress" aria-hidden="true" data-scroll-progress></span>`}
${bare ? '' : header(site)}
${body}
${bare ? '' : html`${footer(site)}${dock(site)}${cookieNotice()}`}
${data ? html`<script type="application/json" id="page-data">${jsonForScript(data)}</script>` : ''}
${bare ? '' : html`<script type="module" src="${asset('/js/site.js')}"></script>`}
${scripts.map(src => html`<script type="module" src="${asset(src)}"></script>`)}
</body>
</html>`;
}

module.exports = { layout, brand };
