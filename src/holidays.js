'use strict';

const { addDays, weekday, pad2 } = require('./time');

/** Dimanche de Pâques d'une année, « AAAA-MM-JJ » (calcul de Meeus pour le calendrier grégorien). */
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Les onze jours fériés de France métropolitaine pour une année, dans l'ordre du calendrier. */
function holidaysOf(year) {
  const sunday = easter(year);
  return [
    [`${year}-01-01`, "Jour de l'An"],
    [addDays(sunday, 1), 'Lundi de Pâques'],
    [`${year}-05-01`, 'Fête du Travail'],
    [`${year}-05-08`, 'Victoire de 1945'],
    [addDays(sunday, 39), 'Ascension'],
    [addDays(sunday, 50), 'Lundi de Pentecôte'],
    [`${year}-07-14`, 'Fête nationale'],
    [`${year}-08-15`, 'Assomption'],
    [`${year}-11-01`, 'Toussaint'],
    [`${year}-11-11`, 'Armistice de 1918'],
    [`${year}-12-25`, 'Noël'],
  ].map(([date, name]) => ({ date, name })).sort((x, y) => x.date.localeCompare(y.date));
}

/** Les jours fériés entre deux dates incluses. */
function holidaysBetween(from, to) {
  const list = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    list.push(...holidaysOf(year).filter(day => day.date >= from && day.date <= to));
  }
  return list;
}

/**
 * Les jours fériés du salon. Par défaut, le salon est fermé ces jours-là, sans rien avoir à saisir ;
 * depuis son espace, la coiffeuse peut en ouvrir un (elle travaille ce jour-là) ou arrêter la
 * fermeture automatique. Un jour férié qui tombe un jour où le salon est de toute façon fermé
 * (un dimanche, par exemple) ne compte pas : il n'y a rien à annoncer ni à régler.
 */
function createHolidays({ config, store, clock }) {
  const prefs = () => ({ auto: true, open: [], ...store.holidays.get() });
  const worked = date => config.hours[weekday(date)].length > 0;

  /** Les prochains jours fériés qui tombent un jour travaillé, et ce qui est prévu pour chacun. */
  function upcoming(days = 370) {
    const { auto, open } = prefs();
    const today = clock().date;
    return holidaysBetween(today, addDays(today, days)).filter(day => worked(day.date))
      .map(day => ({ ...day, open: !auto || open.includes(day.date) }));
  }

  /**
   * Tous les jours fermés : ceux que la coiffeuse a saisis (congés…), plus les jours fériés à venir.
   * Une fermeture saisie garde son motif : des congés qui englobent Noël restent « congés ».
   */
  function closures() {
    const saved = store.closures.all();
    if (!prefs().auto) return saved;
    const taken = new Set(saved.map(closure => closure.date));
    // Aussi loin que la réservation est ouverte, et au moins quatre mois : le site annonce les
    // fermetures des trois mois à venir.
    const added = upcoming(Math.max(config.booking.maxDaysAhead + 1, 120))
      .filter(day => !day.open && !taken.has(day.date))
      .map(day => ({ date: day.date, reason: `Jour férié (${day.name})`, holiday: true }));
    return added.length ? [...saved, ...added].sort((x, y) => x.date.localeCompare(y.date)) : saved;
  }

  /** Fermeture automatique : oui ou non. */
  function setAuto(auto) {
    store.holidays.set({ ...prefs(), auto: Boolean(auto) });
  }

  /** Ouvrir (ou refermer) un jour férié précis. false si ce n'est pas un jour férié travaillé à venir. */
  function setOpen(date, open) {
    if (!upcoming(config.booking.maxDaysAhead + 370).some(day => day.date === date)) return false;
    const today = clock().date;
    // On en profite pour oublier les jours passés.
    const kept = prefs().open.filter(day => day !== date && day >= today);
    store.holidays.set({ ...prefs(), open: open ? [...kept, date].sort() : kept });
    return true;
  }

  return { upcoming, closures, setAuto, setOpen, state: () => ({ auto: prefs().auto, list: upcoming() }) };
}

module.exports = { easter, holidaysOf, holidaysBetween, createHolidays };
