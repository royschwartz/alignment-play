// A fresh, unsaved comparison life reaches the chosen activity through the
// same inputs as play. This module is never needed by the ordinary game.
import { skipIntro, take, tick, readNext } from '../engine/sim.mjs';

const SCENARIOS = new Set(['cook', 'dishes', 'groceries']);

function clearPages(s, C) {
  for (let page = 0; s.event && page < 100; page++) {
    if (s.event.mode !== 'pages' || !readNext(s, C)) throw new Error('The pace preview reached an answer it cannot choose.');
  }
  if (s.event) throw new Error('The pace preview did not finish its intertitle.');
}

// A card comes a while after the last choice (Roy, Oct 18, 400), so the
// life goes on until it's offered, as a player would wait for it.
function start(s, C, id) {
  for (let minute = 0; !s.cards.some(c => c.id === id) && minute < 4096; minute++) {
    clearPages(s, C);
    if (!tick(s, C)) throw new Error(`The pace preview stopped waiting for ${id}.`);
  }
  if (!take(s, C, id)) throw new Error(`The pace preview could not start ${id}.`);
  clearPages(s, C);
  return s.now.run;
}

function complete(s, C, id) {
  const run = start(s, C, id);
  for (let minute = 0; s.now.run === run && minute < 4096; minute++) {
    clearPages(s, C);
    if (!tick(s, C)) throw new Error(`The pace preview stopped during ${id}.`);
  }
  if (s.now.run === run) throw new Error(`The pace preview did not finish ${id}.`);
  clearPages(s, C);
}

export function preparePacePreview(s, C, scenario) {
  if (!SCENARIOS.has(scenario)) throw new Error(`Unknown pace preview: ${scenario}`);
  if (s.phase === 'intro') skipIntro(s, C);
  if (s.phase !== 'life') throw new Error('The pace preview needs a new life.');
  if (scenario === 'cook') {
    complete(s, C, 'groceries');
    complete(s, C, 'dishes');
  }
  start(s, C, scenario);
  return { run: s.now.run, minute: s.minute };
}
