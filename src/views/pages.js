'use strict';

const { html } = require('./html');
const { icon } = require('./icons');
const { layout } = require('./layout');
const {
  PAGES, folio, picture, button, buttonLabel, splitTitle, kicker, stamp, openBadge, hoursTable,
  priceTable, telHref, ratioClass, fullSize, houseRules, euros, priceLabel, durationLabel,
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
    extra: config.priceNote ? html`<p class="notice-line" data-reveal>${icon('info')}<span>${config.priceNote}</span></p>` : '',
  })}
  <div class="container menu">
    ${config.categories.map((category, c) => html`<section class="menu-group" aria-labelledby="categorie-${c}">
      <h2 class="menu-group-title" id="categorie-${c}" data-reveal>${category.name}</h2>
      ${priceTable(category.items, `${category.name} : tarifs`)}
    </section>`)}
  </div>
  <div class="container">${houseRules(config)}</div>
  <aside class="container help-band" data-reveal>
    <p><strong>Une question&nbsp;?</strong> Appelez le <a class="link" href="${telHref(config.contact.phone)}">${config.contact.phone}</a>${config.contact.messenger ? html` ou écrivez sur <a class="link" href="${config.contact.messenger}" target="_blank" rel="noopener">Messenger</a>` : ''}.</p>
  </aside>
</main>`;

  return layout(site, {
    title: `Tarifs coiffure à ${config.address.city}`,
    crumb: 'Prestations et tarifs',
    catalog: true,
    description: `Les prestations et les tarifs de ${config.name} : coupes, brushings, colorations, balayages, soins. Uniquement sur rendez-vous, réservation en ligne.`,
    body,
    styles: ['/css/pages.css'],
  });
}

// ── La page d'une prestation ───────────────────────────────────────────────
// « Balayage à Loison-sous-Lens » : son tarif, sa durée, le bouton pour réserver. Une adresse par
// prestation, c'est une chance de plus d'être trouvé par qui cherche cette prestation dans le coin.

function service(site, item) {
  const { config } = site;
  const { city } = config.address;
  const others = (config.categories.find(category => category.items.some(other => other.id === item.id))?.items || []).filter(other => other.id !== item.id);
  const amounts = item.prices || [item.price];
  const price = item.prices && item.prices.length === 3
    ? `de ${euros(Math.min(...amounts))} à ${euros(Math.max(...amounts))} selon la longueur`
    : item.prices ? item.prices.map(euros).join(' ou ') : priceLabel(item);
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, {
    path: '/prestations',
    kick: `${item.category} · ${config.trade} à ${city}`,
    title: [item.name, `_à ${city}_`],
  })}
  <div class="container menu">
    <section class="menu-group" aria-labelledby="tarif-titre">
      <h2 class="menu-group-title" id="tarif-titre" data-reveal>Le tarif</h2>
      ${priceTable([item], `${item.name} : tarif`, { link: false })}
      <dl class="info-list service-facts" data-reveal>
        <div><dt>Durée</dt><dd>${durationLabel(item.duration)}</dd></div>
        <div><dt>Adresse</dt><dd>${config.address.full}</dd></div>
        ${config.contact.phone ? html`<div><dt>Téléphone</dt><dd><a class="link" href="${telHref(config.contact.phone)}">${config.contact.phone}</a></dd></div>` : ''}
      </dl>
      ${config.priceNote ? html`<p class="notice-line" data-reveal>${icon('info')}<span>${config.priceNote}</span></p>` : ''}
      <p class="actions" data-reveal>${button('Prendre rendez-vous', `/reservation?service=${item.id}`, { variant: 'btn--accent' })}</p>
    </section>
    ${others.length ? html`<section class="menu-group" aria-labelledby="autres-titre">
      <h2 class="menu-group-title" id="autres-titre" data-reveal>${item.category} : les autres prestations</h2>
      ${priceTable(others, `${item.category} : autres prestations`)}
    </section>` : ''}
    <p class="section-foot" data-reveal>${button('Toute la carte', '/prestations', { variant: 'btn--outline' })}</p>
  </div>
  <div class="container">${houseRules(config)}</div>
</main>`;

  return layout(site, {
    title: `${item.name} à ${city}`,
    crumb: item.name,
    trail: [{ name: 'Prestations et tarifs', path: '/prestations' }],
    description: `${item.name} à ${city} chez ${config.name} : ${price}, ${durationLabel(item.duration)}. ${config.booking.appointmentOnly || 'Sur rendez-vous'}, réservation en ligne.`,
    schema: ({ at, salon }) => [{
      '@type': 'Service',
      '@id': at(`${site.path}#prestation`),
      name: item.name,
      serviceType: item.category,
      url: at(site.path),
      provider: { '@id': salon },
      areaServed: [city, ...config.seo.nearby].map(name => ({ '@type': 'City', name })),
      offers: amounts.length > 1
        ? { '@type': 'AggregateOffer', priceCurrency: 'EUR', lowPrice: Math.min(...amounts), highPrice: Math.max(...amounts), offerCount: amounts.length }
        : { '@type': 'Offer', priceCurrency: 'EUR', price: item.price },
    }],
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
    title: 'Coiffures avant / après en photos',
    crumb: 'En images',
    description: `Les réalisations de ${config.name}, ${config.trade.toLowerCase()} à ${config.address.city}, en photos : balayages, ombrés, colorations, avant et après.`,
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
        ${contact.google ? html`<div>
          <dt>Sur Google</dt>
          <dd><a class="link" href="${contact.google}" target="_blank" rel="noopener">La fiche du salon et les avis</a></dd>
        </div>` : ''}
        ${config.booking.appointmentOnly ? html`<div>
          <dt>Accueil</dt>
          <dd><strong>${config.booking.appointmentOnly}</strong></dd>
        </div>` : ''}
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
          <button type="button" class="btn" data-map-load>${buttonLabel('Afficher le plan')}${icon('pin')}</button>
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
    title: "Adresse, horaires et plan d'accès",
    crumb: 'Adresse et horaires',
    description: `${config.name}, ${address.full}. Horaires d'ouverture, plan d'accès, itinéraire et téléphone. ${config.booking.appointmentOnly || 'Sur rendez-vous'}.`,
    body,
    styles: ['/css/pages.css'],
  });
}

// ── Pages légales ──────────────────────────────────────────────────────────
// L'ours (dans la presse, l'encadré qui dit qui publie le journal), la confidentialité, les
// conditions d'utilisation. Elles se renvoient l'une à l'autre par un petit sommaire.

const LEGAL_PAGES = [
  { path: '/mentions-legales', label: 'Mentions légales' },
  { path: '/confidentialite', label: 'Confidentialité et cookies' },
  { path: '/conditions', label: "Conditions d'utilisation" },
];

const legalNav = current => html`<nav class="container legal-nav" aria-label="Pages légales">
  <ul>${LEGAL_PAGES.map(page => html`<li><a href="${page.path}" ${page.path === current ? html`aria-current="page"` : ''}>${page.label}</a></li>`)}</ul>
</nav>`;

/** Les moyens de joindre le salon, selon ce qui est renseigné : e-mail, téléphone, Messenger. */
function reachLinks(contact) {
  return [
    contact.email ? html`<a class="link" href="mailto:${contact.email}">${contact.email}</a>` : '',
    contact.phone ? html`<a class="link" href="${telHref(contact.phone)}">${contact.phone}</a>` : '',
    contact.messenger ? html`<a class="link" href="${contact.messenger}" target="_blank" rel="noopener">Messenger</a>` : '',
  ].filter(Boolean).map((link, i) => html`${i ? ' · ' : ''}${link}`);
}

function legal(site) {
  const { config } = site;
  const { legal: info, contact, address } = config;
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, { path: '', kick: "L'ours", title: ['Mentions', '_légales_'] })}
  ${legalNav('/mentions-legales')}
  <div class="container prose">
    <section>
      <h2>Éditeur du site</h2>
      <p>${info.company}, ${info.status}<br>
        ${address.full}<br>
        SIRET&nbsp;: ${info.siret}<br>
        Responsable de la publication&nbsp;: ${info.publisher}<br>
        Contact&nbsp;: ${reachLinks(contact)}</p>
    </section>
    <section>
      <h2>Hébergement</h2>
      <p>${info.host}</p>
    </section>
    <section>
      <h2>Crédits</h2>
      <p>Textes et photographies&nbsp;: ${info.company}, sauf mention contraire. Toute reproduction sans accord est interdite.</p>
    </section>
    <section>
      <h2>Vos données et l'usage du site</h2>
      <p>Ce que le salon fait de vos informations est expliqué dans la page <a class="link" href="/confidentialite">Confidentialité et cookies</a>. Les règles de la réservation en ligne sont dans les <a class="link" href="/conditions">Conditions d'utilisation</a>.</p>
    </section>
  </div>
</main>`;

  return layout(site, { title: 'Mentions légales', crumb: 'Mentions légales', description: `Mentions légales du site de ${config.name}, ${config.trade.toLowerCase()} à ${address.city} : éditeur, hébergeur, crédits.`, body, styles: ['/css/pages.css'] });
}

// ── Confidentialité (RGPD) et cookies ──────────────────────────────────────

function privacy(site) {
  const { config } = site;
  const { legal: info, contact, address } = config;
  const months = Math.round(config.booking.retentionDays / 30);
  const reach = reachLinks(contact);
  const leads = site.push ? new Intl.ListFormat('fr', { type: 'conjunction' }).format(site.push.labels) : '';
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, { path: '', kick: 'Vos données', title: ['Confidentialité', '_et cookies_'] })}
  ${legalNav('/confidentialite')}
  <div class="container prose">
    <section>
      <h2>En deux mots</h2>
      <p>Le salon ne garde que ce qu'il faut pour vous recevoir&nbsp;: votre nom, votre téléphone et votre rendez-vous. Rien n'est vendu ni transmis, aucune publicité, aucun traceur.</p>
    </section>
    <section>
      <h2>Qui est responsable</h2>
      <p>${info.company}, ${address.full}. Pour toute question sur vos données&nbsp;: ${reach}.</p>
    </section>
    <section id="donnees">
      <h2>Ce qui est enregistré, et pourquoi</h2>
      <h3>Quand vous réservez</h3>
      <p>Votre nom, votre numéro de téléphone, la prestation, la date et l'heure du rendez-vous, et le message que vous choisissez d'ajouter. Ces informations servent uniquement à organiser le rendez-vous que vous demandez et à vous prévenir en cas d'imprévu (mesures prises à votre demande avant la prestation, article 6.1.b du RGPD).</p>
      ${leads ? html`<h3>Si vous demandez un rappel</h3>
      <p>Le rappel par notification est facultatif. Si vous l'activez, votre navigateur fournit au site une adresse technique qui permet de vous envoyer la notification (${leads}). Elle ne dit rien de vous, ne sert qu'à ce rappel et est effacée après le rendez-vous. Vous retirez votre accord quand vous voulez&nbsp;: en appuyant de nouveau sur le bouton, ou dans les réglages de notifications de votre navigateur.</p>` : ''}
      <h3>Quand vous visitez le site</h3>
      <p>Le site compte ses visites lui-même, sans cookie et sans service extérieur&nbsp;: nombre de pages vues par jour, site de provenance, téléphone ou ordinateur. Aucune adresse IP n'est conservée et rien ne permet de vous reconnaître d'une visite à l'autre. Si votre navigateur demande à ne pas être suivi («&nbsp;Do Not Track&nbsp;» ou «&nbsp;Global Privacy Control&nbsp;»), votre visite n'est pas comptée.</p>
    </section>
    <section>
      <h2>Qui y a accès</h2>
      <p>La coiffeuse, dans son espace protégé par mot de passe, et l'hébergeur du site, qui stocke les données sans les utiliser. Les rappels sont transportés, chiffrés, par le service de notification de votre navigateur (Google, Mozilla, Apple ou Microsoft selon l'appareil), qui ne peut pas les lire.</p>
    </section>
    <section>
      <h2>Combien de temps</h2>
      <p>Les rendez-vous sont effacés automatiquement ${months} mois après leur date. L'adresse de notification est effacée dès que le rendez-vous est passé. Les compteurs de visites, anonymes, sont gardés treize mois.</p>
    </section>
    <section>
      <h2>Vos droits</h2>
      <p>Vous pouvez à tout moment demander à consulter, corriger ou faire effacer vos informations, ou vous opposer à leur utilisation, en contactant le salon (${reach}). Si la réponse ne vous satisfait pas, vous pouvez saisir la CNIL, 3 place de Fontenoy, 75007 Paris (cnil.fr).</p>
    </section>
    <section id="cookies">
      <h2>Cookies</h2>
      <p>Ce site ne dépose aucun cookie publicitaire ni de mesure d'audience. Le seul cookie qu'il utilise est celui qui garde la coiffeuse connectée à son espace privé&nbsp;; il ne concerne pas les visiteurs.</p>
      <p>Le plan de la page Pratique est fourni par Google Maps, qui dépose ses propres cookies. Il ne s'affiche donc que si vous l'acceptez. Votre choix est gardé six mois dans votre navigateur et se modifie quand vous voulez&nbsp;:</p>
      <p><button type="button" class="btn btn--outline" data-cookies-open><span>Modifier mon choix</span></button></p>
      <p>Les polices de caractères sont servies par Google Fonts, qui reçoit à cette occasion l'adresse IP de votre appareil, sans déposer de cookie.</p>
    </section>
  </div>
</main>`;

  return layout(site, {
    title: 'Confidentialité et cookies',
    crumb: 'Confidentialité et cookies',
    description: `Ce que ${config.name} fait de vos données : réservation, rappels, durée de conservation, vos droits (RGPD) et les cookies du site.`,
    body,
    styles: ['/css/pages.css'],
  });
}

// ── Conditions d'utilisation (CGU) ─────────────────────────────────────────

function terms(site) {
  const { config } = site;
  const { contact, booking: rules } = config;
  const phone = contact.phone ? html`<a class="link" href="${telHref(contact.phone)}">${contact.phone}</a>` : 'téléphone';
  const body = html`
<main id="contenu" class="page">
  ${pageHead(site, { path: '', kick: 'Règles du jeu', title: ['Conditions', "_d'utilisation_"] })}
  ${legalNav('/conditions')}
  <div class="container prose">
    <section>
      <h2>À quoi sert ce site</h2>
      <p>Ce site présente ${config.name} (prestations, tarifs, photos, horaires, adresse) et permet de prendre rendez-vous en ligne. Son usage est gratuit. L'utiliser, c'est accepter les règles ci-dessous.</p>
    </section>
    <section id="rendez-vous">
      <h2>La réservation</h2>
      <p>${rules.appointmentOnly ? html`<strong>${rules.appointmentOnly}.</strong> ` : ''}Vous choisissez une prestation, un jour et une heure parmi les créneaux libres, puis vous laissez votre nom et votre numéro de téléphone. Le rendez-vous est enregistré quand la page de confirmation s'affiche.</p>
      <p>Indiquez votre vrai nom et un numéro où vous joindre&nbsp;: le salon s'en sert pour vous prévenir en cas d'imprévu. Un même numéro peut avoir jusqu'à ${rules.maxActivePerPhone} rendez-vous à venir&nbsp;; au-delà, appelez le salon.</p>
      <p>Le salon peut être amené à déplacer ou annuler un rendez-vous (maladie, fermeture exceptionnelle). Vous êtes alors prévenu par téléphone.</p>
    </section>
    <section id="absence">
      <h2>Empêchement et rendez-vous manqué</h2>
      <p>Un empêchement&nbsp;? Prévenez le salon le plus tôt possible au ${phone}${contact.messenger ? html` ou sur <a class="link" href="${contact.messenger}" target="_blank" rel="noopener">Messenger</a>` : ''}, pour que le créneau serve à quelqu'un d'autre.</p>
      ${rules.noShow ? html`<p><strong>${rules.noShow}</strong></p>` : ''}
    </section>
    <section>
      <h2>Les tarifs</h2>
      <p>Les prix affichés sont en euros, toutes taxes comprises.${config.priceNote ? ` ${config.priceNote}` : ''} Le prix définitif dépend de la longueur et de la nature des cheveux&nbsp;: il vous est confirmé au salon avant de commencer.</p>
    </section>
    ${site.push ? html`<section>
      <h2>Les rappels</h2>
      <p>Le rappel par notification et le fichier d'agenda sont des aides. Leur bon fonctionnement dépend de votre appareil et de ses réglages&nbsp;: ils ne dispensent pas de noter votre rendez-vous.</p>
    </section>` : ''}
    <section>
      <h2>Le site</h2>
      <p>Le salon fait de son mieux pour que le site soit disponible et à jour, sans pouvoir le garantir à tout instant. En cas de panne, la réservation reste possible par téléphone.</p>
      <p>Les textes et les photographies appartiennent à ${config.legal.company}&nbsp;; ils ne peuvent pas être réutilisés sans accord. Les liens vers d'autres sites (Facebook, Google Maps) sont donnés pour vous rendre service&nbsp;; le salon n'est pas responsable de leur contenu.</p>
    </section>
    <section>
      <h2>Vos données, le droit applicable</h2>
      <p>Ce que le salon fait de vos informations est expliqué dans la page <a class="link" href="/confidentialite">Confidentialité et cookies</a>. Ces conditions relèvent du droit français.</p>
    </section>
  </div>
</main>`;

  return layout(site, {
    title: "Conditions d'utilisation",
    crumb: "Conditions d'utilisation",
    description: `Les règles du site de ${config.name} : réservation en ligne, empêchement et rendez-vous manqué, tarifs, rappels.`,
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

module.exports = { services, service, gallery, find, legal, privacy, terms, notFound };
