/**
 * Le site en ligne sur Cloudflare (configuration : wrangler.jsonc ; mode d'emploi : README).
 *
 * Deux pièces :
 *  - le Worker (export default) reçoit chaque visite, au plus près du visiteur. Il sert lui-même les
 *    fichiers de public/ (styles, scripts, photos) et passe tout le reste au salon ;
 *  - le salon (classe Salon, un « Durable Object ») : une seule instance, créée en Europe de l'Ouest,
 *    qui fait tourner le site comme sur l'ordinateur du salon (src/app.js) et range ses données dans
 *    sa propre base. Il s'endort quand personne ne visite le site, et se fait réveiller
 *    pour envoyer les rappels (notifications et e-mails) et faire l'entretien.
 */

import { DurableObject } from 'cloudflare:workers';
import site from './generated/site.json';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';
import { securityHeaders } from '../src/http.js';
import { TYPES, cacheControl } from '../src/static.js';
import { sqlBackend } from './storage.js';
import { toFetchHandler } from './adapter.js';

const MINUTE = 60_000;

export class Salon extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const store = createStore(sqlBackend(ctx.storage.sql, run => ctx.storage.transactionSync(run)));
    this.app = createApp({
      // Le site d'essai (wrangler.jsonc, « essai ») porte son nom dans chaque titre de page.
      config: env.ESSAI ? { ...site.config, name: `${site.config.name} (site d'essai)` } : site.config,
      store,
      // Le code de première connexion : le secret SETUP_CODE, choisi dans les réglages du Worker.
      setupCode: env.SETUP_CODE || '',
      timers: false,
      assetVersion: () => site.version,
      serveStatic: async () => false,
      // Cloudflare ne signale une page fermée qu'à l'envoi suivant : des battements plus rapprochés,
      // et plus de flux par adresse le temps que ceux des pages fermées s'éteignent.
      live: { heartbeatMs: 10_000, maxPerIp: 30 },
      // Les e-mails aux clients : secrets BREVO_API_KEY et MAIL_FROM (README, « Les e-mails »).
      mail: { apiKey: env.BREVO_API_KEY || '', from: env.MAIL_FROM || '' },
    });
    this.handle = toFetchHandler(this.app.handle);
    this.alarmPlanned = false;
  }

  async fetch(request) {
    const response = await this.handle(request);
    this.app.stats.save();
    // Une réservation, un rappel demandé… : le prochain réveil est peut-être plus tôt.
    if (!this.alarmPlanned || request.method !== 'GET') await this.planAlarm();
    return response;
  }

  /** Le réveil : l'entretien, puis les rappels arrivés à échéance. */
  async alarm() {
    this.app.maintain();
    await this.app.tick();
    await this.planAlarm(true);
  }

  /** Prochain réveil : au prochain rappel à envoyer, et au moins toutes les heures pour l'entretien. */
  async planAlarm(force = false) {
    const minutes = Math.min(60, Math.max(1, this.app.nextDue() ?? 60));
    // Au début d'une minute, comme l'horloge du salon, avec une seconde de marge.
    const at = (Math.floor(Date.now() / MINUTE) + minutes) * MINUTE + 1000;
    const current = force ? null : await this.ctx.storage.getAlarm();
    if (current === null || at < current) await this.ctx.storage.setAlarm(at);
    this.alarmPlanned = true;
  }
}

/** Un fichier de public/, avec les mêmes en-têtes que sur l'ordinateur du salon (src/static.js). */
function withHeaders(response, type, url) {
  const headers = new Headers(response.headers);
  if (response.status === 200) headers.set('Content-Type', type);
  headers.set('Cache-Control', cacheControl(type, url.searchParams.has('v')));
  for (const [name, value] of Object.entries(securityHeaders(site.config, url.protocol === 'https:'))) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

/** Le site d'essai n'apparaît jamais dans les moteurs de recherche. */
function hidden(response, env) {
  if (!env.ESSAI) return response;
  const copy = new Response(response.body, response);
  copy.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return copy;
}

/** Un fichier de public/ est servi directement ; tout le reste va au salon. */
async function serve(request, env) {
  const url = new URL(request.url);
  const extension = /\.[a-z0-9]+$/i.exec(url.pathname)?.[0].toLowerCase();
  const type = extension && TYPES[extension];
  if (type && !url.pathname.startsWith('/api/')) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return withHeaders(response, type, url);
  }
  // Toutes les visites vont au même salon, créé en Europe de l'Ouest, au plus près de ses clientes.
  return env.SALON.get(env.SALON.idFromName('salon'), { locationHint: 'weur' }).fetch(request);
}

export default {
  async fetch(request, env) {
    return hidden(await serve(request, env), env);
  },
};
