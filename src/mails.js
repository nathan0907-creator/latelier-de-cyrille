'use strict';

const { daysBetween, formatLong, frTime } = require('./time');

const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Le rappel de la veille part 24 h avant le rendez-vous. */
const DAY_BEFORE = 1440;

/**
 * Les e-mails aux clients qui ont laissé leur adresse en réservant : demande reçue, rendez-vous
 * confirmé, déplacé ou annulé par le salon, et « N'oubliez pas votre rendez-vous » la veille.
 * Chacun se termine par les informations pratiques (adresse, téléphone, itinéraire).
 * mailer : src/mail.js ; pageOf : l'adresse de la page « Votre rendez-vous », relative au site.
 */
function createMails({ config, store, clock, mailer, pageOf }) {
  const minutesUntil = (booking, now) => daysBetween(now.date, booking.date) * 1440 + booking.start - now.minutes;
  const when = booking => `${formatLong(booking.date)} à ${frTime(booking.start)}`;
  const base = booking => (config.siteUrl || booking.site || '').replace(/\/+$/, '');
  const link = booking => (base(booking) ? `${base(booking)}/${pageOf(booking)}` : '');

  const MESSAGES = {
    received: booking => ({
      subject: `Votre demande de rendez-vous du ${when(booking)}`,
      lines: [`Bonjour ${firstName(booking)},`, `Votre demande de rendez-vous est bien reçue : ${booking.serviceName}, ${when(booking)}.`,
        `${config.owner || 'Le salon'} va la valider et peut ajuster l'heure dans la journée : vous recevrez un e-mail. En attendant, revenez vérifier votre rendez-vous de temps en temps.`],
      action: 'Voir ou annuler mon rendez-vous',
    }),
    confirmed: booking => ({
      subject: `Rendez-vous confirmé : ${when(booking)}`,
      lines: [`Bonjour ${firstName(booking)},`, `Votre rendez-vous est confirmé : ${booking.serviceName}, ${when(booking)}.`, 'À bientôt au salon !'],
      action: 'Voir ou annuler mon rendez-vous',
    }),
    moved: booking => ({
      subject: `Rendez-vous déplacé : ${when(booking)}`,
      lines: [`Bonjour ${firstName(booking)},`, `Votre rendez-vous a été déplacé. Nouveau rendez-vous : ${booking.serviceName}, ${when(booking)}.`,
        "Si cette heure ne vous convient pas, vous pouvez l'annuler ou appeler le salon."],
      action: 'Voir ou annuler mon rendez-vous',
    }),
    cancelled: booking => ({
      subject: `Rendez-vous annulé : ${when(booking)}`,
      lines: [`Bonjour ${firstName(booking)},`, `${config.owner || 'Le salon'} a dû annuler votre rendez-vous du ${when(booking)}. Toutes nos excuses !`,
        'Pour en prendre un autre, choisissez un créneau en ligne ou appelez le salon.'],
      action: 'Prendre un autre rendez-vous',
      href: booking => (base(booking) ? `${base(booking)}/reservation` : ''),
    }),
    reminder: booking => ({
      subject: `N'oubliez pas votre rendez-vous demain à ${frTime(booking.start)}`,
      lines: [`Bonjour ${firstName(booking)},`, `N'oubliez pas votre rendez-vous ${when(booking)} : ${booking.serviceName}.`,
        `Un empêchement ? Annulez-le depuis votre page de rendez-vous${config.contact.phone ? ` ou appelez le salon au ${config.contact.phone}` : ''}, pour que le créneau serve à quelqu'un d'autre.`],
      action: 'Voir ou annuler mon rendez-vous',
    }),
  };

  const firstName = booking => booking.name.split(' ')[0];

  /** Les informations pratiques, en bas de chaque e-mail. */
  function practical() {
    const { address, contact, maps } = config;
    return [
      ['Adresse', address.full],
      ['Téléphone', contact.phone],
      ['Itinéraire', maps.directions],
      ...(address.access || []).map(line => ['Accès', line]),
    ].filter(([, value]) => value);
  }

  function compose(booking, kind) {
    const message = MESSAGES[kind](booking);
    const href = message.href ? message.href(booking) : link(booking);
    const info = practical();
    const text = [
      ...message.lines,
      ...(href ? ['', `${message.action} : ${href}`] : []),
      '', '—', `${config.name} · Informations pratiques`,
      ...info.map(([label, value]) => `${label} : ${value}`),
    ].join('\n');
    const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f5eee1;font-family:Georgia,serif;color:#1d1a16">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #1d1a16;border-top:4px solid #1d1a16;padding:24px">
${base(booking) ? `<img src="${escape(base(booking))}/img/cyrille.png" width="88" height="88" alt="${escape(config.name)}" style="display:block;margin:0 auto 12px;border:0;border-radius:50%">` : ''}
<p style="margin:0 0 16px;font:700 13px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#8a6a1c;text-align:center">${escape(config.name)}</p>
${message.lines.map(line => `<p style="margin:0 0 12px;font-size:16px;line-height:1.5">${escape(line)}</p>`).join('\n')}
${href ? `<p style="margin:20px 0"><a href="${escape(href)}" style="display:inline-block;padding:12px 18px;background:#1d1a16;color:#ffffff;font:700 14px Arial,sans-serif;text-decoration:none;text-transform:uppercase;letter-spacing:.04em">${escape(message.action)}</a></p>` : ''}
<hr style="border:0;border-top:1px dashed #1d1a16;margin:24px 0 16px">
<p style="margin:0 0 8px;font:700 13px Arial,sans-serif;text-transform:uppercase;letter-spacing:.06em">Informations pratiques</p>
${info.map(([label, value]) => `<p style="margin:0 0 6px;font-size:14px"><strong>${escape(label)} :</strong> ${/^https?:/.test(value)
    ? `<a href="${escape(value)}" style="color:#1d1a16">Ouvrir dans Google Maps</a>`
    : label === 'Téléphone' ? `<a href="tel:${escape(value.replace(/[^\d+]/g, ''))}" style="color:#1d1a16">${escape(value)}</a>` : escape(value)}</p>`).join('\n')}
</div></body></html>`;
    return { subject: message.subject, text, html };
  }

  /** Envoie un e-mail au client, s'il a laissé son adresse. Renvoie true s'il est parti. */
  async function notify(booking, kind) {
    if (!mailer.enabled || !booking.email || !MESSAGES[kind]) return false;
    let result;
    try {
      result = await mailer.send({ to: booking.email, toName: booking.name, ...compose(booking, kind) });
    } catch (err) {
      result = { ok: false, status: err.message };
    }
    if (!result.ok) console.error(`[e-mails] envoi refusé (${result.status}) : ${kind}`);
    return result.ok;
  }

  /** Les rendez-vous à rappeler par e-mail : à venir, avec une adresse, pas encore rappelés. */
  const toRemind = () => store.bookings.all().filter(b => b.email && b.status !== 'cancelled' && !b.mailReminded);

  /** Envoie les rappels de la veille arrivés à échéance. */
  async function tick() {
    if (!mailer.enabled) return 0;
    let sent = 0;
    for (const booking of toRemind()) {
      const now = clock();
      const remaining = minutesUntil(booking, now);
      if (remaining > DAY_BEFORE) continue;
      // Rendez-vous déjà tout proche (le site était arrêté) : trop tard pour « demain ».
      if (remaining > 60 && await notify(booking, 'reminder')) sent += 1;
      store.bookings.update(booking.id, { mailReminded: true });
    }
    return sent;
  }

  /**
   * Un rendez-vous pris ou déplacé à moins de 24 h : le client vient d'avoir un e-mail, pas de
   * rappel « demain ». Sinon, le rappel de la veille est (de nouveau) prévu.
   */
  function schedule(booking) {
    const remindLater = minutesUntil(booking, clock()) > DAY_BEFORE;
    if (Boolean(booking.mailReminded) === !remindLater) return;
    store.bookings.update(booking.id, { mailReminded: !remindLater });
  }

  /** Dans combien de minutes un rappel par e-mail doit partir, ou null. */
  function nextDue() {
    if (!mailer.enabled) return null;
    const now = clock();
    let next = null;
    for (const booking of toRemind()) {
      const due = Math.max(0, minutesUntil(booking, now) - DAY_BEFORE);
      if (next === null || due < next) next = due;
    }
    return next;
  }

  return { enabled: mailer.enabled, notify, schedule, tick, nextDue, compose };
}

module.exports = { createMails };
