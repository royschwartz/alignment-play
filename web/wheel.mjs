// Ten numerals printed on a cylinder: exactly 36 degrees per digit.
// Each raster row of a glyph occupies its own angle on that surface. Projecting
// the rows separately bends the numeral itself; no flat face or scaleY trick.
// The wheel has no visible casing. The caller supplies the fractional value
// (the number heading for the true one, web/number-chase.mjs); the wheel
// itself has no motion of its own.
export const DIGIT_ANGLE = Math.PI * 2 / 10;
export const WHEEL_DEFAULTS = { radius: 1.45, distance: 4.5, height: 1.35, still: null };
const mod = (n, m) => ((n % m) + m) % m;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const awayFrom = (digit, position) => mod(digit - position + 5, 10) - 5;

// Higher places engage during the final tenth of the wheel to their right.
// A continuous carry works in both directions, including 99.5 and 9.5.
export function carried(position) {
  const turns = Math.floor(position / 10);
  return turns + clamp(position - turns * 10 - 9, 0, 1);
}
export function positionsOf(value) {
  const out = [Math.max(0, value)];
  for (let n = String(Math.floor(value) + 1).length; out.length < n;) out.push(carried(out.at(-1)));
  return out;
}

// The cylinder's axis is horizontal. y is distance ALONG its curved surface
// in em, measured from the glyph centre. The camera faces the front at z = 0.
export function surfacePoint(away, y = 0, options = WHEEL_DEFAULTS) {
  const { radius, distance } = { ...WHEEL_DEFAULTS, ...options };
  const angle = away * DIGIT_ANGLE + y / radius;
  const depth = radius * (1 - Math.cos(angle));
  const scale = distance / (distance + depth);
  return { angle, y: radius * Math.sin(angle) * scale, scale, front: Math.cos(angle) > 0 };
}

// Inverse of the cylindrical perspective projection, on the visible front.
export function surfaceAngle(y, options = WHEEL_DEFAULTS) {
  const { radius: r, distance: d } = { ...WHEEL_DEFAULTS, ...options };
  return Math.asin(clamp(y * (d + r) / (r * Math.hypot(d, y)), -1, 1)) - Math.atan2(y, d);
}

export function cellsOf(value) {
  if (value == null) return [];
  const positions = positionsOf(value), out = [];
  let visible = 0;
  for (let k = positions.length - 1; k >= 0; k--) {
    const at = positions[k];
    visible = Math.max(visible, clamp(at, 0, 1));
    out.push({ position: at, width: k ? visible : 1, zero: k && at < 1 ? 0 : 1 });
  }
  return out;
}

// No independent animation: a fractional reading is the wheel's position.
export function createWheelNumber(holder, options = {}) {
  const opt = { ...WHEEL_DEFAULTS, ...options };
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const el = document.createElement('span');
  el.className = 'wheel-number';
  el.setAttribute('role', 'img');
  const canvas = document.createElement('canvas');
  canvas.className = 'wheel-surface';
  canvas.setAttribute('aria-hidden', 'true');
  el.append(canvas);
  holder.append(el);
  const ctx = canvas.getContext('2d');
  const atlas = document.createElement('canvas'), ink = atlas.getContext('2d');
  const EM = 96, GLYPH_W = 80, GLYPH_H = 130;
  atlas.width = GLYPH_W * 10; atlas.height = GLYPH_H;
  let value = null, lastPaint = '', atlasKey = '';

  function paint() {
    const style = getComputedStyle(holder), size = parseFloat(style.fontSize) || 16;
    const font = `${style.fontWeight} ${EM}px ${style.fontFamily}`;
    const key = `${font}|${style.color}`;
    if (key !== atlasKey) {
      atlasKey = key;
      ink.clearRect(0, 0, atlas.width, atlas.height);
      ink.font = font; ink.fillStyle = style.color; ink.textAlign = 'center';
      // Optical centre from actual font ink bounds, rather than line-box padding.
      const metrics = ink.measureText('0');
      const baseline = GLYPH_H / 2 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
      for (let d = 0; d < 10; d++) ink.fillText(String(d), (d + 0.5) * GLYPH_W, baseline);
    }
    const plain = opt.still ?? reduced?.matches;
    const shown = value == null ? null : plain ? Math.round(value) : value;
    const signature = `${shown}|${size}|${key}|${devicePixelRatio}|${plain}`;
    if (signature === lastPaint) return;
    lastPaint = signature;
    el.setAttribute('aria-label', shown == null ? '' : String(Math.round(shown)));
    const cells = cellsOf(shown), cellWidth = ink.measureText('0').width / EM;
    const width = cells.reduce((n, c) => n + c.width * cellWidth, 0);
    el.style.width = `${width}em`;
    el.style.height = `${opt.height}em`;
    // Extra raster resolution keeps small type smooth even in a scaled phone.
    const resolution = Math.max(2, devicePixelRatio || 1) * size;
    canvas.width = Math.max(1, Math.ceil(width * resolution));
    canvas.height = Math.ceil(opt.height * resolution);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let x = 0;
    for (const cell of cells) {
      const centre = x + (cell.width - 0.5) * cellWidth;
      x += cell.width * cellWidth;
      if (!cell.width) continue;
      ctx.save();
      ctx.beginPath(); ctx.rect((x - cell.width * cellWidth) * resolution, 0, cell.width * cellWidth * resolution, canvas.height); ctx.clip();
      const base = Math.floor(cell.position);
      for (let n = base; n <= base + 1; n++) {
        const digit = mod(n, 10), away = n - cell.position;
        if (digit === 0 && !cell.zero) continue;
        const faceFade = Math.cos(away * Math.PI / 2) ** 2;
        if (faceFade < 1e-8) continue;
        // Inverse-project each OUTPUT pixel row onto the cylinder. Rows share
        // exact raster boundaries, avoiding seams between transformed strips.
        for (let row = 0; row < canvas.height; row++) {
          const y = (row + 0.5) / resolution - opt.height / 2;
          const angle = surfaceAngle(y, opt);
          const sourceY = (angle - away * DIGIT_ANGLE) * opt.radius * EM + GLYPH_H / 2;
          if (sourceY < 0 || sourceY >= GLYPH_H) continue;
          const edge = Math.abs(y) / (opt.height / 2);
          const fade = 1 - clamp((edge - 0.48) / 0.52, 0, 1);
          ctx.globalAlpha = faceFade * fade * fade * (3 - 2 * fade) * (digit === 0 ? cell.zero : 1);
          const scale = opt.distance / (opt.distance + opt.radius * (1 - Math.cos(angle)));
          const w = GLYPH_W / EM * scale * resolution;
          ctx.drawImage(atlas, digit * GLYPH_W, sourceY, GLYPH_W, Math.min(1, GLYPH_H - sourceY),
            centre * resolution - w / 2, row, w, 1);
        }
      }
      ctx.restore();
    }
  }
  function follow(next) {
    value = next == null || next === '' ? null : Math.max(0, Number(next) || 0);
    paint();
  }
  return { el, options: opt, follow, set: follow, frame: paint,
    get value() { return value; }, get settled() { return true; } };
}
