'use strict';

const { html } = require('./html');
const { icon } = require('./icons');
const { layout } = require('./layout');
const {
  PAGES, folio, picture, button, buttonLabel, splitTitle, kicker, stamp, openBadge, hoursTable,
  priceTable, telHref, ratioClass, fullSize,
} = require('./components');

const pageOf = path => PAGES.find(page => page.path === path);

/** Haut de page intérieure : titre courant, surtitre, grand titre, chapeau. */
function pageHead(site, { path, kick, title, deck, extra = '' }) {
  const page = pageOf(path);
  return html`<header class="page-head container">
    ${page ? folio(site, page) : ''}
    ${kicker(kick)}
    <h1 class="headline headline--xl" data-reveal="lines">${splitTitle(title)}</h1>
    ${deck ? html`<p class="deck" data-reveal>${deck}</p>` : ''}
    ${extra}
  </header>`;
}

// ── Page 2 — La carte : prestations et tarifs ──────────────────────────────

function services(site) {
  const { config } = site;
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, {
    path: '/prestations',
    kick: 'Prestations et tarifs',
    title: ['La carte,', '_ligne par ligne_'],
    extra: html`${config.priceNote ? html`<p class="notice-line" data-reveal>${icon('info')}<span>${config.priceNote}</span></p>` : ''}
      <p class="notice-line" data-reveal>${icon('card')}<span>${config.booking.paymentNote}</span></p>`,
  })}
  <div class="container menu">
    ${config.categories.map((category, c) => html`<section class="menu-group" aria-labelledby="categorie-${c}">
      <h2 class="menu-group-title" id="categorie-${c}" data-reveal>${category.name}</h2>
      ${priceTable(category.items, `${category.name} : tarifs`)}
    </section>`)}
  </div>
  <aside class="container help-band" data-reveal>
    <p><strong>Une question&nbsp;?</strong> Appelez le <a class="link" href="${telHref(config.contact.phone)}">${config.contact.phone}</a>${config.contact.messenger ? html` ou écrivez sur <a class="link" href="${config.contact.messenger}" target="_blank" rel="noopener">Messenger</a>` : ''}.</p>
  </aside>
</main>`;

  return layout(site, {
    title: 'La carte : prestations et tarifs',
    description: `Les prestations et les tarifs de ${config.name} : coupes, brushings, colorations, balayages, soins. Réservation en ligne, règlement sur place.`,
    body,
    styles: ['/css/pages.css'],
  });
}

// ── Page 3 — En images ─────────────────────────────────────────────────────

function gallery(site) {
  const { config } = site;
  const photos = config.photos.gallery;
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, {
    path: '/galerie',
    kick: 'Reportage',
    title: ['Sorti', "_de l'atelier_"],
  })}
  <div class="container">
    <ul class="masonry" data-gallery>
      ${photos.map((photo, i) => html`<li class="masonry-item ${ratioClass(photo)}" data-reveal>
        <button type="button" class="masonry-button frame halftone" data-index="${i}" data-full="${fullSize(photo)}" data-caption="${photo.alt}" data-cursor="Voir" aria-label="Agrandir la photo : ${photo.alt}">
          ${picture(photo, { sizes: '(min-width: 64rem) 30vw, (min-width: 40rem) 46vw, 92vw', widths: [480, 800, 1200] })}
        </button>
        <p class="caption"><b>Photo ${i + 1}.</b> ${photo.alt}.</p>
      </li>`)}
    </ul>
  </div>
  <dialog class="lightbox" data-lightbox aria-label="Photo agrandie">
    <button type="button" class="icon-btn lightbox-close" data-lightbox-close aria-label="Fermer">${icon('close')}</button>
    <button type="button" class="icon-btn lightbox-nav lightbox-prev" data-lightbox-prev aria-label="Photo précédente">${icon('chevron-left')}</button>
    <figure class="lightbox-figure">
      <img data-lightbox-image alt="">
      <figcaption><span data-lightbox-caption></span><span class="lightbox-count" data-lightbox-count></span></figcaption>
    </figure>
    <button type="button" class="icon-btn lightbox-nav lightbox-next" data-lightbox-next aria-label="Photo suivante">${icon('chevron-right')}</button>
  </dialog>
</main>`;

  return layout(site, {
    title: 'En images',
    description: `Les réalisations de ${config.name} en photos : coupes, couleurs et ambiance du salon.`,
    body,
    styles: ['/css/pages.css'],
    scripts: ['/js/gallery.js'],
  });
}

// ── Page 5 — Pratique : nous trouver ───────────────────────────────────────

function find(site) {
  const { config, status, now } = site;
  const { address, contact } = config;
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, {
    path: '/nous-trouver',
    kick: 'Carnet pratique',
    title: ['On est', '_juste là_'],
  })}
  <div class="container find-page">
    <div class="box find-card" data-reveal>
      <h2 class="box-title">L'adresse</h2>
      ${openBadge(status)}
      <dl class="info-list">
        <div>
          <dt>Adresse</dt>
          <dd>${address.street}<br>${address.postalCode} ${address.city}</dd>
        </div>
        ${contact.phone ? html`<div>
          <dt>Téléphone</dt>
          <dd><a class="link" href="${telHref(contact.phone)}">${contact.phone}</a></dd>
        </div>` : ''}
        ${contact.email ? html`<div>
          <dt>E-mail</dt>
          <dd><a class="link" href="mailto:${contact.email}">${contact.email}</a></dd>
        </div>` : ''}
        ${contact.messenger || contact.facebook ? html`<div>
          <dt>Sur Facebook</dt>
          <dd>${contact.messenger ? html`<a class="link" href="${contact.messenger}" target="_blank" rel="noopener">Écrire sur Messenger</a>` : ''}${contact.messenger && contact.facebook ? html`<br>` : ''}${contact.facebook ? html`<a class="link" href="${contact.facebook}" target="_blank" rel="noopener">La page du salon</a>` : ''}</dd>
        </div>` : ''}
        <div>
          <dt>Règlement</dt>
          <dd>${config.booking.paymentNote}</dd>
        </div>
      </dl>
      <div class="actions">
        ${button('Itinéraire', config.maps.directions, { iconName: 'arrow-up-right', external: true })}
        ${button('Rendez-vous', '/reservation', { variant: 'btn--outline' })}
      </div>
    </div>

    <div class="map" data-map data-src="${config.maps.embed}" data-title="Plan d'accès : ${address.full}" data-reveal>
      <div class="map-facade">
        <div class="map-art" aria-hidden="true">
          <span class="map-road map-road--1"></span><span class="map-road map-road--2"></span>
          <span class="map-road map-road--3"></span><span class="map-road map-road--4"></span>
          <span class="map-block map-block--1"></span><span class="map-block map-block--2"></span><span class="map-block map-block--3"></span>
          <span class="map-pin">${icon('pin')}</span>
        </div>
        <div class="map-facade-copy">
          <p class="map-address">${address.full}</p>
          <button type="button" class="btn btn--accent" data-map-load>${buttonLabel('Afficher le plan')}${icon('pin')}</button>
          <p class="map-note">Le plan est fourni par Google Maps. En l'affichant, vous acceptez que Google dépose ses cookies.</p>
          <a class="link" href="${config.maps.view}" target="_blank" rel="noopener">Ouvrir dans Google Maps</a>
        </div>
      </div>
    </div>
  </div>

  <div class="container find-extra">
    <section class="box" aria-labelledby="horaires-titre" data-reveal>
      <h2 class="box-title" id="horaires-titre">Les horaires</h2>
      ${hoursTable(config, now)}
    </section>
    ${address.access.length ? html`<section class="box" aria-labelledby="acces-titre" data-reveal data-delay="90">
      <h2 class="box-title" id="acces-titre">Pour venir</h2>
      <ul class="briefs">${address.access.map(line => html`<li>${line}</li>`)}</ul>
    </section>` : ''}
  </div>
</main>`;

  return layout(site, {
    title: 'Pratique : nous trouver',
    description: `${config.name}, ${address.full}. Plan d'accès, itinéraire, horaires et contact.`,
    body,
    styles: ['/css/pages.css'],
  });
}

// ── L'ours : mentions légales et confidentialité ───────────────────────────
// (Dans la presse, « l'ours » est l'encadré qui dit qui publie le journal.)

function legal(site) {
  const { config } = site;
  const { legal: info, contact, address } = config;
  const months = Math.round(config.booking.retentionDays / 30);
  // Les moyens de joindre le salon, selon ce qui est renseigné : e-mail, téléphone, Messenger.
  const reach = [
    contact.email ? html`<a class="link" href="mailto:${contact.email}">${contact.email}</a>` : '',
    contact.phone ? html`<a class="link" href="${telHref(contact.phone)}">${contact.phone}</a>` : '',
    contact.messenger ? html`<a class="link" href="${contact.messenger}" target="_blank" rel="noopener">Messenger</a>` : '',
  ].filter(Boolean).map((link, i) => html`${i ? ' · ' : ''}${link}`);
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, { path: '', kick: "L'ours", title: ['Mentions légales', '_et confidentialité_'] })}
  <div class="container prose">
    <section>
      <h2>Éditeur du site</h2>
      <p>${info.company}, ${info.status}<br>
        ${address.full}<br>
        SIRET&nbsp;: ${info.siret}<br>
        Responsable de la publication&nbsp;: ${info.publisher}<br>
        Contact&nbsp;: ${reach}</p>
    </section>
    <section>
      <h2>Hébergement</h2>
      <p>${info.host}</p>
    </section>
    <section id="donnees">
      <h2>Vos données personnelles</h2>
      <p>Quand vous réservez en ligne, le salon enregistre votre nom, votre numéro de téléphone, la prestation, la date et l'heure du rendez-vous, ainsi que le message que vous choisissez d'ajouter.</p>
      <p>Ces informations servent uniquement à organiser votre rendez-vous et à vous prévenir en cas d'imprévu. Elles ne sont ni vendues ni transmises à des tiers, et ne servent pas à de la publicité.</p>
      <p>Elles sont effacées automatiquement ${months} mois après la date du rendez-vous. Vous pouvez demander à tout moment à les consulter, les corriger ou les supprimer en contactant le salon (${reach}). Si la réponse ne vous satisfait pas, vous pouvez saisir la CNIL (cnil.fr).</p>
    </section>
    <section>
      <h2>Cookies et services tiers</h2>
      <p>Ce site ne dépose aucun cookie publicitaire ni de mesure d'audience. Le seul cookie utilisé est celui qui garde la coiffeuse connectée à son espace privé.</p>
      <p>Le plan Google Maps ne se charge que si vous cliquez sur «&nbsp;Afficher le plan&nbsp;»&nbsp;; Google peut alors déposer ses propres cookies. Les polices de caractères sont servies par Google Fonts, qui reçoit à cette occasion l'adresse IP de votre appareil.</p>
    </section>
    <section>
      <h2>Crédits</h2>
      <p>Textes et photographies&nbsp;: ${info.company}, sauf mention contraire. Toute reproduction sans accord est interdite.</p>
    </section>
  </div>
</main>`;

  return layout(site, {
    title: 'Mentions légales et confidentialité',
    body,
    styles: ['/css/pages.css'],
  });
}

// ── Page introuvable ───────────────────────────────────────────────────────

function notFound(site) {
  const body = html`
<main id="contenu" class="page">
  <div class="container not-found">
    ${kicker('Erratum')}
    <h1 class="headline headline--xl">Cette page n'a <em>jamais été imprimée</em></h1>
    <div class="actions">
      ${button('Revenir à la une', '/')}
      ${button('Prendre rendez-vous', '/reservation', { variant: 'btn--outline' })}
    </div>
    ${stamp('Erreur 404 · Page introuvable · ', { id: 'tampon-404', className: 'not-found-stamp' })}
  </div>
</main>`;

  return layout(site, { title: 'Page introuvable', body, styles: ['/css/pages.css'], noindex: true });
}

module.exports = { services, gallery, find, legal, notFound };
