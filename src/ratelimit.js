'use strict';

/** Limiteur à fenêtre glissante, en mémoire : au plus `max` actions par `windowMs` et par clé. */
function createLimiter({ max, windowMs, now = Date.now }) {
  const hits = new Map();

  function recent(key, t) {
    const list = (hits.get(key) || []).filter(ts => t - ts < windowMs);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  }

  return {
    /** { ok: true } ou { ok: false, retryAfter: secondes } — sans rien compter. */
    check(key) {
      const t = now();
      const list = recent(key, t);
      if (list.length < max) return { ok: true };
      return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (t - list[0])) / 1000)) };
    },
    hit(key) {
      const t = now();
      const list = recent(key, t);
      list.push(t);
      hits.set(key, list);
    },
    /** Compte l'action si elle est permise. */
    take(key) {
      const state = this.check(key);
      if (state.ok) this.hit(key);
      return state;
    },
    reset(key) {
      hits.delete(key);
    },
    sweep() {
      const t = now();
      for (const key of [...hits.keys()]) recent(key, t);
    },
  };
}

module.exports = { createLimiter };
