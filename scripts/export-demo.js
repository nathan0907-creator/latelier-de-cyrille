'use strict';

/**
 * Fabrique la démonstration en ligne du site (GitHub Pages).
 *
 * Un hébergement de simples fichiers ne peut pas faire tourner le serveur du salon. La démonstration
 * est donc une copie figée des pages publiques, avec une réservation « pour de faux » : les créneaux
 * sont calculés dans le navigateur avec les vraies règles du salon (src/time.js et src/availability.js),
 * et rien n'est enregistré nulle part. L'espace de la coiffeuse n'en fait pas partie.
 *
 *   node scripts/export-demo.js [dossier de sortie] [--base=/nom-du-depot]
 *
 * --base : le dossier sous lequel le site sera servi (« /nom-du-depot » sur GitHub Pages).
 */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const out = path.resolve(args.find(arg => !arg.startsWith('--')) || path.join(root, '_site'));
const base = (args.find(arg => arg.startsWith('--base=')) || '--base=').slice(7).replace(/\/+$/, '');

// Les données du salon ne sont jamais lues : la démonstration démarre sur un dossier vide.
const env = { ...process.env, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'demo-')) };
const { loadConfig } = require('../src/config');
const { createStore } = require('../src/store');
const { createApp } = require('../src/app');

const config = loadConfig(require('../salon.config.js'), env);

// Les pages du site → les fichiers de la démonstration.
const PAGES = ['prestations', 'galerie', 'reservation', 'nous-trouver', 'mentions-legales'];
const FILES = [
  ['/', 'index.html'],
  ...PAGES.map(page => [`/${page}`, `${page}/index.html`]),
  ['/page-introuvable', '404.html'],
];

const BANNER = 'Démonstration · les rendez-vous pris ici ne sont pas enregistrés';

/** Fait pointer liens et fichiers vers le dossier de la démonstration, et y ajoute ce qui lui est propre. */
function adapt(html) {
  return html
    .replace(/<link rel="manifest"[^>]*>\n?/, '')
    // L'espace de la coiffeuse n'existe pas dans la démonstration.
    .replace(/\s*<li><a href="\/salon">[^<]*<\/a><\/li>/, '')
    .replace(/(\s(?:href|src|action|content|data-full|data-image)=")\/(?!\/)([^"]*)"/g, (all, attribute, rest) => {
      const [, file, tail] = /^([^?#]*)(.*)$/.exec(rest);
      const target = file === '' ? '' : PAGES.includes(file) ? `${file}/` : file;
      return `${attribute}${base}/${target}${tail}"`;
    })
    .replace('<title>', '<title>Démo · ')
    .replace('</head>', `<meta name="robots" content="noindex, nofollow">\n<link rel="stylesheet" href="${base}/css/demo.css">\n</head>`)
    .replace(/(<body[^>]*>)/, `$1\n<p class="demo-banner" role="note">${BANNER}</p>`)
    // Avant les scripts du site : la fausse réservation doit être en place quand ils démarrent.
    .replace('<script type="module"', `<script src="${base}/js/demo.js"></script>\n<script type="module"`);
}

/** Le « serveur » de la démonstration, qui tourne dans le navigateur. */
function demoScript() {
  const source = file => fs.readFileSync(path.join(root, 'src', file), 'utf8').replace(/^'use strict';\s*/, '');
  const settings = {
    timezone: config.timezone,
    hours: config.hours,
    booking: config.booking,
    services: config.services.map(({ id, name, duration, price, priceFrom }) => ({ id, name, duration, price, priceFrom })),
  };
  return `// Démonstration : le serveur du salon est remplacé par ce script. Les créneaux sont calculés ici,
// avec les mêmes règles que sur le vrai site ; les rendez-vous ne quittent pas cet onglet.
// (Fichier fabriqué par scripts/export-demo.js : ne pas le modifier à la main.)
(function () {
  'use strict';

  var modules = {
    './time': function (module, exports, require) {
${source('time.js')}
    },
    './availability': function (module, exports, require) {
${source('availability.js')}
    },
  };
  var loaded = {};
  function load(name) {
    if (!loaded[name]) {
      loaded[name] = { exports: {} };
      modules[name](loaded[name], loaded[name].exports, load);
    }
    return loaded[name].exports;
  }

  var time = load('./time');
  var availability = load('./availability');
  var config = ${JSON.stringify(settings)};
  var quickest = config.services.reduce(function (a, b) { return b.duration < a.duration ? b : a; });
  var KEY = 'demo-rendez-vous';

  function bookings() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY)) || [];
    } catch (error) {
      return [];
    }
  }

  function snapshot() {
    return { config: config, bookings: bookings(), closures: [], now: time.nowInZone(config.timezone) };
  }

  function nextSlot() {
    var state = snapshot();
    var slot = availability.nextSlot(Object.assign({}, state, { service: quickest }));
    if (!slot) return null;
    var offset = time.daysBetween(state.now.date, slot.date);
    var day = offset === 0 ? "aujourd'hui" : offset === 1 ? 'demain' : time.formatShort(slot.date);
    return { date: slot.date, time: slot.time, label: day + ' à ' + time.frTime(slot.start) };
  }

  function reply(status, data) {
    return Promise.resolve(new Response(JSON.stringify(data), { status: status, headers: { 'Content-Type': 'application/json' } }));
  }

  function book(body) {
    var state = snapshot();
    var service = config.services.find(function (s) { return s.id === body.serviceId; });
    var start = time.toMinutes(body.time);
    if (!service || !time.isValidDate(body.date) || start === null) return reply(400, { error: 'Demande invalide.' });

    var fields = {};
    var name = String(body.name || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
    if (!/^\\p{L}[\\p{L}\\p{M}'’ .-]{1,59}$/u.test(name)) fields.name = 'Indiquez un prénom et un nom (lettres uniquement).';
    if (!/^\\+?\\d{9,15}$/.test(String(body.phone || '').replace(/[\\s.\\-()]/g, ''))) fields.phone = 'Indiquez un numéro valide, par exemple 06 12 34 56 78.';
    if (Object.keys(fields).length) return reply(400, { error: 'Vérifiez les informations saisies.', fields: fields });

    var problem = availability.slotProblem(Object.assign({}, state, { service: service, date: body.date, start: start, mode: 'public' }));
    if (problem === 'taken') return reply(409, { error: "Ce créneau vient d'être réservé. Choisissez-en un autre.", code: 'slot_taken' });
    if (problem) return reply(409, { error: "Ce créneau n'est plus disponible.", code: 'slot_unavailable' });

    // Le rendez-vous reste dans cet onglet : rien n'est envoyé, ni le nom ni le téléphone.
    var kept = state.bookings.concat({ id: 'demo-' + Date.now(), date: body.date, start: start, duration: service.duration, status: 'pending' });
    try {
      sessionStorage.setItem(KEY, JSON.stringify(kept));
    } catch (error) {
      // Stockage indisponible : la démonstration continue, le créneau ne sera simplement pas grisé.
    }
    return reply(201, {
      booking: {
        date: body.date, time: time.fromMinutes(start), end: time.fromMinutes(start + service.duration),
        serviceName: service.name, duration: service.duration, price: service.price, priceFrom: service.priceFrom, name: name,
      },
    });
  }

  function answer(method, url, body) {
    var state = snapshot();
    var service = config.services.find(function (s) { return s.id === url.searchParams.get('service'); });
    if (url.pathname === '/api/next-slot') return reply(200, { slot: nextSlot() });
    if (url.pathname === '/api/availability') {
      var date = url.searchParams.get('date');
      if (!service || !time.isValidDate(date)) return reply(400, { error: 'Paramètres invalides.' });
      var day = availability.daySlots(Object.assign({}, state, { service: service, date: date }));
      return reply(200, { date: date, closed: day.closed, slots: day.slots.map(function (s) { return { time: s.time, available: s.available }; }) });
    }
    if (url.pathname === '/api/availability/month') {
      var month = url.searchParams.get('month');
      if (!service || !time.isValidMonth(month)) return reply(400, { error: 'Paramètres invalides.' });
      return reply(200, { month: month, days: availability.monthSummary(Object.assign({}, state, { service: service, month: month })) });
    }
    if (url.pathname === '/api/bookings' && method === 'POST') return book(body || {});
    return reply(404, { error: 'Adresse inconnue.' });
  }

  // Les appels au serveur du salon sont servis ici ; tout le reste passe normalement.
  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || url.pathname.indexOf('/api/') !== 0) return realFetch.apply(this, arguments);
    var body = null;
    try {
      body = init && init.body ? JSON.parse(init.body) : null;
    } catch (error) {
      body = null;
    }
    return answer(((init && init.method) || 'GET').toUpperCase(), url, body);
  };

  // Pas de serveur, donc pas de mises à jour « en direct ».
  window.EventSource = function () {
    this.addEventListener = function () {};
    this.close = function () {};
  };

  // Les pages ont été figées à la fabrication : on remet à l'heure ce qui dépend du moment.
  var now = time.nowInZone(config.timezone);
  var data = document.getElementById('page-data');
  if (data) {
    try {
      var content = JSON.parse(data.textContent);
      if (content.today) {
        content.today = now.date;
        content.lastDate = availability.lastBookableDate(config, now.date);
        data.textContent = JSON.stringify(content);
      }
    } catch (error) {
      // Données de page illisibles : la page garde celles de la fabrication.
    }
  }

  var slot = nextSlot();
  document.querySelectorAll('[data-next-slot-label]').forEach(function (label) {
    label.textContent = slot ? slot.label : 'voir les disponibilités';
  });

  var status = availability.openStatus({ config: config, closures: [], now: now });
  var text = 'Fermé';
  if (status.open) text = "Ouvert jusqu'à " + time.frTime(status.until);
  else if (status.date) {
    var when = status.offset === 0 ? '' : status.offset === 1 ? 'demain ' : time.WEEKDAYS[time.weekday(status.date)] + ' ';
    text = 'Fermé · ouvre ' + when + 'à ' + time.frTime(status.at);
  }
  document.querySelectorAll('.open-badge').forEach(function (badge) {
    badge.classList.toggle('is-open', status.open);
    badge.classList.toggle('is-closed', !status.open);
    badge.lastChild.textContent = text;
  });

  // Sur la confirmation, on redit que rien n'a été enregistré.
  var done = document.querySelector('[data-step="done"] h2');
  if (done) {
    var note = document.createElement('p');
    note.className = 'notice';
    note.textContent = "Démonstration : ce rendez-vous n'a pas été enregistré. Sur le vrai site, il arriverait dans l'agenda de la coiffeuse.";
    done.after(note);
  }
})();
`;
}

const DEMO_CSS = `/* Démonstration en ligne : le bandeau qui prévient, et la place qu'il prend en haut de page.
   (Fichier fabriqué par scripts/export-demo.js.) */

:root {
  --demo-h: 2rem;
}

html {
  scroll-padding-top: calc(var(--header-h) + var(--demo-h) + 1rem);
}

.demo-banner {
  position: fixed;
  inset: 0 0 auto;
  z-index: 120;
  display: grid;
  place-items: center;
  height: var(--demo-h);
  margin: 0;
  padding-inline: .5rem;
  overflow: hidden;
  background: var(--ink);
  color: #fff;
  font-family: var(--font-label);
  font-size: .86rem;
  font-weight: 700;
  letter-spacing: .04em;
  line-height: 1.1;
  text-align: center;
  text-transform: uppercase;
  white-space: nowrap;
}

.site-header,
.scroll-progress {
  top: var(--demo-h);
}

.une,
.page {
  padding-top: calc(var(--header-h) + var(--demo-h));
}

@media (max-width: 62rem) {
  .site-nav {
    padding-top: calc(var(--header-h) + var(--demo-h) + 1.5rem);
  }
}

@media (max-width: 26rem) {
  .demo-banner {
    font-size: .74rem;
    letter-spacing: 0;
  }
}
`;

async function main() {
  const app = createApp({ config, store: createStore(config.dataDir) });
  const server = http.createServer(app.handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(config.publicDir, out, { recursive: true });
  fs.rmSync(path.join(out, 'js', 'salon.js'), { force: true });
  fs.rmSync(path.join(out, 'css', 'salon.css'), { force: true });

  for (const [url, file] of FILES) {
    const response = await fetch(origin + url);
    const target = path.join(out, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, adapt(await response.text()));
  }

  // L'image de secours est le seul fichier que les scripts du site appellent par son chemin.
  const siteJs = path.join(out, 'js', 'site.js');
  fs.writeFileSync(siteJs, fs.readFileSync(siteJs, 'utf8').replace("'/img/placeholder.svg'", `'${base}/img/placeholder.svg'`));

  fs.writeFileSync(path.join(out, 'js', 'demo.js'), demoScript());
  fs.writeFileSync(path.join(out, 'css', 'demo.css'), DEMO_CSS);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');

  app.close?.();
  server.close();
  fs.rmSync(env.DATA_DIR, { recursive: true, force: true });
  console.log(`Démonstration écrite dans ${out} (${FILES.length} pages, adresse de base « ${base || '/'} »).`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
