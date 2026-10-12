'use strict';

/**
 * Prépare la publication sur Cloudflare. Lancé tout seul par « wrangler deploy » et « wrangler dev »
 * (voir wrangler.jsonc), avant l'envoi du site.
 *
 * En ligne, le site ne lit aucun fichier du dossier : ce que le serveur y lit d'habitude au démarrage
 * est calculé ici, une fois pour toutes, et rangé dans cloudflare/generated/site.json :
 *   - salon.config.js, vérifié comme au démarrage du serveur (une erreur arrête la publication) ;
 *   - les dimensions des photos et leurs versions réduites ;
 *   - l'empreinte des styles et des scripts.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { loadConfig } = require('../src/config');

const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'generated', 'site.json');

let config;
try {
  // En ligne, le site est toujours derrière Cloudflare : HTTPS forcé, une seule adresse (TRUST_PROXY).
  config = loadConfig(require('../salon.config.js'), { TRUST_PROXY: '1' });
} catch (err) {
  console.error(`\n  Publication impossible : ${err.message}\n`);
  process.exit(1);
}

// Empreinte des styles et des scripts, d'après leur contenu : elle ne change que s'ils changent.
const hash = crypto.createHash('sha256');
for (const dir of ['css', 'js']) {
  for (const name of fs.readdirSync(path.join(config.publicDir, dir)).sort()) {
    hash.update(`${dir}/${name}:`).update(fs.readFileSync(path.join(config.publicDir, dir, name)));
  }
}

// Dernière mise à jour du contenu (plan du site) : le dernier changement enregistré de salon.config.js.
let updated = config.updated;
try {
  const options = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
  updated = execFileSync('git', ['log', '-1', '--format=%cs', '--', 'salon.config.js'], options).trim() || updated;
} catch { /* pas de git : la date du fichier */ }

// Les dossiers de cet ordinateur n'ont pas de sens en ligne.
const site = {
  config: { ...config, updated, dataDir: '', publicDir: '' },
  version: hash.digest('base64url').slice(0, 10),
};
const text = `${JSON.stringify(site, null, 2)}\n`;
let previous = '';
try {
  previous = fs.readFileSync(out, 'utf8');
} catch { /* première fois */ }
if (text !== previous) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
}
console.log(`  ${config.name} : prêt pour Cloudflare.`);
