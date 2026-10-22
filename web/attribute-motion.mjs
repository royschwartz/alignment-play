// The true number at this instant, between whole numbers: the engine's
// minute and a preview of the next, never an animation of an old
// transaction. It's hidden; the wheels show a number heading for it in real
// seconds (Roy, Oct 19, 402; web/number-chase.mjs). Money remains an
// immediate transaction, so its true number jumps.
export function readingAt(key, before, after, fraction) {
  if (key === 'money') return before[key];
  return before[key] + (after[key] - before[key]) * Math.max(0, Math.min(1, fraction));
}
