// Espace salon : ce que la coiffeuse règle elle-même — tarifs, horaires, photos.
// Tarifs et horaires se modifient dans un brouillon, enregistré d'un bouton ; les photos
// s'enregistrent à chaque geste. Le serveur vérifie tout de nouveau avant d'accepter.

import { h, icon, durationLabel, fromMinutes } from './lib.js';

const DAYS = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [0, 'Dimanche']];

// Les façons d'afficher un prix, et le libellé de chaque montant à saisir.
const PRICE_MODES = {
  single: { label: 'Prix unique', amounts: ['Prix'] },
  from: { label: 'À partir de', amounts: ['À partir de'] },
  lengths: { label: 'Selon la longueur', amounts: ['Courts', 'Mi-longs', 'Longs'] },
  two: { label: 'Deux tarifs', amounts: ['Tarif 1', 'Tarif 2'] },
};

let serial = 0;
const uid = prefix => `${prefix}-${++serial}`;

const iconButton = (name, label, onclick, { disabled = false, danger = false } = {}) => h('button', {
  type: 'button', class: `icon-btn${danger ? ' icon-btn--danger' : ''}`, 'aria-label': label, title: label, onclick, disabled,
}, icon(name));

/** Échange deux éléments voisins d'une liste. */
function swap(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
}

// ── Photos : préparation dans le navigateur ───────────────────────────────
// La photo choisie est réduite à 1600 px et déclinée en plusieurs largeurs avant l'envoi :
// le site reste rapide sur téléphone, quelle que soit la taille du fichier d'origine.

const toBlob = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));

async function encode(canvas) {
  const webp = await toBlob(canvas, 'image/webp', 0.82);
  // Certains navigateurs ne savent pas écrire le WebP : ils rendent autre chose, on repasse au JPEG.
  return webp && webp.type === 'image/webp' ? webp : toBlob(canvas, 'image/jpeg', 0.85);
}

const toDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.addEventListener('load', () => resolve(String(reader.result)));
  reader.addEventListener('error', () => reject(reader.error));
  reader.readAsDataURL(blob);
});

/** Ouvre le fichier choisi comme une image qu'on peut redessiner, dans le bon sens (photo de téléphone). */
async function readImage(file) {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Format que cette méthode ne sait pas lire : on essaie par une balise image.
    }
  }
  const image = new Image();
  image.src = await toDataUrl(file);
  await image.decode();
  return { source: image, width: image.naturalWidth, height: image.naturalHeight };
}

async function preparePhoto(file) {
  const image = await readImage(file);
  const scale = Math.min(1, 1600 / image.width, 2000 / image.height);
  const full = Math.round(image.width * scale);
  const files = [];
  for (const width of [full, ...[1200, 800, 480].filter(w => w < full - 60)]) {
    const canvas = Object.assign(document.createElement('canvas'), { width, height: Math.round((image.height * width) / image.width) });
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
    files.push({ data: (await toDataUrl(await encode(canvas))).split(',')[1] });
  }
  image.source.close?.();
  return { files };
}

/**
 * Les trois vues de réglages.
 *   call, toast, field : les outils de l'espace salon ;
 *   view()  : l'endroit où dessiner la vue ;
 *   onSaved : à appeler après un enregistrement (l'agenda relit la carte et les horaires).
 */
export function createSettingsViews({ call, toast, field, view, onSaved }) {
  let settings = null;

  async function open(lead) {
    view().replaceChildren(h('p', { class: 'view-lead' }, lead), h('p', { class: 'empty' }, 'Chargement…'));
    try {
      settings = await call('/api/salon/settings');
      return true;
    } catch (err) {
      view().replaceChildren(h('p', { class: 'notice notice--error', role: 'alert' }, err.message));
      return false;
    }
  }

  async function save(body) {
    settings = await call('/api/salon/settings', { method: 'PUT', body });
    await onSaved();
  }

  /** Pied d'un brouillon : le message d'erreur, « Enregistrer » et « Annuler les modifications ». */
  function draftFooter({ onSave, onReset, saved }) {
    const error = h('p', { class: 'notice notice--error', role: 'alert', hidden: true });
    const submit = h('button', { type: 'submit', class: 'btn' }, h('span', {}, 'Enregistrer'), icon('check'));
    const footer = h('div', { class: 'editor-footer' }, error,
      h('div', { class: 'sheet-actions' }, submit,
        h('button', { type: 'button', class: 'link', onclick: onReset }, 'Annuler les modifications')));
    const submitDraft = async event => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      try {
        await onSave();
        toast(saved);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        error.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } finally {
        submit.disabled = false;
      }
    };
    return { footer, submitDraft };
  }

  // ── Tarifs ──────────────────────────────────────────────────────────────

  const PRICES_LEAD = 'Changez un nom, une durée ou un prix, puis enregistrez : le site est à jour tout de suite. Les rendez-vous déjà pris gardent leur prix et leur durée.';

  async function mountPrices() {
    if (!(await open(PRICES_LEAD))) return;
    const step = settings.slotStep;
    const durations = Array.from({ length: Math.floor(600 / step) }, (_, i) => (i + 1) * step);

    const toDraft = item => {
      const amounts = (item.prices || [item.price]).map(amount => String(amount).replace('.', ','));
      const mode = amounts.length === 3 ? 'lengths' : amounts.length === 2 ? 'two' : item.priceFrom ? 'from' : 'single';
      return { id: item.id, name: item.name, duration: item.duration, mode, amounts, featured: Boolean(item.featured) };
    };
    const draft = {
      priceNote: settings.priceNote,
      categories: settings.categories.map(category => ({ name: category.name, items: category.items.map(toDraft) })),
    };
    const blank = () => ({ id: '', name: '', duration: step, mode: 'single', amounts: [''], featured: false });

    const body = h('div', { class: 'editor' });

    function row(category, item, index) {
      const name = h('input', { type: 'text', maxlength: '60', value: item.name, required: true, oninput: event => { item.name = event.target.value; } });
      const duration = h('select', { onchange: event => { item.duration = Number(event.target.value); } },
        durations.map(minutes => h('option', { value: String(minutes), selected: minutes === item.duration }, durationLabel(minutes))));
      const mode = h('select', {
        onchange: event => {
          item.mode = event.target.value;
          // On garde ce qui a déjà été saisi : le premier prix reste, les autres cases s'ajoutent vides.
          item.amounts = PRICE_MODES[item.mode].amounts.map((_, i) => item.amounts[i] || '');
          render();
        },
      }, Object.entries(PRICE_MODES).map(([key, value]) => h('option', { value: key, selected: key === item.mode }, value.label)));
      const amounts = PRICE_MODES[item.mode].amounts.map((label, i) => field({
        id: uid('tarif-prix'),
        label,
        control: h('input', { type: 'text', inputmode: 'decimal', maxlength: '8', class: 'amount', value: item.amounts[i] || '', required: true, oninput: event => { item.amounts[i] = event.target.value; } }),
      }));
      const featuredId = uid('tarif-une');
      return h('li', { class: 'editor-row' },
        h('div', { class: 'editor-main' },
          field({ id: uid('tarif-nom'), label: 'Prestation', control: name }),
          field({ id: uid('tarif-duree'), label: 'Durée', control: duration }),
          field({ id: uid('tarif-mode'), label: 'Type de prix', control: mode })),
        h('div', { class: 'editor-amounts' }, amounts, h('span', { class: 'editor-unit', 'aria-hidden': 'true' }, '€')),
        h('div', { class: 'editor-tools' },
          h('label', { class: 'check', for: featuredId },
            h('input', { type: 'checkbox', id: featuredId, checked: item.featured, onchange: event => { item.featured = event.target.checked; } }),
            h('span', {}, 'À la une')),
          iconButton('chevron-up', `Monter ${item.name || 'cette prestation'}`, () => { swap(category.items, index, -1); render(); }, { disabled: index === 0 }),
          iconButton('chevron-down', `Descendre ${item.name || 'cette prestation'}`, () => { swap(category.items, index, 1); render(); }, { disabled: index === category.items.length - 1 }),
          iconButton('trash', `Retirer ${item.name || 'cette prestation'}`, () => { category.items.splice(index, 1); render(); }, { danger: true })));
    }

    function block(category, index) {
      const title = h('input', { type: 'text', maxlength: '40', value: category.name, required: true, oninput: event => { category.name = event.target.value; } });
      return h('section', { class: 'editor-category' },
        h('div', { class: 'editor-category-head' },
          field({ id: uid('tarif-categorie'), label: 'Catégorie', control: title }),
          h('div', { class: 'editor-tools' },
            iconButton('chevron-up', `Monter la catégorie ${category.name}`, () => { swap(draft.categories, index, -1); render(); }, { disabled: index === 0 }),
            iconButton('chevron-down', `Descendre la catégorie ${category.name}`, () => { swap(draft.categories, index, 1); render(); }, { disabled: index === draft.categories.length - 1 }),
            iconButton('trash', `Supprimer la catégorie ${category.name} et ses prestations`, () => { draft.categories.splice(index, 1); render(); }, { danger: true }))),
        h('ul', { class: 'editor-rows' }, category.items.map((item, i) => row(category, item, i))),
        h('button', { type: 'button', class: 'btn btn--small btn--outline', onclick: () => { category.items.push(blank()); render({ focusLast: category }); } },
          icon('plus'), h('span', {}, 'Ajouter une prestation')));
    }

    function render({ focusLast = null } = {}) {
      body.replaceChildren(...draft.categories.map(block),
        h('button', { type: 'button', class: 'btn btn--small btn--outline', onclick: () => { draft.categories.push({ name: '', items: [blank()] }); render({ focusLast: 'category' }); } },
          icon('plus'), h('span', {}, 'Ajouter une catégorie')));
      if (focusLast === 'category') body.querySelector('.editor-category:last-of-type .editor-category-head input')?.focus();
      else if (focusLast) body.querySelectorAll('.editor-category')[draft.categories.indexOf(focusLast)]?.querySelector('.editor-row:last-child input')?.focus();
    }

    const note = h('input', { type: 'text', maxlength: '160', value: draft.priceNote, oninput: event => { draft.priceNote = event.target.value; } });
    const { footer, submitDraft } = draftFooter({
      saved: 'La carte est enregistrée : le site est à jour.',
      onReset: mountPrices,
      onSave: async () => {
        await save({ services: {
          priceNote: draft.priceNote,
          categories: draft.categories.map(category => ({
            name: category.name,
            items: category.items.map(item => ({
              id: item.id, name: item.name, duration: item.duration, featured: item.featured,
              ...(item.amounts.length > 1 ? { prices: item.amounts } : { price: item.amounts[0], priceFrom: item.mode === 'from' }),
            })),
          })),
        } });
        mountPrices();
      },
    });

    render();
    view().replaceChildren(
      h('p', { class: 'view-lead' }, PRICES_LEAD),
      h('form', { class: 'editor-form', novalidate: true, onsubmit: submitDraft },
        body,
        field({ id: 'tarif-note', label: 'Note affichée avec les tarifs', optional: true, control: note }),
        footer));
  }

  // ── Horaires ────────────────────────────────────────────────────────────

  const HOURS_LEAD = "Vos horaires habituels, semaine après semaine. Pour des congés ou un jour férié, passez par l'onglet Fermetures. Les rendez-vous déjà pris restent enregistrés.";

  async function mountHours() {
    if (!(await open(HOURS_LEAD))) return;
    const step = settings.slotStep;
    const times = [];
    for (let minutes = 6 * 60; minutes <= 22 * 60; minutes += step) times.push(fromMinutes(minutes));
    const draft = Object.fromEntries(DAYS.map(([day]) => [day, (settings.hours[day] || []).map(range => [...range])]));
    const body = h('ul', { class: 'hours-editor' });

    const timeLabel = time => `${Number(time.slice(0, 2))}h${time.slice(3) === '00' ? '' : time.slice(3)}`;
    const timeSelect = (value, label, onchange) => h('select', { 'aria-label': label, onchange: event => onchange(event.target.value) },
      // Une heure déjà enregistrée hors de la liste (avant 6h, après 22h) reste proposée.
      [...new Set([...times, value])].sort().map(time => h('option', { value: time, selected: time === value }, timeLabel(time))));

    /** Une coupure au milieu de la journée : la plage unique est partagée autour de midi. */
    function addBreak(ranges) {
      const [from, to] = ranges.at(-1);
      if (ranges.length === 1 && from < '12:30' && to > '13:30') ranges.splice(0, 1, [from, '12:30'], ['13:30', to]);
      else ranges.push([to, times.find(time => time > to) || to]);
    }

    function render() {
      // Un jour qu'on rouvre reprend les horaires du premier jour ouvert.
      const usual = Object.values(draft).find(ranges => ranges.length) || [['09:00', '18:00']];
      body.replaceChildren(...DAYS.map(([day, name]) => {
        const ranges = draft[day];
        const id = uid('horaire-jour');
        return h('li', { class: `hours-row${ranges.length ? '' : ' is-closed'}` },
          h('label', { class: 'check hours-day', for: id },
            h('input', { type: 'checkbox', id, checked: ranges.length > 0, onchange: event => { draft[day] = event.target.checked ? usual.map(range => [...range]) : []; render(); } }),
            h('strong', {}, name)),
          ranges.length
            ? h('div', { class: 'hours-ranges' },
              ranges.map((range, i) => h('span', { class: 'hours-range' },
                timeSelect(range[0], `${name}, ouverture${ranges.length > 1 ? ` de la plage ${i + 1}` : ''}`, value => { range[0] = value; }),
                h('span', { 'aria-hidden': 'true' }, '–'),
                timeSelect(range[1], `${name}, fermeture${ranges.length > 1 ? ` de la plage ${i + 1}` : ''}`, value => { range[1] = value; }),
                ranges.length > 1 ? iconButton('close', `${name} : retirer la plage ${i + 1}`, () => { ranges.splice(i, 1); render(); }) : null)),
              ranges.length < 3 ? h('button', { type: 'button', class: 'link', onclick: () => { addBreak(ranges); render(); } }, 'Ajouter une pause') : null)
            : h('p', { class: 'hours-closed' }, 'Fermé'));
      }));
    }

    const { footer, submitDraft } = draftFooter({
      saved: 'Les horaires sont enregistrés : le site et les créneaux sont à jour.',
      onReset: mountHours,
      onSave: async () => {
        await save({ hours: draft });
        mountHours();
      },
    });

    render();
    view().replaceChildren(
      h('p', { class: 'view-lead' }, HOURS_LEAD),
      h('form', { class: 'editor-form', novalidate: true, onsubmit: submitDraft }, body, footer));
  }

  // ── Photos ──────────────────────────────────────────────────────────────

  const PHOTOS_LEAD = 'Les photos de la page « En images » et de la une. Ajoutez-en depuis votre téléphone ou votre ordinateur : elles sont allégées toutes seules.';
  const DEFAULT_ALT = 'Coiffure réalisée au salon';

  async function mountPhotos() {
    if (!(await open(PHOTOS_LEAD))) return;
    const status = h('p', { class: 'photo-status', role: 'status' });
    const body = h('div', { class: 'photo-editor' });
    let asking = ''; // adresse de la photo dont on confirme la suppression
    let busy = false;

    const photos = () => settings.photos;

    /** Enregistre la liste telle qu'elle est (ou telle qu'on la donne), puis redessine. */
    async function persist(next, message) {
      try {
        await save({ photos: { hero: photos().hero, second: photos().second, ...next, gallery: (next.gallery || photos().gallery).map(({ src, alt }) => ({ src, alt })) } });
        if (message) toast(message);
        status.textContent = '';
      } catch (err) {
        status.textContent = err.message;
      }
      asking = '';
      render();
    }

    async function addFiles(files) {
      if (busy || !files.length) return;
      busy = true;
      const added = [];
      let failed = 0;
      for (const [i, file] of files.entries()) {
        status.textContent = files.length > 1 ? `Envoi de la photo ${i + 1} sur ${files.length}…` : 'Envoi de la photo…';
        try {
          const { photo } = await call('/api/salon/photos', { method: 'POST', body: await preparePhoto(file) });
          added.push({ src: photo.src, alt: DEFAULT_ALT });
        } catch (err) {
          failed += 1;
          status.textContent = err.status ? err.message : `« ${file.name} » n'a pas pu être lue : choisissez une photo au format JPEG, PNG ou WebP.`;
        }
      }
      busy = false;
      if (!added.length) return;
      const note = failed ? ` ${failed} photo${failed > 1 ? "s n'ont" : " n'a"} pas pu être ajoutée${failed > 1 ? 's' : ''}.` : '';
      await persist({ gallery: [...added, ...photos().gallery] }, `${added.length > 1 ? `${added.length} photos ajoutées` : 'Photo ajoutée'} : pensez à la décrire en quelques mots.${note}`);
    }

    function card(photo, index) {
      const list = photos().gallery;
      const altId = uid('photo-description');
      const alt = h('input', {
        type: 'text', id: altId, maxlength: '120', value: photo.alt,
        onchange: event => {
          const text = event.target.value.trim();
          if (!text) {
            event.target.value = photo.alt;
            status.textContent = 'Chaque photo a besoin de quelques mots de description (ils sont lus par Google et aux personnes malvoyantes).';
            return;
          }
          persist({ gallery: list.map(other => (other === photo ? { ...other, alt: text } : other)) }, 'Description enregistrée.');
        },
      });
      const role = photo.src === photos().hero ? 'Grande photo de la une' : photo.src === photos().second ? 'Seconde photo de la une' : '';
      const moved = delta => {
        const next = [...list];
        swap(next, index, delta);
        persist({ gallery: next });
      };
      return h('li', { class: 'photo-card' },
        h('div', { class: 'photo-thumb' },
          h('img', { src: photo.thumb, alt: '', loading: 'lazy' }),
          role ? h('span', { class: 'badge badge--pending' }, role) : null),
        h('div', { class: 'field' }, h('label', { for: altId }, 'Description'), alt),
        asking === photo.src
          ? h('div', { class: 'sheet-actions' },
            h('p', { class: 'sheet-question' }, 'Supprimer cette photo ?'),
            h('button', { type: 'button', class: 'btn btn--small btn--danger', onclick: () => persist({ gallery: list.filter(other => other !== photo) }, 'Photo supprimée.') }, h('span', {}, 'Oui, supprimer')),
            h('button', { type: 'button', class: 'btn btn--small btn--outline', onclick: () => { asking = ''; render(); } }, h('span', {}, 'Non')))
          : h('div', { class: 'editor-tools' },
            iconButton('chevron-left', 'Placer cette photo avant', () => moved(-1), { disabled: index === 0 }),
            iconButton('chevron-right', 'Placer cette photo après', () => moved(1), { disabled: index === list.length - 1 }),
            iconButton('trash', 'Supprimer cette photo', () => { asking = photo.src; render(); }, { disabled: list.length === 1, danger: true })));
    }

    function render() {
      const list = photos().gallery;
      const choice = (value, onchange, { none = false } = {}) => h('select', { onchange: event => onchange(event.target.value) },
        [none ? h('option', { value: '', selected: !value }, 'Aucune') : null,
          ...list.map((photo, i) => h('option', { value: photo.src, selected: photo.src === value }, `${i + 1}. ${photo.alt}`))]);
      const input = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr-only', id: 'photo-fichiers', onchange: event => { const files = [...event.target.files]; event.target.value = ''; addFiles(files); } });
      body.replaceChildren(
        h('div', { class: 'photo-bar' },
          h('label', { class: 'btn', for: 'photo-fichiers' }, icon('plus'), h('span', {}, 'Ajouter des photos')),
          input,
          h('div', { class: 'field-row' },
            field({ id: 'photo-une', label: 'Grande photo de la une', control: choice(photos().hero, src => persist({ hero: src, second: photos().second === src ? '' : photos().second }, 'La une est à jour.')) }),
            field({ id: 'photo-seconde', label: 'Photo placée à côté', control: choice(photos().second, src => persist({ second: src === photos().hero ? '' : src }, 'La une est à jour.'), { none: true }) }))),
        h('ul', { class: 'photo-grid' }, list.map(card)));
    }

    render();
    view().replaceChildren(h('p', { class: 'view-lead' }, PHOTOS_LEAD), status, body);
  }

  return { mountPrices, mountHours, mountPhotos };
}
