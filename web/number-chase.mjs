// Roy, Oct 19 (402): the numbers at the top are always heading for the true
// number, which the player never sees, in real seconds rather than story
// minutes, so they never jump or race. A number moves at most `share` of
// what you have each second (5%: at 20 rapture, at most 1 a second), and
// slows as it comes near (`ease`). The simulation keeps the true number and
// decides everything by it; this only decides what the wheels show.
// Pure: no timers, no simulation reads or writes, no randomness.
export const CHASE = Object.freeze({ share: 0.05, ease: 1, least: 1 });
// Small fixed steps, so the same real time moves a number the same way at
// 15 frames a second or 60.
const STEP = 1 / 60, CLOSE = 1e-6;

export function chase(shown, target, seconds, tuning = CHASE) {
  const { share, ease, least } = { ...CHASE, ...tuning };
  let at = shown;
  for (let left = Math.max(0, seconds); left > 1e-12 && Math.abs(target - at) >= CLOSE;) {
    const h = Math.min(STEP, left), gap = target - at;
    left -= h;
    // What you have is the larger of the two: a loss is a share of what you
    // had, a gain a share of what you'll have, and nothing stalls at zero.
    const most = share * Math.max(Math.abs(at), Math.abs(target), least) * h;
    const near = Math.abs(gap) * (ease > 0 ? 1 - Math.exp(-h / ease) : 1);
    at += Math.sign(gap) * Math.min(most, near);
  }
  return Math.abs(target - at) < CLOSE ? target : at;
}

// The shown numbers, by attribute. A number appears at its true value the
// first time it's shown (when revealed, or when the page opens) and chases
// it from then on. Nothing here is saved: a reload shows the true numbers.
export function createChase(tuning = CHASE) {
  const shown = new Map();
  return {
    follow(key, target, seconds = 0) {
      if (target == null) { shown.delete(key); return null; }
      const next = shown.has(key) ? chase(shown.get(key), target, seconds, tuning) : target;
      shown.set(key, next);
      return next;
    },
    snapshot: () => Object.fromEntries(shown),
  };
}
