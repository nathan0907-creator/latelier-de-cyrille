'use strict';

/**
 * Dates et heures. Les dates sont des chaînes « AAAA-MM-JJ », les heures des
 * minutes depuis minuit. Aucun calcul ne dépend du fuseau du serveur : « maintenant »
 * est toujours lu dans le fuseau du salon.
 */

const pad2 = n => String(n).padStart(2, '0');

function toMinutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof hhmm === 'string' ? hhmm : '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const fromMinutes = min => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

/** 570 → « 9h30 », 540 → « 9h » */
const frTime = min => `${Math.floor(min / 60)}h${min % 60 ? pad2(min % 60) : ''}`;

function isValidDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof str === 'string' ? str : '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const isValidMonth = str => /^\d{4}-(0[1-9]|1[0-2])$/.test(typeof str === 'string' ? str : '');

function toUTC(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const fromUTC = d => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

function addDays(str, n) {
  const d = toUTC(str);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

const daysBetween = (from, to) => Math.round((toUTC(to) - toUTC(from)) / 86_400_000);

/** 0 = dimanche … 6 = samedi */
const weekday = str => toUTC(str).getUTCDay();

function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${pad2(i + 1)}`);
}

const zoneFormatters = new Map();

/** Date et heure actuelles dans le fuseau du salon. */
function nowInZone(timeZone, at = new Date()) {
  let fmt = zoneFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    zoneFormatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(at).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const longDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** « mardi 13 octobre » */
const formatLong = str => longDate.format(toUTC(str));
/** « mar. 13 oct. » */
const formatShort = str => shortDate.format(toUTC(str));

/** Rang du jour dans l'année : 1 pour le 1er janvier. */
function dayOfYear(str) {
  const d = toUTC(str);
  return Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

module.exports = {
  pad2, toMinutes, fromMinutes, frTime, isValidDate, isValidMonth, addDays, daysBetween,
  weekday, daysInMonth, dayOfYear, nowInZone, formatLong, formatShort, WEEKDAYS,
};
