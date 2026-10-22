// Roy's selected pain card, Oct 13 (311): fixed wall mounts, growing blades.
import { svg } from './kit.mjs';
import { DEFAULTS, FACE, WALL_DEPTH, LEAN, TURN_DISTANCE, fixedBladeOffsets, perimeterAt, bladePose, projectedProfile, createFrameGate } from './blade-geometry.mjs';

// Blades grow in real time (Roy, Oct 13: "they shouldn't. grow by story
// minutes but in real seconds, 1.5 seconds"). Their spin follows story time.
export const PAIN_BLADES = Object.freeze({ ...DEFAULTS, minSize: 6, maxSize: 14, growthSeconds: 1.5 });
export const PREVIEW_SPIN_RATE = PAIN_BLADES.travel * DEFAULTS.pace / TURN_DISTANCE;
// One pain is the current ordinary cost. Higher costs add 2px, capped at 14.
export const painBladeSize = pain => pain > 0 ? Math.min(14, 6 + 2 * Math.max(0, pain - 1)) : 0;

// `grown`: the blades are already at their size (a card that was there when the page opened).
export function createPainBladeClock({ pain, initialMinutes = 0, grown = initialMinutes > 0 } = {}) {
  const targetSize = painBladeSize(pain), gate = createFrameGate();
  let minutes = Math.max(0, initialMinutes), shownMinutes = minutes;
  let distance = minutes * PAIN_BLADES.travel, shownDistance = distance;
  let growth = grown ? PAIN_BLADES.growthSeconds : 0, shownGrowth = growth;
  const snapshot = () => ({ minutes: shownMinutes, distance: shownDistance,
    size: targetSize * Math.min(1, shownGrowth / PAIN_BLADES.growthSeconds), targetSize });
  return {
    update(storyMinutes, seconds, { frozen = false, still = false, fps = PAIN_BLADES.fps, spinSpeed = 1 } = {}) {
      if (still) {
        const changed = shownGrowth < PAIN_BLADES.growthSeconds;
        growth = shownGrowth = PAIN_BLADES.growthSeconds;
        return changed;
      }
      if (frozen) return false;
      minutes += Math.max(0, storyMinutes);
      distance += Math.max(0, storyMinutes) * PAIN_BLADES.travel * Math.max(0, spinSpeed);
      growth = Math.min(PAIN_BLADES.growthSeconds, growth + Math.max(0, seconds));
      if (!gate.ready(Math.max(0, seconds), fps)) return false;
      shownMinutes = minutes;
      shownDistance = distance;
      shownGrowth = growth;
      return true;
    },
    snapshot,
  };
}

export function bladeMountParity(x, y, width, height, tile = 24) {
  const columns = Math.max(1, Math.round((width - 1) / tile));
  const rows = Math.max(1, Math.round((height - 1) / tile));
  const col = Math.min(columns - 1, Math.max(0, Math.floor((x - .5) / ((width - 1) / columns))));
  const row = Math.min(rows - 1, Math.max(0, Math.floor((y - .5) / ((height - 1) / rows))));
  return (col + row) % 2;
}

// Use the same eased depth as the grid. Retraction is a presentation of the
// frozen pose, so returning to level zero restores that exact blade size.
export function heldBlade(size, parity, level) {
  const lowered = parity * Math.max(0, Math.min(1, level));
  return { size: size * (1 - lowered), drop: FACE.depth * lowered };
}

// The full straight base, including its outline, must fit on one wall
// segment. A center-point parity check lets a blade straddle a lowered
// neighbour, leaving a floating sliver after the faces mask it (Roy, 328).
// Test in wall coordinates: projection shifts the base with its depth.
export function bladeWallAttached(pose, size, width, height, level, tile = 24) {
  if (level <= 0) return true; // The unlocked wall is continuous.
  const axis = pose.ny !== 0 ? 0 : 1;
  const length = axis === 0 ? width : height;
  const count = Math.max(1, Math.round((length - 1) / tile));
  const span = (length - 1) / count;
  const along = axis === 0 ? pose.x : pose.y;
  const cell = Math.min(count - 1, Math.max(0, Math.floor((along - .5) / span)));
  const start = .5 + cell * span, end = start + span;
  const a = along - .45 * size * pose.basisV[axis];
  const b = along + .50 * size * pose.basisV[axis];
  const stroke = PAIN_BLADES.line / 2;
  return Math.min(a, b) - stroke >= start && Math.max(a, b) + stroke <= end;
}

let serial = 0;
export function createPainBlades(el, button, { pain, initialMinutes = 0, grown = initialMinutes > 0 } = {}) {
  const clock = createPainBladeClock({ pain, initialMinutes, grown });
  const offsets = fixedBladeOffsets();
  let width = 0, height = 0, holdLevel = 0, holdFaces = null, holdSignature = '';
  let released = false, frozenExit = false, fragments = [];
  let spinRate = PREVIEW_SPIN_RATE;
  const art = svg('svg', { class: 'pain-blade-art', 'aria-hidden': 'true' });
  const maskId = `pain-blade-mask-${++serial}`;
  const cover = svg('path', { fill: '#000', stroke: '#000', 'stroke-width': 1 });
  const mask = svg('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: -24, y: -24, width: 220, height: 150 },
    svg('rect', { x: -24, y: -24, width: 220, height: 150, fill: '#fff' }), cover);
  const group = svg('g', { mask: `url(#${maskId})` });
  const paths = offsets.map((_, i) => svg('path', { class: 'pain-blade', 'data-blade': i,
    'stroke-linejoin': 'round', 'stroke-width': PAIN_BLADES.line }));
  group.append(...paths); art.append(svg('defs', {}, mask), group);
  el.prepend(art); el.classList.add('blade-pain-card');

  function paint() {
    if (released || frozenExit) return;
    width = button.offsetWidth; height = button.offsetHeight;
    if (!width || !height) return;
    const { size, distance, targetSize } = clock.snapshot();
    art.setAttribute('width', width + 3); art.setAttribute('height', height + 3);
    art.setAttribute('viewBox', `0 0 ${width + 3} ${height + 3}`);
    art.dataset.size = size.toFixed(4); art.dataset.targetSize = String(targetSize);
    art.dataset.distance = distance.toFixed(5); art.dataset.holdLevel = String(holdLevel);
    cover.setAttribute('d', holdFaces?.join('') || `M.5 .5H${width-.5}V${height-.5}H.5Z`);
    fragments = [];
    offsets.forEach((offset, i) => {
      const p = perimeterAt(offset);
      p.x = .5 + p.x * (width - 1) / FACE.width;
      p.y = .5 + p.y * (height - 1) / FACE.height;
      const pose = bladePose(p, distance, offset, PAIN_BLADES.tilt);
      const parity = bladeMountParity(p.x, p.y, width, height);
      const held = heldBlade(size, parity, holdLevel);
      const attached = bladeWallAttached(pose, held.size, width, height, holdLevel);
      const visible = held.size > 0 && attached;
      const matrix = pose.matrix.map((v, j) => j < 4 ? v * held.size : v + held.drop);
      const d = projectedProfile(matrix);
      paths[i].setAttribute('d', d);
      if (visible) fragments.push({ index: i, d, x: matrix[4], y: matrix[5], nx: p.nx, ny: p.ny,
        u: pose.basisU.map(v => v * held.size), v: pose.basisV.map(v => v * held.size),
        heightAboveGround: Math.max(0, WALL_DEPTH / 2 - held.drop / LEAN), spinRate });
      paths[i].setAttribute('data-mount', `${p.x.toFixed(4)},${p.y.toFixed(4)}`);
      paths[i].setAttribute('data-drop', String(held.drop));
      paths[i].setAttribute('data-size', held.size.toFixed(4));
      paths[i].setAttribute('data-parity', String(parity));
      paths[i].setAttribute('data-attached', String(attached));
      paths[i].style.visibility = visible ? '' : 'hidden';
    });
  }
  const observer = new ResizeObserver(paint); observer.observe(button);
  return {
    update(dt = 0, { storyMinutes = 0, frozen = false, still = false, fps = PAIN_BLADES.fps, spinSpeed = 1 } = {}) {
      if (released || frozenExit) return;
      // Keep the unscaled rate of the last moving frame. Selection captures
      // it before the next activity changes pace, so release cannot speed up.
      if (!frozen && !still && dt > 0) spinRate = Math.max(0, storyMinutes) * PAIN_BLADES.travel / TURN_DISTANCE / dt;
      if (clock.update(storyMinutes, dt, { frozen, still, fps, spinSpeed }) || !width) paint();
    },
    hold({ level = 0, faces = null } = {}) {
      const signature = faces?.join('') || '';
      if (level === holdLevel && signature === holdSignature) return;
      holdLevel = level; holdFaces = faces; holdSignature = signature; paint();
    },
    snapshot: clock.snapshot,
    // An unselected departure keeps its last visible blades on the wall.
    // Clearing the hold surface must not restore its retracted blades.
    freeze() { if (!width) paint(); frozenExit = true; },
    // Capture before the hold overlay is cleared: fully retracted blades
    // are absent, and partially retracted blades retain their exact shape.
    release() {
      if (released) return [];
      if (!width) paint();
      released = true;
      art.style.visibility = 'hidden';
      return fragments.map(fragment => ({ ...fragment }));
    },
    destroy() { observer.disconnect(); art.remove(); },
  };
}
