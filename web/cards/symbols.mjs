// The symbols on the boxes (Roy, Oct 9: "these images go in on the boxes like
// the one"). The art is Roy's, in web/art/, copied unchanged from
// spec/sketches/roy-card-symbols-2026-10-09/.
//
//   - A pain box has the knife in the heart: "the pain box symbol will be
//     animated", in "random images, no set order". It was 12 pictures a
//     second at first; then "the twisting of the kniife should be much , 3
//     fps", so three.
//   - When a pain box is selected, "the heart explodes": Roy's nine pictures
//     of the heart destroyed, drawn white on the black ("the exploding heart
//     I showed you has to be swapped for white"; the swap is done on the page,
//     the file stays as he made it). They still play at 12 a second
//     (provisional), so it's over in under a second.
//   - A thought box has the brain: "Thinking cards show the brain on top".
//     It's drawn a little bigger than the others (Roy, Oct 9: "Make the
//     brain a little bit bigger and move it up. the bottom should still be
//     where it is but it should touch the white outline on top through
//     resize"): enlarged about the middle of its bottom edge until its top
//     reaches the top of the picture.
//
// Roy, Oct 11: keep the original thin strokes and exact knife pixels;
// scale the unboxed icons slightly smaller. Only the knife moves. Each
// complete frame is drawn without smoothing or foreground thickening.
// CLOCK is shared by the sheets; each retains its own drawing cadence.
export const CLOCK = 12;
// A picture is 48 pixels square with a 2-pixel frame drawn in it; without the
// frame, 44. Roy asked for unboxed, larger icons on Oct 11; the full content
// is now shown at 40 px (Oct 11: "smaller actually", "just a little bit").
export const ART = 48, TRIM = 2, INSIDE = ART - 2 * TRIM, SHOWN = 40;
// Canvas pixels to one pixel of the art, so an enlarged picture stays sharp.
export const FINE = 2;
export const SYMBOLS = {
  // Roy's sheet has eight pictures; the last two are the same, so seven.
  knife: { src: 'web/art/knife-in-heart.png', size: 48, columns: 3, frames: 7, fps: 3, random: true, ink: [0, 9, 37, 44] },
  // Black on nothing, 32 pixels square: drawn white, in the middle.
  destroyed: { src: 'web/art/heart-destroyed.png', size: 32, columns: 3, frames: 9, fps: 12, white: true },
  // `ink`: where the brain itself is in its picture without the frame (left,
  // top, right, bottom). It's enlarged until its top touches the top.
  brain: { src: 'web/art/brain.png', size: 48, columns: 1, frames: 1, ink: [5, 6, 39, 43], fill: 'up' },
};
// The knife's pictures differ only where the knife is: left of this column
// and below this row (in the 48-pixel picture). The rest, the heart's top and
// right side and the frame, is the same in all of them.
export const KNIFE_REACH = { right: 24, top: 20 };

// Which symbol a box has: a thought box the brain, even when it costs pain;
// any other pain box, and an answer that costs pain, the knife in the heart.
export const symbolOf = card => (card.thought ? 'brain' : card.pain ? 'knife' : null);

// The next picture of the knife: any but the one showing, so it never stands
// still and never follows an order. `random` gives a number from 0 to 1.
export function nextFrame(current, frames, random = Math.random) {
  if (frames < 2) return 0;
  const n = Math.min(frames - 2, Math.floor(random() * (frames - 1)));
  return n >= current ? n + 1 : n;
}

// Where picture n sits in its sheet, in sheet pixels.
export const frameAt = (sheet, n) => [(n % sheet.columns) * sheet.size, Math.floor(n / sheet.columns) * sheet.size];

// How many beats of the clock a sheet's picture stays.
export const beatsOf = sheet => Math.max(1, Math.round(CLOCK / sheet.fps));

// What to draw of picture n, and where in the INSIDE × INSIDE picture: a
// 48-pixel picture loses its frame; a smaller one sits in the middle; one
// that fills up is enlarged about the middle of its ink's bottom edge until
// the ink's top is at the top.
//   { sx, sy, side }: the square taken from the sheet
//   { dx, dy, size }: where it's drawn and how big, in art pixels
export function placeOf(sheet, n) {
  const [x, y] = frameAt(sheet, n);
  if (sheet.size !== ART) {
    const off = (INSIDE - sheet.size) / 2;
    return { sx: x, sy: y, side: sheet.size, dx: off, dy: off, size: sheet.size };
  }
  const place = { sx: x + TRIM, sy: y + TRIM, side: INSIDE, dx: 0, dy: 0, size: INSIDE };
  if (sheet.fill !== 'up') return place;
  const [left, top, right, bottom] = sheet.ink, scale = bottom / (bottom - top), middle = (left + right) / 2;
  return { ...place, dx: middle * (1 - scale), dy: bottom * (1 - scale), size: INSIDE * scale };
}

// Visible right edge, in CSS pixels, rather than the sprite's blank margin.
// The knife uses the union of all frames so its text never shifts as it turns.
export function symbolRight(name) {
  const sheet = SYMBOLS[name], { dx, size } = placeOf(sheet, 0);
  return (dx + sheet.ink[2] * size / INSIDE) * SHOWN / INSIDE;
}

// ------------------------------------------------------------- on the page

const live = new Set(), sheets = {};
let ticking = false, last = 0, owed = 0;

// A sheet's image, loaded once. A sheet drawn white is turned white here.
function sheetImage(name) {
  if (sheets[name]) return sheets[name];
  const sheet = SYMBOLS[name], entry = sheets[name] = { image: null, waiting: [], frames: new Map() };
  const img = new Image();
  img.onload = () => {
    let image = img;
    if (sheet.white) {
      image = document.createElement('canvas');
      image.width = img.naturalWidth;
      image.height = img.naturalHeight;
      const ctx = image.getContext('2d');
      ctx.drawImage(img, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, image.width, image.height);
    }
    entry.image = image;
    for (const draw of entry.waiting.splice(0)) draw();
  };
  img.src = sheet.src;
  return entry;
}

function show(entry, name, frame) {
  entry.name = name;
  entry.frame = frame;
  entry.beats = SYMBOLS[name].fps ? beatsOf(SYMBOLS[name]) : 0;
  entry.el.dataset.symbol = name;
  const sheet = sheetImage(name), draw = () => {
    // Only if this is still the picture wanted (the image may load late).
    if (entry.name !== name || entry.frame !== frame) return;
    let picture = sheet.frames.get(frame);
    if (!picture) {
      const { sx, sy, side, dx, dy, size } = placeOf(SYMBOLS[name], frame);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = INSIDE * FINE;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sheet.image, sx, sy, side, side, dx * FINE, dy * FINE, size * FINE, size * FINE);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      sheet.frames.set(frame, picture = pixels);
    }
    entry.ctx.putImageData(picture, 0, 0);
  };
  if (sheet.image) draw(); else sheet.waiting.push(draw);
}

// Puts a box's symbol on its button and starts it. Returns null when the box
// has none. `still`: the knife doesn't move (a locked answer).
export function addSymbol(button, card, { still = false } = {}) {
  const name = symbolOf(card);
  if (!name) return null;
  const el = document.createElement('span');
  el.className = 'symbol';
  el.style.setProperty('--symbol-size', `${SHOWN}px`);
  button.style.setProperty('--symbol-ink-right', `${symbolRight(name)}px`);
  el.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = INSIDE * FINE;
  el.append(canvas);
  button.append(el);
  const entry = { el, ctx: canvas.getContext('2d'), still, done: null };
  show(entry, name, 0);
  // Each knife keeps its own time, so two pain boxes don't twist together.
  entry.beats = entry.beats ? 1 + Math.floor(Math.random() * entry.beats) : 0;
  if (name === 'knife') sheetImage('destroyed');
  el.symbol = entry;
  live.add(entry);
  if (!ticking) { ticking = true; last = performance.now(); requestAnimationFrame(tick); }
  return el;
}

// The heart is destroyed (a pain box was selected). Resolves when the last
// picture has shown; at once if the box has no heart or motion is reduced.
export function destroyHeart(symbolEl) {
  const entry = symbolEl?.symbol;
  if (!entry || entry.name !== 'knife' || reducedMotion()) return Promise.resolve();
  // The whole heart, the knife gone, shows for a full twelfth of a second
  // (show sets its beats; one more is added for the part-beat it comes in on).
  show(entry, 'destroyed', 0);
  entry.beats += 1;
  return new Promise(resolve => { entry.done = resolve; });
}

// The longest the heart takes to be destroyed, in milliseconds: its nine
// pictures, and up to a beat before the first changes.
export const DESTROY_MS = Math.round((SYMBOLS.destroyed.frames * beatsOf(SYMBOLS.destroyed) + 1) * 1000 / CLOCK);

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// One clock for every symbol on the page. A symbol's picture changes when its
// beats run out. It stops while the game is paused (an ancestor has .paused).
function tick(now) {
  owed += Math.min(250, now - last);
  last = now;
  const step = 1000 / CLOCK;
  while (owed >= step) {
    owed -= step;
    for (const entry of live) {
      if (!entry.el.isConnected) { live.delete(entry); entry.done?.(); continue; }
      if (!entry.beats || entry.el.closest('.paused')) continue;
      if (--entry.beats > 0) continue;
      entry.beats = beatsOf(SYMBOLS[entry.name]);
      if (entry.name === 'destroyed') {
        if (entry.frame + 1 < SYMBOLS.destroyed.frames) show(entry, 'destroyed', entry.frame + 1);
        else { entry.name = 'gone'; entry.ctx.clearRect(0, 0, INSIDE * FINE, INSIDE * FINE); live.delete(entry); entry.done?.(); }
      } else if (SYMBOLS[entry.name].random && !entry.still && !reducedMotion()) {
        show(entry, entry.name, nextFrame(entry.frame, SYMBOLS[entry.name].frames));
      }
    }
  }
  if (live.size) requestAnimationFrame(tick);
  else { ticking = false; owed = 0; }
}
