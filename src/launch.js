'use strict';

const { spawn } = require('node:child_process');

/** Nombre de ports essayés à la suite quand le premier est occupé. */
const PORT_ATTEMPTS = 10;

/**
 * Le site tourne-t-il déjà sur cet ordinateur ? Renvoie son adresse, ou null.
 * On le reconnaît à son nom : un autre programme sur le même port est ignoré.
 */
async function findRunningSite(config) {
  const last = config.portFixed ? config.port : config.port + PORT_ATTEMPTS;
  for (let port = config.port; port <= last; port++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/site`, { signal: AbortSignal.timeout(400) });
      if (!response.ok) continue;
      const site = await response.json();
      if (site && site.name === config.name) return `http://localhost:${port}/`;
    } catch {
      // Rien n'écoute sur ce port, ou ce n'est pas le site : on passe au suivant.
    }
  }
  return null;
}

/**
 * Démarre le serveur sur le port demandé, ou sur le premier port libre qui suit.
 * Si le port a été imposé (variable PORT), on n'en essaie pas d'autre.
 * Renvoie le port finalement utilisé.
 */
function listenOnFreePort(server, { port, host, fixed = false, attempts = PORT_ATTEMPTS }) {
  return new Promise((resolve, reject) => {
    let current = port;
    const onError = err => {
      if (err.code === 'EADDRINUSE' && !fixed && current < port + attempts) {
        current += 1;
        server.listen(current, host);
        return;
      }
      server.off('error', onError);
      reject(err);
    };
    server.on('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve(current);
    });
    server.listen(current, host);
  });
}

/** Ouvre l'adresse dans le navigateur par défaut. Sans effet si le système refuse. */
function openBrowser(url) {
  const [command, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Pas de navigateur disponible : l'adresse reste affichée dans la fenêtre.
  }
}

module.exports = { findRunningSite, listenOnFreePort, openBrowser, PORT_ATTEMPTS };
