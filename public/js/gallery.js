// Galerie : visionneuse plein écran (clavier, flèches, balayage tactile).

const dialog = document.querySelector('[data-lightbox]');
const thumbs = [...document.querySelectorAll('[data-gallery] .masonry-button')];

if (dialog && thumbs.length && typeof dialog.showModal === 'function') {
  const image = dialog.querySelector('[data-lightbox-image]');
  const caption = dialog.querySelector('[data-lightbox-caption]');
  const count = dialog.querySelector('[data-lightbox-count]');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0;

  function show(next, direction = 0) {
    index = (next + thumbs.length) % thumbs.length;
    const thumb = thumbs[index];
    const small = thumb.querySelector('img');

    // La vignette déjà chargée s'affiche tout de suite ; la grande photo la remplace dès qu'elle arrive.
    image.src = small.currentSrc || small.src;
    image.alt = thumb.dataset.caption;
    caption.textContent = thumb.dataset.caption;
    count.textContent = `${index + 1} / ${thumbs.length}`;

    const full = new Image();
    full.onload = () => {
      if (thumbs[index] === thumb) image.src = thumb.dataset.full;
    };
    full.src = thumb.dataset.full;

    if (!reducedMotion) {
      image.animate(
        [{ opacity: 0, transform: `translateX(${direction * 48}px) scale(.985)` }, { opacity: 1, transform: 'none' }],
        { duration: 480, easing: 'cubic-bezier(.16, 1, .3, 1)' },
      );
    }
  }

  const previous = () => show(index - 1, -1);
  const next = () => show(index + 1, 1);

  thumbs.forEach((thumb, i) => {
    thumb.addEventListener('click', () => {
      show(i);
      dialog.showModal();
    });
  });

  dialog.querySelector('[data-lightbox-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-lightbox-prev]').addEventListener('click', previous);
  dialog.querySelector('[data-lightbox-next]').addEventListener('click', next);

  // Un clic sur le fond (la boîte elle-même, pas son contenu) ferme la visionneuse.
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') previous();
    if (event.key === 'ArrowRight') next();
  });

  // À la fermeture, le focus revient sur la vignette de la photo affichée.
  dialog.addEventListener('close', () => thumbs[index].focus());

  let startX = null;
  dialog.addEventListener('pointerdown', event => {
    startX = event.pointerType === 'mouse' ? null : event.clientX;
  });
  dialog.addEventListener('pointerup', event => {
    if (startX === null) return;
    const delta = event.clientX - startX;
    startX = null;
    if (Math.abs(delta) > 50) (delta < 0 ? next : previous)();
  });
}
