// Roy's Oct 13 blade sketch: a simple hooked plate, white with black lines,
// mounted in the black side wall, with its axle pointing outward from it.
// A half turn flips the profile vertically, keeping its whole reach outside.
// Counterclockwise spin and perimeter travel share the same story-time distance.

export const FACE = Object.freeze({ width: 145, height: 73, depth: 3 });
export const BLADE_TILT = 90;
export const TURN_DISTANCE = .8 * FACE.width;
export const CORNER_RADIUS = 3;
const TRACK_W = FACE.width, TRACK_H = FACE.height;
export const PERIMETER = 2 * (TRACK_W + TRACK_H - 4 * CORNER_RADIUS) + 2 * Math.PI * CORNER_RADIUS;
// The straight back and two curved edges follow Roy's side/profile sketch.
// The root is halfway along the straight back, at the origin.
export const BLADE_PROFILE = 'M0,-0.45 Q-0.63,-0.54 -1,-0.13 Q-0.32,-0.20 0,0.50 Z';
export const DEFAULTS = Object.freeze({ tilt: 67, size: 6, count: 20, line: .9, travel: 3, pace: 6, fps: 15 });
export const RANGES = [
  ['tilt', 'Blade angle', 0, 90, 1, '°'],
  ['size', 'Blade size', 0, 14, .5, 'px'],
  ['count', 'Blades around the card', 1, 24, 1, ''],
  ['line', 'Line weight', .3, 1.2, .05, 'px'],
  ['travel', 'Travel per game minute', .25, 8, .25, 'px'],
  ['pace', 'Game minutes per second', 0, 60, 1, ''],
  ['fps', 'Frame rate', 1, 60, 1, 'fps'],
];
export function normalizeSettings(input = {}) {
  return Object.fromEntries(RANGES.map(([key, , min, max, step]) => {
    const raw = input[key], value = raw == null || raw === '' ? NaN : Number(raw);
    const n = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : DEFAULTS[key];
    return [key, Number((min + Math.round((n - min) / step) * step).toFixed(4))];
  }));
}
const TAU = Math.PI * 2, mod = (n, d) => ((n % d) + d) % d;
export const LEAN = Math.tan(9 * Math.PI / 180) / Math.SQRT2;
// The world-space slab thickness projects to exactly the original 3px edge.
export const WALL_DEPTH = FACE.depth / LEAN;
export const MOUNT_Z = -WALL_DEPTH / 2;

export function projectedProfile([a,b,c,d,e,f]) {
  const p = (x,y) => `${(a*x+c*y+e).toFixed(4)},${(b*x+d*y+f).toFixed(4)}`;
  return `M${p(0,-.45)} Q${p(-.63,-.54)} ${p(-1,-.13)} Q${p(-.32,-.20)} ${p(0,.50)} Z`;
}

// The physical wall perimeter, at mid-depth below the face. Only the route of the
// mounts rounds the corners; the face keeps its original square geometry.
// Positive distance follows the rim clockwise; the blades travel backward.
export function perimeterAt(distance) {
  const W = TRACK_W, H = TRACK_H, r = CORNER_RADIUS, arc = Math.PI * r / 2;
  const segments = [W - 2*r, arc, H - 2*r, arc, W - 2*r, arc, H - 2*r, arc];
  let s = mod(distance, PERIMETER), section = 0;
  while (section < 7 && s >= segments[section]) { s -= segments[section]; section++; }
  if (section === 0) return { x: r + s, y: 0, tx: 1, ty: 0, nx: 0, ny: -1 };
  if (section === 2) return { x: W, y: r + s, tx: 0, ty: 1, nx: 1, ny: 0 };
  if (section === 4) return { x: W - r - s, y: H, tx: -1, ty: 0, nx: 0, ny: 1 };
  if (section === 6) return { x: 0, y: H - r - s, tx: 0, ty: -1, nx: -1, ny: 0 };
  const corner = (section - 1) / 2;
  const center = [[W-r, r], [W-r, H-r], [r, H-r], [r, r]][corner];
  const angle = -Math.PI / 2 + corner * Math.PI / 2 + s / r;
  const nx = Math.cos(angle), ny = Math.sin(angle);
  return { x: center[0] + r * nx, y: center[1] + r * ny, tx: -ny, ty: nx, nx, ny };
}

export function bladeAt(distance, offset = 0, mountDistance = distance, tilt = BLADE_TILT) {
  const p = perimeterAt(offset - mountDistance);
  return bladePose(p, distance, offset, tilt);
}

export function bladePose(p, distance, offset = 0, tilt = BLADE_TILT) {
  // Unwrapped distance is essential: completing a lap must not reset spin.
  const angle = -(distance + offset) / TURN_DISTANCE * TAU;
  const c = Math.cos(angle), s = Math.sin(angle);
  // V is the blade's straight base, always in the wall. Hinge U around that
  // base: 90° projects outward; 0° folds flat against the wall. The complete
  // frame then spins about the outward axle without detaching the base.
  // Negative angle is counterclockwise when looking inward from the axle tip.
  const leanRadians = (90 - Math.max(0, Math.min(90, tilt))) * Math.PI / 180;
  const outward = Math.cos(leanRadians), along = Math.sin(leanRadians);
  const basisU = [-p.nx * outward + p.tx * c * along,
    -p.ny * outward + p.ty * c * along, -s * along];
  const basisV = [-p.tx * s, -p.ty * s, -c];
  const project = ([x, y, z]) => [x - LEAN * z, y - LEAN * z];
  const u = project(basisU), v = project(basisV);
  const root = [p.x, p.y, MOUNT_Z];
  const matrix = [u[0], u[1], v[0], v[1],
    root[0] - LEAN * root[2], root[1] - LEAN * root[2]];
  const sideMatrix = [outward, -basisU[2], 0, -basisV[2], 0, 0];
  return { ...p, angle, matrix, sideMatrix, root, basisU, basisV, axle: [p.nx, p.ny, 0] };
}

// Keep even a 14px blade's rotating profile clear of each square corner.
export const CORNER_CLEARANCE = 16;
export function fixedBladeOffsets(count = DEFAULTS.count) {
  const W = FACE.width, H = FACE.height, r = CORNER_RADIUS, arc = Math.PI * r / 2;
  const long = Math.max(1, Math.round(count * (W - 2 * CORNER_CLEARANCE) / (2 * (W + H - 4 * CORNER_CLEARANCE))));
  const counts = [long, Math.floor((count - 2 * long) / 2), long, Math.ceil((count - 2 * long) / 2)];
  if (count < 4) return Array.from({ length: count }, (_, i) => [W/2-r, W-2*r+arc+H/2-r, W-2*r+H-2*r+2*arc+W/2-r][i]);
  const starts = [0, W-2*r+arc, W+H-4*r+2*arc, 2*W+H-6*r+3*arc];
  return counts.flatMap((n, side) => Array.from({ length: n }, (_, i) => {
    const length = side % 2 ? H : W;
    const along = n === 1 ? length / 2 : CORNER_CLEARANCE + (length - 2 * CORNER_CLEARANCE) * i / (n - 1);
    return starts[side] + along - r;
  }));
}

// Limit drawing only. Story time continues between displayed frames, so a low
// frame rate changes the stepped appearance without slowing travel or spin.
export function createFrameGate() {
  let elapsed = 0;
  return {
    ready(seconds, fps) {
      elapsed += seconds;
      const interval = 1 / fps;
      if (elapsed + 1e-9 < interval) return false;
      elapsed = Math.max(0, elapsed - Math.floor((elapsed + 1e-9) / interval) * interval);
      return true;
    },
    reset() { elapsed = 0; },
  };
}

// Consumers supply elapsed story minutes. Paused time is zero; changing
// pace changes minutes supplied, not the distance/rotation ratio.
export function createBladeMotion() {
  let distance = 0, mountDistance = 0, minutes = 0;
  return {
    advance(storyMinutes, pixelsPerMinute, { travel = true } = {}) {
      if (!Number.isFinite(storyMinutes) || storyMinutes <= 0 || !Number.isFinite(pixelsPerMinute) || pixelsPerMinute < 0) return;
      minutes += storyMinutes; distance += storyMinutes * pixelsPerMinute;
      if (travel) mountDistance += storyMinutes * pixelsPerMinute;
    },
    reset() { distance = mountDistance = minutes = 0; },
    snapshot() { return { distance, mountDistance, minutes }; },
  };
}
