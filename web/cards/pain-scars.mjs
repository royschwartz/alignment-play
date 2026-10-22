// Procedural scar study: a height field seen directly from above. No textures,
// photographs, simulation RNG, or frame-to-frame random draws are used.
import { seeded } from './kit.mjs';

const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
const gauss = n => Math.exp(-n * n);
const mix = (a, b, t) => a + (b - a) * t;
const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;

function noiseLine(random, count) {
  const values = Array.from({ length: count + 2 }, () => random() * 2 - 1);
  return t => {
    const x = clamp(t) * (count - 1), i = Math.floor(x);
    return mix(values[i], values[i + 1], smooth(x - i));
  };
}

// At a fixed coordinate the grain is permanent, independent of draw order.
function grain(x, y, salt) {
  let n = Math.imul(x + 101, 374761393) ^ Math.imul(y + 317, 668265263) ^ salt;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function createScarRaster(options = {}) {
  const width = Math.round(clamp(finite(options.width, 600), 1, 1800));
  const height = Math.round(clamp(finite(options.height, 492), 1, 1800));
  const scale = clamp(finite(options.scale, 1), .25, 6);
  const length = clamp(finite(options.length, width * .6), 2, width * 1.5);
  const breadth = clamp(finite(options.breadth, length * .09), scale * .1, length * .4);
  const angle = finite(options.angle, -.14), relief = clamp(finite(options.relief, .65));
  const texture = clamp(finite(options.texture, .7));
  const kind = ['seam', 'ridge', 'hollow'].includes(options.kind) ? options.kind : 'seam';
  const random = seeded(`scar:${options.seed ?? '1'}:${kind}`);
  const salt = (random() * 4294967296) >>> 0;
  const bend = noiseLine(random, 6), asymmetry = noiseLine(random, 10);
  const widening = noiseLine(random, 12), fine = noiseLine(random, 46);
  const ripple = noiseLine(random, 75);
  const swellings = Array.from({ length: 4 }, () => ({ t: .1 + random() * .8,
    span: .05 + random() * .1, amount: .15 + random() * .35 }));
  const folds = Array.from({ length: 26 }, (_, i) => ({
    t: .025 + (i + random() * .75) / 27 * .95,
    side: random() < .5 ? -1 : 1, slant: (random() - .5) * 1.8,
    span: (.7 + random() * 1.8) * scale, reach: .6 + random() * 1.4,
    strength: .22 + random() * .66,
  }));
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const density = new Float32Array(width * height), threshold = new Float32Array(width * height);
  const onset = new Float32Array(width * height);

  function section(u) {
    const t = u / length + .5;
    if (t <= 0 || t >= 1) return null;
    const taper = Math.pow(Math.sin(Math.PI * t), .64);
    let swell = .82 + widening(t) * .19;
    for (const blob of swellings) swell += blob.amount * gauss((t - blob.t) / blob.span);
    const typeWidth = kind === 'seam' ? .72 : kind === 'ridge' ? 1.1 : 1.5;
    const half = breadth * .5 * taper * swell * typeWidth;
    const center = breadth * (bend(t) * .39 + .18 * Math.sin(t * Math.PI * 1.7));
    return { t, taper, half, center, skew: asymmetry(t) * .2, detail: fine(t),
      groove: .3 + .7 * smooth((widening(t) + 1) / 2), ripple: .5 + .5 * ripple(t) };
  }

  function surface(u, v, sec) {
    if (!sec) return 0;
    const { t, taper, half, center, skew } = sec;
    const across = (v - center) / (half * (v > center ? 1 + skew : 1 - skew));
    if (Math.abs(across) > 3.4) return 0;
    // One continuous asymmetric lens. A low valley and a higher lip make the
    // broad variant recessed; the other two have rounded raised tissue.
    let profile;
    if (kind === 'hollow') profile = -.65 * gauss(across * 1.25)
      + .3 * gauss((across + .95) * 3) + .21 * gauss((across - .98) * 4);
    else profile = gauss(across * 1.1) + .17 * gauss((across + .2) * 3.1);
    // Uneven long grooves are interrupted, avoiding a continuous black cut.
    profile -= .12 * gauss((across - .23 - .11 * sec.detail) * 8) * sec.groove;
    profile += texture * .045 * Math.sin(across * 18 + sec.detail * 3)
      * gauss(across * 1.2) * sec.ripple;
    // Soft, short puckers pull into the shoulders, with neither symmetry nor
    // evenly spaced opposing bars. Their heights generate their own shadows.
    for (const f of folds) {
      if (Math.abs(t - f.t) > .065) continue;
      const outward = across * f.side;
      const distance = (u - (f.t - .5) * length - (outward - .75) * half * f.slant) / f.span;
      const shoulder = gauss((outward - 1.03) / f.reach) * smooth((outward - .35) * 3);
      profile -= texture * .2 * f.strength * gauss(distance) * shoulder;
    }
    return profile * breadth * .24 * taper * (.25 + relief * .95);
  }

  // Subpixel detail follows the requested drawing scale, not the viewport.
  const step = .45 * scale;
  // All contributions are confined to 3.4 half-widths of the spine. A
  // conservative analytic bound skips the blank paper while keeping exactly
  // the same density and grain at every pixel of the accepted scar drawing.
  const widestSwell = 1.01 + swellings.reduce((sum, blob) => sum + blob.amount, 0);
  const typeWidth = kind === 'seam' ? .72 : kind === 'ridge' ? 1.1 : 1.5;
  const extentV = breadth * (.57 + 3.4 * .5 * widestSwell * typeWidth);
  const extentX = Math.abs(cos) * length / 2 + Math.abs(sin) * extentV + 1;
  const extentY = Math.abs(sin) * length / 2 + Math.abs(cos) * extentV + 1;
  const x0 = Math.max(0, Math.floor(width / 2 - extentX));
  const x1 = Math.min(width, Math.ceil(width / 2 + extentX));
  const y0 = Math.max(0, Math.floor(height / 2 - extentY));
  const y1 = Math.min(height, Math.ceil(height / 2 + extentY));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const index = y * width + x;
    const dx = x + .5 - width / 2, dy = y + .5 - height / 2;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    const sec = section(u);
    if (!sec) continue;
    const across = (v - sec.center) / Math.max(scale * .1, sec.half);
    if (Math.abs(across) > 3.4) continue;
    const du = (surface(u + step, v, section(u + step)) - surface(u - step, v, section(u - step))) / (2 * step);
    const dv = (surface(u, v + step, sec) - surface(u, v - step, sec)) / (2 * step);
    const gx = du * cos - dv * sin, gy = du * sin + dv * cos;
    const shadow = Math.max(0, gx * .48 + gy * .88);
    const shoulder = gauss((Math.abs(across) - .95) / .52);
    const tissue = gauss(across * .85);
    const edge = gauss((across - .82 - sec.detail * .05) * 10);
    const ragged = .4 + .6 * smooth((sec.detail + 1) * .5);
    let ink = shadow * 1.8 + shoulder * .045 + tissue * .018
      + edge * .14 * ragged * (.3 + relief);
    // Only the scar has grain. The surrounding page remains unmarked white.
    ink *= smooth(sec.t * 35) * smooth((1 - sec.t) * 35);
    ink *= .78 + .3 * grain(Math.floor(x / scale), Math.floor(y / scale), salt + 43);
    density[index] = clamp(ink, 0, .96);
    threshold[index] = grain(x, y, salt);
    // Dark folds arrive later than the faint tissue. All reveals preserve the
    // same final black pixels, so no grain crawls or flickers during formation.
    onset[index] = .05 + .18 * grain(Math.floor(x / (scale * 5)), Math.floor(y / (scale * 5)), salt + 101)
      + .2 * clamp(shadow);
  }
  return { width, height, density, threshold, onset, seed: String(options.seed ?? '1'), kind };
}

export function scarPixel(raster, index, progress = 1, opacity = 1) {
  const grown = smooth((clamp(progress) - raster.onset[index]) / (1 - raster.onset[index]));
  return raster.threshold[index] < raster.density[index] * grown * clamp(opacity);
}

// Binary ink on transparency; no frame opacity, gradients, or gray pixels.
export function drawScar(canvas, raster, { progress = 1, opacity = 1 } = {}) {
  if (canvas.width !== raster.width) canvas.width = raster.width;
  if (canvas.height !== raster.height) canvas.height = raster.height;
  const ctx = canvas.getContext('2d');
  const frame = ctx.createImageData(raster.width, raster.height);
  if (progress > 0 && opacity > 0) {
    for (let i = 0; i < raster.density.length; i++) if (scarPixel(raster, i, progress, opacity)) frame.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(frame, 0, 0);
}
