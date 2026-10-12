'use strict';

/**
 * Mini-gabarits HTML : tout ce qui est inséré est échappé par défaut.
 * Seules les valeurs produites par html`…` ou raw(…) sont insérées telles quelles.
 */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ENTITIES[c]);

class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

const raw = value => new SafeHtml(String(value));

function render(value) {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

function html(strings, ...values) {
  let out = '';
  strings.forEach((chunk, i) => {
    out += chunk;
    if (i < values.length) out += render(values[i]);
  });
  return new SafeHtml(out);
}

/** JSON à placer dans une balise <script> de données : « < » est neutralisé. */
const jsonForScript = data => raw(JSON.stringify(data).replace(/</g, '\\u003c'));

module.exports = { html, raw, escapeHtml, jsonForScript, SafeHtml };
