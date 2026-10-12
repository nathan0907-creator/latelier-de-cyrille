'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    // Un fichier abîmé ne doit jamais être écrasé en silence.
    throw new Error(`Fichier de données illisible : ${file} (${err.message})`);
  }
}

/** Écrit dans un fichier temporaire puis le renomme : jamais de fichier à moitié écrit. */
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows : la cible peut être verrouillée un court instant (antivirus, sauvegarde).
    fs.copyFileSync(tmp, file);
    fs.unlinkSync(tmp);
  }
}

/** Stockage du salon : rendez-vous, fermetures, rappels et compte de la coiffeuse, dans des fichiers JSON. */
function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const files = {
    bookings: path.join(dataDir, 'rendez-vous.json'),
    closures: path.join(dataDir, 'fermetures.json'),
    admin: path.join(dataDir, 'compte.json'),
    reminders: path.join(dataDir, 'rappels.json'),
    stats: path.join(dataDir, 'frequentation.json'),
  };
  const state = {
    bookings: readJson(files.bookings, []),
    closures: readJson(files.closures, []),
    admin: readJson(files.admin, null),
    reminders: readJson(files.reminders, { identity: null, list: [] }),
    stats: readJson(files.stats, {}),
  };
  const save = key => writeJsonAtomic(files[key], state[key]);

  return {
    bookings: {
      all: () => state.bookings,
      get: id => state.bookings.find(b => b.id === id) || null,
      add(booking) {
        state.bookings.push(booking);
        save('bookings');
        return booking;
      },
      update(id, patch) {
        const booking = state.bookings.find(b => b.id === id);
        if (!booking) return null;
        Object.assign(booking, patch);
        save('bookings');
        return booking;
      },
      remove(id) {
        const index = state.bookings.findIndex(b => b.id === id);
        if (index === -1) return null;
        const [removed] = state.bookings.splice(index, 1);
        save('bookings');
        return removed;
      },
      removeWhere(predicate) {
        const before = state.bookings.length;
        state.bookings = state.bookings.filter(b => !predicate(b));
        if (state.bookings.length !== before) save('bookings');
        return before - state.bookings.length;
      },
    },
    closures: {
      all: () => state.closures,
      add(closure) {
        state.closures = state.closures.filter(c => c.date !== closure.date);
        state.closures.push(closure);
        state.closures.sort((a, b) => a.date.localeCompare(b.date));
        save('closures');
        return closure;
      },
      /** Plusieurs jours d'un coup (des congés) : un seul enregistrement sur le disque. */
      addMany(list) {
        const dates = new Set(list.map(c => c.date));
        state.closures = [...state.closures.filter(c => !dates.has(c.date)), ...list];
        state.closures.sort((a, b) => a.date.localeCompare(b.date));
        save('closures');
        return list;
      },
      remove(date) {
        const before = state.closures.length;
        state.closures = state.closures.filter(c => c.date !== date);
        if (state.closures.length !== before) save('closures');
        return before !== state.closures.length;
      },
      /** Rouvre tous les jours fermés entre deux dates incluses ; renvoie les dates rouvertes. */
      removeRange(from, to) {
        const removed = state.closures.filter(c => c.date >= from && c.date <= to).map(c => c.date);
        if (removed.length) {
          state.closures = state.closures.filter(c => c.date < from || c.date > to);
          save('closures');
        }
        return removed;
      },
    },
    /** Rappels par notification : les clés du serveur et les abonnements en attente. */
    reminders: {
      identity: () => state.reminders.identity,
      setIdentity(identity) {
        state.reminders.identity = identity;
        save('reminders');
      },
      all: () => state.reminders.list,
      /** Un abonnement par rendez-vous et par appareil : le nouveau remplace l'ancien. */
      put(record) {
        state.reminders.list = state.reminders.list.filter(r => r.bookingId !== record.bookingId || r.endpoint !== record.endpoint);
        state.reminders.list.push(record);
        save('reminders');
        return record;
      },
      update(record, patch) {
        Object.assign(record, patch);
        save('reminders');
        return record;
      },
      removeWhere(predicate) {
        const before = state.reminders.list.length;
        state.reminders.list = state.reminders.list.filter(r => !predicate(r));
        if (state.reminders.list.length !== before) save('reminders');
        return before - state.reminders.list.length;
      },
    },
    /** Fréquentation : un compteur par jour (voir src/stats.js), modifié sur place puis enregistré. */
    stats: {
      days: () => state.stats,
      save: () => save('stats'),
    },
    admin: {
      get: () => state.admin,
      set(record) {
        state.admin = record;
        save('admin');
      },
    },
  };
}

module.exports = { createStore };
