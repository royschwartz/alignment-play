// Letter formation is an explicit special case. All unmarked cards have
// complete text immediately. A future slow entrance uses story time and
// a fixed duration; this hash never consumes a simulation random stream.
import { hash32 } from '../../engine/random.mjs';

export const FORMATION_DEFAULTS = Object.freeze({
  minMinutes: 0, maxMinutes: 0,
  slow: Object.freeze({ minMinutes: 12, maxMinutes: 20 }),
});

export function formationDuration(seed, key, rule = FORMATION_DEFAULTS, formation = 'immediate') {
  if (formation !== 'slow') return 0;
  const defaults = FORMATION_DEFAULTS.slow;
  const timing = rule.slow ?? defaults;
  const min = Math.max(1, Math.ceil(timing.minMinutes ?? defaults.minMinutes));
  const max = Math.max(min, Math.floor(timing.maxMinutes ?? defaults.maxMinutes));
  const sample = hash32(`${seed}:card-formation:${key}`) / 4294967296;
  return min + Math.floor(sample * (max - min + 1));
}

export function formationProgress({ seed, key, minutes = 0, carry = 0, active = true, rule = FORMATION_DEFAULTS, formation = 'immediate' }) {
  const duration = formationDuration(seed, key, rule, formation);
  if (duration === 0) return 1;
  // carry is the fraction of the next story minute already elapsed. A
  // stopped/locked clock must not borrow it from the activity now running.
  const fraction = active ? Math.min(1, Math.max(0, Number.isFinite(carry) ? carry : 0)) : 0;
  const elapsed = Math.max(0, Number.isFinite(minutes) ? minutes : 0) + fraction;
  return Math.min(1, elapsed / duration);
}
