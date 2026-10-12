// Chargé dans <head>, avant l'affichage.
(function () {
  var root = document.documentElement;

  // JavaScript est actif : les états « masqué avant apparition » des animations sont autorisés.
  root.classList.add('js');

  // Rideau d'ouverture : une seule fois par visite, jamais si le visiteur préfère moins de mouvement.
  try {
    var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!calm && location.pathname !== '/salon' && !sessionStorage.getItem('rideau')) {
      sessionStorage.setItem('rideau', 'vu');
      root.classList.add('intro-on');
    }
  } catch (error) {
    // Stockage indisponible (navigation privée stricte) : pas de rideau, le site s'affiche directement.
  }

  // Filet de sécurité : si le script principal ne démarre pas, tout le contenu est affiché.
  setTimeout(function () {
    if (!window.__siteReady) root.classList.add('reveal-all');
  }, 4000);
})();
