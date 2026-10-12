'use strict';

const { nowInZone, isValidDate, isValidMonth, addDays, daysBetween, formatShort, frTime } = require('./time');
const availability = require('./availability');
const { createBookings, cleanText } = require('./bookings');
const { createReminders } = require('./reminders');
const { createAuth } = require('./auth');
const { createEvents } = require('./events');
const { createLimiter } = require('./ratelimit');
const { createStatic, createVersion } = require('./static');
const { createStats } = require('./stats');
const { HttpError, clientIp, isSecure, sameOrigin, readJson, applySecurityHeaders, send, sendJson, sendHtml } = require('./http');
const views = require('./views');

const fs = require('node:fs');
const path = require('node:path');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createApp({ config, store, clock = () => nowInZone(config.timezone) }) {
  const bookings = createBookings({ config, store, clock });
  const reminders = createReminders({ config, store, clock });
  const auth = createAuth({ store });
  const events = createEvents();
  const serveStatic = createStatic(config.publicDir);
  const assetVersion = createVersion(config.publicDir);
  const stats = createStats({ store, clock });

  const limits = {
    api: createLimiter({ max: 300, windowMs: 60_000 }),
    booking: createLimiter({ max: 8, windowMs: 10 * 60_000 }),
    // Toutes adresses confondues : un agenda ne se remplit pas de quarante demandes en une heure.
    bookingGlobal: createLimiter({ max: 40, windowMs: 60 * 60_000 }),
    reminder: createLimiter({ max: 20, windowMs: 10 * 60_000 }),
    login: createLimiter({ max: 5, windowMs: 15 * 60_000 }),
    loginGlobal: createLimiter({ max: 40, windowMs: 15 * 60_000 }),
  };

  const quickest = config.services.reduce((a, b) => (b.duration < a.duration ? b : a));
  const serviceById = id => config.services.find(s => s.id === id);
  const snapshot = () => ({ config, bookings: store.bookings.all(), closures: store.closures.all(), now: clock() });

  /** « aujourd'hui à 14h30 », « demain à 9h », « mar. 13 oct. à 9h » */
  function describeSlot(slot, now) {
    if (!slot) return null;
    const offset = daysBetween(now.date, slot.date);
    const day = offset === 0 ? "aujourd'hui" : offset === 1 ? 'demain' : formatShort(slot.date);
    return { date: slot.date, time: slot.time, label: `${day} à ${frTime(slot.start)}` };
  }

  /**
   * Adresse publique du site : celle de salon.config.js une fois le site en ligne, sinon celle
   * par laquelle le visiteur est arrivé (localhost, adresse du Wi-Fi…).
   */
  function originOf(req) {
    if (config.siteUrl) return config.siteUrl;
    const host = /^[a-z0-9.-]+(:\d{1,5})?$/i.test(req.headers.host || '') ? req.headers.host : `localhost:${config.port}`;
    return `${isSecure(req, config.trustProxy) ? 'https' : 'http'}://${host}`;
  }

  function siteContext(pathname, req) {
    const state = snapshot();
    const version = assetVersion();
    return {
      config,
      path: pathname,
      origin: originOf(req),
      // Adresse d'un style ou d'un script, avec son empreinte (voir createVersion).
      asset: file => `${file}?v=${version}`,
      now: state.now,
      status: availability.openStatus(state),
      next: describeSlot(availability.nextSlot({ ...state, service: quickest }), state.now),
      // Congés et fermetures à venir, annoncés dans le bandeau de la une.
      closures: availability.closurePeriods(state),
      // Seule la une affiche l'affichette aux languettes : inutile de calculer ces jours ailleurs.
      nextDays: pathname === '/' ? availability.nextOpenDays({ ...state, service: quickest }) : [],
      // Rappels par notification : la clé publique du serveur et les échéances proposées.
      push: { key: reminders.publicKey, leads: reminders.leads, labels: reminders.labels },
    };
  }

  /** Prévient les pages ouvertes : la journée a changé (public), le détail du rendez-vous (salon). */
  function announce(kind, booking) {
    events.send('public', 'slots', { date: booking.date });
    events.send('salon', 'booking', { kind, booking });
  }

  // ── API ────────────────────────────────────────────────────────────────

  async function api(req, res, url) {
    const { pathname, searchParams } = url;
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const ip = clientIp(req, config.trustProxy);
    const secure = isSecure(req, config.trustProxy);
    const json = (status, data, headers) => sendJson(req, res, status, data, headers);
    const reject = result => json(result.status, { error: result.error, fields: result.fields, code: result.code });
    const tooMany = (limit, error) => json(429, { error, retryAfter: limit.retryAfter }, { 'Retry-After': String(limit.retryAfter) });

    if (!limits.api.take(ip).ok) return json(429, { error: 'Trop de requêtes. Patientez un instant.' });
    if (method !== 'GET' && !sameOrigin(req)) return json(403, { error: 'Requête refusée.' });

    const route = `${method} ${pathname}`;

    // — Public —

    if (route === 'GET /api/events') return events.open('public', req, res, { ip });

    // Sert au lanceur à reconnaître le site quand il tourne déjà sur cet ordinateur.
    if (route === 'GET /api/site') return json(200, { name: config.name });

    if (route === 'GET /api/next-slot') {
      const state = snapshot();
      return json(200, { slot: describeSlot(availability.nextSlot({ ...state, service: quickest }), state.now) });
    }

    if (route === 'GET /api/availability') {
      const service = serviceById(searchParams.get('service'));
      const date = searchParams.get('date');
      if (!service || !isValidDate(date)) return json(400, { error: 'Paramètres invalides.' });
      const mode = searchParams.get('salon') === '1' && auth.readSession(req) ? 'salon' : 'public';
      const { closed, slots } = availability.daySlots({ ...snapshot(), service, date, mode });
      return json(200, { date, closed, slots: slots.map(({ time, available }) => ({ time, available })) });
    }

    if (route === 'GET /api/availability/month') {
      const service = serviceById(searchParams.get('service'));
      const month = searchParams.get('month');
      if (!service || !isValidMonth(month)) return json(400, { error: 'Paramètres invalides.' });
      return json(200, { month, days: availability.monthSummary({ ...snapshot(), service, month }) });
    }

    if (route === 'POST /api/bookings') {
      const limit = [limits.booking.take(ip), limits.bookingGlobal.take('*')].find(state => !state.ok);
      if (limit) return tooMany(limit, 'Trop de demandes de réservation. Réessayez dans quelques minutes ou appelez le salon.');
      const body = await readJson(req);
      // Champ piège invisible : seuls les robots le remplissent.
      if (cleanText(body.website, 50)) return json(400, { error: 'Requête refusée.' });
      const result = bookings.create(body, { mode: 'public' });
      if (!result.ok) return reject(result);
      announce('created', result.booking);
      stats.booking();
      // « reminder » : la référence qui permet à ce client, et à lui seul, de demander un rappel.
      return json(201, { booking: bookings.publicView(result.booking), reminder: reminders.refFor(result.booking) });
    }

    // Rappel par notification : le client qui vient de réserver l'active (ou le retire) sur son appareil.
    if (route === 'POST /api/reminders' || route === 'DELETE /api/reminders') {
      const limit = limits.reminder.take(ip);
      if (!limit.ok) return tooMany(limit, 'Trop de demandes. Réessayez dans quelques minutes.');
      const body = await readJson(req);
      const result = method === 'POST'
        ? reminders.subscribe(body.ref, body.subscription)
        : reminders.unsubscribe(body.ref, String(body.endpoint || ''));
      if (!result.ok) return reject(result);
      return json(method === 'POST' ? 201 : 200, result);
    }

    // — Accès à l'espace salon —

    if (route === 'GET /api/salon/session') {
      return json(200, { configured: auth.isConfigured(), authenticated: Boolean(auth.readSession(req)) });
    }

    if (route === 'POST /api/salon/setup' || route === 'POST /api/salon/login') {
      const blocked = [limits.login.check(ip), limits.loginGlobal.check('*')].find(state => !state.ok);
      if (blocked) return tooMany(blocked, `Trop de tentatives. Réessayez dans ${Math.ceil(blocked.retryAfter / 60)} min.`);
      const body = await readJson(req);
      const result = route.endsWith('setup')
        ? await auth.setup(body.code, body.password)
        : await auth.login(body.password);
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          limits.login.hit(ip);
          limits.loginGlobal.hit('*');
          await delay(400); // ralentit les essais en série
        }
        return reject(result);
      }
      limits.login.reset(ip);
      const session = auth.createSession();
      return json(200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(session.token, secure) });
    }

    if (!pathname.startsWith('/api/salon/')) return json(404, { error: 'Adresse inconnue.' });

    // — Espace salon : session obligatoire à partir d'ici —

    const session = auth.readSession(req);
    if (!session) return json(401, { error: 'Session expirée. Reconnectez-vous.' });

    if (route === 'POST /api/salon/logout') {
      auth.destroySession(session.id);
      events.closeSalon(id => id === session.id);
      return json(200, { ok: true }, { 'Set-Cookie': auth.clearedCookie(secure) });
    }

    if (route === 'POST /api/salon/password') {
      const blocked = limits.login.check(ip);
      if (!blocked.ok) return tooMany(blocked, `Trop de tentatives. Réessayez dans ${Math.ceil(blocked.retryAfter / 60)} min.`);
      const body = await readJson(req);
      const result = await auth.changePassword(body.current, body.next);
      if (!result.ok) {
        if (result.status === 403) limits.login.hit(ip);
        return reject(result);
      }
      auth.destroyOtherSessions(session.id);
      events.closeSalon(id => id !== session.id);
      return json(200, { ok: true });
    }

    if (route === 'GET /api/salon/events') return events.open('salon', req, res, { ip, sessionId: session.id });

    // Fréquentation du site sur les 30 derniers jours (ou ?jours=7, 90…).
    if (route === 'GET /api/salon/stats') {
      const span = Math.min(366, Math.max(1, Number(searchParams.get('jours')) || 30));
      return json(200, stats.summary(span));
    }

    if (route === 'GET /api/salon/data') {
      const now = clock();
      return json(200, {
        today: now.date,
        nowMinutes: now.minutes,
        bookings: store.bookings.all(),
        closures: store.closures.all(),
      });
    }

    if (route === 'POST /api/salon/bookings') {
      const result = bookings.create(await readJson(req), { mode: 'salon' });
      if (!result.ok) return reject(result);
      announce('created', result.booking);
      return json(201, { booking: result.booking });
    }

    const bookingRoute = /^\/api\/salon\/bookings\/([\w-]{6,40})$/.exec(pathname);
    if (bookingRoute && method === 'PATCH') {
      const body = await readJson(req);
      const result = bookings.setStatus(bookingRoute[1], body.status);
      if (!result.ok) return reject(result);
      announce('updated', result.booking);
      return json(200, { booking: result.booking });
    }
    if (bookingRoute && method === 'DELETE') {
      const result = bookings.remove(bookingRoute[1]);
      if (!result.ok) return reject(result);
      reminders.forget(result.booking.id);
      announce('deleted', result.booking);
      return json(200, { ok: true });
    }

    // Une fermeture : un jour, ou une période entière (des congés) avec « until ».
    if (route === 'POST /api/salon/closures') {
      const body = await readJson(req);
      if (!isValidDate(body.date) || body.date < clock().date) return json(400, { error: 'Choisissez une date à venir.' });
      const until = body.until || body.date;
      if (!isValidDate(until) || until < body.date) return json(400, { error: 'La date de fin doit suivre la date de début.' });
      if (daysBetween(body.date, until) > 62) return json(400, { error: 'Une fermeture ne peut pas dépasser deux mois. Enregistrez-la en deux fois.' });
      const reason = cleanText(body.reason, 80);
      const added = [];
      for (let date = body.date; date <= until; date = addDays(date, 1)) added.push({ date, reason });
      store.closures.addMany(added);
      for (const closure of added) events.send('public', 'slots', { date: closure.date });
      events.send('salon', 'closures', { closures: store.closures.all() });
      return json(201, { closure: added[0], closures: store.closures.all() });
    }

    // Rouvrir un jour, ou toute une période avec ?until=AAAA-MM-JJ.
    const closureRoute = /^\/api\/salon\/closures\/(\d{4}-\d{2}-\d{2})$/.exec(pathname);
    if (closureRoute && method === 'DELETE') {
      const from = closureRoute[1];
      const until = searchParams.get('until') || from;
      if (!isValidDate(from) || !isValidDate(until) || until < from) return json(400, { error: 'Période invalide.' });
      const reopened = store.closures.removeRange(from, until);
      if (!reopened.length) return json(404, { error: 'Fermeture introuvable.' });
      for (const date of reopened) events.send('public', 'slots', { date });
      events.send('salon', 'closures', { closures: store.closures.all() });
      return json(200, { ok: true, closures: store.closures.all() });
    }

    return json(404, { error: 'Adresse inconnue.' });
  }

  // ── Pages ──────────────────────────────────────────────────────────────

  function robots(origin) {
    return `${['User-agent: *', 'Allow: /', 'Disallow: /salon', 'Disallow: /api/', '', `Sitemap: ${origin}/sitemap.xml`].join('\n')}\n`;
  }

  /**
   * Fiche « application » : sur téléphone, « Ajouter à l'écran d'accueil » donne une icône
   * qui ouvre directement le site (ou l'espace salon, pour la coiffeuse).
   */
  function manifest(salon) {
    return JSON.stringify({
      name: salon ? `Espace salon · ${config.name}` : config.name,
      short_name: salon ? 'Mes rendez-vous' : config.name,
      lang: 'fr',
      start_url: salon ? '/salon' : '/',
      display: 'standalone',
      background_color: '#f5eee1',
      theme_color: '#f5eee1',
      icons: [
        { src: '/img/icone-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/img/icone-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/img/icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    });
  }

  // Date de la dernière mise à jour du contenu : celle du fichier de configuration du salon.
  const lastModified = (() => {
    try {
      return fs.statSync(path.join(__dirname, '..', 'salon.config.js')).mtime.toISOString().slice(0, 10);
    } catch {
      return clock().date;
    }
  })();

  function sitemap(origin) {
    const urls = views.publicPaths.map(p => `  <url><loc>${origin}${p === '/' ? '/' : p}</loc><lastmod>${lastModified}</lastmod></url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  }

  async function page(req, res, url) {
    let pathname = url.pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(req, res, 405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' }, 'Méthode non autorisée');
    }
    if (pathname.length > 1 && pathname.endsWith('/')) {
      res.writeHead(308, { Location: pathname.replace(/\/+$/, '') + url.search });
      return res.end();
    }
    if (pathname === '/robots.txt') return send(req, res, 200, { 'Content-Type': 'text/plain; charset=utf-8' }, robots(originOf(req)));
    if (pathname === '/sitemap.xml') return send(req, res, 200, { 'Content-Type': 'application/xml; charset=utf-8' }, sitemap(originOf(req)));
    if (pathname === '/site.webmanifest' || pathname === '/salon.webmanifest') {
      return send(req, res, 200, { 'Content-Type': 'application/manifest+json; charset=utf-8' }, manifest(pathname === '/salon.webmanifest'));
    }

    const render = views.pages[pathname];
    if (render) {
      const salon = pathname === '/salon';
      // Une visite du site (pas de l'espace salon, ni de la coiffeuse connectée) : on la compte.
      if (!salon && req.method === 'GET' && !auth.readSession(req)) {
        stats.view({
          path: pathname,
          referrer: req.headers.referer,
          userAgent: req.headers['user-agent'],
          ip: clientIp(req, config.trustProxy),
          host: req.headers.host,
          // « Ne pas me suivre » demandé par le navigateur, ou page préchargée sans être vue.
          optOut: req.headers.dnt === '1' || req.headers['sec-gpc'] === '1' || /prefetch|prerender/.test(`${req.headers.purpose || ''}${req.headers['sec-purpose'] || ''}`),
        });
      }
      const headers = salon ? { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } : {};
      return sendHtml(req, res, 200, render(siteContext(pathname, req)), headers);
    }
    if (await serveStatic(req, res, pathname, { versioned: url.searchParams.has('v') })) return undefined;
    return sendHtml(req, res, 404, views.notFound(siteContext(pathname, req)), { 'X-Robots-Tag': 'noindex' });
  }

  /**
   * En ligne (derrière le serveur frontal qui porte le certificat) : tout passe en HTTPS, et sur
   * une seule adresse, celle de salon.config.js. Sans cela, « http:// » et « www. » feraient
   * exister le site en double pour les moteurs de recherche.
   */
  function canonicalRedirect(req) {
    if (!config.trustProxy) return '';
    const host = req.headers.host || '';
    // Une requête faite sur la machine elle-même (surveillance, lanceur) n'est pas un visiteur.
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return '';
    const wanted = config.siteUrl ? new URL(config.siteUrl) : null;
    const insecure = req.headers['x-forwarded-proto'] === 'http';
    if (wanted && wanted.host !== host) return `${wanted.origin}${req.url}`;
    if (insecure && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return `https://${host}${req.url}`;
    return '';
  }

  async function handle(req, res) {
    applySecurityHeaders(req, res, config);
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendJson(req, res, 400, { error: 'Adresse invalide.' });
    }
    const redirect = canonicalRedirect(req);
    if (redirect) {
      res.writeHead(308, { Location: redirect, 'Cache-Control': 'public, max-age=3600' });
      return res.end();
    }
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return await page(req, res, url);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return sendJson(req, res, err.status, { error: err.message }, { Connection: 'close' });
      console.error(`[erreur] ${req.method} ${url.pathname}`, err);
      if (url.pathname.startsWith('/api/')) return sendJson(req, res, 500, { error: 'Erreur du serveur. Réessayez dans un instant.' });
      return send(req, res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Erreur du serveur. Réessayez dans un instant.');
    }
  }

  // ── Entretien ──────────────────────────────────────────────────────────

  bookings.purgeOld();
  const housekeeping = setInterval(() => {
    bookings.purgeOld();
    auth.sweep();
    Object.values(limits).forEach(limiter => limiter.sweep());
  }, 60 * 60_000);
  housekeeping.unref();

  // Chaque minute : les rappels arrivés à échéance partent.
  const reminding = setInterval(() => {
    reminders.tick().catch(err => console.error('[rappels]', err));
  }, 60_000);
  reminding.unref();

  function close() {
    stats.close();
    clearInterval(housekeeping);
    clearInterval(reminding);
    events.close();
  }

  return { handle, close, auth, events, reminders, stats };
}

module.exports = { createApp };
