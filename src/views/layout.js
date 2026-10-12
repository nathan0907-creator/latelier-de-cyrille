'use strict';

const { html, raw, jsonForScript } = require('./html');
const { icon, sprite } = require('./icons');
const { PAGES, edition, capitalize, hoursTable, openBadge, telHref, buttonLabel } = require('./components');
const { fromMinutes } = require('../time');

// Les quatre familles de la gazette :
//   Grand Hotel            le titre et les mots en écriture : une cursive d'enseigne des années trente
//   League Gothic          les gros titres : l'« Alternate Gothic » des unes, en capitales étroites
//   Old Standard TT        titres secondaires et texte : le romain des imprimés du début du XXe siècle
//   Archivo Narrow         surtitres, étiquettes, boutons : une grotesque étroite
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@400..700&family=Grand+Hotel&family=League+Gothic&family=Old+Standard+TT:ital,wght@0,400;0,700;1,400&display=swap';

const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Données structurées « salon de coiffure » lues par les moteurs de recherche. */
function structuredData(config) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    name: config.name,
    description: config.description,
    ...(config.siteUrl && { url: config.siteUrl }),
    ...(config.contact.phone && { telephone: config.contact.phone }),
    ...(config.contact.email && { email: config.contact.email }),
    ...(config.contact.facebook && { sameAs: [config.contact.facebook] }),
    ...(config.photos.hero && { image: config.photos.hero.src }),
    address: {
      '@type': 'PostalAddress',
      streetAddress: config.address.street,
      postalCode: config.address.postalCode,
      addressLocality: config.address.city,
      addressCountry: 'FR',
    },
    openingHoursSpecification: Object.entries(config.hours).flatMap(([day, ranges]) =>
      ranges.map(range => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: `https://schema.org/${SCHEMA_DAYS[day]}`,
        opens: fromMinutes(range.start),
        closes: fromMinutes(range.end),
      }))),
    paymentAccepted: 'Paiement sur place',
  };
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
          </ul>
        </div>
      </div>
      <div class="container ours-bottom">
        <p>© ${now.date.slice(0, 4)} ${config.name} · ${capitalize(edition(now).date)}</p>
        <ul>
          <li><a href="/mentions-legales">L'ours : mentions légales</a></li>
          <li><a href="/salon">La rédaction</a></li>
        </ul>
      </div>
    </div>
  </footer>`;
}

/**
 * Gabarit commun.
 * bare : page sans en-tête ni pied de page du site (espace salon).
 */
function layout(site, {
  title, description, body, bodyClass = '', styles = [], scripts = [],
  data = null, bare = false, noindex = false,
}) {
  const { config, path } = site;
  const fullTitle = title ? `${title} · ${config.name}` : `${config.name} · ${config.tagline} à ${config.address.city}`;
  const metaDescription = description || config.description;
  const canonical = config.siteUrl ? `${config.siteUrl}${path === '/' ? '/' : path}` : '';

  return html`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${fullTitle}</title>
<meta name="description" content="${metaDescription}">
${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
${canonical ? html`<link rel="canonical" href="${canonical}">` : ''}
<meta name="theme-color" content="#f8f1ea">
<meta name="color-scheme" content="only light">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="${config.name}">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${metaDescription}">
${config.photos.hero ? html`<meta property="og:image" content="${config.photos.hero.src}${config.photos.hero.src.includes('unsplash') ? '?auto=format&fit=crop&w=1200&h=630&q=72' : ''}">` : ''}
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/img/icone.png">
<link rel="manifest" href="${bare ? '/salon.webmanifest' : '/site.webmanifest'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/css/base.css">
${styles.map(href => html`<link rel="stylesheet" href="${href}">`)}
<script src="/js/boot.js"></script>
${bare ? '' : html`<script type="application/ld+json">${jsonForScript(structuredData(config))}</script>`}
</head>
<body class="${bodyClass}">
${sprite}
<a class="skip-link" href="#contenu">Aller au contenu</a>
${bare ? '' : html`${intro(site)}<span class="scroll-progress" aria-hidden="true" data-scroll-progress></span>`}
${bare ? '' : header(site)}
${body}
${bare ? '' : html`${footer(site)}${dock(site)}`}
${data ? html`<script type="application/json" id="page-data">${jsonForScript(data)}</script>` : ''}
${bare ? '' : raw('<script type="module" src="/js/site.js"></script>')}
${scripts.map(src => html`<script type="module" src="${src}"></script>`)}
</body>
</html>`;
}

module.exports = { layout, brand };
