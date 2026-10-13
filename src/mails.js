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

  /** Les e-mails, leur moment, et le bouton sous le texte (lien vers le rendez-vous ou la réservation). */
  const KINDS = {
    received: { label: 'Demande reçue', when: 'Juste après une réservation en ligne.', action: 'Voir ou annuler mon rendez-vous' },
    confirmed: { label: 'Rendez-vous confirmé', when: 'Quand vous confirmez une demande, ou saisissez un rendez-vous avec un e-mail.', action: 'Voir ou annuler mon rendez-vous' },
    moved: { label: 'Rendez-vous déplacé', when: 'Quand vous changez le jour ou l\'heure.', action: 'Voir ou annuler mon rendez-vous' },
    cancelled: { label: 'Rendez-vous annulé', when: 'Quand vous annulez un rendez-vous.', action: 'Prendre un autre rendez-vous', page: 'reservation' },
    reminder: { label: 'Rappel de la veille', when: '24 h avant le rendez-vous.', action: 'Voir ou annuler mon rendez-vous' },
  };

  /** Les textes d'origine. Entre accolades, ce que le site remplit pour chaque client (FIELDS). */
  const DEFAULTS = {
    received: {
      subject: 'Votre demande de rendez-vous du {date} à {heure}',
      body: "Bonjour {prenom},\nVotre demande de rendez-vous est bien reçue : {prestation}, {date} à {heure}.\n{salon} va la valider et peut ajuster l'heure dans la journée : vous recevrez un e-mail. En attendant, revenez vérifier votre rendez-vous de temps en temps.",
    },
    confirmed: {
      subject: 'Rendez-vous confirmé : {date} à {heure}',
      body: 'Bonjour {prenom},\nVotre rendez-vous est confirmé : {prestation}, {date} à {heure}.\nÀ bientôt au salon !',
    },
    moved: {
      subject: 'Rendez-vous déplacé : {date} à {heure}',
      body: "Bonjour {prenom},\nVotre rendez-vous a été déplacé. Nouveau rendez-vous : {prestation}, {date} à {heure}.\nSi cette heure ne vous convient pas, vous pouvez l'annuler ou appeler le salon.",
    },
    cancelled: {
      subject: 'Rendez-vous annulé : {date} à {heure}',
      body: 'Bonjour {prenom},\n{salon} a dû annuler votre rendez-vous du {date} à {heure}. Toutes nos excuses !\nPour en prendre un autre, choisissez un créneau en ligne ou appelez le salon.',
    },
    reminder: {
      subject: "N'oubliez pas votre rendez-vous demain à {heure}",
      body: `Bonjour {prenom},\nN'oubliez pas votre rendez-vous {date} à {heure} : {prestation}.\nUn empêchement ? Annulez-le depuis votre page de rendez-vous${config.contact.phone ? ' ou appelez le salon au {telephone}' : ''}, pour que le créneau serve à quelqu'un d'autre.`,
    },
  };

  /** Ce que le site remplit dans les textes, pour chaque client. */
  const FIELDS = {
    prenom: booking => booking.name.split(' ')[0],
    nom: booking => booking.name,
    prestation: booking => booking.serviceName,
    date: booking => formatLong(booking.date),
    heure: booking => frTime(booking.start),
    salon: () => config.name,
    telephone: () => config.contact.phone || '',
  };
  const fill = (template, booking) => template.replace(/\{(\w+)\}/g, (all, name) => (FIELDS[name] ? FIELDS[name](booking) : all));

  /** Le texte d'un e-mail : celui de la coiffeuse s'il y en a un, sinon celui d'origine. */
  const textOf = kind => ({ ...DEFAULTS[kind], ...store.mailTexts.all()[kind] });

  const MESSAGES = Object.fromEntries(Object.keys(KINDS).map(kind => [kind, booking => {
    const { subject, body } = textOf(kind);
    return {
      subject: fill(subject, booking),
      lines: body.split(/\n+/).map(line => fill(line.trim(), booking)).filter(Boolean),
      action: KINDS[kind].action,
      ...(KINDS[kind].page && { href: () => (base(booking) ? `${base(booking)}/${KINDS[kind].page}` : '') }),
    };
  }]));

  const SUBJECT_MAX = 150;
  const BODY_MAX = 3000;

  /** Les e-mails, pour la page « E-mails » de l'espace salon. */
  function texts() {
    return {
      enabled: mailer.enabled,
      fields: Object.keys(FIELDS),
      kinds: Object.entries(KINDS).map(([kind, info]) => ({
        kind, label: info.label, when: info.when, action: info.action,
        ...textOf(kind), defaults: DEFAULTS[kind], custom: Boolean(store.mailTexts.all()[kind]),
      })),
    };
  }

  /** La coiffeuse réécrit un e-mail ; un texte vide, ou celui d'origine, revient au texte d'origine. */
  function setText(input) {
    const kind = String(input?.kind || '');
    if (!Object.hasOwn(KINDS, kind)) return { ok: false, status: 400, error: 'E-mail inconnu.' };
    const subject = String(input.subject ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    const body = String(input.body ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
    if (subject.length > SUBJECT_MAX) return { ok: false, status: 400, error: `L'objet est trop long (${SUBJECT_MAX} caractères au plus).` };
    if (body.length > BODY_MAX) return { ok: false, status: 400, error: `Le texte est trop long (${BODY_MAX} caractères au plus).` };
    const text = {
      subject: subject || DEFAULTS[kind].subject,
      body: body || DEFAULTS[kind].body,
    };
    const same = text.subject === DEFAULTS[kind].subject && text.body === DEFAULTS[kind].body;
    store.mailTexts.set(kind, same ? null : text);
    return { ok: true, ...texts() };
  }


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

  return { enabled: mailer.enabled, notify, schedule, tick, nextDue, compose, texts, setText };
}

module.exports = { createMails };
