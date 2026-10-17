// Espace salon, page « Événement » : la coiffeuse prépare l'événement du mois (soirée Halloween,
// portes ouvertes…). Titre, dates, accroche, texte mis en forme, photos, bouton d'infos, style :
// tout se modifie dans un brouillon, avec un aperçu, puis s'enregistre d'un bouton. Le serveur
// vérifie tout de nouveau (src/salon-event.js).

import { h, icon, formatLong, capitalize } from './lib.js';

const MAX_IMAGES = 6;
const TEXT_MAX = 4000;
const THEMES = { clair: 'Classique : beige et or', soiree: 'Soirée : noir et or' };
const LEAD = "L'événement du mois s'affiche sur la une, sur sa propre page, et dans un petit encart à l'ouverture du site. Il disparaît tout seul le lendemain de son dernier jour.";

let serial = 0;
const uid = prefix => `${prefix}-${++serial}`;

const iconButton = (name, label, onclick, { disabled = false, danger = false } = {}) => h('button', {
  type: 'button', class: `icon-btn${danger ? ' icon-btn--danger' : ''}`, 'aria-label': label, title: label, onclick, disabled,
}, icon(name));

// ── Le texte mis en forme (la même règle que le site : src/views/event.js) ──

/** Une ligne : **gras**, *italique*, _écriture_. Construite en nœuds : rien n'est interprété comme du HTML. */
function inline(text) {
  const nodes = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|(^|[\s(«'’])_(.+?)_(?=$|[\s).,;:!?»])/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const lead = match[3] || '';
    nodes.push(text.slice(last, match.index) + lead);
    if (match[1] !== undefined) nodes.push(h('strong', {}, match[1]));
    else if (match[2] !== undefined) nodes.push(h('em', {}, match[2]));
    else nodes.push(h('em', { class: 'script' }, match[4]));
    last = match.index + match[0].length;
  }
  nodes.push(text.slice(last));
  return nodes.filter(node => node !== '');
}

function richText(text) {
  const out = [];
  let list = [];
  const flush = () => {
    if (list.length) out.push(h('ul', {}, list.map(item => h('li', {}, inline(item)))));
    list = [];
  };
  for (const row of String(text || '').split('\n')) {
    const value = row.trim();
    const item = /^[-•]\s+(.*)$/.exec(value);
    if (item) {
      list.push(item[1]);
      continue;
    }
    flush();
    if (value) out.push(h('p', {}, inline(value)));
  }
  flush();
  return out;
}

/** Le titre : _mot_ s'écrit en lettres attachées, comme sur le site. */
const titleNodes = title => inline(title);

function whenLabel(event) {
  const day = event.date ? (event.endDate ? `Du ${formatLong(event.date)} au ${formatLong(event.endDate)}` : capitalize(formatLong(event.date))) : '';
  return [day, event.time.trim()].filter(Boolean).join(' · ');
}

/**
 * call, toast, field : les outils de l'espace salon ; view() : où dessiner ;
 * preparePhoto(file) : réduit une photo et la décline en plusieurs largeurs avant l'envoi.
 */
export function createEventView({ call, toast, field, view, preparePhoto }) {
  let saved = null; // l'événement tel qu'il est enregistré
  let draft = null; // le brouillon en cours
  let busy = false;

  const toDraft = event => ({ ...event, images: event.images.map(image => ({ ...image })) });
  const blank = () => ({
    ...draft, enabled: draft.enabled, title: '', date: '', endDate: '', time: '', summary: '', text: '',
    images: [], buttonLabel: "Plus d'infos", buttonLink: '', booking: false,
  });

  async function mount() {
    view().replaceChildren(h('p', { class: 'view-lead' }, LEAD), h('p', { class: 'empty' }, 'Chargement…'));
    try {
      saved = await call('/api/salon/event');
    } catch (err) {
      view().replaceChildren(h('p', { class: 'notice notice--error', role: 'alert' }, err.message));
      return;
    }
    draft = toDraft(saved);
    render();
  }

  function render() {
    const status = h('p', { class: 'photo-status', role: 'status' });
    const error = h('p', { class: 'notice notice--error', role: 'alert', hidden: true });
    const preview = h('div', { class: 'event-preview-box', 'aria-live': 'polite' });
    const showPreview = () => preview.replaceChildren(...previewNodes().filter(Boolean));

    /** Un champ texte relié au brouillon ; l'aperçu suit la frappe. */
    const text = (key, { max, placeholder = '', type = 'text' } = {}) => {
      const input = h('input', { type, maxlength: max ? String(max) : null, value: draft[key] || '', placeholder, autocomplete: 'off' });
      input.addEventListener('input', () => {
        draft[key] = input.value;
        showPreview();
      });
      return input;
    };
    const check = (key, label, hint = '') => {
      const id = uid('evenement-case');
      return h('div', { class: 'event-check' },
        h('label', { class: 'check', for: id },
          h('input', { type: 'checkbox', id, checked: Boolean(draft[key]), onchange: event => { draft[key] = event.target.checked; showPreview(); } }),
          h('span', {}, label)),
        hint ? h('p', { class: 'field-hint' }, hint) : null);
    };

    // — Affichage —
    const theme = h('select', { onchange: event => { draft.theme = event.target.value; showPreview(); } },
      Object.entries(THEMES).map(([value, label]) => h('option', { value, selected: draft.theme === value }, label)));

    // — Dates —
    const start = text('date', { type: 'date' });
    const end = text('endDate', { type: 'date' });
    end.min = draft.date || '';
    start.addEventListener('change', () => {
      end.min = start.value;
      if (end.value && end.value < start.value) {
        end.value = '';
        draft.endDate = '';
        showPreview();
      }
    });

    // — Le texte, avec sa barre de mise en forme —
    const body = h('textarea', { rows: '9', maxlength: String(TEXT_MAX), placeholder: 'Le programme de la soirée, ce qui est offert, à qui s’adresse l’événement…' });
    body.value = draft.text;
    body.addEventListener('input', () => {
      draft.text = body.value;
      showPreview();
    });
    /** Entoure la sélection d'une marque (ou l'insère, prête à être remplie). */
    const wrap = (mark, sample) => {
      const { selectionStart: from, selectionEnd: to, value } = body;
      const chosen = value.slice(from, to) || sample;
      body.setRangeText(`${mark}${chosen}${mark}`, from, to, 'end');
      if (from === to) body.setSelectionRange(from + mark.length, from + mark.length + chosen.length);
      body.focus();
      body.dispatchEvent(new Event('input'));
    };
    const bullet = () => {
      const { selectionStart: from, selectionEnd: to, value } = body;
      const lineStart = value.lastIndexOf('\n', from - 1) + 1;
      const lines = value.slice(lineStart, to).split('\n').map(row => (/^[-•]\s/.test(row) ? row : `- ${row}`)).join('\n');
      body.setRangeText(lines, lineStart, to, 'end');
      body.focus();
      body.dispatchEvent(new Event('input'));
    };
    const tool = (name, label, onclick, extra = '') => h('button', { type: 'button', class: `format-btn${extra}`, title: label, 'aria-label': label, onclick }, icon(name));
    const toolbar = h('div', { class: 'format-bar', role: 'toolbar', 'aria-label': 'Mise en forme du texte' },
      tool('bold', 'Gras', () => wrap('**', 'texte en gras')),
      tool('italic', 'Italique', () => wrap('*', 'texte en italique')),
      tool('pen', 'En écriture, dans la couleur du salon', () => wrap('_', 'mot')),
      tool('list', 'Liste à puces', bullet));

    // — Le bouton d'infos —
    const destination = h('select', {
      onchange: event => {
        draft.buttonLink = event.target.value === 'page' ? '' : (saved.buttonLink || 'https://');
        render();
      },
    }, [h('option', { value: 'page', selected: !draft.buttonLink }, "La page de l'événement, sur le site"),
      h('option', { value: 'link', selected: Boolean(draft.buttonLink) }, 'Une autre adresse (Facebook, Instagram…)')]);
    const link = draft.buttonLink ? text('buttonLink', { max: 400, placeholder: 'https://www.facebook.com/events/…', type: 'url' }) : null;

    const form = h('form', { class: 'event-form', novalidate: true },
      h('section', { class: 'editor-category' },
        h('h3', { class: 'event-form-title' }, 'Affichage'),
        statusLine(),
        check('enabled', 'Afficher l’événement sur le site'),
        check('popup', 'Ouvrir un encart à l’arrivée sur le site', 'Une fois fermé, il ne revient plus pour ce visiteur, sauf si vous modifiez l’événement.'),
        field({ id: uid('evenement-style'), label: 'Style', control: theme })),
      h('section', { class: 'editor-category' },
        h('h3', { class: 'event-form-title' }, "L'annonce"),
        field({ id: uid('evenement-surtitre'), label: 'Surtitre', control: text('kicker', { max: 60 }) }),
        field({ id: uid('evenement-titre'), label: 'Titre', hint: 'Entourez un mot de tirets bas pour l’écrire en lettres attachées : Soirée _Halloween_', control: text('title', { max: 90, placeholder: 'Soirée _Halloween_' }) }),
        h('div', { class: 'field-row' },
          field({ id: uid('evenement-debut'), label: 'Le', optional: true, control: start }),
          field({ id: uid('evenement-fin'), label: "Jusqu'au", optional: true, control: end })),
        field({ id: uid('evenement-heures'), label: 'Horaires', optional: true, control: text('time', { max: 60, placeholder: 'de 18h à 22h' }) }),
        field({ id: uid('evenement-accroche'), label: 'Accroche', optional: true, hint: 'Une phrase, reprise dans l’encart et sur la une.', control: text('summary', { max: 220, placeholder: 'Maquillage, coiffures de sorcière et bonbons pour les enfants !' }) })),
      h('section', { class: 'editor-category' },
        h('h3', { class: 'event-form-title' }, 'Le texte'),
        h('div', { class: 'field' },
          h('label', { for: 'evenement-texte' }, 'Texte de la page'),
          toolbar,
          Object.assign(body, { id: 'evenement-texte' }),
          h('p', { class: 'field-hint' }, 'Une ligne = un paragraphe. Sélectionnez des mots puis choisissez une mise en forme ; « - » en début de ligne fait une liste.'))),
      h('section', { class: 'editor-category' },
        h('h3', { class: 'event-form-title' }, 'Photos'),
        imagesEditor(status)),
      h('section', { class: 'editor-category' },
        h('h3', { class: 'event-form-title' }, 'Boutons'),
        field({ id: uid('evenement-bouton'), label: "Texte du bouton d'infos", control: text('buttonLabel', { max: 40 }) }),
        field({ id: uid('evenement-destination'), label: 'Il mène à', control: destination }),
        link ? field({ id: uid('evenement-lien'), label: 'Adresse', control: link }) : null,
        check('booking', 'Ajouter un bouton « Prendre rendez-vous »')),
      h('div', { class: 'editor-footer' }, error,
        h('div', { class: 'sheet-actions' },
          h('button', { type: 'submit', class: 'btn' }, h('span', {}, 'Enregistrer'), icon('check')),
          h('a', { class: 'btn btn--outline', href: '/evenement', target: '_blank', rel: 'noopener' }, h('span', {}, 'Voir la page'), icon('arrow-up-right')),
          h('button', { type: 'button', class: 'link', onclick: () => { draft = toDraft(saved); render(); } }, 'Annuler les modifications'),
          h('button', { type: 'button', class: 'link', onclick: () => { draft = blank(); render(); } }, 'Repartir d’une page blanche'))));

    form.addEventListener('submit', async event => {
      event.preventDefault();
      error.hidden = true;
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        saved = await call('/api/salon/event', {
          method: 'PUT',
          body: { ...draft, images: draft.images.map(({ src, alt }) => ({ src, alt })) },
        });
        draft = toDraft(saved);
        toast(saved.enabled && !saved.over ? "L'événement est en ligne : le site est à jour." : "L'événement est enregistré. Il n'est pas affiché sur le site.", { title: 'Événement' });
        render();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        error.scrollIntoView({ block: 'center', behavior: 'smooth' });
        submit.disabled = false;
      }
    });

    showPreview();
    view().replaceChildren(
      h('p', { class: 'view-lead' }, LEAD),
      h('div', { class: 'event-editor' },
        form,
        h('aside', { class: 'event-preview-col', 'aria-label': 'Aperçu' },
          h('p', { class: 'mail-preview-label' }, 'Aperçu'),
          preview)));
  }

  /** Où en est l'événement enregistré. */
  function statusLine() {
    if (!saved.title) return h('p', { class: 'field-hint' }, 'Aucun événement pour le moment.');
    const [label, kind] = saved.over ? ['Passé : il ne s’affiche plus', 'cancelled']
      : saved.enabled ? ['En ligne sur le site', 'confirmed'] : ['Masqué', 'pending'];
    return h('p', { class: 'event-status' }, h('span', { class: `badge badge--${kind}` }, label),
      saved.updatedAt ? h('span', { class: 'field-hint' }, `Enregistré le ${new Date(saved.updatedAt).toLocaleDateString('fr-FR')}`) : null);
  }

  /** Les photos : la première est la grande photo (une, encart, page). */
  function imagesEditor(status) {
    const input = h('input', {
      type: 'file', accept: 'image/*', multiple: true, class: 'sr-only', id: 'evenement-photos',
      onchange: event => {
        const files = [...event.target.files];
        event.target.value = '';
        addFiles(files, status);
      },
    });
    const cards = draft.images.map((image, index) => {
      const altId = uid('evenement-photo');
      const move = delta => {
        const target = index + delta;
        [draft.images[index], draft.images[target]] = [draft.images[target], draft.images[index]];
        render();
      };
      return h('li', { class: 'photo-card' },
        h('div', { class: 'photo-thumb' },
          h('img', { src: image.thumb || image.src, alt: '', loading: 'lazy' }),
          index === 0 ? h('span', { class: 'badge badge--pending' }, 'Grande photo') : null),
        h('div', { class: 'field' }, h('label', { for: altId }, 'Description'),
          h('input', { type: 'text', id: altId, maxlength: '120', value: image.alt, oninput: event => { image.alt = event.target.value; } })),
        h('div', { class: 'editor-tools' },
          iconButton('chevron-left', 'Placer cette photo avant', () => move(-1), { disabled: index === 0 }),
          iconButton('chevron-right', 'Placer cette photo après', () => move(1), { disabled: index === draft.images.length - 1 }),
          iconButton('trash', 'Retirer cette photo', () => { draft.images.splice(index, 1); render(); }, { danger: true })));
    });
    return h('div', { class: 'photo-editor' },
      h('div', { class: 'photo-bar' },
        draft.images.length < MAX_IMAGES
          ? h('label', { class: 'btn btn--outline', for: 'evenement-photos' }, icon('plus'), h('span', {}, draft.images.length ? 'Ajouter des photos' : 'Ajouter une photo'))
          : h('p', { class: 'field-hint' }, `${MAX_IMAGES} photos au plus.`),
        input,
        h('p', { class: 'field-hint' }, 'La première est la grande photo. Les autres s’affichent sur la page de l’événement.')),
      status,
      cards.length ? h('ul', { class: 'photo-grid' }, cards) : null);
  }

  async function addFiles(files, status) {
    if (busy || !files.length) return;
    busy = true;
    const room = MAX_IMAGES - draft.images.length;
    let failed = 0;
    for (const [i, file] of files.slice(0, room).entries()) {
      status.textContent = files.length > 1 ? `Envoi de la photo ${i + 1} sur ${Math.min(files.length, room)}…` : 'Envoi de la photo…';
      try {
        const { photo } = await call('/api/salon/photos', { method: 'POST', body: await preparePhoto(file) });
        // Une description de départ : le titre de l'événement, à préciser.
        draft.images.push({ src: photo.src, thumb: photo.src, ratio: photo.ratio, alt: draft.title.replace(/_/g, '').trim() });
      } catch (err) {
        failed += 1;
        status.textContent = err.status ? err.message : `« ${file.name} » n'a pas pu être lue : choisissez une photo au format JPEG, PNG ou WebP.`;
      }
    }
    busy = false;
    const message = failed ? status.textContent : '';
    render();
    const fresh = view().querySelector('.photo-status');
    if (fresh) fresh.textContent = message || 'Photo ajoutée : vérifiez sa description, puis enregistrez.';
  }

  /** L'aperçu : la rubrique telle qu'elle apparaîtra sur la une, puis le texte de la page. */
  function previewNodes() {
    const [photo] = draft.images;
    const when = whenLabel(draft);
    const teaser = draft.summary.trim();
    return [
      draft.enabled ? null : h('p', { class: 'notice notice--warn' }, 'Masqué : cochez « Afficher l’événement sur le site » pour le publier.'),
      h('article', { class: `event-mini event-mini--${draft.theme === 'soiree' ? 'soiree' : 'clair'}` },
        photo ? h('img', { class: 'event-mini-photo', src: photo.thumb || photo.src, alt: '' }) : null,
        h('div', { class: 'event-mini-body' },
          h('p', { class: 'event-mini-kicker' }, draft.kicker || "L'événement du mois"),
          h('p', { class: 'event-mini-title' }, draft.title.trim() ? titleNodes(draft.title) : 'Le titre de l’événement'),
          when ? h('p', { class: 'event-mini-when' }, icon('calendar'), h('span', {}, when)) : null,
          teaser ? h('p', { class: 'event-mini-summary' }, teaser) : null,
          h('p', { class: 'event-mini-actions' },
            h('span', { class: 'event-mini-btn' }, draft.buttonLabel || "Plus d'infos", icon(draft.buttonLink ? 'arrow-up-right' : 'arrow-right')),
            draft.booking ? h('span', { class: 'event-mini-btn event-mini-btn--outline' }, 'Prendre rendez-vous') : null))),
      draft.text.trim() ? h('div', { class: 'event-mini-text' }, h('p', { class: 'mail-preview-label' }, 'Texte de la page'), ...richText(draft.text)) : null,
    ];
  }

  return { mount };
}
