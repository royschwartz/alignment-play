// Roy, Oct 13 (348): grow a scar in half-pixel width steps with its own
// rapture drain, then retrace those widths to heal. All time is story time.
import { seeded } from './kit.mjs';
import { createScarRaster, drawScar } from './pain-scars.mjs';

export const SCAR_RULE = Object.freeze({ step: .5, baseMinutes: 120, widthPerRapture: .5,
  minWidth: .5, maxWidth: 20, healRatio: 2 });
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const safe = n => Number.isFinite(n) ? n : 0;
const stepDown = n => Math.floor((n + 1e-9) / SCAR_RULE.step) * SCAR_RULE.step;
export function scarWidthForDuration(minutes, raptureAmount = 1) {
  if (!(minutes > 0) || !Number.isFinite(minutes) || !(raptureAmount > 0) || !Number.isFinite(raptureAmount)) return 0;
  // The cost matters as well as its duration: one rapture (the dishes)
  // leaves only the smallest half-pixel trace, not a full-sized wound.
  const width = clamp(SCAR_RULE.widthPerRapture * raptureAmount * Math.sqrt(minutes / SCAR_RULE.baseMinutes), SCAR_RULE.minWidth, SCAR_RULE.maxWidth);
  return Math.round(width / SCAR_RULE.step) * SCAR_RULE.step;
}

export function scarState({ drainMinutes = 0, raptureAmount = 1, drainProgress = 0, healingElapsed = 0 } = {}) {
  drainMinutes = Math.max(0, safe(drainMinutes));
  raptureAmount = Math.max(0, safe(raptureAmount));
  drainProgress = clamp(safe(drainProgress));
  healingElapsed = Math.max(0, safe(healingElapsed));
  const peakWidth = scarWidthForDuration(drainMinutes, raptureAmount);
  const healingMinutes = drainMinutes * SCAR_RULE.healRatio;
  const done = !peakWidth || (drainProgress >= 1 && healingElapsed >= healingMinutes - 1e-8);
  // Subtract the same ascending staircase to retrace every half-pixel width
  // on the way back. The ink and folds use exactly the same seed each time.
  const width = done ? 0 : drainProgress < 1 ? (drainProgress > 0 ? Math.max(SCAR_RULE.step, stepDown(peakWidth * drainProgress)) : 0)
    : Math.max(0, peakWidth - stepDown(peakWidth * clamp(healingElapsed / healingMinutes)));
  return { phase: done ? 'gone' : drainProgress < 1 ? 'growing' : 'healing',
    width, peakWidth, drainMinutes, raptureAmount, drainProgress, healingElapsed, healingMinutes, done };
}

export function createScarClock(flow, { minute = () => 0, fraction = () => 0 } = {}) {
  const valid = flow && flow.left < 0 && flow.per < 0 && Number.isFinite(flow.left) && Number.isFinite(flow.per);
  const total = valid ? -flow.left : 0, rate = valid ? -flow.per : 0;
  const drainMinutes = valid ? total / rate : 0;
  const remaining = () => valid ? Math.max(0, -flow.left - rate * clamp(safe(fraction()))) : 0;
  let progress = 0, healingElapsed = 0, endAt = null;
  // Keep the exact predicted endpoint from the flow. This recovers the time
  // of completion if one fast frame crosses the end and part of healing.
  let projectedEnd = safe(minute()) + (valid ? remaining() / rate : 0);
  let state = scarState({ drainMinutes, raptureAmount: total });
  return {
    snapshot: () => ({ ...state }),
    update() {
      if (!valid || state.done) return { ...state };
      const now = safe(minute()), left = remaining();
      progress = Math.max(progress, clamp(1 - left / total));
      if (left > 1e-10) projectedEnd = now + left / rate;
      else {
        progress = 1;
        endAt ??= Math.min(now, projectedEnd);
        healingElapsed = Math.max(healingElapsed, now - endAt);
      }
      state = scarState({ drainMinutes, raptureAmount: total, drainProgress: progress, healingElapsed });
      return { ...state };
    },
  };
}

export function scarKind(seed) {
  return ['seam', 'ridge', 'hollow'][Math.floor(seeded(`${seed}:scar-kind`)() * 3)];
}

export function createPainScar(host, { flow, seed, x = 0, y = 0, width = 148, height = 76,
  minute, fraction, kind = scarKind(seed), still = false } = {}) {
  const clock = createScarClock(flow, { minute, fraction });
  if (!['seam', 'ridge', 'hollow'].includes(kind)) kind = scarKind(seed);
  const canvas = document.createElement('canvas');
  canvas.className = 'pain-scar';
  canvas.setAttribute('aria-hidden', 'true');
  const logicalWidth = 200, logicalHeight = 164, scale = 2;
  Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none', zIndex: '0',
    left: `${x + width / 2 - logicalWidth / 2}px`, top: `${y + height / 2 - logicalHeight / 2}px`,
    width: `${logicalWidth}px`, height: `${logicalHeight}px`, imageRendering: 'pixelated' });
  canvas.width = logicalWidth * scale; canvas.height = logicalHeight * scale;
  canvas.hidden = true;
  host.append(canvas);
  let revealed = false, destroyed = false, lastWidth = -1;
  let state = clock.snapshot();
  const snapshot = () => ({ ...state, kind, revealed });
  function paint() {
    if (destroyed || !revealed) return;
    canvas.hidden = state.done;
    canvas.dataset.phase = state.phase;
    canvas.dataset.width = String(state.width);
    canvas.dataset.kind = kind;
    if (state.width === lastWidth) return;
    lastWidth = state.width;
    if (!state.width) { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); return; }
    const raster = createScarRaster({ seed, kind, width: canvas.width, height: canvas.height,
      scale, length: Math.min(148, width * .8) * scale, breadth: state.width * scale,
      angle: -.14, relief: .65, texture: .7 });
    // Even reduced motion keeps discrete width states, with no continuous
    // movement or opacity animation. The already sampled game frame governs.
    drawScar(canvas, raster);
  }
  return {
    reveal() { if (destroyed) return; revealed = true; state = clock.update(); paint(); },
    update() { if (destroyed) return true; state = clock.update(); paint(); return state.done; },
    snapshot,
    destroy() { destroyed = true; canvas.remove(); },
  };
}
