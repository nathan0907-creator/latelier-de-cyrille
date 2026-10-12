// Page « Votre rendez-vous » : le bouton d'annulation. Le reste de la page vient du serveur.

import { api, readPageData } from './lib.js';

const root = document.querySelector('[data-cancel]');
const { ref } = readPageData();

if (root && ref) {
  const ask = root.querySelector('[data-cancel-ask]');
  const confirm = root.querySelector('[data-cancel-confirm]');
  const yes = root.querySelector('[data-cancel-yes]');
  const error = root.querySelector('[data-cancel-error]');

  const asking = on => {
    ask.hidden = on;
    confirm.hidden = !on;
    (on ? yes : ask).focus();
  };
  ask.addEventListener('click', () => asking(true));
  root.querySelector('[data-cancel-no]').addEventListener('click', () => asking(false));

  yes.addEventListener('click', async () => {
    error.hidden = true;
    yes.disabled = true;
    try {
      await api('/api/bookings/cancel', { method: 'POST', body: { ref } });
    } catch (err) {
      // Déjà annulé (un autre onglet, le salon) : la page rechargée le dira.
      if (err.status !== 409) {
        error.textContent = err.message;
        error.hidden = false;
        yes.disabled = false;
        return;
      }
    }
    // La page de réservation n'a plus à le proposer sur cet appareil.
    try {
      const kept = JSON.parse(localStorage.getItem('mes-rendez-vous') || '[]').filter(item => item.ref !== ref);
      localStorage.setItem('mes-rendez-vous', JSON.stringify(kept));
    } catch {
      // Stockage indisponible : rien à nettoyer.
    }
    location.reload();
  });
}
