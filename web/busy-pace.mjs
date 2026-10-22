// Experimental presentation pacing for quiet busy passages. The app opts in
// and still applies its reading/activity-duration limits before advancing
// story minutes normally. This module never changes the simulation or clock.
//
// Capture the work left once, choose a finite passage budget, and ramp to a
// fixed rate whose area covers it. Recomputing remaining/budget every frame
// would make the last minutes approach completion without ever reaching it.
// All constants here are provisional tuning for the comparison.
export function createBusyPace({ seconds = 3, rampSeconds = 0.65, maxRate = 60 } = {}) {
  for (const [name, value] of Object.entries({ seconds, rampSeconds, maxRate })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite.`);
  }
  let passage = null;

  const begin = ({ run, remaining, rate }) => {
    const budget = Math.min(seconds, 0.7 + remaining / 20);
    const ramp = Math.min(rampSeconds, Math.max(0.2, remaining / 15), budget);
    const initialRate = Math.max(0, Number.isFinite(rate) ? rate : 0);
    const wanted = (remaining - initialRate * ramp / 2) / (budget - ramp / 2);
    // The cap limits acceleration. An already faster entry rate is retained,
    // since a quiet passage must not slow itself down partway through a task.
    const plateauRate = Math.max(initialRate, Math.min(maxRate, wanted));
    return { run, initialRemaining: remaining, elapsed: 0, budget, ramp, initialRate, plateauRate };
  };

  const instantRate = (p, elapsed) => {
    const u = Math.min(1, elapsed / p.ramp);
    return p.initialRate + (p.plateauRate - p.initialRate) * u * u * (3 - 2 * u);
  };

  // Exact integral of the smoothstep ramp, followed by the captured plateau.
  // Returning a frame's average rate keeps rate * dt independent of frame rate.
  const area = (p, elapsed) => {
    const u = Math.min(1, elapsed / p.ramp);
    const rampArea = p.ramp * (u ** 3 - u ** 4 / 2);
    return p.initialRate * elapsed
      + (p.plateauRate - p.initialRate) * (rampArea + Math.max(0, elapsed - p.ramp));
  };

  return {
    update({ run, remaining, idle = false, reading = 0, stopped = false, rate = 0 }, dt = 0) {
      if (idle || reading > 0 || stopped || !Number.isFinite(remaining) || remaining <= 0) {
        passage = null;
        return null;
      }
      if (!passage || !Object.is(passage.run, run)) passage = begin({ run, remaining, rate });
      if (!Number.isFinite(dt) || dt <= 0) return instantRate(passage, passage.elapsed);
      const from = passage.elapsed;
      passage.elapsed += dt;
      const average = (area(passage, passage.elapsed) - area(passage, from)) / dt;
      return Math.max(passage.initialRate, Math.min(passage.plateauRate, average));
    },
    snapshot() {
      return passage ? { ...passage, rate: instantRate(passage, passage.elapsed) } : null;
    },
  };
}

// A presentation-only clock for the variable-rate experiment. The simulation
// still advances every minute; this samples its current whole minute on a
// real-time beat. Boundary flushes keep that beat's phase, pauses freeze it,
// and neither can make a displayed minute go backward.
export function createBeatClock({ perSecond = 1 } = {}) {
  if (!Number.isFinite(perSecond) || perSecond <= 0) throw new RangeError('perSecond must be positive and finite.');
  const interval = 1 / perSecond;
  let elapsed = 0, shown = null;
  return ({ minute, dt = 0, stopped = false, force = false }) => {
    if (!Number.isFinite(minute)) throw new RangeError('minute must be finite.');
    const current = Math.floor(minute);
    if (shown === null) shown = current;
    if (!stopped && Number.isFinite(dt) && dt > 0) {
      elapsed += dt;
      const beats = Math.floor((elapsed + interval * 1e-9) / interval);
      if (beats > 0) {
        elapsed = Math.max(0, elapsed - beats * interval);
        shown = Math.max(shown, current);
      }
    }
    if (force) shown = Math.max(shown, current);
    return shown;
  };
}
