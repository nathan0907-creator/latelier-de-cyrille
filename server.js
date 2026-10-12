'use strict';

const http = require('node:http');
const os = require('node:os');
const { loadConfig } = require('./src/config');
const { createStore } = require('./src/store');
const { createApp } = require('./src/app');
const { findRunningSite, listenOnFreePort, openBrowser } = require('./src/launch');

// « node server.js --open » (ou un double-clic sur « Ouvrir le site.bat ») :
// le site démarre puis s'ouvre tout seul dans le navigateur.
const openWhenReady = process.argv.includes('--open');

/** Code de sortie « le site tournait déjà » : le lanceur ferme alors sa fenêtre sans attendre. */
const ALREADY_RUNNING = 2;

const line = (text = '') => console.log(`  ${text}`);

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`\n  Démarrage impossible : ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  // Le site tourne déjà (deuxième double-clic, par exemple) : on ne lance pas un second serveur,
  // qui écrirait dans les mêmes fichiers de rendez-vous. On rouvre simplement le site.
  const running = await findRunningSite(config);
  if (running) {
    console.log(`\n  ${config.name} tourne déjà : ${running}\n`);
    if (openWhenReady) openBrowser(running);
    process.exitCode = ALREADY_RUNNING;
    return;
  }

  let store;
  try {
    store = createStore(config.dataDir);
  } catch (err) {
    console.error(`\n  Démarrage impossible : ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const app = createApp({ config, store });
  const server = http.createServer(app.handle);

  let port;
  try {
    port = await listenOnFreePort(server, { port: config.port, host: config.host, fixed: config.portFixed });
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(`\n  Le port ${config.port} est déjà utilisé par un autre programme.`);
    console.error('  Fermez-le, ou choisissez un autre port :  set PORT=3005  puis  node server.js\n');
    process.exitCode = 1;
    return;
  }

  const local = `http://localhost:${port}`;
  console.log('');
  line(`${config.name} — le site est en marche`);
  line('');
  line(`Site          ${local}/`);
  line(`Réservation   ${local}/reservation`);
  line(`Espace salon  ${local}/salon`);

  const lan = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal);
  if (lan.length && config.host === '0.0.0.0') {
    line('');
    line('Sur un téléphone connecté au même Wi-Fi :');
    for (const { address } of lan) line(`              http://${address}:${port}/`);
  }

  const code = app.auth.setupCode();
  if (code) {
    line('');
    line('┌───────────────────────────────────────────────────────────┐');
    line("│  Première utilisation de l'espace salon                   │");
    line(`│  Code de configuration :  ${code}                       │`);
    line('│  Ouvrez /salon, saisissez ce code et créez le mot de      │');
    line("│  passe de la coiffeuse. Le code ne sert qu'une fois.      │");
    line('└───────────────────────────────────────────────────────────┘');
  }

  line('');
  line('Gardez cette fenêtre ouverte : la fermer arrête le site.');
  console.log('');

  if (openWhenReady) openBrowser(`${local}/`);

  const shutdown = () => {
    app.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
