'use strict';

// Mot de passe de la coiffeuse oublié : efface le compte de l'espace salon.
// Au prochain démarrage, le serveur affiche un nouveau code de configuration
// qui permet de choisir un nouveau mot de passe. Les rendez-vous ne sont pas touchés.
//
//   npm run reset-password
//
// À lancer serveur arrêté.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const file = path.join(dataDir, 'compte.json');

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
  console.log('  Mot de passe effacé. Relancez le serveur : il affichera un nouveau code de configuration.\n');
});
