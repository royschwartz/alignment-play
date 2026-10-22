// A small, art-directed capillary-growth model. The wetting front follows
// local fabric resistance, not a radius or a pre-drawn stain silhouette.
// This is a visual approximation, not a quantitative fluid simulation.
import { seeded } from './kit.mjs';

const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const smooth = t => t * t * (3 - 2 * t);

function fabricField(random, size) {
  const values = Array.from({ length: size * size }, () => random());
  return (x, y) => {
    x = clamp(x) * (size - 1); y = clamp(y) * (size - 1);
    const ix = Math.floor(x), iy = Math.floor(y), u = smooth(x - ix), v = smooth(y - iy);
    const at = (dx, dy) => values[Math.min(size - 1, iy + dy) * size + Math.min(size - 1, ix + dx)];
    return (at(0, 0) * (1 - u) + at(1, 0) * u) * (1 - v) + (at(0, 1) * (1 - u) + at(1, 1) * u) * v;
  };
}

// A binary heap advances whichever neighboring pore will become wet next.
function frontier() {
  const heap = [];
  return {
    push(index, time) {
      let at = heap.length; heap.push({ index, time });
      while (at) {
        const parent = (at - 1) >> 1;
        if (heap[parent].time <= time) break;
        heap[at] = heap[parent]; at = parent;
      }
      heap[at] = { index, time };
    },
    pop() {
      if (!heap.length) return null;
      const first = heap[0], last = heap.pop();
      if (heap.length) {
        let at = 0;
        while (at * 2 + 1 < heap.length) {
          let child = at * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1].time < heap[child].time) child++;
          if (heap[child].time >= last.time) break;
          heap[at] = heap[child]; at = child;
        }
        heap[at] = last;
      }
      return first;
    },
  };
}

export function simulateStain({ seed = 'alignment', size = 128, source = [.50, .48], aspect = 1 } = {}) {
  const random = seeded(`cloth:${seed}`), patches = fabricField(random, 7), pores = fabricField(random, 29);
  const count = size * size, resistance = new Float32Array(count), warp = new Float32Array(count);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, u = x / size, v = y / size;
    const patch = patches(u, v);
    resistance[i] = .25 + 2.8 * patch ** 2 + pores(u, v) * .22;
    warp[i] = .65 + patches(1 - u, v) * .7;
  }
  const times = new Float32Array(count).fill(Infinity), queue = frontier();
  const origin = source.map(v => Math.round(clamp(v) * (size - 1)));
  const start = origin[1] * size + origin[0];
  times[start] = 0; queue.push(start, 0);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
    [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
  const settled = new Uint8Array(count);
  let item;
  while ((item = queue.pop())) {
    const { index: i, time } = item;
    if (settled[i]) continue;
    settled[i] = 1;
    const x = i % size, y = Math.floor(i / size);
    for (const [dx, dy] of directions) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      const j = ny * size + nx;
      if (settled[j]) continue;
      const thread = (warp[i] + warp[j]) / 2;
      const distance = Math.hypot(dx * thread * aspect, dy / thread);
      const cost = distance * (resistance[i] + resistance[j]) / 2;
      const next = time + cost;
      if (next < times[j]) { times[j] = next; queue.push(j, next); }
    }
  }
  // Stop while the front is inside the cloth sample. Crop the result after
  // spreading, preserving its proportions and its irregular connected edge.
  let boundary = Infinity;
  for (let i = 0; i < size; i++) boundary = Math.min(boundary, times[i], times[(size - 1) * size + i], times[i * size], times[i * size + size - 1]);
  const finish = boundary * .84, feather = finish * .07;
  const bounds = [size, size, 0, 0];
  for (let i = 0; i < count; i++) if (times[i] < finish + feather) {
    const x = i % size, y = Math.floor(i / size);
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
  }
  return { seed, size, times, resistance, finish, feather, bounds, origin };
}

export function stainPixels(model, outputSize = 256) {
  const { size, times, finish, feather, bounds } = model;
  const random = seeded(`fibers:${model.seed}`), data = new Uint8ClampedArray(outputSize * outputSize * 4);
  const span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) + 8;
  const cx = (bounds[0] + bounds[2]) / 2, cy = (bounds[1] + bounds[3]) / 2;
  const sample = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy;
    const at = (dx, dy) => times[clamp(iy + dy, 0, size - 1) * size + clamp(ix + dx, 0, size - 1)];
    return (at(0, 0) * (1 - u) + at(1, 0) * u) * (1 - v) + (at(0, 1) * (1 - u) + at(1, 1) * u) * v;
  };
  for (let y = 0; y < outputSize; y++) for (let x = 0; x < outputSize; x++) {
    const sx = cx + (x / outputSize - .5) * span, sy = cy + (y / outputSize - .5) * span;
    const arrival = sample(sx, sy);
    const wet = smooth(clamp((finish + feather - arrival) / (2 * feather)));
    // Horizontal fibers only (Roy's latest direction). Slight waviness and
    // varying absorption keep the lines from reading as a rigid stripe fill.
    const py = y + Math.sin(x / 53) * .7;
    const thread = Math.abs(Math.sin(py * Math.PI / 5.2)) ** 8;
    const fiber = .7 + .3 * Math.sin(x / 7 + Math.floor(py / 5.2) * 1.8) ** 2;
    const wash = 42 * clamp(arrival / finish) ** 1.8;
    const body = clamp(8 + wash + thread * fiber * 32 + random() * 20, 0, 150);
    const edgeGrain = wet < .95 ? (random() - .5) * .24 : 0;
    const alpha = clamp(wet + edgeGrain * wet);
    const gray = Math.round(255 * (1 - alpha) + body * alpha), i = (y * outputSize + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = gray; data[i + 3] = 255;
  }
  return { data, width: outputSize, height: outputSize };
}

// Keep the natural silhouette instead of imposing a circular text-safe core.
// Choose a fabric realization whose central mass can carry the white digits.
// This uses only appearance randomness, and the chosen result is shared/cached.
export function createStainArtwork({ seed = 'alignment' } = {}) {
  let best, bestScore = -1;
  for (let attempt = 0; attempt < 12; attempt++) {
    const model = simulateStain({ seed: attempt ? `${seed}:cloth:${attempt}` : seed });
    const picture = stainPixels(model);
    let dark = 0, count = 0;
    for (let y = 76; y <= 180; y += 4) for (let x = 80; x <= 176; x += 4) {
      dark += picture.data[(y * picture.width + x) * 4] < 165; count++;
    }
    const score = dark / count;
    if (score > bestScore) { best = { ...picture, model, coverage: score }; bestScore = score; }
    if (score >= .995) return best;
  }
  return best;
}

// Keep the same spreading model, but print it onto a sprite-sized 1-bit grid.
// Low thresholds grouped on horizontal rows preserve broken fabric threads.
export function pixelStain(model, { filter = 'threshold', size = 48 } = {}) {
  const picture = stainPixels(model, size);
  const values = Float32Array.from({ length: size * size }, (_, i) => picture.data[i * 4]);
  const weave = [40, 60, 44, 64, 208, 228, 212, 232, 136, 156, 140, 160, 240, 220, 244, 224];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const baseThreshold = filter === 'woven' ? weave[(y % 4) * 4 + x % 4] : filter === 'threshold' ? 68 : 128;
    // Solid ink behind the digits, easing back to the fabric print outside.
    // Raise only the print threshold: do not stamp a box onto the silhouette.
    const clearance = Math.max(Math.abs((x + .5) / size - .5) / .23, Math.abs((y + .5) / size - .5) / .25);
    const center = 1 - smooth(clamp((clearance - 1) / .4));
    const threshold = filter === 'threshold' ? baseThreshold + (210 - baseThreshold) * center : baseThreshold;
    const value = values[i] < threshold ? 0 : 255;
    if (filter === 'diffusion') {
      const error = values[i] - value;
      const add = (dx, dy, weight) => {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < size && ny < size) values[ny * size + nx] += error * weight / 16;
      };
      add(1, 0, 7); add(-1, 1, 3); add(0, 1, 5); add(1, 1, 1);
    }
    picture.data[i * 4] = picture.data[i * 4 + 1] = picture.data[i * 4 + 2] = value;
  }
  return picture;
}
