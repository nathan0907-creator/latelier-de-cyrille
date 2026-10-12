'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Largeur et hauteur d'une image (WebP, PNG, JPEG), lues dans son en-tête. null si le format est inconnu. */
function imageSize(file) {
  let data;
  try {
    data = fs.readFileSync(file);
  } catch {
    return null;
  }
  const size = (width, height) => (width > 0 && height > 0 ? { width, height } : null);

  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') {
    const kind = data.toString('latin1', 12, 16);
    if (kind === 'VP8X') return size(data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1);
    if (kind === 'VP8 ') return size(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff);
    if (kind === 'VP8L') {
      const bits = data.readUInt32LE(21);
      return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    return null;
  }
  if (data.readUInt32BE(0) === 0x89504e47) return size(data.readUInt32BE(16), data.readUInt32BE(20));
  if (data[0] === 0xff && data[1] === 0xd8) {
    // JPEG : on saute de segment en segment jusqu'à celui qui donne les dimensions.
    for (let at = 2; at + 9 < data.length;) {
      if (data[at] !== 0xff) return null;
      const marker = data[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return size(data.readUInt16BE(at + 7), data.readUInt16BE(at + 5));
      at += 2 + data.readUInt16BE(at + 2);
    }
  }
  return null;
}

/**
 * Complète une photo locale (/photos/nom.webp) avec ses dimensions et ses versions réduites
 * (nom-480.webp, nom-800.webp…) quand elles existent : le navigateur charge alors la plus
 * petite qui suffit à l'écran. Une photo distante, ou sans version réduite, reste telle quelle.
 */
function describePhoto(photo, publicDir) {
  if (!photo || typeof photo.src !== 'string' || !photo.src.startsWith('/')) return photo;
  const file = path.join(publicDir, photo.src);
  const dimensions = imageSize(file);
  if (!dimensions) return photo;
  const { dir, name, ext } = path.parse(photo.src);
  let siblings = [];
  try {
    siblings = fs.readdirSync(path.dirname(file));
  } catch { /* dossier absent : pas de versions réduites */ }
  const variants = siblings
    .map(sibling => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)\\${ext}$`).exec(sibling))
    .filter(Boolean)
    .map(match => ({ width: Number(match[1]), src: `${dir}/${match[0]}` }))
    .filter(variant => variant.width < dimensions.width)
    .sort((a, b) => a.width - b.width);
  return { ...photo, ...dimensions, variants };
}

module.exports = { imageSize, describePhoto };
