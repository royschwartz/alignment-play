// A fresh, unsaved life brought up to the lead-up of one of the game's events,
// for the branching-events study (studies/branching-events.html; Roy, Oct 18:
// "can i see the interaction with Dee and the inetractions with the dweller
// the first time I go back", "give me the set up too", "events offer branching
// paths"). It gets there through the player's own inputs (read, answer, take),
// as the stand-in does, so what's on the screen is what that life would show.
// This module is never needed by the ordinary game.
import { tick, skipIntro, readNext, answer, take, meets, lockOf, openAnswers } from '../engine/sim.mjs';
import { canChoose } from '../engine/rules.mjs';

// Each scene's starting points, earliest first. `find` watches one life and
// returns the story minute to stop at, once it knows it.
export const SCENES = {
  dee: {
    morning: 'the morning of the first shift, as you wake',
    shift: 'a minute before the shift starts',
    rant: 'ten story minutes before DEE starts',
  },
  hole: {
    night: 'the second night, as you go to bed',
    morning: 'the morning after the dream, as you wake',
  },
};

// The attentive stand-in's way of playing (game-opus/tools/autoplay.mjs,
// policy `play`, copied deliberately so the study needs nothing outside web/
// and engine/). The trip to the hole is never taken: that's the player's.
function wants(s, C) {
  if (!canChoose(s, C)) return null;
  for (const card of s.cards) {
    if (card.id === 'go-hole' || card.neglectedAt != null || s.neglectedNeeds?.[card.id]) continue;
    const def = C.choices[card.id];
    if (lockOf(s, C, def)) continue;
    if (def.purpose === 'need' && s.minute - card.since < 150
      && (card.needMinutes ?? 0) < C.tuning.cards.neglect.minutes - 10) continue;
    if (s.minute - card.since < 3) continue;
    if (def.purpose === 'impulse' && C.activities[s.now.id].interruptible && !s.now.over && s.now.by === 'you') continue;
    return card.id;
  }
  return null;
}

function answerEvent(s, C) {
  const id = s.event.id;
  const open = openAnswers(s, C).filter(a => meets(s, a));
  const wanted = id === 'signup' ? '3'
    : id === 'hole' ? (open.find(a => a.id === 'look') || open.find(a => a.id === 'say') || open.find(a => a.id === 'feed'))?.id
    : open[open.length - 1]?.id;
  return answer(s, C, wanted ?? open[0].id);
}

// Lives `s` until `stop(s)` says so, at the top of a story minute with
// nothing covering the screen. Returns false if it never does.
function live(s, C, stop, onEvent = () => {}) {
  const until = s.minute + 14 * 1440;
  let seen = null;
  for (let guard = 0; s.minute < until && guard < 14 * 1440 * 4; guard++) {
    if (s.event) {
      if (s.event.key !== seen) { seen = s.event.key; onEvent(s); }
      if (s.event.mode === 'pages') readNext(s, C); else answerEvent(s, C);
      continue;
    }
    if (stop(s)) return true;
    const id = wants(s, C);
    if (id) take(s, C, id);
    if (stop(s)) return true;
    if (!s.event) tick(s, C);
  }
  return false;
}

// The story minute each starting point stands at, read from one life.
function landmarks(s, C, scene) {
  const marks = {};
  let last = s.now.id, lastBed = null, lastWake = null, done = false;
  const watch = s => {
    if (s.now.id !== last) {
      last = s.now.id;
      if (last === 'wake') lastWake = s.minute;
      // Going to bed: the first minute of trying to sleep or of sleep.
      if (last === 'sleep' || last === 'try-sleep') lastBed ??= s.minute;
      else lastBed = null;
      if (scene === 'dee' && last === 'shift' && marks.shift == null) marks.shift = s.minute - 1;
      if (scene === 'hole' && last === 'wake' && marks.night != null && marks.morning == null) {
        marks.morning = s.minute;
        done = true;
      }
    }
    return done;
  };
  live(s, C, watch, s => {
    if (scene === 'dee' && s.event.id === 'dee-hyton') {
      marks.morning = lastWake;
      marks.rant = s.minute - 10;
      done = true;
    }
    if (scene === 'hole' && s.event.id === 'night-two') marks.night = lastBed;
  });
  return marks;
}

export function prepareScene(s, C, scene, at) {
  const points = SCENES[scene];
  if (!points) throw new Error(`Unknown scene: ${scene}`);
  if (!(at in points)) at = Object.keys(points)[0];
  if (s.phase === 'intro') skipIntro(s, C);
  if (s.phase !== 'life') throw new Error('The scene preview needs a new life.');
  const start = structuredClone(s);
  const minute = landmarks(s, C, scene)[at];
  if (minute == null) throw new Error(`This life never reached ${scene} (${at}).`);
  // The same life again, from the start, to just that minute: the same
  // inputs on the same seed give the same life.
  const ready = start;
  if (!live(ready, C, s => s.minute >= minute)) throw new Error(`This life never reached ${scene} (${at}).`);
  return { s: ready, scene, at };
}
