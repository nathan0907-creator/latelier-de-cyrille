'use strict';

const { html } = require('./html');
const { layout } = require('./layout');

/** Espace salon : une coquille vide. Tout le contenu est chargé après connexion, par l'API. */
function salon(site) {
  const { config } = site;
  const data = {
    name: config.name,
    owner: config.owner,
    phone: config.contact.phone,
    services: config.services.map(({ id, name, duration, price, priceFrom, category }) => ({ id, name, duration, price, priceFrom, category })),
    hours: config.hours,
    slotStep: config.booking.slotStep,
    // Les alertes sur l'appareil de la coiffeuse (nouvelle demande, annulation), même page fermée.
    push: site.push ? { key: site.push.key, worker: '/sw.js' } : null,
    mail: Boolean(site.mail),
  };

  const body = html`
<main id="contenu" class="salon" data-salon>
  <div class="salon-splash" data-splash>
    <span class="spinner" aria-hidden="true"></span>
    <p>Chargement de l'espace salon…</p>
  </div>
  <noscript><p class="notice notice--warn">L'espace salon a besoin de JavaScript.</p></noscript>
</main>
<div class="toasts" data-toasts role="status" aria-live="polite"></div>`;

  return layout(site, {
    title: 'Espace salon',
    body,
    data,
    bare: true,
    noindex: true,
    bodyClass: 'page-salon',
    styles: ['/css/salon.css'],
    scripts: ['/js/salon.js'],
  });
}

module.exports = { salon };
