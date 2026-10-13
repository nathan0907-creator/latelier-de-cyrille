'use strict';

/**
 * Envoi d'e-mails par Brevo (https://www.brevo.com), un service français : le site lui passe le
 * message, Brevo le remet dans la boîte du client. Gratuit jusqu'à 300 e-mails par jour.
 *
 * Réglages (variables d'environnement, ou secrets du Worker sur Cloudflare) :
 *   BREVO_API_KEY : la clé d'API créée dans Brevo (« SMTP et API » → « Clés API ») ;
 *   MAIL_FROM     : l'adresse d'expédition, validée dans Brevo (« Expéditeurs »). À défaut,
 *                   l'adresse e-mail du salon (salon.config.js, contact.email).
 * Sans clé, les e-mails sont désactivés : la réservation ne demande pas d'adresse.
 */

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Une adresse e-mail plausible, en minuscules ; '' si elle ne l'est pas. */
function readEmail(input) {
  const email = String(input ?? '').trim().toLowerCase();
  return email.length <= 120 && EMAIL_RE.test(email) ? email : '';
}

function createMailer({ apiKey = '', from = '', name = '', replyTo = '', request = fetch } = {}) {
  const sender = readEmail(from);
  const enabled = Boolean(apiKey && sender);

  /** Envoie un e-mail. Renvoie { ok, status }. */
  async function send({ to, toName = '', subject, text, html }) {
    if (!enabled) return { ok: false, status: 'désactivé' };
    const response = await request(ENDPOINT, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: sender, ...(name && { name }) },
        to: [{ email: to, ...(toName && { name: toName }) }],
        ...(readEmail(replyTo) && { replyTo: { email: readEmail(replyTo) } }),
        subject,
        textContent: text,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: response.ok, status: response.status };
  }

  return { enabled, send };
}

module.exports = { createMailer, readEmail };
