// Roy, Oct 19: trickles show the short-term changes in rapture, like water
// trickling on a wall seen face-on. When you gain they run up above the
// number toward its word; when you lose, down below it toward the line;
// disquiet's pull on rapture runs from right to left between the two numbers,
// a short stream centered in the gap. Each dissolves at a barrier near the
// words and numbers it comes close to. Up and down show the most recent event
// alone, never the overall trend, "so the player can get a sense of what
// events and choices immediate ramifications are": a burst of drops as big as
// the rapture it moves (`createEventWatch`). Disquiet's pull follows its rate
// per story hour (`raptureCurrents` in engine/sim.mjs). The look follows the
// pain scars: one-bit ink on a fixed grain, so nothing crawls and a drop
// shows the same pixels wherever it stops. Drops move in real seconds, as the
// numbers have since October 19 (402). No simulation reads or writes and no
// Math.random: every turn a drop takes is hashed from its serial number. All
// numbers provisional.
export const TRICKLE = Object.freeze({
  pixel: 1,              // CSS px per ink pixel
  fps: 15,               // drawn frames per second of motion
  perRate: .5,           // sideways drops per second for each rapture per story hour
  most: 3,               // sideways drops per second at most, each way
  side: .45,             // the part of the gap between two numbers a sideways stream runs, centered
  float: 4,              // px per second a sideways drop floats, never catching (Roy: "slower floating")
  perRapture: 3,         // drops in an event's burst for each rapture it moves
  burstMost: 12,         // drops in a burst at most
  spread: 1.6,           // how wide a burst spreads, in widths of the number
  burst: 3,              // seconds a burst lasts, most of it at the start
  speed: 12,             // px per second while a drop runs
  run: [5, 14],          // px a drop runs before it catches
  hold: [.1, .5],        // seconds it holds before it runs again
  bead: [.6, 1],         // a drop's radius, px
  trail: .6,             // the wet trail's half-width, px
  wet: .92,              // how dark a fresh trail is (0 to 1)
  dry: 5,                // seconds a trail stays wet
  taper: .45,            // how much a trail narrows as it dries (0 to 1)
  broken: .5,            // how broken a trail is, in dashes (0 solid to 1)
  dash: 1.5,             // px of trail in each dash
  stretch: .55,          // how far a running drop's head stretches behind it, in radii
  residue: 0,            // a drop that holds long leaves a bead this part of its size
  meander: .6,           // px a drop wanders from its line
  wander: 10,            // px along the line for each wander
  gap: 1,                // px the barrier keeps clear of words and numbers
  soft: 2.5,             // px over which a drop dissolves
  clump: .5,             // how much of the grain is in clumps (0 fine specks to 1)
  clumpSize: 2.6,        // px across a clump of the grain
  hunger: 'off',         // hunger's pull: 'off', or 'right' toward hunger as disquiet's goes left
});

const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
const span = ([lo, hi], u) => lo + (hi - lo) * u;
const STEP = 1 / 60;

// A fixed number in [0, 1) for any list of integers.
export function hashed(...parts) {
  let n = 0x9e3779b9;
  for (const p of parts) {
    n = Math.imul(n ^ (p | 0), 0x85ebca6b);
    n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16;
  }
  return (n >>> 0) / 4294967296;
}
// The wall's grain: one threshold per ink pixel, the same every frame. Part
// of it is in clumps a few pixels wide, so what dries or dissolves breaks
// into specks and patches rather than an even salt-and-pepper.
const lattice = (x, y) => hashed(x + 409, y + 1201, 57);
function clumps(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = smooth(x - i), v = smooth(y - j);
  const a = lattice(i, j), b = lattice(i + 1, j), c = lattice(i, j + 1), d = lattice(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const grain = (x, y, t = TRICKLE) => clamp((1 - t.clump) * hashed(x + 7919, y + 104729, 31) + t.clump * clumps(x / t.clumpSize, y / t.clumpSize), 0, .999);

const DIRECTIONS = {
  up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 },
};
const STREAMS = Object.keys(DIRECTIONS);

// The steady streams' rates per story hour, by direction: disquiet's pull to
// the left, hunger's to the right if the tuning says. Up and down come only
// from events, never from a rate.
export function streamRates(currents = {}, tuning = TRICKLE) {
  const r = k => Math.max(0, Number(currents[k]) || 0);
  return { up: 0, down: 0, left: r('disquiet'), right: (tuning.hunger ?? TRICKLE.hunger) === 'right' ? r('hunger') : 0 };
}

// The latest change to rapture, as an event: each new rapture flow (a pain
// card, a meal's warmth, a description's, a neglected need, a shift's) and
// the hourly rate of an activity you chose, for its length. Whatever begins
// in the same frame is one event; its gains and losses are kept apart. What
// is already flowing when the page opens is no event. Reads the state only.
export function createEventWatch() {
  const seen = new WeakSet();
  let run = null, primed = false;
  return {
    update(s, C) {
      let up = 0, down = 0;
      const add = n => { if (n > 0) up += n; else down -= n; };
      for (const f of s.flows) if (!seen.has(f)) {
        seen.add(f);
        if (primed && f.key === 'rapture') add(f.left);
      }
      if (s.now.run !== run) {
        run = s.now.run;
        const a = C.activities[s.now.id];
        // Its hourly rate moves rapture `raptureScale` of what's written (Oct 21, 413).
        if (primed && s.now.by === 'you' && a?.rate && !s.now.owed) add(a.rate * (C.tuning.raptureScale ?? 1) * Math.max(0, s.now.ends - s.now.started) / 60);
      }
      primed = true;
      return up > 1e-9 || down > 1e-9 ? { up, down } : null;
    },
  };
}

// Distance from a point to a box (0 inside it).
const boxDistance = (b, x, y) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

// How much ink may show at each pixel: none within `gap` of a word or
// number (or the line beneath), rising over `soft` to all of it.
export function barrierField(layout, tuning = TRICKLE) {
  const p = tuning.pixel, cols = Math.max(1, Math.ceil(layout.width / p)), rows = Math.max(1, Math.ceil(layout.height / p));
  const mask = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = (i + .5) * p, y = (j + .5) * p;
    let d = Math.min(x, layout.width - x, y, layout.height - y);
    for (const b of layout.boxes) d = Math.min(d, boxDistance(b, x, y));
    mask[j * cols + i] = smooth((d - tuning.gap) / Math.max(1e-6, tuning.soft));
  }
  return { cols, rows, mask };
}

// Where a drop of each direction starts, and how far it goes. Up and down
// start at the number and end wholly inside the barrier they head for. A
// sideways stream runs only the middle part of the gap between two numbers
// (`side`), and dissolves at both of its ends.
function course(stream, layout, u, tuning) {
  const n = layout.number, beyond = tuning.gap + tuning.soft + tuning.bead[1] * 2 + 1;
  const across = (a, b) => a + (b - a) * (.15 + .7 * u);
  const wide = (n.x1 - n.x0) * tuning.spread / 2, centre = (n.x0 + n.x1) / 2;
  if (stream === 'up') return { x: across(centre - wide, centre + wide), y: n.y0, travel: n.y0 - (layout.label?.y1 ?? 0) + beyond };
  if (stream === 'down') return { x: across(centre - wide, centre + wide), y: n.y1, travel: (layout.floor ?? layout.height) - n.y1 + beyond };
  const [a, b] = stream === 'left' ? [layout.left?.x1 ?? n.x0 - 40, n.x0] : [n.x1, layout.right?.x0 ?? n.x1 + 40];
  const mid = (a + b) / 2, length = Math.max(2, (b - a) * tuning.side);
  return { x: stream === 'left' ? mid + length / 2 : mid - length / 2, y: across(n.y0, n.y1), travel: length };
}

export function createTrickles(tuning = TRICKLE) {
  let t = { ...TRICKLE, ...tuning };
  let clock = 0, serial = 0, carry = 0, drops = [];
  const owed = Object.fromEntries(STREAMS.map((k, i) => [k, { have: 0, due: -Math.log(1 - hashed(i, 0, 17)) }]));
  let field = null, fieldKey = '', drawn = '', bursts = {}, retuned = false;

  function spawn(stream, layout) {
    const id = ++serial, h = k => hashed(id, k, STREAMS.indexOf(stream));
    const { dx, dy } = DIRECTIONS[stream];
    const start = course(stream, layout, h(1), t);
    drops.push({ id, stream, dx, dy, nx: -dy, ny: dx, x0: start.x, y0: start.y, travel: Math.max(1, start.travel),
      r: span(t.bead, h(2)), pace: .7 + .7 * h(3), phase1: h(4) * 6.283, phase2: h(5) * 6.283,
      s: 0, running: true, left: span(t.run, h(6)), turns: 0, held: 0, floats: stream === 'left' || stream === 'right',
      trail: [], marked: -1, residues: [], gone: false });
  }

  function at(d, s) {
    const w = t.meander * smooth(s / 4) * (.7 * Math.sin(6.283 * s / t.wander + d.phase1) + .3 * Math.sin(6.283 * s / (t.wander * .43) + d.phase2));
    return { x: d.x0 + d.dx * s + d.nx * w, y: d.y0 + d.dy * s + d.ny * w };
  }

  function move(d, h) {
    if (d.gone) return;
    while (h > 1e-9) {
      if (d.running) {
        // Disquiet's stream floats along slowly and evenly; the others run
        // and catch, as water does down a wall.
        const v = (d.floats ? t.float : t.speed) * d.pace;
        const step = Math.min(d.floats ? Infinity : d.left, v * h, d.travel - d.s);
        d.s += step; h -= step / v;
        if (!d.floats) d.left -= step;
        // The wet line it leaves, every half pixel along its way.
        while (d.marked + .5 <= d.s) {
          d.marked += .5;
          if (d.marked >= 0) d.trail.push({ ...at(d, d.marked), s: d.marked, t: clock - h });
        }
        if (!d.floats && d.left <= 1e-9) {
          d.running = false; d.turns += 1; d.held = 0;
          d.left = span(t.hold, hashed(d.id, 100 + d.turns));
        }
      } else {
        const step = Math.min(d.left, h);
        d.held += step; d.left -= step; h -= step;
        if (d.left <= 1e-9) {
          // A drop that held a while leaves a little of itself behind.
          if (d.held > .5 && t.residue > 0) d.residues.push({ ...at(d, d.s), s: d.s, r: d.r * t.residue, t: clock });
          d.running = true; d.turns += 1;
          d.left = span(t.run, hashed(d.id, 100 + d.turns));
        }
      }
      if (d.s >= d.travel - 1e-9) { d.gone = true; return; }
    }
  }

  // Real seconds of motion. Pass 0 when story time isn't running.
  function advance(seconds, currents, layout) {
    if (!layout?.number) return;
    const rates = streamRates(currents, t);
    for (let left = Math.max(0, Math.min(1, seconds || 0)); left > 1e-9;) {
      const h = Math.min(STEP - carry, left);
      carry += h; left -= h;
      if (carry < STEP - 1e-9) break;
      carry = 0; clock += STEP;
      // The latest event's burst: drops as many as the rapture it moves, most
      // of them at once, then fewer, then none.
      for (const k of ['up', 'down']) {
        const b = bursts[k];
        if (!b) continue;
        b.elapsed += STEP;
        const x = Math.min(1, b.elapsed / Math.max(1e-6, t.burst));
        for (const due = Math.ceil(b.count * (1 - (1 - x) ** 2) - 1e-9); b.sent < due; b.sent++) spawn(k, layout);
        if (b.sent >= b.count) delete bursts[k];
      }
      STREAMS.forEach((k, i) => {
        if (!rates[k]) return;
        const o = owed[k];
        o.have += Math.min(t.most, rates[k] * t.perRate) * STEP;
        // Irregular arrivals at the right average: each wait is drawn from
        // the drop's own serial, so the same seconds give the same drops.
        while (o.have >= o.due) {
          o.have -= o.due;
          spawn(k, layout);
          o.due = -Math.log(1 - hashed(serial, i, 23));
        }
      });
      for (const d of drops) {
        move(d, STEP);
        while (d.trail.length && clock - d.trail[0].t > t.dry) d.trail.shift();
        while (d.residues.length && clock - d.residues[0].t > t.dry * 1.6) d.residues.shift();
      }
      drops = drops.filter(d => !d.gone || d.trail.length || d.residues.length);
    }
  }

  // The density of ink each drop leaves, before the barrier and the grain.
  function density(cols, rows) {
    const p = t.pixel, D = new Float32Array(cols * rows);
    const stamp = (cx, cy, reach, f, keep = 1) => {
      const i0 = Math.max(0, Math.floor((cx - reach) / p)), i1 = Math.min(cols - 1, Math.floor((cx + reach) / p));
      const j0 = Math.max(0, Math.floor((cy - reach) / p)), j1 = Math.min(rows - 1, Math.floor((cy + reach) / p));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const v = Math.min(1, f((i + .5) * p - cx, (j + .5) * p - cy)) * keep;
        if (v > D[j * cols + i]) D[j * cols + i] = v;
      }
    };
    // Fresh water is solid ink; only what dries, or meets a barrier, breaks
    // up. A small drop is a dot. A larger one is a ring, clear inside but for
    // its shadow on the lower right, with a glint at its top left: light from
    // the upper left, as on the scars.
    const bead = (cx, cy, r, ax, ay, stretch, strength, glint, keep) => stamp(cx, cy, r * (1 + stretch) + 1, (ox, oy) => {
      const u = ox * ax + oy * ay, v = -ox * ay + oy * ax;
      const d = Math.hypot(u / (u < 0 ? r * (1 + stretch) : r), v / r);
      if (d > 1) return 0;
      if (r < 1.5) return strength;
      if (glint && Math.hypot(ox + r * .4, oy + r * .4) < r * .3) return 0;
      const inner = 1 - Math.max(.9 / r, .3);
      if (d >= inner) return strength;
      return d > inner * .4 && (ox * .6 + oy * .8) / (r * d) > .5 ? strength : 0;
    }, keep);
    // A drop dissolves into and out of its own way's two ends, as at a barrier.
    const ends = (d, s) => smooth(s / t.soft) * smooth((d.travel - s) / t.soft);
    for (const d of drops) {
      for (const q of d.trail) {
        const wet = clamp(1 - (clock - q.t) / t.dry);
        if (wet <= 0) continue;
        const half = t.trail * (1 - t.taper + t.taper * wet);
        const ragged = 1.1 - t.broken + t.broken * hashed(d.id, Math.floor(q.s / Math.max(.25, t.dash)), 7);
        const dark = 1.5 * t.wet * wet ** 1.1 * ragged;
        stamp(q.x, q.y, half * 1.4 + .5, (ox, oy) => dark * smooth((1.4 - Math.hypot(ox, oy) / half) / 1), ends(d, q.s));
      }
      for (const q of d.residues) {
        const wet = clamp(1 - (clock - q.t) / (t.dry * 1.6));
        if (wet > 0) bead(q.x, q.y, q.r * (.6 + .4 * wet), d.dx, d.dy, .1, 1.4 * wet ** .8, false, ends(d, q.s));
      }
      if (d.gone) continue;
      const head = at(d, d.s), grow = d.running ? 0 : .18 * smooth(d.held);
      const r = d.r * (1 + grow);
      bead(head.x, head.y, r, d.dx, d.dy, d.running ? t.stretch : .12, 1.2, r >= 1.6, ends(d, d.s));
    }
    return D;
  }

  // Draws the frame for now, at most `fps` times a second of motion.
  function draw(canvas, layout) {
    if (!layout?.number) return;
    const p = t.pixel, cols = Math.max(1, Math.ceil(layout.width / p)), rows = Math.max(1, Math.ceil(layout.height / p));
    const key = JSON.stringify([layout.width, layout.height, layout.boxes, t.pixel, t.gap, t.soft]);
    if (retuned) { drawn = ''; retuned = false; }
    if (key !== fieldKey) { field = barrierField(layout, t); fieldKey = key; drawn = ''; }
    const frame = `${Math.floor(clock * t.fps)}|${key}|${drops.length}`;
    if (frame === drawn && canvas.width === cols) return;
    drawn = frame;
    if (canvas.width !== cols) canvas.width = cols;
    if (canvas.height !== rows) canvas.height = rows;
    canvas.style.width = `${cols * p}px`; canvas.style.height = `${rows * p}px`;
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(cols, rows);
    const ink = inkOf(density(cols, rows), field.mask, cols, rows, t);
    for (let i = 0; i < ink.length; i++) if (ink[i]) image.data[i * 4 + 3] = 255;
    ctx.putImageData(image, 0, 0);
  }

  // One bit per pixel, the same pixels for the same frame.
  function raster(layout) {
    const p = t.pixel, cols = Math.max(1, Math.ceil(layout.width / p)), rows = Math.max(1, Math.ceil(layout.height / p));
    const f = barrierField(layout, t);
    return { cols, rows, ink: inkOf(density(cols, rows), f.mask, cols, rows, t) };
  }

  // The most recent event: its gains burst up, its losses down. A new event
  // takes the place of the last one's burst; drops already out run on.
  function event({ up = 0, down = 0 } = {}) {
    const count = n => Math.min(t.burstMost, Math.max(1, Math.round(n * t.perRapture)));
    bursts = {};
    if (up > 1e-9) bursts.up = { count: count(up), sent: 0, elapsed: 0 };
    if (down > 1e-9) bursts.down = { count: count(down), sent: 0, elapsed: 0 };
  }

  return {
    advance, draw, raster, event,
    retune(next) { t = { ...TRICKLE, ...next }; fieldKey = ''; retuned = true; },
    get tuning() { return { ...t }; },
    get drops() { return drops.map(d => ({ id: d.id, stream: d.stream, s: d.s, travel: d.travel, gone: d.gone, head: at(d, d.s) })); },
    get clock() { return clock; },
  };
}

function inkOf(D, mask, cols, rows, t) {
  const out = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i;
    if (D[k] > 0 && grain(i, j, t) < D[k] * mask[k]) out[k] = 1;
  }
  return out;
}

// The words and numbers of the attributes as boxes around their ink, in CSS
// px from the top left of `host` (the status bar), whatever the phone's scale.
// `attrs` maps each attribute's id to its element (.attr with .label and .num).
export function trickleLayout(host, attrs) {
  const frame = host.getBoundingClientRect(), scale = frame.width / (host.offsetWidth || frame.width || 1);
  const local = r => ({ x0: (r.left - frame.left) / scale, y0: (r.top - frame.top) / scale, x1: (r.right - frame.left) / scale, y1: (r.bottom - frame.top) / scale });
  const ctx = (trickleLayout.ctx ??= document.createElement('canvas').getContext('2d'));
  const inkOfText = (el, text) => {
    const style = getComputedStyle(el), box = local(el.getBoundingClientRect());
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const m = ctx.measureText(text || 'x');
    const fontHeight = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
    const baseline = box.y0 + (box.y1 - box.y0 - fontHeight) / 2 + m.fontBoundingBoxAscent;
    return { x0: box.x0, x1: box.x1, y0: baseline - m.actualBoundingBoxAscent, y1: baseline + m.actualBoundingBoxDescent };
  };
  const inkOfNumber = el => {
    const wheel = el.querySelector('.wheel-number') ?? el, style = getComputedStyle(el);
    const box = local(wheel.getBoundingClientRect());
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const m = ctx.measureText('0123456789'), half = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 2;
    const mid = (box.y0 + box.y1) / 2;
    if (box.x1 - box.x0 < 1) { const c = (box.x0 + box.x1) / 2; box.x0 = c - 4; box.x1 = c + 4; }
    return { x0: box.x0, x1: box.x1, y0: mid - half, y1: mid + half };
  };
  const out = { width: host.offsetWidth, height: host.offsetHeight, boxes: [] };
  for (const [id, el] of Object.entries(attrs)) {
    const label = el.querySelector('.label'), num = el.querySelector('.num');
    const words = inkOfText(label, label.textContent), number = inkOfNumber(num);
    out.boxes.push(words, number);
    if (id === 'rapture') { out.label = words; out.number = number; }
    if (id === 'disquiet') out.left = number;
    if (id === 'hunger') out.right = number;
  }
  // The line beneath the numbers.
  out.floor = out.height;
  out.boxes.push({ x0: 0, x1: out.width, y0: out.height, y1: out.height + 1 });
  return out;
}
