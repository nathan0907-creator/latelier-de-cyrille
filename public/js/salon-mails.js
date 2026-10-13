// Espace salon, page « E-mails » : la coiffeuse réécrit le texte des e-mails envoyés aux clients
// (demande reçue, confirmé, déplacé, annulé, rappel de la veille). Le bouton sous le texte et les
// informations pratiques (adresse, téléphone, itinéraire) s'ajoutent tout seuls.

import { h, icon } from './lib.js';

const TEST_KEY = 'salon-adresse-essai';

/** Les exemples montrés dans l'aperçu, à la place de ce que le site remplit pour chaque client. */
const SAMPLE = { prenom: 'Léa', nom: 'Léa Dupont', prestation: 'Coupe brushing', date: 'mardi 20 octobre', heure: '10h', telephone: '' };

export function createMailsView({ call, toast, field, view, salonName, phone }) {
  const sample = { ...SAMPLE, salon: salonName, telephone: phone || '07 00 00 00 00' };
  const fill = text => text.replace(/\{(\w+)\}/g, (all, name) => sample[name] ?? all);

  let testAddress = '';
  try {
    testAddress = localStorage.getItem(TEST_KEY) || '';
  } catch {
    // Pas de mémoire du navigateur : l'adresse sera redemandée.
  }

  async function mount() {
    view().replaceChildren(h('p', { class: 'empty' }, 'Chargement…'));
    let data;
    try {
      data = await call('/api/salon/mails');
    } catch (err) {
      view().replaceChildren(h('p', { class: 'notice notice--error', role: 'alert' }, err.message));
      return;
    }
    render(data);
  }

  function render(data) {
    const address = h('input', { type: 'email', inputmode: 'email', autocomplete: 'email', value: testAddress, placeholder: 'votre.adresse@gmail.com' });
    address.addEventListener('change', () => {
      testAddress = address.value.trim();
      try {
        localStorage.setItem(TEST_KEY, testAddress);
      } catch {
        // Tant pis : l'adresse reste le temps de la page.
      }
    });

    view().replaceChildren(
      h('p', { class: 'view-lead' }, 'Le texte des e-mails envoyés aux clients. Entre accolades, ce que le site remplit pour chaque client : ',
        ...data.fields.flatMap((name, index) => [index ? ', ' : '', h('code', {}, `{${name}}`)]),
        '. Une ligne = un paragraphe. Le bouton et les informations pratiques (adresse, téléphone, itinéraire) s\'ajoutent tout seuls en bas.'),
      data.enabled ? null : h('p', { class: 'notice notice--warn' }, "Les e-mails ne sont pas encore en service (la clé Brevo manque) : vous pouvez déjà préparer les textes."),
      field({ id: 'mails-essai', label: 'Votre adresse, pour les essais', optional: true, hint: '« M\'envoyer un essai » envoie le texte enregistré à cette adresse, avec un client d\'exemple.', control: address }),
      h('div', { class: 'editor' }, ...data.kinds.map(item => card(item, data.enabled))),
    );
  }

  /** Un e-mail : son objet, son texte, l'aperçu, et les boutons. */
  function card(item, enabled) {
    const subject = h('input', { type: 'text', maxlength: '150', value: item.subject });
    const body = h('textarea', { rows: '6', maxlength: '3000' });
    body.value = item.body;
    const preview = h('div', { class: 'mail-preview', 'aria-live': 'polite' });
    const error = h('p', { class: 'notice notice--error', role: 'alert', hidden: true });
    const showPreview = () => preview.replaceChildren(
      h('p', { class: 'mail-preview-subject' }, fill(subject.value)),
      ...body.value.split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => h('p', {}, fill(line))),
      h('p', { class: 'mail-preview-button' }, item.action),
      h('p', { class: 'mail-preview-info' }, 'Informations pratiques : adresse, téléphone, itinéraire'),
    );
    subject.addEventListener('input', showPreview);
    body.addEventListener('input', showPreview);
    showPreview();

    const fail = message => {
      error.textContent = message;
      error.hidden = false;
    };
    const save = async (values, message) => {
      error.hidden = true;
      try {
        render(await call('/api/salon/mails', { method: 'PUT', body: { kind: item.kind, ...values } }));
        toast(message, { title: item.label });
      } catch (err) {
        fail(err.message);
      }
    };
    const sendTest = async () => {
      error.hidden = true;
      if (!testAddress) {
        fail('Indiquez d\'abord votre adresse, en haut de la page.');
        return;
      }
      try {
        await call('/api/salon/mails/test', { method: 'POST', body: { kind: item.kind, to: testAddress } });
        toast(`Envoyé à ${testAddress}. Pensez aux indésirables si vous ne le voyez pas.`, { title: 'Essai envoyé' });
      } catch (err) {
        fail(err.message);
      }
    };

    const form = h('form', { class: 'editor-category mail-card', novalidate: true },
      h('div', { class: 'mail-card-head' },
        h('h3', {}, item.label, item.custom ? h('span', { class: 'badge badge--neutral' }, 'Modifié') : null),
        h('p', { class: 'field-hint' }, item.when)),
      field({ id: `mail-${item.kind}-objet`, label: 'Objet', control: subject }),
      field({ id: `mail-${item.kind}-texte`, label: 'Texte', control: body }),
      h('p', { class: 'mail-preview-label' }, 'Aperçu'),
      preview,
      error,
      h('div', { class: 'sheet-actions' },
        h('button', { type: 'submit', class: 'btn btn--small' }, h('span', {}, 'Enregistrer'), icon('check')),
        enabled ? h('button', { type: 'button', class: 'btn btn--small btn--outline', onclick: sendTest }, h('span', {}, "M'envoyer un essai"), icon('mail')) : null,
        item.custom ? h('button', { type: 'button', class: 'link', onclick: () => save({ subject: '', body: '' }, "Texte d'origine remis.") }, "Revenir au texte d'origine") : null));
    form.addEventListener('submit', event => {
      event.preventDefault();
      save({ subject: subject.value, body: body.value }, 'Texte enregistré.');
    });
    return form;
  }

  return { mount };
}
