// Roy, October 12 (295): the selected silent wave is the pain card's edge.
// It is part of the face. Lettering and the original grid keep their places.
import { WAVE_DEFAULTS, createWaveClock } from './wave-signal.mjs';

const SVG = 'http://www.w3.org/2000/svg';
const path = points => `M${points.map(p => p.join(' ')).join('L')}Z`;

// One closed silhouette, with bars cut into all four edges and no divider
// seams. The 12px inset reserves room inside the original footprint; the
// text and hold grid retain their original positions and dimensions.
export function waveOutline(width, height, levels, settings = WAVE_DEFAULTS) {
  const bottomLevels = Array.isArray(levels) ? levels : levels.bottom;
  if (settings.sides === 'all') {
    const inset = Math.min((width - 2) / 2, (height - 2) / 2, settings.inset ?? 12);
    const left = .5 + inset, right = width - .5 - inset;
    const top = .5 + inset, bottom = height - .5 - inset;
    const amount = n => Math.max(0, Math.min(inset, n * settings.unit));
    const cuts = (start, end, count) => Array.from({ length: count + 1 }, (_, i) => start + Math.round((end - start) * i / count));
    const points = [[left, top]];
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const heights = Array.isArray(levels) ? levels : levels[side] || bottomLevels;
      const horizontal = side === 'top' || side === 'bottom';
      const positions = horizontal ? cuts(left, right, heights.length) : cuts(top, bottom, heights.length);
      const forward = side === 'top' || side === 'right';
      for (let n = 0; n < heights.length; n++) {
        const i = forward ? n : heights.length - 1 - n;
        const a = positions[forward ? i : i + 1], b = positions[forward ? i + 1 : i];
        if (side === 'top') points.push([a, top - amount(heights[i])], [b, top - amount(heights[i])]);
        if (side === 'right') points.push([right + amount(heights[i]), a], [right + amount(heights[i]), b]);
        if (side === 'bottom') points.push([a, bottom + amount(heights[i])], [b, bottom + amount(heights[i])]);
        if (side === 'left') points.push([left - amount(heights[i]), a], [left - amount(heights[i]), b]);
      }
      points.push(side === 'top' ? [right, top] : side === 'right' ? [right, bottom] : side === 'bottom' ? [left, bottom] : [left, top]);
    }
    const outline = points.filter(([x, y], i) => !i || x !== points[i - 1][0] || y !== points[i - 1][1]);
    if (outline.at(-1)[0] === outline[0][0] && outline.at(-1)[1] === outline[0][1]) outline.pop();
    return outline;
  }
  const left = .5, right = width - .5, bottom = height - .5;
  const inset = Math.min(height - 1, settings.inset ?? settings.amp ?? 12);
  const base = bottom - inset;
  const cuts = Array.from({ length: bottomLevels.length + 1 }, (_, i) => left + Math.round(i * (width - 1) / bottomLevels.length));
  const points = [[left, .5], [right, .5]];
  for (let i = bottomLevels.length - 1; i >= 0; i--) {
    const y = Math.min(bottom, base + bottomLevels[i] * settings.unit);
    points.push([cuts[i + 1], y], [cuts[i], y]);
  }
  return points.filter(([x, y], i) => !i || x !== points[i - 1][0] || y !== points[i - 1][1]);
}

// The solid black slab follows every edge, including the notches.
function sides(points, depth = 3) {
  const pieces = [points.map(([x, y]) => [x + depth, y + depth])];
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    const turn = b[0] - a[0] - b[1] + a[1];
    const quad = [a, b, [b[0] + depth, b[1] + depth], [a[0] + depth, a[1] + depth]];
    if (turn) pieces.push(turn > 0 ? quad : quad.reverse());
  });
  return pieces.map(path).join('');
}

// Begin inside the signal, so a reduced-motion card still has a visible wave.
export function createPainWave(el, button, { settings = {}, offset = 3.25 } = {}) {
  const clock = createWaveClock({ settings, offset });
  let tuning = { ...WAVE_DEFAULTS, ...settings };
  let shape = [], previous = '', width = 0, height = 0;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'wave-surface');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const side = document.createElementNS(SVG, 'path');
  side.setAttribute('class', 'wave-side');
  const face = document.createElementNS(SVG, 'path');
  face.setAttribute('class', 'wave-face');
  svg.append(side, face);
  el.prepend(svg);
  el.classList.add('wave-card');

  function paint() {
    width = button.offsetWidth; height = button.offsetHeight;
    if (!width || !height) return;
    shape = waveOutline(width, height, clock.snapshot().edgeLevels, tuning);
    const d = path(shape);
    if (d === previous) return;
    previous = d;
    svg.setAttribute('width', width + 3); svg.setAttribute('height', height + 3);
    svg.setAttribute('viewBox', `0 0 ${width + 3} ${height + 3}`);
    side.setAttribute('d', sides(shape));
    face.setAttribute('d', d);
  }
  const observer = new ResizeObserver(paint);
  observer.observe(button);
  return {
    update(dt = 0, { frozen = false, still = false } = {}) {
      clock.update(dt, { frozen, still });
      paint();
    },
    configure(settings) {
      tuning = { ...tuning, ...settings };
      clock.configure(settings);
      previous = '';
      paint();
    },
    outline() { if (!shape.length) paint(); return shape.map(p => [...p]); },
    snapshot: () => clock.snapshot(),
    destroy() { observer.disconnect(); svg.remove(); },
  };
}
