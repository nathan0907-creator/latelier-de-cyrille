'use strict';

/**
 * Taille d'un morceau : Cloudflare limite une ligne de sa base à 2 Mo. Une sorte de données plus
 * grosse (beaucoup de rendez-vous, par exemple) est rangée sur plusieurs lignes.
 */
const CHUNK = 1_000_000;

/** JSON en caractères ASCII seulement (accents écrits « é ») : un caractère = un octet, coupable n'importe où. */
const asciiJson = data => JSON.stringify(data).replace(/[\u007f-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * Les données du salon dans la base SQLite d'un Durable Object Cloudflare : la même chose que les
 * fichiers JSON de data/, une ligne (ou quelques-unes) par sorte de données. S'utilise avec
 * createStore (src/store.js). sql : ctx.storage.sql ; transaction : ctx.storage.transactionSync.
 */
function sqlBackend(sql, transaction = run => run()) {
  sql.exec('CREATE TABLE IF NOT EXISTS donnees (nom TEXT NOT NULL, morceau INTEGER NOT NULL, valeur TEXT NOT NULL, PRIMARY KEY (nom, morceau))');
  return {
    read(key, fallback) {
      const rows = sql.exec('SELECT valeur FROM donnees WHERE nom = ? ORDER BY morceau', key).toArray();
      if (!rows.length) return fallback;
      try {
        return JSON.parse(rows.map(row => row.valeur).join(''));
      } catch (err) {
        // Des données abîmées ne doivent jamais être écrasées en silence.
        throw new Error(`Données illisibles : ${key} (${err.message})`);
      }
    },
    write(key, data) {
      const text = asciiJson(data);
      const parts = Math.max(1, Math.ceil(text.length / CHUNK));
      transaction(() => {
        for (let part = 0; part < parts; part++) {
          sql.exec('INSERT OR REPLACE INTO donnees (nom, morceau, valeur) VALUES (?, ?, ?)', key, part, text.slice(part * CHUNK, (part + 1) * CHUNK));
        }
        sql.exec('DELETE FROM donnees WHERE nom = ? AND morceau >= ?', key, parts);
      });
    },
  };
}

module.exports = { sqlBackend, CHUNK };
