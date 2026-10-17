'use strict';

const { html } = require('./html');
const { icon } = require('./icons');
const { layout } = require('./layout');
const { eventFeature, eventWhen, plainTitle } = require('./event');
const { formatShort, formatLong, daysBetween } = require('../time');
const {
  PAGES, picture, button, splitTitle, kicker, sectionBar, stamp, ticker, edition, capitalize, openBadge, hoursTable,
  openDaysSentence, priceTable, telHref, closureWording, ratioClass, houseRules,
} = require('./components');

const pageOf = path => PAGES.find(page => page.path === path);

// Largeur occupée par la grande photo de la une, selon l'écran (sert aussi à la charger en priorité).
const HERO_SIZES = '(min-width: 64rem) 34vw, 92vw';

/** La une du journal. */
function home(site) {
  const { config, next, nextDays, status, now } = site;
  const photos = config.photos;
  const gallery = photos.gallery;
  const days = openDaysSentence(config);
  const issue = edition(now);
  const city = config.address.city;
  // Le texte de présentation est facultatif (salon.config.js) : sans lui, la photo prend toute la place.
  const story = [config.about.title, ...config.about.paragraphs].filter(Boolean);
  const { appointmentOnly, noShow } = config.booking;

  // Congés et fermetures à venir : annoncés en tête du bandeau (les deux prochaines périodes).
  const closures = (site.closures || []).slice(0, 2).map(closureWording);
  // En cours ou dans les quinze jours : la fermeture s'affiche en fixe dans l'étiquette du bandeau.
  const soon = (site.closures || []).find(period => period.current || daysBetween(now.date, period.from) <= 15);

  const tickerItems = [
    // L'événement du mois, annoncé dans le bandeau.
    site.event ? html`<b>${plainTitle(site.event)}${eventWhen(site.event) ? ` · ${eventWhen(site.event)}` : ''}</b>` : '',
    ...closures.flatMap(notice => [notice.closed, notice.reopening]).filter(Boolean).map(text => html`<b>${text}</b>`),
    appointmentOnly ? html`<b>${appointmentOnly}</b>` : '',
    next ? html`Prochain créneau&nbsp;: <b data-next-slot-label>${next.label}</b>` : 'Réservation en ligne',
    'Créneaux à jour en direct',
    noShow.replace(/\.$/, ''),
    days ? `Ouvert ${days}` : '',
    `${config.services.length} prestations à la carte`,
  ].filter(Boolean);

  const body = html`
<main id="contenu" class="une">
  ${ticker(tickerItems, soon ? closureWording(soon).short : undefined)}

  <header class="masthead container">
    <div class="masthead-top">
      <p class="masthead-ear" data-reveal data-delay="250">
        <strong>${city}</strong>
        <span>${capitalize(issue.date)}</span>
        <span>N°&nbsp;${issue.number}<span class="masthead-ear-more"> · édition du jour</span></span>
      </p>
      <p class="nameplate" data-reveal="lines">${splitTitle([config.name])}</p>
      <a class="masthead-ear masthead-ear--slot" href="/reservation" data-reveal data-delay="350">
        <strong>Prochain créneau</strong>
        <span data-next-slot-label>${next ? next.label : 'voir les disponibilités'}</span>
        <span class="masthead-ear-go">Réserver ${icon('arrow-right')}</span>
      </a>
    </div>
    <p class="masthead-line" data-reveal data-delay="450">
      <span>${config.tagline}</span><span>Réservation en ligne, en direct</span>${days ? html`<span>Ouvert ${days}</span>` : ''}
    </p>
    ${appointmentOnly || noShow ? html`<p class="house-rule" data-reveal data-delay="550">
      ${appointmentOnly ? html`<strong>${appointmentOnly}</strong>` : ''}
      ${noShow ? html`<span>${noShow}</span>` : ''}
    </p>` : ''}
  </header>

  <section class="container lead ${story.length ? '' : photos.second ? 'lead--duo' : 'lead--photo'}" aria-labelledby="une-titre">
    <div class="lead-banner">
      ${kicker(`À la une · ${config.trade} à ${city}`)}
      <h1 class="headline headline--xl" id="une-titre" data-reveal="lines" data-delay="150" data-fit>${splitTitle(config.headline)}</h1>
    </div>

    <figure class="lead-photo ${ratioClass(photos.hero)}">
      <div class="frame halftone" data-reveal="settle" data-delay="300">
        <div class="frame-inner" data-scrub>${picture(photos.hero, { lazy: false, sizes: HERO_SIZES })}</div>
      </div>
      ${photos.hero && photos.hero.alt ? html`<figcaption>${photos.hero.alt}.</figcaption>` : ''}
    </figure>

    ${story.length ? html`<div class="lead-text">
      <div class="columns dropcap" data-reveal data-delay="450">
        <p><span class="dateline">${city} —</span> ${story[0]}</p>
        ${story.slice(1).map(text => html`<p>${text}</p>`)}
      </div>
    </div>` : photos.second ? html`<figure class="lead-photo ${ratioClass(photos.second)}">
      <div class="frame frame--whole" data-reveal="settle" data-delay="400">
        <div class="frame-inner">${picture(photos.second, { lazy: false, sizes: '(min-width: 64rem) 38vw, 92vw' })}</div>
      </div>
      ${photos.second.alt ? html`<figcaption>${photos.second.alt}.</figcaption>` : ''}
    </figure>` : ''}

    <aside class="lead-side" aria-label="En marge de la une">
      <a class="box box--ink slot-box" href="/reservation" data-reveal data-delay="400">
        <span class="box-title">Le créneau du jour</span>
        <span class="slot-box-label" data-next-slot-label>${next ? next.label : 'Voir les disponibilités'}</span>
        <span class="slot-box-go">Réserver ce créneau ${icon('arrow-right')}</span>
      </a>

      <section class="box briefs-box" aria-labelledby="bref-titre" data-reveal data-delay="500">
        <h2 class="box-title" id="bref-titre">En bref</h2>
        <ul class="briefs">
          ${closures.map(notice => html`<li class="briefs-alert"><strong>Fermeture.</strong> ${capitalize(notice.closed.replace(/^Fermé /, ''))}.${notice.reopening ? ` ${notice.reopening}.` : ''}</li>`)}
          ${days ? html`<li><strong>Ouverture.</strong> ${capitalize(days)}.</li>` : ''}
          ${appointmentOnly || noShow ? html`<li>${appointmentOnly ? html`<strong>${appointmentOnly}.</strong> ` : ''}${noShow}</li>` : ''}
          ${config.contact.phone ? html`<li><strong>Téléphone.</strong> <a class="link" href="${telHref(config.contact.phone)}">${config.contact.phone}</a></li>` : ''}
        </ul>
        ${stamp(`Sur rendez-vous · ${config.name} · `, { id: 'tampon-une', className: 'briefs-stamp', attrs: 'data-reveal="stamp" data-delay="1000"' })}
      </section>
    </aside>

    <nav class="lead-index" aria-labelledby="sommaire-titre" data-reveal>
      <h2 class="lead-index-title" id="sommaire-titre">Dans ce numéro</h2>
      <ol class="index-list" data-stagger>
        ${PAGES.slice(1).map(page => html`<li><a href="${page.path}">
          <span class="index-page">Page ${page.number}</span>
          <span class="index-name">${page.label}</span>
        </a></li>`)}
      </ol>
    </nav>
  </section>

  ${eventFeature(site)}

  <section class="container section" aria-labelledby="tarifs-titre">
    ${sectionBar('tarifs-titre', 'Les tarifs', pageOf('/prestations'))}
    ${priceTable(config.featuredServices, 'Extrait des tarifs')}
    <p class="section-foot" data-reveal>${button('Toute la carte', '/prestations', { variant: 'btn--outline' })}</p>
  </section>

  <section class="hgallery" aria-labelledby="images-titre" data-scrub="pin" data-hgallery>
    <div class="hgallery-sticky">
      <div class="container">
        ${sectionBar('images-titre', 'En images', pageOf('/galerie'))}
      </div>
      <div class="hgallery-viewport" data-hgallery-viewport>
        <ul class="hgallery-track" data-hgallery-track>
          ${gallery.slice(0, 7).map((photo, i) => html`<li class="hgallery-item hgallery-item--${i % 3} ${ratioClass(photo)}">
            <figure class="frame frame--whole" data-reveal="clip">
              <div class="frame-inner">${picture(photo, { sizes: '(min-width: 56rem) 30vw, 70vw', widths: [480, 800, 1200] })}</div>
            </figure>
            <p class="caption"><b>Photo ${i + 1}.</b> ${photo.alt}.</p>
          </li>`)}
          <li class="hgallery-item hgallery-item--end">
            ${stamp('Page 3 · En images · Page 3 · ', { id: 'tampon-images', href: '/galerie', label: 'Voir toute la galerie, page 3', className: 'stamp--cta', attrs: 'data-magnetic' })}
          </li>
        </ul>
      </div>
    </div>
  </section>

  <section class="container section" aria-labelledby="annonces-titre">
    ${sectionBar('annonces-titre', 'Prendre rendez-vous', pageOf('/reservation'))}
    <div class="annonces">
      <div class="flyer" data-reveal>
        <p class="flyer-kicker">Réserver en ligne</p>
        <p class="flyer-title">Choisissez <span>un jour</span></p>
        ${nextDays.length ? html`<ul class="tabs" aria-label="Prochains jours avec des créneaux libres">
          ${nextDays.map(day => html`<li><a class="tab" href="/reservation?date=${day.date}" aria-label="Réserver le ${formatLong(day.date)}"><span>${formatShort(day.date)}</span></a></li>`)}
        </ul>` : html`<p class="flyer-text">${button('Voir les disponibilités', '/reservation')}</p>`}
      </div>

      <div class="box how-box" data-reveal data-delay="120">
        <h3 class="box-title">Comment réserver</h3>
        <dl class="info-list">
          <div>
            <dt>En ligne</dt>
            <dd>Prochain créneau&nbsp;: <span data-next-slot-label>${next ? next.label : 'voir les disponibilités'}</span></dd>
          </div>
          ${config.contact.phone ? html`<div>
            <dt>Par téléphone</dt>
            <dd><a class="link" href="${telHref(config.contact.phone)}">${config.contact.phone}</a></dd>
          </div>` : ''}
          ${config.contact.messenger ? html`<div>
            <dt>Sur Messenger</dt>
            <dd><a class="link" href="${config.contact.messenger}" target="_blank" rel="noopener">Écrire au salon</a></dd>
          </div>` : ''}
        </dl>
        ${houseRules(config)}
        <p class="actions">${button('Prendre rendez-vous', '/reservation', { variant: 'btn--accent' })}</p>
      </div>
    </div>
  </section>

  <section class="container section" aria-labelledby="pratique-titre">
    ${sectionBar('pratique-titre', 'Carnet pratique', pageOf('/nous-trouver'))}
    <div class="carnet ${photos.find ? '' : 'carnet--duo'}">
      <div class="carnet-col" data-reveal>
        <h3 class="headline headline--s">Où ça&nbsp;?</h3>
        <address>${config.address.street}<br>${config.address.postalCode} ${city}</address>
        ${openBadge(status)}
        <p class="actions">${button('Itinéraire', config.maps.directions, { iconName: 'arrow-up-right', external: true })}</p>
      </div>
      <div class="carnet-col" data-reveal data-delay="90">
        <h3 class="headline headline--s">Quand&nbsp;?</h3>
        ${hoursTable(config, now)}
      </div>
      ${photos.find ? html`<figure class="carnet-photo" data-reveal data-delay="180">
        <div class="frame" data-reveal="clip">
          <div class="frame-inner" data-scrub>${picture(photos.find, { sizes: '(min-width: 60rem) 30vw, 92vw' })}</div>
        </div>
        ${photos.find.alt ? html`<figcaption>${photos.find.alt}.</figcaption>` : ''}
      </figure>` : ''}
    </div>
  </section>
</main>`;

  const nearby = config.seo.nearby.length ? `, près de ${config.seo.nearby[0]}` : '';
  return layout(site, {
    description: `${config.name}, ${config.trade.toLowerCase()} à ${city}${nearby} : coupes, colorations, balayages, lissages. ${appointmentOnly ? `${appointmentOnly}, r` : 'R'}éservation en ligne.`,
    body,
    bodyClass: 'page-une',
    styles: ['/css/pages.css'],
    catalog: true,
    preload: { photo: photos.hero, sizes: HERO_SIZES },
  });
}

module.exports = { home };
