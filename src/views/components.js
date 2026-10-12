'use strict';

const { html, raw, escapeHtml } = require('./html');
const { icon } = require('./icons');
const { frTime, weekday, WEEKDAYS, formatLong, formatShort, dayOfYear } = require('../time');

/** 42 → « 42 € », 24.5 → « 24,50 € » */
const euros = amount => `${Number.isInteger(amount) ? amount : amount.toFixed(2).replace('.', ',')} €`;
const priceLabel = service => `${service.priceFrom ? 'dès ' : ''}${euros(service.price)}`;

/** Les longueurs de cheveux, dans l'ordre des trois prix d'une prestation. */
const LENGTHS = ['Courts', 'Mi-longs', 'Longs'];

/** Le détail des prix d'une prestation qui en a plusieurs : « Courts 25 € · Mi-longs 30 € · Longs 45 € ». */
const priceDetail = service => (!service.prices ? ''
  : service.prices.length === 3 ? service.prices.map((price, i) => `${LENGTHS[i]} ${euros(price)}`).join(' · ')
  : service.prices.map(euros).join(' / '));

/** 90 → « 1 h 30 », 30 → « 30 min » */
function durationLabel(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${String(rest).padStart(2, '0')}` : ''}`;
}

const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);
const telHref = phone => `tel:${phone.replace(/[^\d+]/g, '')}`;
const pad2 = n => String(n).padStart(2, '0');

const UNSPLASH = 'https://images.unsplash.com/';

/** Adresse d'une photo à une largeur donnée (photos provisoires) ou telle quelle (photos locales). */
const photoUrl = (photo, width) => (photo.src.startsWith(UNSPLASH) ? `${photo.src}?auto=format&fit=crop&w=${width}&q=72` : photo.src);

/**
 * Image adaptative. Les photos provisoires (banque d'images) sont servies en plusieurs
 * largeurs ; une photo locale (/photos/…) est utilisée telle quelle.
 */
function picture(photo, { sizes = '100vw', widths = [480, 800, 1200, 1600], lazy = true, className = '' } = {}) {
  if (!photo || !photo.src) return '';
  const remote = photo.src.startsWith(UNSPLASH);
  const responsive = remote
    ? raw(`srcset="${escapeHtml(widths.map(w => `${photoUrl(photo, w)} ${w}w`).join(', '))}" sizes="${escapeHtml(sizes)}"`)
    : '';
  return html`<img class="${className}" src="${remote ? photoUrl(photo, widths[Math.min(1, widths.length - 1)]) : photo.src}"
    ${responsive} alt="${photo.alt || ''}" ${raw(lazy ? 'loading="lazy"' : 'fetchpriority="high"')} decoding="async">`;
}

/** Classe CSS du format d'une photo : « 4/5 » → « r-4-5 ». */
const ratioClass = photo => `r-${['4/3', '4/5', '1/1', '3/4', '16/9'].includes(photo.ratio) ? photo.ratio.replace('/', '-') : '4-5'}`;

/** Adresse de la photo en grand format (visionneuse de la galerie). */
const fullSize = photo => (photo.src.startsWith(UNSPLASH) ? `${photo.src}?auto=format&fit=max&w=1800&q=80` : photo.src);

// ── Le journal : pages, date d'édition ─────────────────────────────────────

/** Les pages du journal, dans l'ordre où on les tourne. */
const PAGES = [
  { path: '/', number: 1, label: 'La une' },
  { path: '/prestations', number: 2, label: 'La carte' },
  { path: '/galerie', number: 3, label: 'En images' },
  { path: '/reservation', number: 4, label: 'Prendre rendez-vous' },
  { path: '/nous-trouver', number: 5, label: 'Pratique' },
];

/** « samedi 10 octobre 2026 » et numéro du jour dans l'année, comme sur la manchette d'un quotidien. */
function edition(now) {
  return { date: `${formatLong(now.date)} ${now.date.slice(0, 4)}`, number: dayOfYear(now.date) };
}

/** Titre courant en haut de chaque page : « Page 2 — La carte — samedi 10 octobre 2026 ». */
function folio(site, page) {
  return html`<p class="folio" data-reveal>
    <span>Page ${page.number}</span><span>${page.label}</span><span>${capitalize(edition(site.now).date)}</span>
  </p>`;
}

// ── Horaires ───────────────────────────────────────────────────────────────

/** Horaires de la semaine, lundi d'abord, avec le jour courant repéré. */
function weekHours(config, now) {
  const today = weekday(now.date);
  return [1, 2, 3, 4, 5, 6, 0].map(day => ({
    day: capitalize(WEEKDAYS[day]),
    today: day === today,
    label: config.hours[day].length
      ? config.hours[day].map(r => `${frTime(r.start)} – ${frTime(r.end)}`).join(' · ')
      : 'Fermé',
    closed: !config.hours[day].length,
  }));
}

function hoursTable(config, now) {
  return html`<table class="hours">
    <caption class="sr-only">Horaires d'ouverture</caption>
    <tbody>
      ${weekHours(config, now).map(row => html`<tr class="${row.today ? 'is-today' : ''} ${row.closed ? 'is-closed' : ''}">
        <th scope="row">${row.day}${row.today ? html`<span class="sr-only"> (aujourd'hui)</span>` : ''}</th>
        <td>${row.label}</td>
      </tr>`)}
    </tbody>
  </table>`;
}

/** « du mardi au samedi » : premier et dernier jour d'ouverture de la semaine. */
function openDaysSentence(config) {
  const open = [1, 2, 3, 4, 5, 6, 0].filter(day => config.hours[day].length);
  if (!open.length) return '';
  if (open.length === 1) return `le ${WEEKDAYS[open[0]]}`;
  return `du ${WEEKDAYS[open[0]]} au ${WEEKDAYS[open.at(-1)]}`;
}

/** « Ouvert jusqu'à 19h » ou « Fermé · ouvre demain à 9h » */
function openStatusLabel(status) {
  if (status.open) return `Ouvert jusqu'à ${frTime(status.until)}`;
  if (!status.date) return 'Fermé';
  const day = status.offset === 0 ? '' : status.offset === 1 ? 'demain ' : `${WEEKDAYS[weekday(status.date)]} `;
  return `Fermé · ouvre ${day}à ${frTime(status.at)}`;
}

function openBadge(status) {
  return html`<p class="open-badge ${status.open ? 'is-open' : 'is-closed'}"><span class="dot" aria-hidden="true"></span>${openStatusLabel(status)}</p>`;
}

// ── Motifs du journal ──────────────────────────────────────────────────────

/**
 * Une fermeture exceptionnelle dite en clair : « Fermé du mardi 20 au samedi 31 octobre : congés »,
 * et, si elle est en cours, le jour de réouverture.
 */
function closureWording(period) {
  const single = period.from === period.to;
  const sameMonth = period.from.slice(0, 7) === period.to.slice(0, 7);
  // « mardi 20 » plutôt que « mardi 20 octobre » quand le mois est donné par la date de fin.
  const start = sameMonth && !single ? formatLong(period.from).replace(/\s+\S+$/, '') : formatLong(period.from);
  const reason = period.reason ? ` : ${period.reason.charAt(0).toLowerCase()}${period.reason.slice(1)}` : '';
  let dates;
  if (period.current) dates = single ? "aujourd'hui" : `jusqu'au ${formatLong(period.to)} inclus`;
  else dates = single ? `le ${start}` : `du ${start} au ${formatLong(period.to)}`;
  // Version courte, pour l'étiquette du bandeau : « Fermé du 20 au 31 oct. »
  const day = date => formatShort(date).replace(/^\S+\s/, '');
  let short;
  if (period.current) short = single ? "Fermé aujourd'hui" : `Fermé jusqu'au ${day(period.to)}`;
  else if (single) short = `Fermé le ${day(period.from)}`;
  else short = `Fermé du ${sameMonth ? day(period.from).replace(/\s+\S+$/, '') : day(period.from)} au ${day(period.to)}`;
  return {
    closed: `Fermé ${dates}${reason}`,
    reopening: period.current && period.reopens ? `Réouverture le ${formatLong(period.reopens)}` : '',
    short,
  };
}

/** Surtitre d'article : « À LA UNE », « PRATIQUE »… */
const kicker = text => html`<p class="kicker" data-reveal>${text}</p>`;

/** Bandeau de rubrique : un titre entre deux filets et, à droite, le renvoi vers la page concernée. */
function sectionBar(id, title, page = null) {
  return html`<header class="section-bar" data-reveal>
    <h2 class="section-title" id="${id}">${title}</h2>
    ${page ? html`<a class="section-note" href="${page.path}" aria-label="${page.label}, page ${page.number}">Suite page ${page.number} ${icon('arrow-right')}</a>` : ''}
  </header>`;
}

/**
 * Tampon rond dont le texte tourne. Avec href, c'est un lien (flèche au centre) ;
 * sinon un simple décor. id doit être unique dans la page.
 */
function stamp(text, { id, href = '', label = '', className = '', attrs = '' } = {}) {
  const art = html`<svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">
    <defs><path id="${id}" d="M100 100m-74 0a74 74 0 1 1 148 0a74 74 0 1 1-148 0"/></defs>
    <circle cx="100" cy="100" r="96"/><circle cx="100" cy="100" r="52"/>
    <text><textPath href="#${id}" textLength="452">${text}</textPath></text>
  </svg>`;
  return href
    ? html`<a class="stamp stamp--solid ${className}" href="${href}" aria-label="${label}" ${raw(attrs)}>${art}${icon('arrow-up-right')}</a>`
    : html`<span class="stamp ${className}" aria-hidden="true" ${raw(attrs)}>${art}</span>`;
}

/**
 * Bandeau « dernière minute » qui défile en haut de la une. L'étiquette de gauche ne défile pas :
 * on y met ce qui doit se lire d'un coup d'œil (une fermeture proche, par exemple).
 */
function ticker(items, label = 'Dernière minute') {
  return html`<div class="ticker" aria-hidden="true" data-marquee>
    <p class="ticker-label">${label}</p>
    <div class="ticker-window">
      <div class="ticker-track">
        ${[0, 1].map(() => html`<ul>${items.map(item => html`<li>${item}</li>`)}</ul>`)}
      </div>
    </div>
  </div>`;
}

/**
 * Trait de stylo rouge autour d'une petite annonce : il se dessine quand l'annonce est choisie.
 * (Ellipse tracée à la main ; pathLength="1" permet de l'animer en CSS.)
 */
const penCircle = raw(`<svg class="pen" viewBox="0 0 300 150" preserveAspectRatio="none" aria-hidden="true" focusable="false">
  <path pathLength="1" d="M34 78C22 38 96 10 168 12c66 2 116 24 112 62-4 40-74 62-146 60C72 132 22 112 26 74c3-32 62-56 128-58"/>
</svg>`);

// ── Boutons et titres ──────────────────────────────────────────────────────

/**
 * Tableau de tarifs : la prestation à gauche, les prix à droite, une colonne par longueur
 * de cheveux. Une prestation à tarif unique occupe les trois colonnes ; la dernière case
 * mène à la réservation de cette prestation.
 */
function priceTable(services, caption) {
  const byLength = services.some(service => service.prices && service.prices.length === 3);
  return html`<table class="prices">
    <caption class="sr-only">${caption}</caption>
    <thead>
      <tr>
        <th scope="col" class="prices-what">Prestation</th>
        ${byLength
          ? LENGTHS.map(length => html`<th scope="col" class="prices-length"><span class="prices-more">Cheveux </span><span class="prices-word">${length.toLowerCase()}</span></th>`)
          : html`<th scope="col" class="prices-length" colspan="3">Tarif</th>`}
        <th scope="col" class="prices-go"><span class="sr-only">Réserver</span></th>
      </tr>
    </thead>
    <tbody data-stagger>
      ${services.map(service => html`<tr data-reveal>
        <th scope="row">${service.name}</th>
        ${service.prices && service.prices.length === 3
          ? service.prices.map(price => html`<td>${euros(price)}</td>`)
          : html`<td colspan="3" class="prices-single">${service.prices ? service.prices.map(euros).join(' / ') : priceLabel(service)}</td>`}
        <td class="prices-go"><a class="prices-book" href="/reservation?service=${service.id}" aria-label="Réserver : ${service.name}"><span>Réserver</span>${icon('arrow-right')}</a></td>
      </tr>`)}
    </tbody>
  </table>`;
}

/** Libellé de bouton : data-text sert à l'effet de « roulement » du texte au survol. */
const buttonLabel = label => html`<span data-text="${label}">${label}</span>`;

function button(label, href, { variant = '', iconName = 'arrow-right', magnetic = false, external = false } = {}) {
  return html`<a class="btn ${variant}" href="${href}" ${raw(magnetic ? 'data-magnetic' : '')} ${raw(external ? 'target="_blank" rel="noopener"' : '')}>${buttonLabel(label)}${iconName ? icon(iconName) : ''}</a>`;
}

/**
 * Titre découpé en lignes puis en mots : chaque mot sort de son masque, comme une ligne
 * qu'on compose. _mots_ → en écriture, dans la couleur du salon ; *mots* → en écriture multicolore.
 * Une espace insécable garde deux mots ensemble.
 * (Une espace sépare les lignes : elles peuvent ainsi se suivre sur une seule, en bandeau.)
 */
function splitTitle(lines) {
  return lines.map((line, n) => {
    const words = String(line).split(/(_[^_]+_|\*[^*]+\*)/).filter(Boolean).flatMap(part => {
      const mark = /^_.+_$/.test(part) ? 'script' : /^\*.+\*$/.test(part) ? 'magic' : '';
      return (mark ? part.slice(1, -1) : part).split(/ +/).filter(Boolean).map(word => ({ word, mark }));
    });
    return html`${n ? ' ' : ''}<span class="line">${words.map((w, i) => html`${i ? ' ' : ''}<span class="w"><span class="w-i">${
      w.mark === 'magic' ? html`<em class="magic">${w.word}</em>` : w.mark ? html`<em>${w.word}</em>` : w.word
    }</span></span>`)}</span>`;
  });
}

module.exports = {
  euros, priceLabel, LENGTHS, priceDetail, priceTable, durationLabel, capitalize, telHref, pad2, photoUrl, picture, ratioClass, fullSize,
  PAGES, edition, folio, weekHours, hoursTable, openDaysSentence, openStatusLabel, openBadge, closureWording,
  kicker, sectionBar, stamp, ticker, penCircle, buttonLabel, button, splitTitle,
};
