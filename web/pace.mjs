// How fast story minutes pass on the screen (spec/opus-5.5-version.md#time).
// "the key thing about this game is controlling time": it goes faster and
// slower in a way that makes the game more understandable (Roy, Oct 12, 267).
// The clock keeps one beat, `tick.perSecond`. What changes is how many story
// minutes a tick is. These are general rules checked in test/pace.test.mjs,
// never activity-specific. Every story minute still happens, in order: needs
// grow and cards expire as fast as time goes.
//
//   1. Time stops for the intro, an event, the pause and the menu.
//   2. A new description knocks time down to `tick.reading`, the first step,
//      for one tick, and then it climbs (Roy, Oct 14, 364: "messages trigger
//      no hold"). Counted in story minutes, never real seconds (Oct 13, 315).
//      It isn't a choice appearing, so it starts no hold of its own (rule 4).
//   3. When a choice appears, time slows at once to `tick.decisions` minutes
//      a tick, by how many cards can now be taken (Roy, Oct 12, 267; Oct 14,
//      362: "if a 4th card appears, reset to 2"). A choice appears when a
//      card that couldn't be taken can: new, or free again after a task.
//   4. A choice that stays static is held for `tick.settle` ticks (5; Roy,
//      Oct 14, 362: "after any choice remains static for 5 ticks begin
//      incrementing"), then time climbs. While it's held, time below its
//      size climbs to it and pauses there (364: "it should immediately start
//      climbing and pause at the level of the tick hold"). Afterwards it
//      climbs no further than `tick.most` for that many cards (365: 4 cards
//      5, 3 cards 10, 2 cards 15); with none, it climbs to the top.
//   5. Every activity stays on the screen at least `minActivitySeconds`.
//   6. An activity ends when its story minutes do: nothing stretches it or
//      hurries it by the second (Roy, Oct 13, 315). The description at its
//      end comes `tell.closing` story minutes before that, which is the
//      engine's doing; read at `tick.reading`, they're about as many seconds.
//   7. The clock shows whole ticks and never steps back.
//   8. Time speeds up slowly and slows down at once (Roy, Oct 12, 292). A
//      tick climbs the steps of `tick.ladder` one at a time (Roy, Oct 14,
//      360: 2, 3, 5, 8, 12, 18, 30, "this can apply to everything"), and it
//      goes up a step only when a whole tick has gone by. It gets smaller at
//      once. Time that stopped starts again from the smallest tick. Without
//      a ladder it's never more than `tick.grow` times the tick before it.
//   9. 30, the last step, is the fastest anything goes (Roy, Oct 14): no
//      size is above it, and the quiet part of a held activity is held to
//      it too (`fastest`, web/busy-pace.mjs).
//
// P is tuning.pace. `sit` is the situation:
//   { stopped, reading, idle, resting, choosable, choices, remaining, elapsed }
// reading: story minutes the newest description is still read for
// (`readingLeft`). idle: free to choose (idle or watching TV). resting: idle
// itself, which has no end to see. choosable: how many cards can be taken.
// choices: the keys of those cards, so a new one can be told from one that
// was there. remaining: story minutes left of the current activity. elapsed:
// real seconds since it began.
export const decisions = sit => (sit.idle ? sit.choosable : 0);

// No faster than lets `remaining` story minutes last the `owed` real seconds.
const atLeast = (rate, remaining, owed) => (owed > 0 ? Math.min(rate, Math.max(remaining, 0) / owed) : rate);

// The size of tick the rules want: while a description is read, the reading
// one; with cards that can be taken, the most `tick.most` allows for that
// many (Roy, Oct 14, 365: "with 4 cards it won't go beyond 5, with 3 cards it
// won't go beyond 10, with 2 cards it won't go beyond 15"); otherwise as fast
// as the steps go. `createTick` takes it a step at a time and `choicesOf`
// slows it when a choice appears. Nothing is faster than the last step (Roy,
// Oct 14: "30 is the fastest").
export function tickMinutes(P, sit) {
  const T = P.tick, top = T.ladder?.at(-1) ?? Infinity;
  if (sit.reading > 0) return Math.min(T.reading, top);
  const n = decisions(sit), most = T.most?.[Math.min(n, Object.keys(T.most).length)];
  const fastest = Number.isFinite(top) ? top : Math.max(...Object.values(T.decisions));
  return n > 0 && most != null ? Math.min(most, fastest) : fastest;
}

// The choices there are, and the size of tick a new one slows time to: by how
// many there are now. Without keys the choices are not known, and nothing
// has appeared.
export function choicesOf(P, sit) {
  const n = decisions(sit);
  if (!Array.isArray(sit.choices)) return null;
  return { keys: n > 0 ? sit.choices : [], size: n > 0 ? P.tick.decisions[Math.min(n, Object.keys(P.tick.decisions).length)] : null };
}

// A pace to try, for the pace study only (web/studies/pace-ramp.html; Roy,
// Oct 14): `over` replaces some of the numbers above. Anything it names is
// kept within limits and in whole minutes; anything it leaves out stays.
//   { grow, ladder: [...], hold, settle, reading, decisions: {1..4}, most: {1..4} }
// `ladder` is the sizes the clock climbs through, each for `hold` ticks (null
// takes it away); `grow` is how it climbs without one; `settle` is how many
// ticks a new choice is held for before it does.
export function tuned(P, over) {
  if (!over || typeof over !== 'object') return P;
  const T = P.tick;
  const num = (v, lo, hi, d) => (v != null && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const whole = (v, d) => Math.round(num(v, 1, 240, d));
  const sizes = (list, d) => (Array.isArray(list) && list.length ? list.slice(0, 24).map(m => whole(m, d)) : null);
  const decisions = Object.fromEntries(Object.entries(T.decisions).map(([n, d]) => [n, whole(over.decisions?.[n], d)]));
  const most = T.most && Object.fromEntries(Object.entries(T.most).map(([n, d]) => [n, whole(over.most?.[n], d)]));
  // `ladder: null` takes the steps away; leaving it out keeps them.
  const named = sizes(over.ladder, 1);
  const { ladder: was, ...rest } = T;
  const ladder = over.ladder === null ? null : named ? [...new Set(named)].sort((a, b) => a - b) : was;
  return {
    ...P,
    tick: {
      ...rest,
      grow: num(over.grow, 1, 4, T.grow),
      reading: whole(over.reading, T.reading),
      hold: Math.round(num(over.hold, 1, 24, T.hold ?? 1)),
      settle: Math.round(num(over.settle, 0, 60, T.settle ?? 0)),
      decisions,
      ...(most ? { most } : {}),
      ...(ladder ? { ladder } : {}),
    },
  };
}

// The most story minutes that ever go by in a second (Roy, Oct 14: "30 is the
// fastest"): the last step of the ladder. The quiet part of a held activity
// is held to it too (web/busy-pace.mjs).
export const fastest = P => (P.tick.ladder?.at(-1) ?? Math.max(...Object.values(P.tick.decisions))) * P.tick.perSecond;

// The next size up from a tick of `size` minutes: the next rung of
// `tick.ladder`, when there is one (Roy, Oct 14: "2 min speed, 3, 4, 6, 8,
// 10"); otherwise `tick.grow` times it, in whole minutes.
export const grown = (P, size) => P.tick.ladder?.find(rung => rung > size)
  ?? Math.max(size + 1, Math.ceil(size * P.tick.grow - 1e-9));

// The size of the tick the clock plays, from the size the rules above want
// (`tickMinutes`). It gets smaller at once. It gets larger only when a whole
// tick has gone by, and then by one step. `minute` is story time, with the
// part of a minute that has gone by; ask at least every story minute. The
// clock starts from the smallest tick, the reading one, and `stop()` says
// time stopped: starting again is a speed-up too.
//
// `choices` (`choicesOf`) says which cards can be taken. A key it hasn't seen
// is a choice that has appeared: time slows to the size given, and for
// `tick.settle` whole ticks it climbs no higher than that size (Roy, Oct 14,
// 362 and 364). A description, which only knocks time down for a tick,
// doesn't start that hold: the ticks after it, and the tick it cuts short,
// count towards it, and it climbs back to the hold's size and pauses there.
export function createTick(P, size = P.tick.reading) {
  // `played`: whole ticks at the size it has. It grows after `tick.hold` of
  // them (one, unless the pace study says more). `since`: whole ticks since a
  // choice appeared. `known`: the choices there were.
  // `cap`: the size a choice that appeared holds time to, while it's held.
  let from = null, played = 0, since = Infinity, cap = Infinity, known = null;
  const hold = P.tick.hold ?? 1, settle = P.tick.settle ?? 0, top = P.tick.ladder?.at(-1) ?? Infinity;
  const tick = (minute, wanted, choices = null) => {
    if (choices) {
      const fresh = choices.keys.some(key => !known?.has(key));
      known = new Set(choices.keys);
      if (fresh && choices.size != null) {
        cap = Math.min(choices.size, top);
        size = Math.min(size, cap); from = minute; played = 0; since = 0;
        return size;
      }
    }
    if (from == null) { size = Math.min(size, wanted); from = minute; played = 0; return size; }
    const whole = Math.floor((minute - from) / size + 1e-9);
    // `from` is where the tick being played began. Less than a minute ago is
    // its beginning; any later, it's played out at the size it has.
    if (whole > 0) { from += whole * size; played += whole; since += whole; }
    if (wanted < size) {
      // It gets smaller at once. The tick it cuts short counts as held, so a
      // message read in the third tick of five leaves two (Roy, Oct 14, 363).
      if (minute - from > 1e-9) since += 1;
      size = wanted; from = minute; played = 0;
      return size;
    }
    const limit = Math.min(wanted, top, since < settle ? cap : Infinity);
    if (whole > 0 && limit > size && played >= hold && minute - from < 1) {
      size = Math.min(limit, grown(P, size));
      played = 0;
    }
    return size;
  };
  tick.stop = () => { size = Math.min(size, P.tick.reading); from = null; played = 0; };
  return tick;
}

// How fast the clock plays a tick of `size` story minutes, against its beat
// (Roy, Oct 21, 408): "slow the game down by 50% during shorter ticks and 0%
// during the longest ticks". Half as fast at the first step of the ladder,
// as fast as the beat at the last; in between by how far up the steps the
// size is, each step taking away about as much of the slowing (provisional).
// `accelerated` (409, the word "accelerate" left of pause): 3 times that at
// the first step and 2 at the last, the same way in between (provisional,
// "300%" read as 3 times). It's the one thing faster than the last step.
// The tick's rules above are in story minutes and stay as they are; this
// only says how many real seconds they take. `P.speed` is the tuning.
export function speed(P, size, accelerated = false) {
  const S = P.speed;
  if (!S) return 1;
  const low = P.tick.ladder?.[0] ?? P.tick.reading;
  const high = P.tick.ladder?.at(-1) ?? Math.max(...Object.values(P.tick.decisions));
  const u = high > low && size > low ? Math.min(1, Math.log(size / low) / Math.log(high / low)) : size > low ? 1 : 0;
  const along = ([first, last]) => first + (last - first) * u;
  return along(S.normal) * (accelerated && S.accelerated ? along(S.accelerated) : 1);
}

// `tick` is the size the clock is playing (createTick); `times` is how much
// faster or slower than the beat it's played (`speed`). Every activity still
// stays on the screen at least `minActivitySeconds`.
export function targetPace(P, sit, tick = tickMinutes(P, sit), times = 1) {
  if (sit.stopped) return 0;
  let rate = tick * P.tick.perSecond * times;
  if (!sit.idle) rate = atLeast(rate, sit.remaining, P.minActivitySeconds - sit.elapsed);
  return rate;
}

// Story minutes the newest description still holds time down for: one tick of
// `tick.reading` from the story minute it was given, however long it is (Roy,
// Oct 14, 364: "messages trigger no hold"). `c` is the engine's clock (view),
// so it's a matter of game time alone. `minute` is story time now, with the
// part of a minute that has gone by.
export const readingLeft = (P, c, minute) => (c.toldAt == null || !c.lastText.trim() ? 0 : Math.max(0, c.toldAt + P.tick.reading - minute));

// The minute the clock shows: whole ticks, counted from the minute the tick
// became the size it is, so every tick is that long. It never steps back.
export function createClockFace() {
  let from = null, size = null, shown = -Infinity;
  return (minute, tick) => {
    if (tick !== size) { size = tick; from = minute; }
    return (shown = Math.max(shown, from + Math.floor((minute - from) / size) * size));
  };
}
