// Roy, Oct 13: selected blades spin outward and sink into the ground. Unselected
// departures keep their blades attached and fade the whole card.
// This presentation clock never changes the simulation or occupies a slot.
import { svg } from './kit.mjs';
import { PAIN_BLADES, PREVIEW_SPIN_RATE } from './pain-blades.mjs';
import { bladeBurialGeometry } from './blade-burial.mjs';

export const BLADE_EXIT = Object.freeze({ fall: .4, linger: 0, sink: .5, spread: 8, fps: PAIN_BLADES.fps,
  spinSpeed: 1, spinSlowdown: .5, sinkCurve: 2 });
// Descent follows its chosen duration, independently of rotation speed.
export const exitDuration = settings =>
  Number((settings.fall + settings.linger + settings.sink).toFixed(9));
// Use the same displayed time for the face, tumbling blades and ground cut.
// A lower cadence holds frames; it never stretches the animation's duration.
export function exitFrameTime(seconds, fps = BLADE_EXIT.fps, duration = Infinity) {
  const time = Math.max(0, seconds);
  return time >= duration ? duration : Math.floor((time + 1e-8) * fps) / fps;
}
const clamp = n => Math.max(0, Math.min(1, n));
// Keep both endpoints and the duration fixed; a higher curve slows the finish.
export const sinkDepth = (progress, curve = BLADE_EXIT.sinkCurve) =>
  1 - (1 - clamp(progress)) ** Math.max(1, curve);
// Stable per-mount variation; no draw from the game's random stream.
const variation = (index, salt) => ((index * 73 + salt * 37) % 101) / 100;

export function bladeExitPose(fragment, seconds, settings = BLADE_EXIT, { still = false, motion = null } = {}) {
  const time = Math.max(0, seconds);
  const progress = settings.fall > 0 ? clamp(time / settings.fall) : 1;
  const sinkAt = settings.fall + settings.linger;
  const spinRate = fragment.spinRate ?? PREVIEW_SPIN_RATE;
  const duration = exitDuration(settings);
  const sink = settings.sink;
  const done = motion ? motion.done : time >= duration;
  const sinkProgress = done ? 1 : motion ? motion.sinkProgress
    : sink > 0 ? clamp((time - sinkAt) / sink) : Number(time >= sinkAt);
  const burial = still ? sinkProgress : sinkDepth(sinkProgress, settings.sinkCurve);
  const i = fragment.index;
  // We look down on a flat card. Every piece falls away from its own wall,
  // with a little tangential scatter. Spin continues through the ground.
  const eased = 1 - (1 - progress) ** 2;
  const outward = settings.spread * (.8 + variation(i, 2) * .4) * eased;
  const sideways = (variation(i, 1) - .5) * settings.spread * .55 * eased;
  const dx = fragment.nx * outward - fragment.ny * sideways;
  const dy = fragment.ny * outward + fragment.nx * sideways;
  // Keep the attached rate until entry, then reach zero over the chosen
  // slowdown duration. Integrate the changing speed to preserve the angle
  // at contact and prevent reversal when seeking or drawing fewer frames.
  const rate = spinRate * Math.max(0, settings.spinSpeed ?? BLADE_EXIT.spinSpeed);
  const slowdown = Math.max(0, settings.spinSlowdown ?? BLADE_EXIT.spinSlowdown);
  const slowingTime = Math.min(Math.max(0, Math.min(time, duration)-sinkAt), slowdown);
  const spinTime = motion ? motion.spinTime : Math.min(time, sinkAt)
    + (slowdown > 0 ? slowingTime * (1-slowingTime/(2*slowdown)) : 0);
  const spinTurns = spinTime * rate;
  return { dx: still ? 0 : dx, dy: still ? 0 : dy,
    spin: still || spinTurns === 0 ? 0 : -spinTurns*Math.PI*2,
    contactSpin: still ? 0 : -settings.fall*rate*Math.PI*2,
    contact: eased, lift: Math.sin(progress*Math.PI)*2, burial,
    // Reduced motion retains a quiet fade in place, without spinning or sinking.
    opacity: done ? 0 : still ? 1-burial : 1,
    phase: done ? 'gone' : time < settings.fall ? 'spinning'
      : time < sinkAt ? 'lingering' : 'sinking' };
}

export function createBladeExit(parent, fragments, { x = 0, y = 0, width = 148, height = 76,
  settings = BLADE_EXIT, still = false, clock = null } = {}) {
  if (!fragments.length) return null;
  const art = svg('svg', { class: 'pain-blade-debris', width, height,
    viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
  art.style.left = `${x}px`; art.style.top = `${y}px`;
  const pieces = fragments.map(fragment => {
    const fill = svg('path', { fill: '#000', stroke: 'none' });
    const outline = svg('path', { fill: 'none', stroke: '#000', 'stroke-width': PAIN_BLADES.line,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    const group = svg('g', { 'data-blade': fragment.index }, fill, outline);
    return { group, fill, outline };
  });
  art.append(...pieces.map(p => p.group)); parent.append(art);
  let elapsed = 0, lastTime = -1, lastShape = '';
  const duration = exitDuration(settings);
  function seek(seconds, motion = null) {
    elapsed = Math.max(0, seconds);
    // Sampling changes cadence, never duration. Completion is exact.
    const fps = settings.fps ?? BLADE_EXIT.fps;
    const time = exitFrameTime(elapsed, fps, motion ? Infinity : duration);
    art.dataset.fps = String(fps);
    const shapeSettings = `${settings.spinSpeed ?? BLADE_EXIT.spinSpeed}:${settings.spinSlowdown ?? BLADE_EXIT.spinSlowdown}:${settings.sinkCurve ?? BLADE_EXIT.sinkCurve}:${motion ? `${motion.spinTime}:${motion.sinkProgress}:${motion.done}` : ''}`;
    if (lastTime === time && lastShape === shapeSettings) return;
    lastTime = time; lastShape = shapeSettings;
    art.dataset.time = String(time);
    fragments.forEach((fragment, i) => {
      const pose = bladeExitPose(fragment, time, settings, { still, motion });
      const shape = still ? { fill: fragment.d, outline: fragment.d, visibleFraction: 1-pose.burial }
        : bladeBurialGeometry(fragment, pose);
      pieces[i].fill.setAttribute('d', shape.fill);
      pieces[i].outline.setAttribute('d', shape.outline);
      pieces[i].group.setAttribute('opacity', pose.opacity);
      pieces[i].group.dataset.aboveGround = shape.visibleFraction.toFixed(4);
      pieces[i].group.dataset.burial = pose.burial.toFixed(4);
      art.dataset.phase = pose.phase;
    });
  }
  seek(0, clock?.snapshot());
  return { seek, update(dt) {
    const motion = clock?.update(dt);
    seek(elapsed + Math.max(0, dt), motion);
    return motion ? motion.done : elapsed >= duration;
  },
    destroy() { art.remove(); } };
}
