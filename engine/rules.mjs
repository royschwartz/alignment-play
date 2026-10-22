// The one condition language shared by activities, cards, events, moods and
// descriptions. Content says *when*; this file says what that means.
import { inHours } from './calendar.mjs';
import { keyed } from './random.mjs';

export const CONDITION_KEYS = [
  'any', 'hours', 'days', 'facts', 'notFacts', 'revealed', 'hidden', 'stat', 'stock', 'stockAtMost', 'place', 'doing', 'notDoing',
  'idle', 'awake', 'asleep', 'sleep', 'house', 'open', 'personAt', 'dayOff', 'shiftWithin', 'count', 'countBelow', 'formed',
  'netRateAbove', 'netRateBelow', 'night', 'mood',
];

export const act = (s, C) => C.activities[s.now.id];

// An activity can leave room for choices without becoming indefinite idle.
export function canChoose(s, C) {
  const a = act(s, C);
  return !a.away && (a.idle || a.interruptible);
}

// Rapture per story hour right now: what you're doing, less the drains.
export function netRate(s, C) {
  const a = act(s, C), t = C.tuning;
  if (a.still) return 0;
  return a.rate - s.meters.disquiet * t.drain.disquietPerHour - s.meters.hunger * t.drain.hungerPerHour;
}

export const isDirty = (s, C) => s.meters.mess >= C.tuning.dirtyAt;

// A place with hours is open only within them; one without is always open.
export function isOpen(C, place, minute) {
  const open = C.places[place]?.open;
  return !open || inHours(C.cal.minuteOfDay(minute), open);
}

// Whether PERSON is at a place: on their days, between their hours, each end
// a little earlier or later that day, and never while the place is closed.
// The same answer for a given minute however often it's asked.
export function personAt(s, C, place, minute = s.minute) {
  const p = C.places[place]?.person;
  if (!p || !isOpen(C, place, minute) || !p.days.includes(C.cal.weekday(minute))) return false;
  const day = C.cal.dayIndex(minute), vary = p.vary || 0;
  const shift = end => Math.round((keyed(s, `PERSON:${place}:${day}:${end}`) * 2 - 1) * vary);
  const m = C.cal.minuteOfDay(minute);
  return m >= p.hours[0] * 60 + shift('from') && m < p.hours[1] * 60 + shift('to');
}

export const nextCommitment = (s, minute = s.minute) => s.commitments.find(c => c.end > minute) || null;

// The mood you're really in (Roy, Oct 18, 393: "the true mood you are
// feeling, which is rpresented internally"): the first mood whose `when`
// fits what's inside. It's worked out here, never on the screen, and it's
// what governs the choices (392). What the player reads may differ (sim's
// `s.mood.shown`). Null when none fits, or during the reset.
export function trueMood(s, C) {
  if (act(s, C).still) return null;
  return C.moods.find(m => test(s, C, m.when)) || null;
}

// Which night it is: the one you're in, or the one coming while you're up.
// Counted by sleeps you've finished (Roy, Oct 15: "the first night", "the
// second night").
export const nightNumber = s => (s.counts.sleep || 0) + 1;

// Sleep is light as it begins and before waking, and deep in between.
export function sleepPhase(s, C, minute = s.minute) {
  const t = C.tuning.sleep;
  return minute - s.now.started < t.lightStartMinutes || s.now.ends - minute <= t.lightEndMinutes ? 'light' : 'deep';
}

export function test(s, C, cond, minute = s.minute) {
  if (!cond) return true;
  const a = act(s, C);
  if (cond.any && !cond.any.some(c => test(s, C, c, minute))) return false;
  if (cond.hours && !inHours(C.cal.minuteOfDay(minute), cond.hours)) return false;
  if (cond.days && !cond.days.includes(C.cal.weekday(minute))) return false;
  if (cond.facts && !cond.facts.every(f => s.facts[f] != null)) return false;
  if (cond.notFacts && cond.notFacts.some(f => s.facts[f] != null)) return false;
  if (cond.revealed && !cond.revealed.every(k => s.revealed[k] != null)) return false;
  if (cond.hidden && !cond.hidden.every(k => s.revealed[k] == null)) return false;
  if (cond.stat) {
    for (const [key, [lo, hi]] of Object.entries(cond.stat)) {
      const v = s.meters[key] ?? 0;
      if ((lo != null && v < lo) || (hi != null && v > hi)) return false;
    }
  }
  if (cond.stock) for (const [k, n] of Object.entries(cond.stock)) if ((s.stocks[k] ?? 0) < n) return false;
  if (cond.stockAtMost) for (const [k, n] of Object.entries(cond.stockAtMost)) if ((s.stocks[k] ?? 0) > n) return false;
  if (cond.place && s.place !== cond.place) return false;
  if (cond.doing && !cond.doing.includes(s.now.id)) return false;
  if (cond.notDoing && cond.notDoing.includes(s.now.id)) return false;
  if (cond.idle != null && !!a.idle !== cond.idle) return false;
  if (cond.awake != null && !a.inBed !== cond.awake) return false;
  if (cond.asleep != null && !!a.asleep !== cond.asleep) return false;
  if (cond.sleep && !(a.asleep && sleepPhase(s, C, minute) === cond.sleep)) return false;
  if (cond.house && (cond.house === 'dirty') !== isDirty(s, C)) return false;
  if (cond.open && !isOpen(C, cond.open, minute)) return false;
  if (cond.personAt && !personAt(s, C, cond.personAt, minute)) return false;
  if (cond.dayOff != null) {
    const day = C.cal.dayIndex(minute);
    if (s.commitments.some(c => C.cal.dayIndex(c.start) === day) === cond.dayOff) return false;
  }
  if (cond.shiftWithin != null) {
    const c = nextCommitment(s, minute);
    if (!c || c.start - minute > cond.shiftWithin) return false;
  }
  if (cond.night != null) {
    const n = nightNumber(s), [lo, hi] = Array.isArray(cond.night) ? cond.night : [cond.night, cond.night];
    if ((lo != null && n < lo) || (hi != null && n > hi)) return false;
  }
  if (cond.mood && !cond.mood.includes(trueMood(s, C)?.key)) return false;
  if (cond.count) for (const [k, n] of Object.entries(cond.count)) if ((s.counts[k] || 0) < n) return false;
  if (cond.countBelow) for (const [k, n] of Object.entries(cond.countBelow)) if ((s.counts[k] || 0) >= n) return false;
  if (cond.formed && !cond.formed.every(id => s.formed[id] != null)) return false;
  if (cond.netRateAbove != null && !(netRate(s, C) > cond.netRateAbove)) return false;
  if (cond.netRateBelow != null && !(netRate(s, C) < cond.netRateBelow)) return false;
  return true;
}
