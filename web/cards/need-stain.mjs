// Roy, Oct 11: an irregular fabric stain, randomly formed once, then still.
// One shape is seeded for the game and shared across all cards/attributes;
// it neither consumes the simulation RNG nor needs extra save data.
import { svg } from './kit.mjs';
import { createStainArtwork, pixelStain } from './wicking-stain.mjs';

export const STAIN_FADE_SECONDS = 1.4;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Every copy reuses the same rendered simulation. Repainting/resizing the
// UI never advances the wetting front or changes the settled fabric texture.
const images = new Map(), models = new Map();
function stainImage(seed, filter) {
  const key = JSON.stringify([seed, filter]);
  if (!images.has(key)) {
    if (!models.has(seed)) {
      models.set(seed, createStainArtwork({ seed }).model);
      if (models.size > 6) models.delete(models.keys().next().value);
    }
    const picture = pixelStain(models.get(seed), { filter });
    const canvas = document.createElement('canvas');
    canvas.width = picture.width; canvas.height = picture.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(picture.data, picture.width, picture.height), 0, 0);
    images.set(key, canvas.toDataURL('image/png'));
    if (images.size > 18) images.delete(images.keys().next().value);
  }
  return images.get(key);
}

// One finite entrance clock drives both copies. Afterwards its value is
// constant: changing neglect, digits, viewport or elapsed time cannot morph it.
export function createNeedStainClock() {
  let activeKey, elapsed = 0;
  return {
    advance({ key, dt = 0, still = false }) {
      if (key !== activeKey) { activeKey = key; elapsed = 0; }
      else elapsed = Math.min(STAIN_FADE_SECONDS, elapsed + Math.max(0, Number.isFinite(dt) ? dt : 0));
      const t = clamp(elapsed / STAIN_FADE_SECONDS, 0, 1);
      return { opacity: key == null ? 0 : still ? 1 : t * t * (3 - 2 * t) };
    },
  };
}

export function stainLayer(holder, { contained = false, filter = 'threshold' } = {}) {
  holder.classList.add('contour-holder', 'contour-number', 'stain-holder');
  if (contained) holder.classList.add('contour-contained');
  const canvas = svg('svg', { class: 'need-contour need-stain', viewBox: '-12 -9 44 44', 'aria-hidden': 'true', focusable: 'false' });
  const picture = svg('image', { x: -12, y: -9, width: 44, height: 44, 'image-rendering': 'pixelated' });
  canvas.dataset.filter = filter;
  canvas.append(picture);
  holder.prepend(canvas);
  let drawn = false, activeKey, drawnSeed, lastOpacity = -1;
  return {
    canvas,
    get drawn() { return drawn; },
    show(blots, _dt = 0, { opacity = 1, seed = 'alignment', scale = 1 } = {}) {
      drawn = true;
      const key = blots[0]?.key;
      if (key !== activeKey) {
        activeKey = key;
        canvas.dataset.need = key ?? '';
        holder.classList.toggle('contour-active', key != null);
      }
      if (seed !== drawnSeed) {
        picture.setAttribute('href', stainImage(seed, filter));
        drawnSeed = seed;
      }
      const alpha = key == null ? 0 : clamp(opacity, 0, 1);
      canvas.style.transform = `scale(${Math.max(0, scale)})`;
      if (alpha !== lastOpacity) {
        canvas.style.opacity = String(alpha);
        // Invert the digits as their stain arrives, without moving the text.
        if (!contained) holder.style.color = `rgb(${Array(3).fill(Math.round(255 * alpha)).join(',')})`;
        lastOpacity = alpha;
      }
      return key != null;
    },
  };
}
