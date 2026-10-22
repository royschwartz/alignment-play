// A selected pain card's loose blades finish with that card's rapture flow.
// Read the engine's existing transaction; never predict a real-time duration
// from the current pace or combine it with other changes to rapture.
const clamp = value => Math.max(0, Math.min(1, value));

export function selectedPainDrain(before, after, id) {
  return after.find(flow => !before.has(flow) && flow.cause === `card:${id}`
    && flow.key === 'rapture' && flow.per < 0 && flow.into === 'choice') ?? null;
}

export function createPainExitClock(flow, { fraction = () => 0, fall = .4, linger = 0 } = {}) {
  const remaining = () => flow ? Math.max(0, -flow.left + flow.per * clamp(fraction())) : 0;
  const total = remaining();
  const entryAt = Math.max(0, fall + linger);
  let elapsed = 0, progress = 0, entryProgress = entryAt === 0 ? 0 : null;
  let spinTime = 0, sinkProgress = 0, done = total <= 0;
  const snapshot = () => ({ spinTime, sinkProgress: done ? 1 : sinkProgress, done });

  return {
    snapshot,
    update(dt) {
      if (done) return snapshot();
      const seconds = Math.max(0, dt), previous = progress, was = elapsed;
      elapsed += seconds;
      // The same fractional story minute drives the number wheels. Never
      // retreat when the clock's fractional carry resets at an input.
      progress = Math.max(previous, clamp(1 - remaining() / total));
      const approach = Math.max(0, Math.min(seconds, entryAt - was));
      spinTime += approach;
      if (elapsed >= entryAt) {
        if (entryProgress === null) {
          entryProgress = seconds > 0 ? previous + (progress-previous)*approach/seconds : progress;
        }
        const phase = value => entryProgress < 1 ? clamp((value-entryProgress)/(1-entryProgress)) : 1;
        const start = phase(previous), end = phase(progress);
        // Integrate speed across this displayed interval. In a steady drain
        // this is the exact linear slowdown, even at a choppy cadence.
        spinTime += (seconds-approach) * (1 - (start+end)/2);
        sinkProgress = end;
      }
      done = progress >= 1;
      return snapshot();
    },
  };
}
