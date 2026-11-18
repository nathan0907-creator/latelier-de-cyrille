// Espace salon : les employées. La coiffeuse a toujours sa ligne dans l'agenda ; chaque employée
// ajoutée ici en reçoit une autre, où se notent ses rendez-vous. Supprimer une employée retire sa
// ligne : ses rendez-vous à venir reviennent sur celle de la coiffeuse.

import { h, icon } from './lib.js';

const plural = (count, one, many) => `${count} ${count > 1 ? many : one}`;

export function createStaffView({ state, call, toast, field, view, ownerName }) {
  let body = null;
  let asking = ''; // l'employée dont la suppression attend une réponse

  const upcomingOf = id => state.bookings.filter(b => b.staff === id && b.status !== 'cancelled' && b.date >= state.today).length;

  function mount() {
    asking = '';
    const error = h('p', { class: 'notice notice--error', role: 'alert', hidden: true });
    const name = h('input', { type: 'text', maxlength: '40', autocomplete: 'off', placeholder: 'Prénom', required: true });
    const submit = h('button', { type: 'submit', class: 'btn btn--small' }, icon('plus'), h('span', {}, 'Ajouter une ligne'));
    const form = h('form', { class: 'staff-add', novalidate: true },
      field({ id: 'employee-nom', label: 'Nouvelle employée', control: name }),
      submit,
      error);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      error.hidden = true;
      if (!name.value.trim()) {
        error.textContent = 'Indiquez son prénom.';
        error.hidden = false;
        name.focus();
        return;
      }
      submit.disabled = true;
      try {
        const result = await call('/api/salon/staff', { method: 'POST', body: { name: name.value } });
        state.staff = result.staff;
        name.value = '';
        toast(`${result.person.name} a sa ligne dans l'agenda.`, { title: 'Employée ajoutée' });
        render();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
      submit.disabled = false;
    });

    body = h('div', { class: 'staff-list' });
    view().replaceChildren(
      h('p', { class: 'view-lead' }, 'Une ligne par personne dans l’agenda de la journée. Les réservations en ligne vont toujours sur la ligne de la coiffeuse.'),
      body,
      form);
    render();
  }

  async function remove(person) {
    try {
      const result = await call(`/api/salon/staff/${person.id}`, { method: 'DELETE' });
      state.staff = result.staff;
      asking = '';
      toast(result.moved
        ? `${plural(result.moved, 'rendez-vous à venir est passé', 'rendez-vous à venir sont passés')} sur la ligne de ${ownerName}.`
        : 'Sa ligne est retirée de l’agenda.', { title: `${person.name} supprimée` });
      render();
    } catch (err) {
      toast(err.message, { title: 'Suppression impossible', type: 'error' });
    }
  }

  function render() {
    if (!body?.isConnected) return;
    const row = (person, meta, actions) => h('article', { class: 'row row--staff' },
      h('div', { class: 'row-main' },
        h('p', { class: 'row-name' }, h('span', {}, person.name)),
        h('p', { class: 'row-meta' }, meta)),
      h('div', { class: 'row-actions' }, actions));

    const rows = [row({ name: ownerName }, 'La coiffeuse · réservations en ligne', h('span', { class: 'badge badge--neutral' }, 'Ligne 1'))];
    state.staff.forEach((person, index) => {
      const upcoming = upcomingOf(person.id);
      const meta = `Ligne ${index + 2} · ${upcoming ? plural(upcoming, 'rendez-vous à venir', 'rendez-vous à venir') : 'aucun rendez-vous à venir'}`;
      if (asking === person.id) {
        rows.push(h('article', { class: 'row row--staff row--asking' },
          h('p', { class: 'sheet-question' }, `Supprimer la ligne de ${person.name} ?`,
            upcoming ? h('span', { class: 'field-hint' }, ` Ses ${plural(upcoming, 'rendez-vous à venir passera', 'rendez-vous à venir passeront')} sur la ligne de ${ownerName}.`) : null),
          h('div', { class: 'row-actions' },
            h('button', { type: 'button', class: 'btn btn--small btn--danger', onclick: () => remove(person) }, h('span', {}, 'Oui, supprimer'), icon('trash')),
            h('button', { type: 'button', class: 'btn btn--small btn--outline', onclick: () => { asking = ''; render(); } }, h('span', {}, 'Non')))));
        return;
      }
      rows.push(row(person, meta, h('button', {
        type: 'button', class: 'btn btn--small btn--outline', 'aria-label': `Supprimer la ligne de ${person.name}`,
        onclick: () => { asking = person.id; render(); },
      }, icon('trash'), h('span', {}, 'Supprimer'))));
    });
    body.replaceChildren(...rows);
  }

  return { mount, render };
}
