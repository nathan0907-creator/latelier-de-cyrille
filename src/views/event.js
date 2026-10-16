'use strict';

// L'événement du mois : sa rubrique sur la une, sa page (/evenement) et l'encart qui s'ouvre à
// l'arrivée sur le site. Le contenu vient de l'espace salon (src/salon-event.js).

const { html, raw, escapeHtml } = require('./html');
const { icon } = require('./icons');
const { layout } = require('./layout');
const { formatLong } = require('../time');
const { picture, button, splitTitle, kicker, sectionBar, capitalize, ratioClass } = require('./components');

/**
 * Le texte mis en forme par la coiffeuse : une ligne = un paragraphe, « - » en début de ligne =
 * une liste, **gras**, *italique*, _écriture_ (dans la couleur du salon). Tout est échappé avant.
 */
function richText(text) {
  const inline = value => escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/(^|[\s(«'’])_(.+?)_(?=$|[\s).,;:!?»])/g, '$1<em class="script">$2</em>');
  const out = [];
  let list = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const row of String(text || '').split('\n')) {
    const value = row.trim();
    const item = /^[-•]\s+(.*)$/.exec(value);
    if (item) {
      list.push(item[1]);
      continue;
    }
    flush();
    if (value) out.push(`<p>${inline(value)}</p>`);
  }
  flush();
  return raw(out.join(''));
}

/** « Samedi 31 octobre · de 18h à 22h », « Du lundi 26 au samedi 31 octobre ». */
function eventWhen(event) {
  const day = event.date ? (event.endDate ? `Du ${formatLong(event.date)} au ${formatLong(event.endDate)}` : capitalize(formatLong(event.date))) : '';
  return [day, event.time].filter(Boolean).join(' · ');
}

/** Le bouton d'infos : le lien donné par la coiffeuse, sinon la page de l'événement. */
const target = event => event.buttonLink || '/evenement';
const isExternal = link => /^https?:/.test(link);

/** Sans accroche, le premier paragraphe du texte (sans sa mise en forme). */
const teaser = event => event.summary || (String(event.text || '').split('\n').find(row => row.trim() && !/^[-•]\s/.test(row.trim())) || '')
  .replace(/\*\*|\*|(^|\s)_|_(?=\s|$)/g, '$1').trim();

/** Le titre sans ses marques de mise en forme (onglet du navigateur, moteurs de recherche, bandeau). */
const plainTitle = event => event.title.replace(/[_*]/g, '').replace(/\s+/g, ' ').trim();

const themeClass = event => `event--${event.theme === 'soiree' ? 'soiree' : 'clair'}`;

/** La rubrique de la une. */
function eventFeature(site) {
  const event = site.event;
  if (!event) return '';
  const [photo] = event.images;
  const when = eventWhen(event);
  const link = target(event);
  return html`<section class="container section event-feature" aria-labelledby="evenement-titre">
    ${sectionBar('evenement-titre', event.kicker)}
    <article class="event-card ${themeClass(event)} ${photo ? '' : 'event-card--text'}" data-reveal>
      ${photo ? html`<figure class="event-card-photo ${ratioClass(photo)}">
        <div class="frame frame--whole"><div class="frame-inner">${picture(photo, { sizes: '(min-width: 56rem) 40vw, 92vw', widths: [480, 800, 1200] })}</div></div>
      </figure>` : ''}
      <div class="event-card-body">
        ${when ? html`<p class="event-when">${icon('calendar')}<span>${when}</span></p>` : ''}
        <h3 class="headline headline--l event-title">${splitTitle([event.title])}</h3>
        ${teaser(event) ? html`<p class="event-summary">${teaser(event)}</p>` : ''}
        <p class="actions">
          ${button(event.buttonLabel, link, { variant: 'btn--accent', iconName: isExternal(link) ? 'arrow-up-right' : 'arrow-right', external: isExternal(link) })}
          ${event.booking ? button('Prendre rendez-vous', '/reservation', { variant: 'btn--outline' }) : ''}
        </p>
      </div>
    </article>
  </section>`;
}

/** L'encart à l'arrivée sur le site (site.js l'ouvre une fois, tant qu'on ne l'a pas fermé). */
function eventPopup(site) {
  const event = site.event;
  if (!event || !event.popup || ['/evenement', '/reservation', '/rendez-vous'].includes(site.path)) return '';
  const [photo] = event.images;
  const when = eventWhen(event);
  const link = target(event);
  return html`<aside class="event-pop ${themeClass(event)}" aria-labelledby="encart-titre" data-event-pop data-event-rev="${event.updatedAt}" hidden>
    <button type="button" class="event-pop-close" aria-label="Fermer l'encart" data-event-pop-close>${icon('close')}</button>
    ${photo ? html`<div class="event-pop-photo">${picture(photo, { sizes: '9rem', widths: [480] })}</div>` : ''}
    <div class="event-pop-body">
      <p class="event-pop-kicker">${event.kicker}</p>
      <p class="event-pop-title" id="encart-titre">${splitTitle([event.title])}</p>
      ${when ? html`<p class="event-pop-when">${when}</p>` : ''}
      ${event.summary ? html`<p class="event-pop-text">${event.summary}</p>` : ''}
      <a class="btn btn--small btn--accent" href="${link}" data-event-pop-go ${raw(isExternal(link) ? 'target="_blank" rel="noopener"' : '')}><span>${event.buttonLabel}</span>${icon(isExternal(link) ? 'arrow-up-right' : 'arrow-right')}</a>
    </div>
  </aside>`;
}

/** La page de l'événement. La coiffeuse connectée la voit même masquée ou passée (aperçu). */
function eventPage(site) {
  const { config } = site;
  const event = site.eventPreview || site.event;
  const when = eventWhen(event);
  const [first, ...others] = event.images;
  const link = event.buttonLink;
  const preview = event.hidden || event.over;
  const body = html`
<main id="contenu" class="page event-page ${themeClass(event)}">
  ${preview ? html`<p class="notice notice--warn container event-preview">${icon('eye')}<span>Aperçu : ${event.over ? 'cet événement est passé' : "cet événement n'est pas affiché"}, seule vous le voyez. Réglez-le dans l'espace salon, onglet Événement.</span></p>` : ''}
  <header class="page-head container">
    ${kicker(event.kicker)}
    <h1 class="headline headline--xl" data-reveal="lines">${splitTitle([event.title])}</h1>
    ${when ? html`<p class="event-when event-when--large" data-reveal>${icon('calendar')}<span>${when}</span></p>` : ''}
    ${event.summary ? html`<p class="deck" data-reveal>${event.summary}</p>` : ''}
  </header>
  <div class="container event-layout ${first ? '' : 'event-layout--text'}">
    ${first ? html`<figure class="event-main-photo ${ratioClass(first)}" data-reveal>
      <div class="frame frame--whole"><div class="frame-inner">${picture(first, { lazy: false, sizes: '(min-width: 60rem) 45vw, 92vw' })}</div></div>
      <figcaption>${first.alt}.</figcaption>
    </figure>` : ''}
    <div class="event-article">
      ${event.text ? html`<div class="event-text" data-reveal>${richText(event.text)}</div>` : ''}
      <p class="actions" data-reveal>
        ${link ? button(event.buttonLabel, link, { variant: 'btn--accent', iconName: isExternal(link) ? 'arrow-up-right' : 'arrow-right', external: isExternal(link) }) : ''}
        ${event.booking ? button('Prendre rendez-vous', '/reservation', { variant: link ? 'btn--outline' : 'btn--accent' }) : ''}
        ${button('Revenir à la une', '/', { variant: 'btn--outline', iconName: '' })}
      </p>
    </div>
  </div>
  ${others.length ? html`<ul class="container event-photos" data-stagger>
    ${others.map(photo => html`<li class="${ratioClass(photo)}">
      <figure class="frame frame--whole" data-reveal="clip"><div class="frame-inner">${picture(photo, { sizes: '(min-width: 56rem) 30vw, 46vw', widths: [480, 800, 1200] })}</div></figure>
      <p class="caption">${photo.alt}.</p>
    </li>`)}
  </ul>` : ''}
</main>`;

  const description = (teaser(event) || `${plainTitle(event)} au salon ${config.name}, ${config.address.city}.`).slice(0, 300);
  return layout(site, {
    title: plainTitle(event),
    crumb: plainTitle(event),
    description,
    body,
    noindex: preview,
    styles: ['/css/pages.css'],
    preload: first ? { photo: first, sizes: '(min-width: 60rem) 45vw, 92vw' } : null,
    // Un événement daté est signalé aux moteurs de recherche, au salon, avec ses photos.
    schema: event.date ? ({ at, salon }) => [{
      '@type': 'Event',
      '@id': at('/evenement#evenement'),
      name: plainTitle(event),
      description,
      url: at('/evenement'),
      startDate: event.date,
      endDate: event.endDate || event.date,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: { '@id': salon },
      organizer: { '@id': salon },
      ...(event.images.length && { image: event.images.map(photo => at(photo.src)) }),
    }] : null,
  });
}

module.exports = { eventFeature, eventPopup, eventPage, richText, eventWhen, plainTitle };
