// Page « Votre rendez-vous » : le bouton d'annulation, et la page tenue à jour si le salon confirme,
// déplace ou annule le rendez-vous pendant qu'elle est ouverte. Le reste de la page vient du serveur.

import { api, readPageData } from './lib.js';

const root = document.querySelector('[data-cancel]');
const { ref, state, lateIn = 0 } = readPageData();
// À partir de ce moment, annuler compte comme une annulation de dernière minute (avertissement).
const lateAt = Date.now() + lateIn * 60_000;
const MINE_KEY = 'mes-rendez-vous';

/** La page de réservation n'a plus à proposer ce rendez-vous sur cet appareil. */
function forget() {
  try {
    const kept = JSON.parse(localStorage.getItem(MINE_KEY) || '[]').filter(item => item.ref !== ref);
    localStorage.setItem(MINE_KEY, JSON.stringify(kept));
  } catch {
    // Stockage indisponible : rien à nettoyer.
  }
}

if (ref && state?.startsWith('cancelled')) forget();

/** Le rendez-vous a changé côté salon : la page rechargée le montre. */
async function check() {
  if (!ref || document.hidden || state?.startsWith('cancelled')) return;
  try {
    const { bookings: [found] } = await api('/api/bookings/mine', { method: 'POST', body: { refs: [ref] } });
    const now = found?.booking ? `${found.booking.status} ${found.booking.date} ${found.booking.time}` : '';
    if (now !== state) location.reload();
  } catch {
    // Hors ligne : on réessaiera.
  }
}
document.addEventListener('visibilitychange', check);
setInterval(check, 2 * 60_000);

if (root && ref) {
  const ask = root.querySelector('[data-cancel-ask]');
  const confirm = root.querySelector('[data-cancel-confirm]');
  const yes = root.querySelector('[data-cancel-yes]');
  const error = root.querySelector('[data-cancel-error]');
  const reason = root.querySelector('[data-cancel-reason]');

  const late = root.querySelector('[data-cancel-late]');
  const asking = on => {
    // Avertir avant de confirmer : la page a pu rester ouverte jusqu'à la dernière minute.
    if (on && late) {
      late.hidden = Date.now() < lateAt;
      yes.querySelector('span').textContent = late.hidden ? 'Oui, annuler' : 'Annuler quand même';
    }
    ask.hidden = on;
    confirm.hidden = !on;
    (on ? reason : ask).focus();
  };
  ask.addEventListener('click', () => asking(true));
  root.querySelector('[data-cancel-no]').addEventListener('click', () => asking(false));

  // Depuis le bouton « Annuler » du rappel : la question est posée tout de suite.
  if (new URLSearchParams(location.search).has('annuler')) asking(true);

  yes.addEventListener('click', async () => {
    error.hidden = true;
    if (reason.value.trim().length < 2) {
      error.textContent = "Indiquez la raison de l'annulation : elle est transmise au salon.";
      error.hidden = false;
      reason.focus();
      return;
    }
    yes.disabled = true;
    try {
      await api('/api/bookings/cancel', { method: 'POST', body: { ref, reason: reason.value } });
    } catch (err) {
      // Déjà annulé (un autre onglet, le salon) : la page rechargée le dira.
      if (err.status !== 409) {
        error.textContent = err.message;
        error.hidden = false;
        yes.disabled = false;
        return;
      }
    }
    forget();
    location.reload();
  });
}
