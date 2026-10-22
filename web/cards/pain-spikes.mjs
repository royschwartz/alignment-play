// Roy, Oct 12: continuous raised pain lines cross the face diagonally,
// with an open space for the lettering. Face-local measurements keep that
// opening aligned with the words while the ridge crests rise above them.
const BASE = 1.8;
const HEIGHT = 3;
const CLEARANCE = 5;

function crossing(start, delta, box) {
  let enter = 0, exit = 1;
  for (const [origin, direction, low, high] of [
    [start.x, delta.x, box.left, box.right],
    [start.y, delta.y, box.top, box.bottom],
  ]) {
    if (Math.abs(direction) < 1e-9) {
      if (origin < low || origin > high) return null;
      continue;
    }
    const a = (low - origin) / direction, b = (high - origin) / direction;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter >= exit) return null;
  }
  return [enter, exit];
}

export function ridgeSegments(width, height, lettering = []) {
  if (width <= BASE * 2 || height <= BASE * 2) return [];
  const inset = BASE / 2 + 1;
  const result = [];
  for (let diagonal = 0; diagonal < 2; diagonal++) {
    const start = { x: inset, y: diagonal ? height - inset : inset };
    const delta = { x: width - inset * 2, y: (height - inset * 2) * (diagonal ? -1 : 1) };
    let intervals = [[0, 1]];
    for (const box of lettering) {
      // The clearance includes the base and the 3px oblique crest offset.
      const blocked = crossing(start, delta, {
        left: box.left - CLEARANCE, top: box.top - CLEARANCE,
        right: box.right + CLEARANCE, bottom: box.bottom + CLEARANCE,
      });
      if (!blocked) continue;
      intervals = intervals.flatMap(([a, b]) => {
        if (blocked[1] <= a || blocked[0] >= b) return [[a, b]];
        return [[a, Math.min(b, blocked[0])], [Math.max(a, blocked[1]), b]].filter(([p, q]) => q > p);
      });
    }
    for (const [index, [a, b]] of intervals.entries()) {
      const length = (b - a) * Math.hypot(delta.x, delta.y);
      if (length < BASE) continue;
      result.push({ key: `${diagonal}:${index}`, x: start.x + delta.x * a,
        y: start.y + delta.y * a, length, angle: Math.atan2(delta.y, delta.x) * 180 / Math.PI });
    }
  }
  return result;
}

function localBox(element, button) {
  let left = 0, top = 0, node = element;
  while (node && node !== button) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent;
  }
  return { left, top, right: left + element.offsetWidth, bottom: top + element.offsetHeight };
}

export function createPainSpikes(el, button) {
  const layer = document.createElement('span');
  layer.className = 'pain-spikes';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.setProperty('--ridge-base', `${BASE}px`);
  layer.style.setProperty('--ridge-height', `${HEIGHT}px`);
  layer.style.setProperty('--ridge-slant', `${Math.hypot(BASE / 2, HEIGHT)}px`);
  layer.style.setProperty('--ridge-slope', `${-Math.atan2(HEIGHT, BASE / 2) * 180 / Math.PI}deg`);
  el.append(layer);
  const lettering = [...button.querySelectorAll('.label, .money')];
  const ridges = new Map();
  let laidOut = false;

  function layout() {
    const width = button.offsetWidth, height = button.offsetHeight;
    if (!width || !height) return;
    const segments = ridgeSegments(width, height, lettering.map(element => localBox(element, button)));
    const live = new Set(segments.map(segment => segment.key));
    for (const [key, ridge] of ridges) if (!live.has(key)) { ridge.remove(); ridges.delete(key); }
    for (const segment of segments) {
      let ridge = ridges.get(segment.key);
      if (!ridge) {
        ridge = document.createElement('span');
        ridge.className = `pain-ridge${laidOut ? ' pain-ridge-settled' : ''}`;
        for (const side of ['front', 'back', 'start', 'end']) {
          const face = document.createElement('span');
          face.className = `pain-ridge-face pain-ridge-${side}`;
          ridge.append(face);
        }
        layer.append(ridge);
        ridges.set(segment.key, ridge);
      }
      ridge.style.left = `${segment.x}px`;
      ridge.style.top = `${segment.y}px`;
      ridge.style.setProperty('--ridge-length', `${segment.length}px`);
      ridge.style.setProperty('--ridge-angle', `${segment.angle}deg`);
    }
    // Font and viewport changes move the existing ridge without replaying it.
    laidOut = true;
  }

  const observer = new ResizeObserver(layout);
  observer.observe(button);
  for (const element of lettering) observer.observe(element);
  return { layout, destroy() { observer.disconnect(); layer.remove(); } };
}
