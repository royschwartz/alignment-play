// Lettering emerges in story time, without substituting a font or moving it.
// The mask lives on the card, so its activity-hold print copies inherit the
// very same missing pieces, including an immediate reveal on selection.

const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t*t*(3-2*t); };
const number = value => Number(value.toFixed(3));
const spines = new Map();

// A narrow mask at a random x often crosses only a serif or the empty
// middle of a bowl. Locate actual vertical ink in the same font instead.
// This canvas only measures; the browser's original DOM text is still the
// sole visible lettering, at its original position and resolution.
function glyphSpine(char, style, fallback) {
  const font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const key = `${font}:${char}`;
  if (spines.has(key)) return spines.get(key);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return fallback;
  context.font = font;
  const metrics = context.measureText(char), advance = metrics.width;
  if (!advance) return fallback;
  const size = parseFloat(style.fontSize) || 15, scale = 4, margin = 3;
  const origin = margin + Math.max(0, metrics.actualBoundingBoxLeft || 0);
  canvas.width = Math.ceil((origin + Math.max(advance, metrics.actualBoundingBoxRight || 0) + margin)*scale);
  canvas.height = Math.ceil((size*2 + margin*2)*scale);
  context.scale(scale, scale); context.font = font;
  context.fillText(char, origin, size*1.4 + margin);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const coverage = new Float64Array(canvas.width);
  for (let x = 0; x < canvas.width; x++) {
    for (let y = 0; y < canvas.height; y++) coverage[x] += data[(y*canvas.width + x)*4 + 3];
  }
  // Average across a half-pixel shaft. The highest total generally follows
  // the long stem; ties choose its interior instead of an antialiased edge.
  let strongest = 0, candidates = [];
  const from = Math.max(1, Math.floor(origin*scale));
  const to = Math.min(canvas.width - 2, Math.ceil((origin + advance)*scale));
  for (let x = from; x <= to; x++) {
    const score = coverage[x - 1] + coverage[x]*2 + coverage[x + 1];
    if (score > strongest + .01) { strongest = score; candidates = [x]; }
    else if (Math.abs(score - strongest) <= .01) candidates.push(x);
  }
  const column = candidates[Math.floor(candidates.length/2)];
  const result = strongest ? clamp(((column + .5)/scale - origin)/advance) : fallback;
  if (spines.size > 512) spines.clear();
  spines.set(key, result);
  return result;
}

function hash(value) {
  let state = 2166136261;
  for (const char of String(value)) {
    state ^= char.codePointAt(0);
    state = Math.imul(state, 16777619);
  }
  return state >>> 0;
}

function random(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Each glyph has its own sequence of uneven story-time holds. The ordering
// is random within the word, not a left-to-right or every-nth-letter reveal.
// Sampling these schedules never advances them or consumes simulation RNG.
export function formationStages(seed, letterCount) {
  const count = Math.max(0, Math.trunc(letterCount));
  const letters = Array.from({ length: count }, (_, index) => {
    const sample = random(hash(`${seed}:formation:${index}`));
    return { index, sample, rank: sample() };
  });
  const arrival = [...letters].sort((a, b) => a.rank - b.rank);
  const initial = new Set(arrival.slice(0, Math.max(1, Math.round(count*.3))).map(letter => letter.index));
  const late = arrival.at(-1)?.index;
  return letters.map(({ index, sample }) => {
    const present = initial.has(index);
    const delay = present ? 0 : index === late ? .56 + sample()*.12 : .04 + sample()*.61;
    const finish = .9 + sample()*.1;
    const count = 7 + Math.floor(sample()*5);
    const first = present ? .18 + sample()*.04 : .035 + sample()*.09;
    const time = Array.from({ length: count - 1 }, () => .15 + Math.pow(sample(), 2)*2.8);
    const ink = Array.from({ length: count - 1 }, () => .09 + Math.pow(sample(), 1.5)*1.8);
    const timeTotal = time.reduce((sum, value) => sum + value, 0);
    const inkTotal = ink.reduce((sum, value) => sum + value, 0);
    const stages = [{ at: delay, growth: first }];
    let elapsed = 0, growth = 0;
    for (let i = 0; i < count - 1; i++) {
      elapsed += time[i]; growth += ink[i];
      stages.push({ at: delay + (finish - delay)*elapsed/timeTotal, growth: first + (1 - first)*growth/inkTotal });
    }
    stages.at(-1).growth = 1;
    return stages;
  });
}

export function stageGrowth(stages, progress) {
  if (progress >= 1) return 1;
  for (let i = stages.length - 1; i >= 0; i--) {
    if (progress >= stages[i].at) return stages[i].growth;
  }
  return 0;
}

// Range preserves the browser's existing kerning, wrapping, marker spans,
// and exact text. Undo only the study's presentation scale when measuring;
// no glyph is wrapped in an element or independently positioned.
function measure(field, button, seed) {
  const origin = field.getBoundingClientRect();
  const face = button.getBoundingClientRect();
  const scaleX = face.width / button.offsetWidth;
  const scaleY = face.height / button.offsetHeight;
  if (!scaleX || !scaleY || !origin.width || !origin.height) return null;
  const width = origin.width / scaleX, height = origin.height / scaleY;
  const letters = [];
  const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let index = 0, node;
  while ((node = walker.nextNode())) {
    const style = getComputedStyle(node.parentElement);
    let offset = 0;
    for (const char of node.data) {
      const start = offset;
      offset += char.length;
      const sample = random(hash(`${seed}:${index++}:${char}`));
      if (/\s/u.test(char)) continue;
      range.setStart(node, start); range.setEnd(node, offset);
      const bounds = range.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      letters.push({
        x: (bounds.left - origin.left) / scaleX,
        y: (bounds.top - origin.top) / scaleY,
        width: bounds.width / scaleX,
        height: bounds.height / scaleY,
        spine: glyphSpine(char, style, .19 + sample()*.47),
        top: .025 + sample()*.08,
        bottom: .88 + sample()*.12,
        second: sample(),
        lean: (sample() - .5)*.045,
      });
    }
  }
  const schedules = formationStages(`${seed}:${field.textContent}`, letters.length);
  letters.forEach((letter, i) => { letter.stages = schedules[i]; });
  return { width, height, letters };
}

function maskFor(shape, progress) {
  const { width, height, letters } = shape;
  const growths = letters.map(letter => stageGrowth(letter.stages, progress));
  const key = growths.join(',');
  if (shape.maskKey === key) return shape.mask;
  const marks = [];
  for (const [index, letter] of letters.entries()) {
    const { x, y, width: w, height: h, spine, top, bottom, second, lean } = letter;
    const growth = growths[index];
    if (!growth) continue;
    // First: a slender, pointed piece of the real glyph. Its thin shaft
    // gains width before the rest of the letter fills the remaining holes.
    const opacity = ease(growth / .17);
    const swelling = Math.pow(clamp((growth - .1)/.9), 1.9);
    const half = .29 + w*.59*swelling;
    const center = x + w*spine;
    const start = y + h*top*(1 - growth);
    const end = y + h*(bottom + (1 - bottom)*growth);
    const tilt = w*lean*(1 - growth);
    const tip = Math.min((end - start)*.2, 2.3*(1 - growth));
    const points = [
      [center + tilt, start],
      [center + half, start + tip],
      [center + half*.7, end - tip],
      [center - tilt, end],
      [center - half*.7, end - tip],
      [center - half, start + tip],
    ].map(point => point.map(number).join(',')).join(' ');
    marks.push(`<polygon points="${points}" opacity="${number(opacity)}"/>`);
    // A second detached fragment gives wider letters broken crossbars and
    // bowls as they grow. It is still clipped by the authored glyph itself.
    const fragment = ease((growth - .16 - second*.13) / .38);
    if (fragment > 0) {
      const stripeY = y + h*(.31 + second*.31);
      const stripeHeight = .45 + h*.32*Math.pow(fragment, 1.7);
      marks.push(`<rect x="${number(x)}" y="${number(stripeY - stripeHeight/2)}" width="${number(w)}" height="${number(stripeHeight)}" opacity="${number(fragment)}"/>`);
    }
    // This fills the small missing portions rather than redrawing the
    // letters. At completion the mask is removed entirely.
    const whole = ease((growth - .43) / .52);
    if (whole > 0) marks.push(`<rect x="${number(x - .6)}" y="${number(y - .6)}" width="${number(w + 1.2)}" height="${number(h + 1.2)}" opacity="${number(whole)}"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}"><g fill="white">${marks.join('')}</g></svg>`;
  shape.maskKey = key;
  shape.mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return shape.mask;
}

export function createFormingInk({ el, button }, { seed = 1 } = {}) {
  let progress = 0, revealed = false, dirty = true, destroyed = false;
  const fields = ['label', 'money'].map(name => ({
    name, node: button.querySelector(`:scope > .${name}`), shape: null,
  })).filter(field => field.node);

  function clear() {
    el.classList.remove('forming-ink');
    for (const field of fields) {
      el.style.removeProperty(`--forming-${field.name}-mask`);
      field.mask = null;
    }
  }

  function paint() {
    if (destroyed) return;
    if (revealed || progress >= 1) { clear(); return; }
    el.classList.add('forming-ink');
    if (dirty) {
      for (const field of fields) field.shape = measure(field.node, button, `${seed}:${field.name}`);
      dirty = fields.some(field => !field.shape);
    }
    for (const field of fields) {
      const { name, shape } = field;
      const mask = shape ? maskFor(shape, progress) : 'linear-gradient(transparent, transparent)';
      if (field.mask !== mask) el.style.setProperty(`--forming-${name}-mask`, mask);
      field.mask = mask;
    }
  }

  function refresh() { dirty = true; paint(); }
  const observer = new ResizeObserver(refresh);
  for (const { node } of fields) observer.observe(node);
  document.fonts?.addEventListener('loadingdone', refresh);
  paint();

  return {
    show(value) {
      if (destroyed || revealed) return;
      // Story progress, not frame timing, determines every visible fragment.
      const next = Math.round(clamp(Number(value) || 0)*500)/500;
      if (next === progress && !dirty) return;
      progress = next; paint();
    },
    reveal() { revealed = true; progress = 1; clear(); },
    isIncomplete() { return !revealed && progress < 1; },
    destroy() {
      destroyed = true; observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', refresh);
      clear();
    },
  };
}
