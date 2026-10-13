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

/** Le nom de fichier de chaque sorte de données, dans data/. */
const FILES = {
  bookings: 'rendez-vous.json',
  closures: 'fermetures.json',
  admin: 'compte.json',
  sessions: 'sessions.json',
  reminders: 'rappels.json',
  stats: 'frequentation.json',
  settings: 'reglages.json',
  holidays: 'jours-feries.json',
  clients: 'clients.json',
  salonDevices: 'appareils-salon.json',
};

/** Le dossier des photos déposées depuis l'espace salon, dans data/. */
const MEDIA_DIR = 'photos';

/** Les données dans des fichiers JSON, un par sorte de données (sur l'ordinateur du salon). */
function fileBackend(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = key => path.join(dataDir, FILES[key]);
  const media = name => path.join(dataDir, MEDIA_DIR, path.basename(name));
  return {
    read: (key, fallback) => readJson(file(key), fallback),
    write: (key, data) => writeJsonAtomic(file(key), data),
    // Les photos déposées : un fichier chacune, dans data/photos/.
    readBlob(name) {
      try {
        return fs.readFileSync(media(name));
      } catch {
        return null;
      }
    },
    writeBlob(name, bytes) {
      fs.mkdirSync(path.join(dataDir, MEDIA_DIR), { recursive: true });
      fs.writeFileSync(media(name), bytes);
    },
    removeBlob: name => fs.rmSync(media(name), { force: true }),
    listBlobs() {
      try {
        return fs.readdirSync(path.join(dataDir, MEDIA_DIR));
      } catch {
        return [];
      }
    },
  };
}

/**
 * Stockage du salon : rendez-vous, fermetures, rappels, réglages, compte et sessions de la coiffeuse.
 * Tout est gardé en mémoire et enregistré à chaque changement : dans les fichiers de data/
 * (un dossier donné), ou ailleurs avec un autre « backend » ({ read, write } pour les données,
 * { readBlob, writeBlob, removeBlob, listBlobs } pour les photos : voir cloudflare/storage.js).
 */
function createStore(target) {
  const backend = typeof target === 'string' ? fileBackend(target) : target;
  const state = {
    bookings: backend.read('bookings', []),
    closures: backend.read('closures', []),
    admin: backend.read('admin', null),
    sessions: backend.read('sessions', {}),
    reminders: backend.read('reminders', { identity: null, list: [] }),
    stats: backend.read('stats', {}),
    settings: backend.read('settings', null),
    holidays: backend.read('holidays', null),
    clients: backend.read('clients', {}),
    salonDevices: backend.read('salonDevices', []),
  };
  const save = key => backend.write(key, state[key]);

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
    /** Réglages faits depuis l'espace salon : prestations, horaires, photos (voir src/settings.js). */
    settings: {
      get: () => state.settings,
      set(record) {
        state.settings = record;
        save('settings');
      },
    },
    /** Les appareils de la coiffeuse qui reçoivent les alertes (nouvelle demande, annulation), même site fermé. */
    salonDevices: {
      all: () => state.salonDevices,
      put(device) {
        state.salonDevices = [...state.salonDevices.filter(d => d.endpoint !== device.endpoint), device].slice(-5);
        save('salonDevices');
      },
      remove(endpoint) {
        const before = state.salonDevices.length;
        state.salonDevices = state.salonDevices.filter(d => d.endpoint !== endpoint);
        if (state.salonDevices.length !== before) save('salonDevices');
      },
    },
    /** Jours fériés : fermeture automatique ou non, et ceux que la coiffeuse a choisi d'ouvrir. */
    holidays: {
      get: () => state.holidays,
      set(record) {
        state.holidays = record;
        save('holidays');
      },
    },
    /** Fichier clients : la note de la coiffeuse et le « ne plus reprendre », par clé de fiche (voir src/clients.js). */
    clients: {
      all: () => state.clients,
      /** Enregistre une fiche, ou l'efface (record nul). */
      set(key, record) {
        if (record) state.clients[key] = record;
        else delete state.clients[key];
        save('clients');
      },
      removeWhere(predicate) {
        const keys = Object.keys(state.clients).filter(key => predicate(key, state.clients[key]));
        for (const key of keys) delete state.clients[key];
        if (keys.length) save('clients');
        return keys.length;
      },
    },
    /** Photos déposées depuis l'espace salon : lues à la demande, jamais gardées en mémoire. */
    media: {
      read: name => backend.readBlob(name),
      write: (name, bytes) => backend.writeBlob(name, bytes),
      remove: name => backend.removeBlob(name),
      list: () => backend.listBlobs(),
    },
    admin: {
      get: () => state.admin,
      set(record) {
        state.admin = record;
        save('admin');
      },
    },
    /** Sessions de l'espace salon, rangées par empreinte du jeton : elles survivent à un redémarrage. */
    sessions: {
      get: id => (Object.hasOwn(state.sessions, id) ? state.sessions[id] : null),
      set(id, session) {
        state.sessions[id] = session;
        save('sessions');
      },
      removeWhere(predicate) {
        const ids = Object.keys(state.sessions).filter(id => predicate(id, state.sessions[id]));
        for (const id of ids) delete state.sessions[id];
        if (ids.length) save('sessions');
        return ids.length;
      },
    },
  };
}

module.exports = { createStore, FILES };
