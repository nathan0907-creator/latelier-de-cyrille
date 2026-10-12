'use strict';

// Mot de passe de la coiffeuse oublié : efface le compte de l'espace salon.
// Au prochain démarrage, le serveur affiche un nouveau code de configuration
// qui permet de choisir un nouveau mot de passe. Les rendez-vous ne sont pas touchés.
// Les appareils connectés à l'espace salon sont déconnectés.
//
// Site en ligne sur Cloudflare : ce script ne sert pas, voir « Mot de passe oublié » dans le README.
//
//   npm run reset-password
//
// À lancer serveur arrêté.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { FILES } = require('../src/store');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const file = path.join(dataDir, FILES.admin);
const sessions = path.join(dataDir, FILES.sessions);

if (!fs.existsSync(file)) {
  console.log("\n  Aucun mot de passe n'est enregistré : lancez le serveur, il affichera le code de configuration.\n");
  process.exit(0);
}

const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
prompt.question("\n  Effacer le mot de passe de l'espace salon ? Tapez OUI pour confirmer : ", answer => {
  prompt.close();
  if (answer.trim().toUpperCase() !== 'OUI') {
    console.log('  Rien n\'a été modifié.\n');
    return;
  }
  fs.unlinkSync(file);
  fs.rmSync(sessions, { force: true });
  console.log('  Mot de passe effacé. Relancez le serveur : il affichera un nouveau code de configuration.\n');
});
