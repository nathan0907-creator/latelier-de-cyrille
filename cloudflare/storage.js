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
 * Les photos déposées depuis l'espace salon vont dans une seconde table, une ligne par fichier
 * (le site les réduit avant l'envoi : chacune tient largement sous la limite de 2 Mo).
 */
function sqlBackend(sql, transaction = run => run()) {
  sql.exec('CREATE TABLE IF NOT EXISTS donnees (nom TEXT NOT NULL, morceau INTEGER NOT NULL, valeur TEXT NOT NULL, PRIMARY KEY (nom, morceau))');
  sql.exec('CREATE TABLE IF NOT EXISTS photos (nom TEXT NOT NULL PRIMARY KEY, octets BLOB NOT NULL)');
  return {
    readBlob(name) {
      const [row] = sql.exec('SELECT octets FROM photos WHERE nom = ?', name).toArray();
      return row ? Buffer.from(row.octets) : null;
    },
    writeBlob(name, bytes) {
      // Les octets seuls, sans le reste de la mémoire tampon dont ils peuvent faire partie.
      sql.exec('INSERT OR REPLACE INTO photos (nom, octets) VALUES (?, ?)', name, new Uint8Array(bytes).buffer);
    },
    removeBlob(name) {
      sql.exec('DELETE FROM photos WHERE nom = ?', name);
    },
    listBlobs: () => sql.exec('SELECT nom FROM photos ORDER BY nom').toArray().map(row => row.nom),
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
