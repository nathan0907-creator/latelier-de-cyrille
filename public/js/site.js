// Comportements communs à toutes les pages du site.
//
// Principe du mouvement : le script mesure (défilement, curseur) et publie des valeurs
// simples — une classe « is-in », une progression --p entre 0 et 1 — et c'est le CSS qui
// décide de l'effet. Rien n'est indispensable : sans script, ou si le visiteur préfère
// moins de mouvement, tout le contenu est affiché dans son état final.

const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (from, to, amount) => from + (to - from) * amount;

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// ── Horloge commune ───────────────────────────────────────────────────────
// Une seule boucle d'animation pour tout le site ; elle s'arrête dès que plus rien ne bouge.
// Une tâche renvoie true tant qu'elle a encore besoin d'images.

const ticker = (() => {
  const tasks = [];
  let running = false;
  function frame() {
    let active = false;
    for (const task of tasks) if (task() === true) active = true;
    if (active) requestAnimationFrame(frame);
    else running = false;
  }
  return {
    add(task) {
      tasks.push(task);
      this.wake();
    },
    wake() {
      if (running) return;
      running = true;
      requestAnimationFrame(frame);
    },
  };
})();

// Position de défilement « amortie » : elle rattrape la position réelle avec un léger retard,
// ce qui donne du poids aux effets qui la suivent. velocity = vitesse du moment.
const scroll = { y: scrollY, smooth: scrollY, velocity: 0 };

ticker.add(() => {
  scroll.y = scrollY;
  const before = scroll.smooth;
  scroll.smooth = reducedMotion ? scroll.y : lerp(scroll.smooth, scroll.y, 0.14);
  if (Math.abs(scroll.y - scroll.smooth) < 0.1) scroll.smooth = scroll.y;
  scroll.velocity = scroll.smooth - before;
  return scroll.smooth !== scroll.y;
});
addEventListener('scroll', () => ticker.wake(), { passive: true });
addEventListener('resize', () => ticker.wake(), { passive: true });

// ── Apparitions ───────────────────────────────────────────────────────────

function initReveals() {
  const setDelay = (el, ms) => el.style.setProperty('--d', `${ms}ms`);

  for (const el of document.querySelectorAll('[data-reveal][data-delay]')) setDelay(el, Number(el.dataset.delay));

  // Groupe [data-stagger] : chaque enfant arrive 90 ms après le précédent (six rangs au plus,
  // pour que l'ensemble se lise comme un seul geste).
  for (const group of document.querySelectorAll('[data-stagger]')) {
    const base = Number(group.dataset.delay) || 0;
    [...group.children].forEach((child, i) => setDelay(child, base + Math.min(i, 6) * 90));
  }

  // Titres : rang de chaque mot dans la cascade.
  for (const title of document.querySelectorAll('[data-reveal="lines"]')) {
    title.querySelectorAll('.w-i').forEach((word, i) => word.style.setProperty('--i', Math.min(i, 10)));
  }

  const items = document.querySelectorAll('[data-reveal]');
  if (reducedMotion || !('IntersectionObserver' in window)) {
    items.forEach(el => el.classList.add('is-in'));
    return;
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });

  // Ce qui est déjà à l'écran au chargement entre en scène tout de suite ; le reste attend le défilement.
  // (Un élément masqué est décalé vers le bas : près du bord de l'écran, l'observateur seul le manquerait.)
  const viewport = innerHeight;
  for (const el of items) {
    if (el.getBoundingClientRect().top < viewport) el.classList.add('is-in');
    else observer.observe(el);
  }
}

// ── Effets liés au défilement ─────────────────────────────────────────────
// Chaque élément [data-scrub] reçoit --p, sa progression entre 0 et 1 :
//   (vide)  traversée de l'écran, du bas vers le haut (photo qui glisse dans son cadre) ;
//   pin     section épinglée, plus haute que l'écran (bande de photos de la une).

function initScrub() {
  const items = [...document.querySelectorAll('[data-scrub]')].map(el => ({
    el,
    type: el.dataset.scrub || 'view',
    // Une photo qui glisse dans son cadre se mesure sur le cadre, qui, lui, ne bouge pas.
    box: el.classList.contains('frame-inner') ? el.parentElement : el,
    top: 0,
    height: 0,
    last: -1,
  }));

  if (!items.length || reducedMotion) return () => {};

  function measure() {
    const y = scrollY;
    for (const item of items) {
      const rect = item.box.getBoundingClientRect();
      item.top = rect.top + y;
      item.height = rect.height;
    }
    ticker.wake();
  }

  ticker.add(() => {
    const y = scroll.smooth;
    const vh = innerHeight;
    for (const item of items) {
      const progress = clamp(item.type === 'pin'
        ? (y - item.top) / Math.max(1, item.height - vh)
        : (y + vh - item.top) / (vh + item.height));
      if (Math.abs(progress - item.last) < 0.0005) continue;
      item.last = progress;
      item.el.style.setProperty('--p', progress.toFixed(4));
    }
    return false;
  });

  measure();
  addEventListener('resize', debounce(measure, 150), { passive: true });
  addEventListener('load', measure);
  // La hauteur de la page change quand polices et photos arrivent : on remesure.
  if ('ResizeObserver' in window) new ResizeObserver(debounce(measure, 150)).observe(document.body);
  return measure;
}

// ── Gros titre à la mesure de la page ─────────────────────────────────────
// [data-fit] : la taille du texte est réglée pour que sa ligne la plus large remplisse la
// largeur disponible, sans dépasser --fit-max (défini en CSS). Sans script, la taille prévue
// par la feuille de style s'applique.

function initFit() {
  const titles = [...document.querySelectorAll('[data-fit]')];
  if (!titles.length) return;

  const fit = () => {
    const rem = parseFloat(getComputedStyle(root).fontSize);
    for (const el of titles) {
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize);
      const available = el.parentElement.clientWidth;
      // Largeur naturelle : sans retour à la ligne ni justification.
      el.style.whiteSpace = 'nowrap';
      el.style.width = 'max-content';
      el.style.justifySelf = 'start';
      const natural = el.getBoundingClientRect().width;
      el.style.whiteSpace = '';
      el.style.width = '';
      el.style.justifySelf = '';
      if (!natural || !available) continue;
      const max = parseFloat(getComputedStyle(el).getPropertyValue('--fit-max')) * rem || Infinity;
      el.style.fontSize = `${Math.min(max, (base * available * 0.975) / natural).toFixed(1)}px`;
    }
  };

  fit();
  document.fonts?.ready.then(fit);
  addEventListener('resize', debounce(fit, 150), { passive: true });
}

// ── Bande de photos épinglée (la une) ─────────────────────────────────────

function initHorizontalGallery() {
  const section = document.querySelector('[data-hgallery]');
  if (!section) return;
  const track = section.querySelector('[data-hgallery-track]');
  const wide = matchMedia('(min-width: 56rem)');

  const update = () => {
    const pin = wide.matches && !reducedMotion;
    root.classList.toggle('can-pin', pin);
    // Distance à faire parcourir à la bande = sa largeur moins celle de l'écran.
    section.style.setProperty('--travel', pin ? `${Math.max(0, track.scrollWidth - root.clientWidth)}px` : '0px');
  };

  update();
  addEventListener('resize', debounce(update, 150), { passive: true });
  addEventListener('load', update);
  document.fonts?.ready.then(update);
}

// ── Bandeau « dernière minute » : il s'emballe quand on fait défiler la page ──

function initMarquee() {
  const marquee = document.querySelector('[data-marquee]');
  const track = marquee?.querySelector('.ticker-track');
  if (!track || reducedMotion) return;
  let animation = null;
  let rate = 1;

  ticker.add(() => {
    animation ||= track.getAnimations()[0];
    const target = 1 + Math.min(Math.abs(scroll.velocity) * 0.22, 5);
    rate = lerp(rate, target, 0.08);
    if (animation) animation.playbackRate = rate;
    return Math.abs(rate - 1) > 0.01;
  });
}

// ── En-tête : se cache en descendant, revient en remontant ────────────────

function initHeader() {
  const header = document.querySelector('[data-header]');
  const bar = document.querySelector('[data-scroll-progress]');
  if (!header) return;
  // Sur la une, le titre de la barre n'apparaît qu'une fois la manchette passée.
  const nameplate = document.querySelector('.nameplate');
  let last = scrollY;

  ticker.add(() => {
    const y = scroll.y;
    header.classList.toggle('is-solid', y > (nameplate ? nameplate.offsetTop + nameplate.offsetHeight * 0.6 : 24));
    // Téléphone : la barre de réservation du bas se montre une fois la page entamée.
    root.classList.toggle('dock-on', y > 360);
    if (Math.abs(y - last) > 6) {
      header.classList.toggle('is-hidden', y > last && y > 180);
      last = y;
    }
    if (bar) {
      const max = root.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? clamp(scroll.smooth / max).toFixed(4) : 0})`;
    }
    return false;
  });
  header.addEventListener('focusin', () => header.classList.remove('is-hidden'));
}

// ── Sommaire (menu des petits écrans) ─────────────────────────────────────

function initMenu() {
  const toggle = document.querySelector('[data-menu-toggle]');
  const nav = document.getElementById('menu');
  if (!toggle || !nav) return;
  const label = toggle.querySelector('.menu-toggle-label');
  const behind = [document.querySelector('main'), document.querySelector('.site-footer')].filter(Boolean);

  const isOpen = () => root.classList.contains('nav-open');
  const setOpen = open => {
    root.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    label.textContent = open ? 'Fermer' : 'Sommaire';
    behind.forEach(el => { el.inert = open; }); // le reste de la page sort du parcours clavier
  };

  toggle.addEventListener('click', () => setOpen(!isOpen()));
  nav.addEventListener('click', event => {
    if (event.target.closest('a')) setOpen(false);
  });
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });
  matchMedia('(min-width: 62.01rem)').addEventListener('change', event => {
    if (event.matches) setOpen(false);
  });
}

// ── Boutons « aimantés » : suivent légèrement le curseur ─────────────────

function initMagnetic() {
  if (reducedMotion || !finePointer) return;
  for (const el of document.querySelectorAll('[data-magnetic]')) {
    el.addEventListener('pointermove', event => {
      const rect = el.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) * 0.22;
      const y = (event.clientY - rect.top - rect.height / 2) * 0.22;
      el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.translate = '';
    });
  }
}

// ── Curseur d'accompagnement : un anneau qui grossit sur les liens et nomme l'action ──

function initCursor() {
  if (reducedMotion || !finePointer) return;
  const cursor = document.createElement('div');
  cursor.className = 'cursor';
  cursor.setAttribute('aria-hidden', 'true');
  const ring = document.createElement('span');
  ring.className = 'cursor-ring';
  const label = document.createElement('span');
  label.className = 'cursor-label';
  cursor.append(ring, label);
  document.body.append(cursor);

  const position = { x: 0, y: 0, tx: 0, ty: 0, seen: false };

  addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    position.tx = event.clientX;
    position.ty = event.clientY;
    if (!position.seen) {
      position.seen = true;
      position.x = position.tx;
      position.y = position.ty;
    }
    const target = event.target instanceof Element ? event.target : null;
    const named = target?.closest('[data-cursor]');
    const field = target?.closest('input, textarea, select');
    cursor.classList.toggle('is-visible', !field);
    cursor.classList.toggle('is-label', Boolean(named));
    cursor.classList.toggle('is-link', !named && Boolean(target?.closest('a, button, summary, label')));
    if (named) label.textContent = named.dataset.cursor;
    ticker.wake();
  }, { passive: true });

  root.addEventListener('pointerleave', () => cursor.classList.remove('is-visible'));

  ticker.add(() => {
    position.x = lerp(position.x, position.tx, 0.22);
    position.y = lerp(position.y, position.ty, 0.22);
    cursor.style.transform = `translate3d(${position.x.toFixed(1)}px, ${position.y.toFixed(1)}px, 0)`;
    return Math.abs(position.tx - position.x) > 0.2 || Math.abs(position.ty - position.y) > 0.2;
  });
}

// ── Photo introuvable : image de secours ──────────────────────────────────

function initImageFallback() {
  const useFallback = img => {
    if (img.dataset.fallback) return;
    img.dataset.fallback = '1';
    img.removeAttribute('srcset');
    img.src = '/img/placeholder.svg';
    img.classList.add('is-missing');
  };
  document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement) useFallback(event.target);
  }, true);
  for (const img of document.querySelectorAll('img')) {
    if (img.complete && img.currentSrc && img.naturalWidth === 0) useFallback(img);
  }
}

// ── « Prochain créneau », tenu à jour en direct ───────────────────────────
// (Il est imprimé à plusieurs endroits de la une : bandeau, oreille de la manchette, encadré.)

function initNextSlot() {
  const targets = [...document.querySelectorAll('[data-next-slot-label]')];
  if (!targets.length || !('EventSource' in window)) return;
  let current = targets[0].textContent.trim();

  async function refresh() {
    try {
      const response = await fetch('/api/next-slot', { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const { slot } = await response.json();
      const text = slot ? slot.label : 'voir les disponibilités';
      if (text === current) return;
      current = text;
      for (const target of targets) {
        target.textContent = text;
        if (reducedMotion) continue;
        target.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
          { duration: 500, easing: 'cubic-bezier(.16, 1, .3, 1)' });
      }
    } catch {
      // Hors ligne : on garde la dernière valeur connue.
    }
  }

  const source = new EventSource('/api/events');
  source.addEventListener('slots', debounce(refresh, 400));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  addEventListener('pagehide', () => source.close());
}

// ── Carte Google Maps : chargée seulement à la demande du visiteur ───────

function initMap() {
  const map = document.querySelector('[data-map]');
  if (!map) return;
  const KEY = 'carte-google';

  const load = ({ focus = false } = {}) => {
    const iframe = document.createElement('iframe');
    iframe.src = map.dataset.src;
    iframe.title = map.dataset.title;
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    iframe.allowFullscreen = true;
    map.querySelector('.map-facade')?.remove();
    map.append(iframe);
    if (focus) iframe.focus();
    try {
      localStorage.setItem(KEY, 'oui');
    } catch {
      // Stockage indisponible (navigation privée) : le choix ne sera pas mémorisé.
    }
  };

  map.querySelector('[data-map-load]')?.addEventListener('click', () => load({ focus: true }));
  try {
    if (localStorage.getItem(KEY) === 'oui') load();
  } catch {
    // Pas de stockage : la carte reste à la demande.
  }
}

// ── Démarrage ─────────────────────────────────────────────────────────────

initImageFallback();
initFit();
initHorizontalGallery();
initScrub();
initMarquee();
initHeader();
initMenu();
initMagnetic();
initCursor();
initNextSlot();
initMap();

// Le rideau d'ouverture (première page de la visite) : le journal est coupé en deux au bout
// d'une seconde et demie. Les apparitions démarrent à ce moment-là, pour que la une entre
// en scène pendant que les deux moitiés s'écartent.
const intro = document.querySelector('.intro');
const introPlaying = root.classList.contains('intro-on') && Boolean(intro);
setTimeout(initReveals, introPlaying ? 1450 : 0);
if (introPlaying) setTimeout(() => intro.remove(), 2800);

window.__siteReady = true;
