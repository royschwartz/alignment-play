// Helpers for card looks (see looks.mjs). A look draws only lines, shapes and
// patterns, never words: the words on a card are Roy's label, already there.

const NS = 'http://www.w3.org/2000/svg';

// An SVG element with attributes, and children appended.
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  el.append(...children.flat());
  return el;
}

// The artwork layer of a card: an SVG laid over the button at the button's
// own size, which may draw outside it (overflow is visible). The words stay
// above it. Calling it again replaces the earlier layer.
export function art(button, className = '') {
  button.querySelector(':scope > svg.look-art')?.remove();
  const layer = svg('svg', { class: `look-art ${className}`.trim(), 'aria-hidden': 'true', focusable: 'false' });
  button.prepend(layer);
  return layer;
}

// Calls draw(width, height) once the button has its layout size (its size
// before the grow-in transform scales it), and again if that size changes.
// It stops when the card leaves the page. Note: width and height include the
// button's 1px border, but the art layer starts inside the border, so in the
// layer's coordinates the button's outer edge runs from -1 to width - 1.
export function sized(el, draw) {
  let w = 0, h = 0;
  const check = () => {
    const nw = el.offsetWidth, nh = el.offsetHeight;
    if (nw && nh && (nw !== w || nh !== h)) { w = nw; h = nh; draw(w, h); }
  };
  const watcher = new ResizeObserver(() => {
    if (!el.isConnected) { watcher.disconnect(); return; }
    check();
  });
  watcher.observe(el);
  requestAnimationFrame(check);
}

// A seeded random number generator (0 to 1), so a card draws the same way
// every time: seed it with the card's label.
export function seeded(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

// Walking around a rectangle's edge, clockwise from the top left, `inset` px
// inside the button's edge (negative is outside). at(s) gives the point s px
// along, with the outward normal (nx, ny) and the side (0 top, 1 right,
// 2 bottom, 3 left).
export function around(w, h, inset = 0) {
  const x0 = inset, y0 = inset, ww = w - 2 * inset, hh = h - 2 * inset, length = 2 * (ww + hh);
  const at = s => {
    s = ((s % length) + length) % length;
    if (s < ww) return { x: x0 + s, y: y0, nx: 0, ny: -1, side: 0 };
    s -= ww;
    if (s < hh) return { x: x0 + ww, y: y0 + s, nx: 1, ny: 0, side: 1 };
    s -= hh;
    if (s < ww) return { x: x0 + ww - s, y: y0 + hh, nx: 0, ny: 1, side: 2 };
    s -= ww;
    return { x: x0, y: y0 + hh - s, nx: -1, ny: 0, side: 3 };
  };
  return { length, at, x: x0, y: y0, w: ww, h: hh };
}
