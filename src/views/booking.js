'use strict';

const { html } = require('./html');
const { icon } = require('./icons');
const { layout } = require('./layout');
const { PAGES, folio, splitTitle, kicker, priceTable, telHref, closureWording } = require('./components');
const { firstBookableDate, lastBookableDate } = require('../availability');

const STEPS = ['La prestation', 'Le créneau', 'Le coupon'];
const WEEKDAY_LABELS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

/**
 * Page 4 — Prendre rendez-vous (présentée comme une page de petites annonces).
 *   1. On choisit une prestation dans le tableau des tarifs.
 *   2. On arrache une languette de l'affichette (le créneau).
 *   3. On remplit le coupon-réponse (les coordonnées).
 * La confirmation propose d'ajouter le rendez-vous à son agenda et d'en recevoir le rappel
 * par notification (voir src/reminders.js).
 */
function booking(site) {
  const { config, now } = site;
  const phone = config.contact.phone;
  const page = PAGES.find(p => p.path === '/reservation');
  const { noShow } = config.booking;
  // La règle du rendez-vous manqué, et qui prévenir : dite avant d'envoyer, redite dans la confirmation.
  const warning = html`<p class="pay-note">${icon('info')}<span>${noShow ? html`<strong>${noShow}</strong> ` : ''}Un empêchement&nbsp;? Prévenez le salon au <a class="link" href="${telHref(phone)}">${phone}</a>.</span></p>`;

  const data = {
    today: now.date,
    // Premier et dernier jours réservables en ligne (le premier est demain quand on réserve la veille).
    firstDate: firstBookableDate(config, now.date),
    lastDate: lastBookableDate(config, now.date),
    services: config.services.map(({ id, name, duration, price, priceFrom }) => ({ id, name, duration, price, priceFrom })),
    salon: { name: config.name, address: config.address.full, phone },
    // Rappels : les échéances (en minutes) et de quoi s'abonner aux notifications.
    reminders: site.push ? site.push.leads : [],
    push: site.push ? { key: site.push.key, worker: '/sw.js' } : null,
  };

  const body = html`
<main id="contenu" class="page booking" data-booking>
  <div class="container">
    <header class="page-head booking-head">
      ${folio(site, page)}
      ${kicker('Réservation en ligne')}
      <h1 class="headline headline--xl" data-reveal="lines">${splitTitle(['Prendre', '_rendez-vous_'])}</h1>
      <p class="live-pill" data-reveal><span class="dot" aria-hidden="true"></span>Créneaux à jour en direct</p>
      <p class="notice-line" data-mine hidden>${icon('calendar')}<span data-mine-text></span><a class="link" data-mine-link>Revoir ou annuler</a></p>
      ${(site.closures || []).slice(0, 1).map(period => {
        const notice = closureWording(period);
        return html`<p class="notice-line" data-reveal>${icon('calendar')}<span>${notice.closed}.${notice.reopening ? ` ${notice.reopening}.` : ''}</span></p>`;
      })}
    </header>

    <noscript>
      <p class="notice notice--warn">La réservation en ligne a besoin de JavaScript. Vous pouvez aussi appeler le salon au ${phone}.</p>
    </noscript>

    <nav class="stepper" aria-label="Étapes de la réservation" data-reveal>
      <ol>
        ${STEPS.map((label, i) => html`<li>
          <button type="button" class="stepper-item" data-goto="${i + 1}" ${i === 0 ? html`aria-current="step"` : html`disabled`}>
            <span class="stepper-num" aria-hidden="true">${i + 1}</span><span>${label}</span>
          </button>
        </li>`)}
      </ol>
      <div class="stepper-bar" aria-hidden="true"><span data-progress></span></div>
    </nav>

    <div class="booking-grid">
      <div class="booking-main">
        <section class="panel" data-step="1" aria-labelledby="etape-1">
          <h2 class="panel-title" id="etape-1" tabindex="-1">Choisissez votre prestation</h2>
          ${config.categories.map(category => html`
          <h3 class="ads-group">${category.name}</h3>
          ${priceTable(category.items, `${category.name} : choisissez une prestation`, { pick: true })}`)}
        </section>

        <section class="panel" data-step="2" aria-labelledby="etape-2" hidden>
          <h2 class="panel-title" id="etape-2" tabindex="-1">Arrachez votre créneau</h2>
          <div class="when">
            <div class="calendar">
              <div class="calendar-head">
                <button type="button" class="icon-btn" data-cal-prev aria-label="Mois précédent">${icon('chevron-left')}</button>
                <p class="calendar-month" data-cal-month aria-live="polite"></p>
                <button type="button" class="icon-btn" data-cal-next aria-label="Mois suivant">${icon('chevron-right')}</button>
              </div>
              <div class="calendar-weekdays" aria-hidden="true">${WEEKDAY_LABELS.map(label => html`<span>${label}</span>`)}</div>
              <div class="calendar-grid" data-cal-grid role="group" aria-label="Choisissez un jour"></div>
              <ul class="calendar-legend">
                <li><span class="legend-dot legend-dot--open" aria-hidden="true"></span>Il reste de la place</li>
                <li><span class="legend-dot legend-dot--full" aria-hidden="true"></span>Complet</li>
                <li><span class="legend-dot legend-dot--closed" aria-hidden="true"></span>Fermé</li>
              </ul>
              ${config.booking.dayBefore ? html`<p class="calendar-note">En ligne, on réserve au plus tard la veille.</p>` : ''}
            </div>
            <div class="flyer flyer--slots">
              <p class="flyer-kicker">Créneaux libres</p>
              <p class="flyer-title" data-slots-title>Choisissez un jour</p>
              <p class="flyer-text" data-slots-hint>Choisissez d'abord un jour dans le calendrier.</p>
              <p class="notice" data-slots-notice role="status" hidden></p>
              <div class="slots-body" data-slots-body></div>
            </div>
          </div>
          <div class="panel-actions">
            <button type="button" class="link" data-goto="1">${icon('chevron-left')} Changer de prestation</button>
            <button type="button" class="btn" data-continue disabled><span>Continuer</span>${icon('arrow-right')}</button>
          </div>
        </section>

        <section class="panel" data-step="3" aria-labelledby="etape-3" hidden>
          <h2 class="panel-title" id="etape-3" tabindex="-1">Renvoyez le coupon</h2>
          <form class="form coupon" data-form novalidate>
            <p class="coupon-cut" aria-hidden="true">${icon('scissors')}<span>Coupon-réponse, à compléter</span></p>
            <div class="field" data-field="name">
              <label for="name">Prénom et nom</label>
              <input id="name" name="name" type="text" autocomplete="name" required maxlength="60" aria-describedby="name-error">
              <p class="field-error" id="name-error" hidden></p>
            </div>
            <div class="field" data-field="phone">
              <label for="phone">Téléphone</label>
              <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="30" aria-describedby="phone-hint phone-error">
              <p class="field-hint" id="phone-hint">Pour vous prévenir en cas d'imprévu, jamais pour de la publicité.</p>
              <p class="field-error" id="phone-error" hidden></p>
            </div>
            <div class="field" data-field="note">
              <label for="note">Un mot pour ${config.owner || 'le salon'} <span class="optional">(facultatif)</span></label>
              <textarea id="note" name="note" rows="3" maxlength="200" aria-describedby="note-hint"></textarea>
              <p class="field-hint" id="note-hint">Longueur des cheveux, envie particulière…</p>
            </div>
            <div class="hp" aria-hidden="true">
              <label for="website">Ne remplissez pas ce champ</label>
              <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
            </div>
            ${warning}
            <div class="field field--tick" data-notify-field hidden>
              <label class="tick" for="notify"><input id="notify" name="notify" type="checkbox" checked aria-describedby="notify-hint"><span>Me prévenir par notification sur cet appareil</span></label>
              <p class="field-hint" id="notify-hint">Quand le salon confirme le rendez-vous, puis en rappel avant de venir.</p>
            </div>
            <p class="notice notice--error" data-form-error role="alert" hidden></p>
            <div class="panel-actions">
              <button type="button" class="link" data-goto="2">${icon('chevron-left')} Changer de créneau</button>
              <button type="submit" class="btn btn--accent" data-submit><span data-submit-label>Envoyer le coupon</span>${icon('check')}</button>
            </div>
            <p class="legal-note">Vos coordonnées servent uniquement à gérer ce rendez-vous. <a class="link" href="/confidentialite">En savoir plus</a></p>
          </form>
        </section>

        <section class="panel panel--done" data-step="done" aria-labelledby="etape-fin" hidden>
          <div class="done-stamp" aria-hidden="true"><span>Retenu</span></div>
          ${kicker('Avis')}
          <h2 class="headline headline--l" id="etape-fin" tabindex="-1">Rendez-vous enregistré</h2>
          <p class="deck" data-done-text></p>
          <dl class="done-recap" data-done-recap></dl>
          ${warning}
          <div class="actions">
            <button type="button" class="btn" data-ics><span>Ajouter à mon agenda</span>${icon('download')}</button>
            <button type="button" class="btn btn--outline" data-remind aria-pressed="false" hidden><span data-remind-label>Me prévenir</span>${icon('bell')}</button>
            <a class="btn btn--outline" href="${config.maps.directions}" target="_blank" rel="noopener"><span>Itinéraire</span>${icon('arrow-up-right')}</a>
          </div>
          <p class="remind-note" data-remind-note role="status" hidden></p>
          <p class="done-manage" data-manage hidden>${icon('calendar')}<span>Un changement de programme&nbsp;? <a class="link" data-manage-link>Revoir ou annuler ce rendez-vous</a></span></p>
          <a class="link" href="/">${icon('chevron-left')} Revenir à la une</a>
        </section>
      </div>

      <aside class="summary" data-summary aria-label="Votre rendez-vous">
        <h2 class="summary-title">Votre rendez-vous</h2>
        <dl class="summary-list">
          <div><dt>Prestation</dt><dd data-sum="service">À choisir</dd></div>
          <div><dt>Date</dt><dd data-sum="date">—</dd></div>
          <div><dt>Heure</dt><dd data-sum="time">—</dd></div>
          <div><dt>Durée</dt><dd data-sum="duration">—</dd></div>
        </dl>
        <p class="summary-total"><span>Tarif</span><strong data-sum="price">—</strong></p>
        <p class="summary-salon">${icon('pin')}<span>${config.address.full}</span></p>
      </aside>
    </div>
  </div>

  <!-- Téléphone : le récapitulatif reste sous le pouce pendant qu'on choisit. -->
  <div class="booking-bar" data-booking-bar aria-hidden="true" hidden>
    <p class="booking-bar-what"><strong data-bar="service"></strong><span data-bar="when"></span></p>
    <p class="booking-bar-price" data-bar="price"></p>
  </div>
</main>`;

  return layout(site, {
    title: 'Prendre rendez-vous en ligne',
    crumb: 'Prendre rendez-vous',
    description: `Prenez rendez-vous en ligne chez ${config.name}, ${config.trade.toLowerCase()} à ${config.address.city} : prestation, jour et heure, créneaux à jour en direct.`,
    body,
    data,
    bodyClass: 'page-booking',
    styles: ['/css/pages.css', '/css/booking.css'],
    scripts: ['/js/booking.js'],
  });
}

module.exports = { booking };
