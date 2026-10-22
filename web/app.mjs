// The screen. It reads the simulation and sends the player's four inputs
// (read, answer, take, pause); it never changes the game by itself
// (spec principle 3). Real seconds only decide how fast story minutes pass.
import { buildContent, FILES } from '../engine/content.mjs';
import { createGame, upgrade, tick, introNext, skipIntro, readNext, answer, take, inspect, raptureCurrents, scaleOf } from '../engine/sim.mjs';
import { view } from '../engine/view.mjs';
import { allocateCardSlots, placeCard } from './cards/slots.mjs';
import { cardElement } from './cards/face.mjs';
import { selectCard } from './cards/selection.mjs';
import { selectedPainDrain } from './cards/pain-exit-clock.mjs';
import { recedeOpacity, showRecede } from './cards/recede.mjs';
import { createPainScar } from './cards/scar-lifecycle.mjs';
import { createActivityHold } from './cards/activity-hold.mjs';
import { createFormingInk } from './cards/forming-ink.mjs';
import { formationProgress } from './cards/formation.mjs';
import { stainLayer, createNeedStainClock } from './cards/need-stain.mjs';
import { targetPace, tickMinutes, choicesOf, readingLeft, createClockFace, createTick, tuned, fastest, speed } from './pace.mjs';
import { createBusyPace, createBeatClock } from './busy-pace.mjs';
import { preparePacePreview } from './pace-preview.mjs';
import { createStream } from './stream.mjs';
import { createWheelNumber } from './wheel.mjs';
import { readingAt } from './attribute-motion.mjs';
import { createChase } from './number-chase.mjs';
import { createTrickles, createEventWatch, trickleLayout } from './trickles.mjs';
import { createPresentation } from './presentation.mjs';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SAVE_KEY = 'alignment.opus.v1';
// Development fast-forward only; players' pace is fixed.
let devSpeed = Math.max(1, Number(params.get('speed')) || 1);
// The quiet part of a held activity goes by in a few seconds (Roy, Oct 13,
// 304 and 334; web/busy-pace.mjs). Development only: `?busy=0` plays the
// pace as it was before, for the comparison page.
const busyQuiet = params.get('busy') !== '0';
const paceStudy = params.has('preview') && ['cook', 'dishes', 'groceries'].includes(params.get('paceStudy'));
// `follow=1`: the pace study goes on after its activity ends (pace-ramp.html).
const paceFollow = paceStudy && params.get('follow') === '1';
const scarStudy = params.has('preview') && params.get('scarStudy') === '1';
const scarStudyKind = scarStudy && ['seam', 'ridge', 'hollow'].includes(params.get('scarKind')) ? params.get('scarKind') : undefined;
// `trickleStudy=1` (with `preview`): the trickle study tunes this game's
// trickles, fires bursts into them and can show them a disquiet of its own
// (studies/trickle-runs.html). The screen only: nothing in the life changes.
const trickleStudy = params.has('preview') && params.get('trickleStudy') === '1';

const getJSON = url => fetch(url, { cache: 'no-store' }).then(r => {
  if (!r.ok) throw new Error(`could not load ${url}`);
  return r.json();
});
const [manuscript, labels, thoughts, ...parts] = await Promise.all([
  getJSON('manuscript.json'), getJSON('roy/labels.json'), getJSON('roy/thoughts.json'), ...FILES.map(f => getJSON(`content/${f}.json`)),
]);
const C = buildContent(manuscript.document, { labels, thoughts }, Object.fromEntries(FILES.map((f, i) => [f, parts[i]])));
if (C.problems.length) console.info(`Content notes:\n${C.problems.join('\n')}`);
const UI = manuscript.document.ui, T = C.tuning;
// Development only: `?grow=1.25` tries another speed-up (pace rule 8).
// `?paceTune={...}` (with `preview`) tries a whole pace, for the pace study
// (`tuned`, web/pace.mjs).
let paceTune = null;
try { paceTune = params.has('preview') ? JSON.parse(params.get('paceTune')) : null; } catch { /* the pace stays as it is */ }
const P = tuned({ ...T.pace, tick: { ...T.pace.tick, grow: Math.max(1, Number(params.get('grow')) || T.pace.tick.grow) } }, paceTune);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ------------------------------------------------------------------ save

let s = load() || createGame(C, params.get('seed') || String(Date.now()));
if (scarStudy) skipIntro(s, C);
// `scene=dee|hole&at=...` (with `preview`): a fresh life brought up to one of
// the events' lead-ups, for the branching-events study (web/scene-preview.mjs).
if (params.has('preview') && params.get('scene')) s = (await import('./scene-preview.mjs')).prepareScene(s, C, params.get('scene'), params.get('at')).s;
// Cards already there when the page opened show their blades grown.
const openedAt = s.minute;
const studyStart = paceStudy ? preparePacePreview(s, C, params.get('paceStudy')) : null;

function load() {
  if (params.has('new') || params.has('seed') || params.has('preview')) return null;
  try { return upgrade(JSON.parse(localStorage.getItem(SAVE_KEY)), C); } catch { return null; }
}
// Set by "restart", so leaving the page doesn't save the old game again.
let restarting = false;
function save() {
  if (restarting || params.has('preview')) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* the game stays playable */ }
}

// ----------------------------------------------------------------- frame

const frame = $('frame'), phone = $('phone');
phone.classList.toggle('scar-study', scarStudy);
new ResizeObserver(() => phone.style.setProperty('--scale', String(frame.clientWidth / 390))).observe(frame);
new ResizeObserver(() => {
  const status = $('status');
  phone.style.setProperty('--cover-top', `${status.offsetTop + status.offsetHeight}px`);
}).observe($('status'));

// ------------------------------------------------------------------ clock

let paused = !!studyStart || scarStudy, menuOpen = false;
// "accelerate", left of pause (Roy, Oct 21, 409): the clock plays faster
// while it's held down (412: "you have to hold it"; `speed`, web/pace.mjs).
// The screen's alone: it isn't saved.
let accelerating = false;
let studyElapsed = 0, studyDone = false, studySentAt = -Infinity;
// The screen's clock is real time plus whatever `alignment.play` has stepped
// it ahead. A hidden page gets no frames, so checks step it by hand.
let lead = 0, stepping = null;
const nowMs = () => (stepping ?? performance.now()) + lead;
// `pace` is story minutes a real second; `beatPace` is what the beat alone
// would play, before `speed` (web/pace.mjs).
let pace = 0, beatPace = 0, carry = 0, last = nowMs(), lastSave = 0;
// What the pace rules need to know about the screen (web/pace.mjs): how long
// the current activity has been up, and how long there's been nothing to
// decide. How long a description is read for is story time, which the engine
// keeps. `tickNow` is the size of the clock's tick.
let runKey = null, runSeconds = 0, tickNow = P.tick.reading;
const tickSize = createTick(P);
const busyPace = createBusyPace({ maxRate: fastest(P) });
const situation = c => ({
  reading: readingLeft(P, c, s.minute + carry), idle: c.idle, resting: c.resting, choosable: c.choosable, choices: c.choices,
  remaining: c.remaining - carry, elapsed: runSeconds,
});
// The size of the clock's tick at `minute` (pace rule 8).
const tickAt = (minute, sit) => tickSize(minute, tickMinutes(P, sit), choicesOf(P, sit));
let previewKey = '', previewMeters = null;
function nextMeters() {
  const key = `${s.minute}:${s.inputsTotal ?? s.inputs.length}:${s.runs}:${s.phase}:${s.event?.key ?? ''}`;
  if (key !== previewKey) {
    const next = structuredClone(s);
    tick(next, C);
    previewMeters = next.meters;
    previewKey = key;
  }
  return previewMeters;
}

const running = () => s.phase === 'life' && !s.event && !paused && !menuOpen && (stepping != null || !document.hidden);

function onFrame(now) {
  const dt = Math.min(1, (now - last) / 1000);
  last = now;
  // The timed comparison reads its own intertitles: only the pace is judged.
  if (studyStart && !paused) while (s.event?.mode === 'pages' && readNext(s, C));
  if (running()) {
    let c = view(s, C).clock;
    if (c.run !== runKey) { runKey = c.run; runSeconds = 0; }
    runSeconds += dt * devSpeed;
    const sit = situation(c);
    tickNow = tickAt(s.minute + carry, sit);
    const quietRate = busyQuiet ? busyPace.update({ ...sit, run: c.run, rate: beatPace / P.tick.perSecond }, dt * devSpeed * P.tick.perSecond) : null;
    const size = quietRate ?? tickNow;
    beatPace = targetPace(P, sit, size);
    pace = targetPace(P, sit, size, speed(P, size, accelerating));
    if ((studyStart && !studyDone) || scarStudy) studyElapsed += dt;
    let seconds = dt * devSpeed;
    // The same clock drives the simulation and its wheels, so the numbers
    // turn as fast as time goes. A change in what there is to decide or read,
    // or in the size of the tick, ends the frame, so the next one starts at
    // the new pace.
    while (seconds > 1e-9 && pace > 0) {
      const step = Math.min(1 - carry, seconds * pace);
      carry += step;
      seconds = Math.max(0, seconds - step / pace);
      if (carry < 1 - 1e-9) break;
      carry = 0;
      if (!tick(s, C)) break;
      const was = c;
      c = view(s, C).clock;
      if (c.run !== was.run || c.told !== was.told || s.event || c.choices.join('|') !== was.choices.join('|')) break;
      if (quietRate == null && tickAt(s.minute, situation(c)) !== tickNow) break;
    }
    tickNow = tickAt(s.minute + carry, situation(c));
  } else {
    pace = beatPace = 0;
    tickSize.stop();
    busyPace.update({ stopped: true }, 0);
  }
  if (studyStart && !paceFollow && s.now.run !== studyStart.run) { studyDone = true; paused = true; }
  render(now, dt);
  if (studyStart && studySentAt !== Infinity && (now - studySentAt >= 100 || studyDone)) {
    parent.postMessage({ type: 'pace-study-status', elapsed: studyElapsed, done: studyDone, minute: s.minute + carry, tick: tickNow, pace, busy: s.now.run === studyStart.run }, location.origin);
    studySentAt = studyDone ? Infinity : now;
  }
  if (scarStudy && now - studySentAt >= 100) {
    sendScarStudyStatus(); studySentAt = now;
  }
  if (now - lastSave > 3000) { save(); lastSave = now; }
}
function loop() {
  onFrame(nowMs());
  requestAnimationFrame(loop);
}

document.addEventListener('visibilitychange', () => { last = nowMs(); presentation.reset(last); save(); });
addEventListener('pagehide', save);

// ----------------------------------------------------------------- render

const setText = (el, text) => { if (el.textContent !== text) { el.textContent = text; return true; } return false; };
// A changed word fades in where it stands; nothing moves.
function swapText(el, text) {
  if (!setText(el, text) || reducedMotion.matches) return;
  el.classList.remove('swap');
  void el.offsetWidth;
  el.classList.add('swap');
}

const needClock = createNeedStainClock();
let needTiming = { opacity: 0 };
const presentation = createPresentation(phone, { now: nowMs });

function render(now, dt = 0) {
  if (document.hidden && stepping == null) return;
  presentation.frame(now, dt, paint);
}

function paint(now, dt = 0) {
  const v = view(s, C);
  phone.dataset.phase = v.phase;
  phone.classList.toggle('paused', paused || menuOpen);
  if (v.phase === 'intro') { renderIntro(v.intro, now); return; }
  $('intro').hidden = true;
  const need = v.cards.find(d => d.purpose === 'need');
  needTiming = { ...needClock.advance({ key: need?.key ?? null, still: reducedMotion.matches, dt: running() ? dt : 0 }), seed: s.seed };
  renderStatus(v, dt);
  renderNow(v, dt);
  renderChoices(v, dt);
  renderEventCards(v);
  renderEvent(v, now);
  setText($('pause'), paused ? T.interface.resume : T.interface.pause);
  setText($('accelerate'), T.interface.accelerate);
  $('accelerate').classList.toggle('on', accelerating);
  $('accelerate').setAttribute('aria-pressed', String(accelerating));
  renderMenu();
}

// The wheels show numbers heading for the true ones in real seconds (Roy,
// Oct 19, 402; web/number-chase.mjs). Pause and the menu stop them; an
// intertitle doesn't. A hidden page gets no frames, so they wait for it.
const attrEls = {}, attrInk = {}, attrWheels = {};
const numbers = createChase(T.numbers);
function renderStatus(v, dt = 0) {
  for (const a of v.attributes) {
    let el = attrEls[a.id];
    if (!el) {
      el = attrEls[a.id] = document.createElement('div');
      el.className = 'attr';
      el.innerHTML = '<button type="button" class="label"></button><span class="num"></span>';
      // Clicking the word says its line in the descriptions (Roy, Oct 21, 416).
      el.querySelector('.label').onclick = () => { if (inspect(s, C, a.id)) render(nowMs()); };
      $('attributes').append(el);
      attrWheels[a.id] = createWheelNumber(el.querySelector('.num'));
    }
    setText(el.querySelector('.label'), a.label);
    // The true number, between whole numbers, is hidden; the wheel shows
    // the number heading for it.
    const truly = a.revealed ? readingAt(a.id, s.meters, nextMeters(), carry) : null;
    attrWheels[a.id].follow(numbers.follow(a.id, truly, paused || menuOpen ? 0 : dt));
    el.classList.toggle('revealed', a.revealed);
    // No need is drawn on rapture (Roy, Oct 19, 402).
    if (a.id !== 'rapture') {
      if (a.ink.length && !attrInk[a.id]) attrInk[a.id] = stainLayer(el.querySelector('.num'));
      attrInk[a.id]?.show(a.ink, dt, needTiming);
    }
  }
  renderTrickles(v, dt);
}

// Trickles (Roy, Oct 19): water on a wall. Up above rapture's number when the
// latest event lifts it, down below when it costs, a burst as big as what it
// moves ("the most recent event, not overall trends"); disquiet's pull runs
// right to left, a short stream centered between the two numbers
// (web/trickles.mjs). They move with the numbers, in real seconds: pause and
// the menu stop them (provisional).
const trickles = createTrickles();
const latest = createEventWatch();
let trickleCanvas, trickleBoxes = null, trickleMeasured = 0, trickleDisquiet = null;
function renderTrickles(v, dt) {
  if (!trickleCanvas) {
    trickleCanvas = document.createElement('canvas');
    trickleCanvas.className = 'trickles';
    trickleCanvas.setAttribute('aria-hidden', 'true');
    $('status').append(trickleCanvas);
  }
  const revealed = Object.fromEntries(v.attributes.map(a => [a.id, a.revealed]));
  const happened = latest.update(s, C);
  trickleCanvas.hidden = reducedMotion.matches;
  if (trickleCanvas.hidden) return;
  // The trickles count rapture as it's written, before `raptureScale` (Roy,
  // Oct 21, 413), so they look as they were tuned to (provisional).
  const written = 1 / scaleOf(C);
  if (happened && revealed.rapture) trickles.event({ up: happened.up * written, down: happened.down * written });
  const currents = revealed.rapture ? Object.fromEntries(Object.entries(raptureCurrents(s, C)).map(([k, v]) => [k, v * written])) : {};
  if (trickleDisquiet != null) currents.disquiet = trickleDisquiet * T.drain.disquietPerHour;
  if (!revealed.disquiet) currents.disquiet = 0;
  if (!revealed.hunger) currents.hunger = 0;
  // Where the words and numbers are, measured a few times a second.
  const now = nowMs();
  if (!trickleBoxes || now - trickleMeasured > 250) { trickleBoxes = trickleLayout($('status'), attrEls); trickleMeasured = now; }
  const layout = trickleBoxes;
  trickles.advance(paused || menuOpen ? 0 : dt, currents, layout);
  trickles.draw(trickleCanvas, layout);
}

// The middle section. Left: the date and time, then where you are, what
// you're doing, and the mood in parentheses. Right: the descriptions.
const stream = createStream($('stream'));
const clockFace = createClockFace();
const beatClock = createBeatClock({ perSecond: P.tick.perSecond });
let shownRun = null, shownTold = null, shownStopped = null;
function renderNow(v, dt = 0) {
  // The date turns with the clock's own tick, not ahead of it.
  const stopped = !running();
  const force = v.clock.run !== shownRun || v.clock.told !== shownTold || stopped !== shownStopped;
  const shown = busyQuiet ? beatClock({ minute: v.minute, dt: dt * devSpeed, stopped, force }) : clockFace(v.minute, tickNow);
  shownRun = v.clock.run; shownTold = v.clock.told; shownStopped = stopped;
  setText($('date'), C.cal.dateLabel(shown));
  setText($('time'), C.cal.timeLabel(shown));
  swapText($('place'), v.place);
  swapText($('activity'), v.activity);
  if (v.mood) setText($('mood'), `(${v.mood})`);
  $('mood').classList.toggle('on', !!v.mood);
  setText($('locks'), v.locks.join(' · '));
  $('locks').hidden = !v.locks.length;
  stream.render(v.stream, { still: reducedMotion.matches });
}

// Four physical white cards share a perspective in four fixed places.
// While busy, alternate squares lower with their lettering (Roy, 257).
const choiceEls = new Map();
const painScars = new Set();

function renderChoices(v, dt = 0) {
  for (const scar of painScars) if (scar.update()) {
    scar.destroy(); painScars.delete(scar);
  }
  const box = $('choices'), live = new Set(v.cards.map(d => d.key));
  const neglected = new Set(v.neglectedCards.map(d => d.key));
  for (const [key, entry] of choiceEls) if (!live.has(key) && !entry.leaving) {
    if (neglected.has(key)) {
      // The same engine minute supplies both the log line and this exit.
      // Paint the completed stain even if this frame crossed the threshold.
      entry.ink?.show([{ key, level: 1 }], 0, needTiming);
      entry.el.classList.add('neglected');
    }
    leave(key, entry, 'fade-out');
  }
  // Let a neglected black card finish its exit before showing a new need.
  // It still occupies a physical slot during the fade, not an engine offer.
  const neglectedExits = [...choiceEls.values()].filter(e => e.leaving && e.el.classList.contains('neglected'));
  let cards = v.cards.filter(d => !neglectedExits.length || d.purpose !== 'need');
  if (neglectedExits.length) {
    const survivors = new Set(cards.filter(d => choiceEls.has(d.key) && !choiceEls.get(d.key).leaving).map(d => d.key));
    let room = Math.max(0, T.cards.max - neglectedExits.length - survivors.size);
    cards = cards.filter(d => survivors.has(d.key) || room-- > 0);
  }
  // Other departing needs must not overlap their replacements.
  const activeNeed = cards.find(d => d.purpose === 'need');
  if (activeNeed) for (const [key, entry] of choiceEls) if (entry.purpose === 'need' && key !== activeNeed.key) removeChoice(key, entry);
  const slots = allocateCardSlots([...choiceEls].map(([key, e]) => ({ key, slot: e.slot, leaving: e.leaving })), cards.map(d => d.key));
  for (const [key, entry] of choiceEls) if (!slots.has(key)) removeChoice(key, entry);
  for (const d of cards) {
    if (!slots.has(d.key)) continue;
    let entry = choiceEls.get(d.key);
    if (!entry) {
      const slot = slots.get(d.key);
      const { el, button, symbol, ink, wave, blades } = cardElement(d, { bladeAge: Math.max(0, v.minute - d.since), bladesGrown: d.since < openedAt });
      button.addEventListener('animationend', event => {
        if (event.target === button && event.animationName === 'fade-in') el.classList.add('entered');
      });
      placeCard(el, slot);
      el.dataset.cardId = d.id;
      button.setAttribute('aria-keyshortcuts', String(slot + 1));
      button.onclick = () => {
        // The isolated scar preview lets an actual choice start its clock.
        if (scarStudy && paused && !menuOpen && !s.event && button.getAttribute('aria-disabled') !== 'true') paused = false;
        if (!running() || entry.leaving) return;
        // A click makes the complete wording visible before taking it.
        entry.forming?.reveal();
        const previousFlows = new Set(s.flows);
        if (take(s, C, d.id)) {
          entry.painDrain = selectedPainDrain(previousFlows, s.flows, d.id);
          if (d.pain) prepareScar(d.key, entry);
          presentation.defer(() => leave(d.key, entry, 'taken'));
          render(nowMs());
        }
      };
      box.append(el);
      entry = { el, id: d.id, purpose: d.purpose, slot, leaving: false, symbol, ink, wave, blades,
        bladeMinute: v.minute + carry,
        forming: d.formation === 'slow' ? createFormingInk({ el, button }, { seed: `${s.seed}:${d.key}` }) : null,
        formationShown: false, formationLevel: 0,
        hold: createActivityHold({ el, button }, { getOutline: wave ? () => wave.outline() : null,
          onSurface: blades ? frame => blades.hold(frame) : null }) };
      choiceEls.set(d.key, entry);
    }
    // Pausing during the entrance must not strand otherwise complete
    // lettering at near-zero opacity. Settle the whole card once.
    if (paused || menuOpen) entry.el.classList.add('entered');
    // Coverage follows the engine clock, including holds and saved progress.
    entry.ink?.show([{ key: d.key, level: d.needProgress }], dt, needTiming);
    // Fainter as its last chance nears, by story minutes, held or not.
    showRecede(entry.el, recedeOpacity(d.recede, v.minute + carry, T.cards.recede));
    const button = entry.el.querySelector('button');
    entry.el.classList.toggle('locked', !!d.lock);
    // Story minutes form the lettering. Preserve its last displayed state
    // throughout the grid's descent and return, just like the wave edge.
    if (entry.forming && (!entry.formationShown || (!v.held && !d.lock && !entry.el.classList.contains('hold-tiled')))) {
      // A clock fraction can reset when another activity begins. Never
      // erase an already formed fragment when that activity lets go.
      entry.formationLevel = Math.max(entry.formationLevel, formationProgress({
        seed: s.seed, key: d.key, minutes: d.formMinutes, carry,
        active: !v.held && !d.lock, rule: T.cards.formation, formation: d.formation,
      }));
      entry.forming.show(entry.formationLevel);
      entry.formationShown = true;
    }
    // Freeze the last displayed pain artwork before the grid lowers, and
    // keep it frozen until the same squares finish rising on unlock.
    entry.wave?.update(running() ? dt : 0, {
      frozen: v.held || entry.el.classList.contains('hold-tiled') || !running(),
      still: reducedMotion.matches,
    });
    const bladeMinute = v.minute + carry;
    entry.blades?.update(running() ? dt : 0, {
      storyMinutes: Math.max(0, bladeMinute - entry.bladeMinute),
      frozen: v.held || entry.el.classList.contains('hold-tiled') || !running(),
      still: reducedMotion.matches,
    });
    entry.bladeMinute = bladeMinute;
    entry.hold.update(v.held, { dt: running() ? dt : 0, still: reducedMotion.matches, covered: !!v.event });
    button.setAttribute('aria-disabled', String(!!d.lock || v.held));
  }
  // Reading and keyboard order match the four stable visual positions.
  let previous = null;
  for (const entry of [...choiceEls.values()].sort((a, b) => a.slot - b.slot)) {
    const next = previous ? previous.nextSibling : box.firstChild;
    if (entry.el !== next) box.insertBefore(entry.el, next);
    previous = entry.el;
  }
}
function removeChoice(key, entry) {
  if (entry.removed) return;
  entry.removed = true;
  // A selected card may surrender its slot before the fade callback. Its
  // scar already owns its captured position and is revealed exactly once.
  entry.scar?.reveal();
  entry.scar = null;
  entry.exitCleanup?.();
  entry.hold?.destroy();
  entry.forming?.destroy();
  entry.wave?.destroy();
  entry.blades?.destroy();
  entry.el.remove();
  if (choiceEls.get(key) === entry) choiceEls.delete(key);
}
function prepareScar(key, entry) {
  if (entry.scar) return;
  const scar = createPainScar($('choices'), {
    flow: entry.painDrain, seed: `${s.seed}:${key}:${s.minute}`,
    x: entry.el.offsetLeft, y: entry.el.offsetTop,
    width: entry.el.offsetWidth, height: entry.el.offsetHeight,
    minute: () => s.minute + carry, fraction: () => carry,
    still: reducedMotion.matches,
    ...(scarStudyKind ? { kind: scarStudyKind } : {}),
  });
  if (scar) { entry.scar = scar; painScars.add(scar); }
}
// Taken cards tint and fade with their attached blades. The scar is only
// exposed once the face leaves, and never holds a decision slot.
// No longer possible: it fades.
function leave(key, entry, how) {
  if (entry.leaving || entry.removed) return;
  entry.leaving = true;
  entry.blades?.freeze();
  entry.hold?.destroy();
  if (how === 'taken') selectCard(entry).then(() => presentation.defer(() => removeChoice(key, entry)));
  else {
    entry.el.classList.add(how);
    const button = entry.el.querySelector('button');
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.tabIndex = -1;
    const done = event => {
      if (event.target !== button || event.animationName !== 'fade-out') return;
      presentation.defer(() => removeChoice(key, entry));
    };
    button.addEventListener('animationend', done);
    button.addEventListener('animationcancel', done);
    entry.exitCleanup = () => {
      button.removeEventListener('animationend', done);
      button.removeEventListener('animationcancel', done);
    };
    if (reducedMotion.matches) presentation.defer(() => removeChoice(key, entry));
  }
}

// Events cover everything below the attributes and stop the clock. Every
// line is said in the middle section's place, where the line above answers
// is, so it never moves between intertitles and answers (Roy, Oct 19, 403).
// "continue" appears on the first page, then stays visible between pages
// (Roy, Oct 12). The guard only keeps a double tap from skipping a line.
const HINT_DELAY = 150, TAP_GUARD = 120;
let eventKey = null, eventAt = 0;
function renderEvent(v, now) {
  const cover = $('event'), ev = v.event;
  phone.classList.toggle('in-event', !!ev);
  if (!ev) {
    cover.hidden = true;
    $('event-hint').classList.remove('in');
    // Fade the revealed screen as one surface, preserving its cards and slots.
    if (eventKey !== null) phone.classList.add('intertitle-return');
    eventKey = null;
    return;
  }
  phone.classList.remove('intertitle-return');
  cover.hidden = false;
  cover.classList.toggle('answering', ev.mode === 'answers');
  const reasons = [...new Set((ev.answers || []).map(a => a.reason).filter(Boolean))];
  setText($('event-lock-reason'), reasons.join(' · '));
  $('event-lock-reason').hidden = !reasons.length;
  if (ev.key !== eventKey) {
    eventKey = ev.key;
    eventAt = now;
    $('event-text').classList.toggle('italic', !!ev.italic);
    fadeText($('event-text'), ev.text);
    // An important mood introduced: its word in bold, beneath and to the right (Roy, Oct 18, 391).
    $('event-mood').hidden = !ev.mood;
    if (ev.mood) fadeText($('event-mood'), ev.mood);
    setText($('event-hint'), UI.dismiss);
  }
  showContinue($('event-hint'), ev.mode === 'pages', now - eventAt);
}

function showContinue(hint, available, elapsed) {
  hint.classList.toggle('in', available && (hint.classList.contains('in') || elapsed > HINT_DELAY));
}
// An event's answers are the main page's cards, in its four places, with its
// faces, entrances, click and fades (Roy, Oct 18: "these should look and
// function exactly like the cards in the main page, only there are no need
// cards, only pain special cards"). While they're up, the cover ends where the
// cards begin, and the day's own cards wait unseen in their places.
const eventCards = new Map();
let answering = false;
function renderEventCards(v) {
  const answers = v.event?.mode === 'answers' ? v.event.answers : [];
  phone.classList.toggle('answering', answers.length > 0);
  // Where the four places begin: the cover ends there, and every line of the
  // event is said above it.
  if (v.event) phone.style.setProperty('--choices-top', `${$('choices').offsetTop}px`);
  // Keyed by the event as it happened, so an answer keeps its place while
  // you stay among its answers, and the next answers take theirs anew.
  const list = answers.map(a => ({ ...a, key: `${s.event.key}:${(s.event.at || []).join('/')}:${a.id}` }));
  const live = new Set(list.map(a => a.key));
  for (const [key, entry] of eventCards) if (!live.has(key) && !entry.leaving) fadeEventCard(key, entry);
  const slots = allocateCardSlots([...eventCards].map(([key, e]) => ({ key, slot: e.slot, leaving: e.leaving })), list.map(a => a.key));
  for (const [key, entry] of eventCards) if (!slots.has(key)) removeEventCard(key, entry);
  for (const a of list) {
    if (!slots.has(a.key)) continue;
    let entry = eventCards.get(a.key);
    if (!entry) {
      const slot = slots.get(a.key);
      // Never a need: an answer is a plain card, or a pain card with its blades.
      const { el, button, blades } = cardElement({ key: a.key, id: a.id, purpose: 'reply', label: a.label, pain: a.pain, marker: a.marker },
        { bladesGrown: true });
      el.classList.add('event-card');
      button.addEventListener('animationend', event => {
        if (event.target === button && event.animationName === 'fade-in') el.classList.add('entered');
      });
      placeCard(el, slot);
      button.setAttribute('aria-keyshortcuts', String(slot + 1));
      entry = { el, id: a.id, slot, leaving: false, blades };
      button.onclick = () => chooseAnswer(a.key, entry);
      $('choices').append(el);
      eventCards.set(a.key, entry);
    }
    entry.answer = a;
    entry.el.classList.toggle('locked', a.locked);
    entry.el.querySelector('button').setAttribute('aria-disabled', String(!a.tappable));
    // The clock is stopped: a pain card's blades stand still.
    entry.blades?.update(0, { storyMinutes: 0, frozen: true, still: reducedMotion.matches });
  }
}
function chooseAnswer(key, entry) {
  const a = entry.answer;
  if (answering || entry.leaving || s.event?.mode !== 'answers' || !a?.tappable) return;
  if (a.locked) {
    // A locked answer can still say why; its reason is at the top edge.
    if (answer(s, C, a.id)) {
      while (s.event?.mode === 'pages' && s.event.then === 'answers' && !s.event.base) readNext(s, C);
      render(nowMs());
    }
    return;
  }
  // The card's own click, then what it leads to.
  answering = true;
  entry.leaving = true;
  entry.blades?.freeze();
  presentation.defer(() => selectCard(entry).then(() => {
    answering = false;
    const cause = `event:${s.event?.id}:${a.id}`, before = new Set(s.flows);
    if (answer(s, C, a.id) && a.pain) {
      // A pain card's scar, as on the main page (Oct 13, 348).
      entry.painDrain = s.flows.find(f => !before.has(f) && f.cause === cause && f.key === 'rapture' && f.per < 0) ?? null;
      prepareScar(key, entry);
    }
    removeEventCard(key, entry);
    render(nowMs());
  }));
}
function fadeEventCard(key, entry) {
  entry.leaving = true;
  entry.blades?.freeze();
  entry.el.classList.add('fade-out');
  const button = entry.el.querySelector('button');
  button.disabled = true;
  button.tabIndex = -1;
  button.addEventListener('animationend', event => {
    if (event.target === button && event.animationName === 'fade-out') removeEventCard(key, entry);
  });
  if (reducedMotion.matches) removeEventCard(key, entry);
}
function removeEventCard(key, entry) {
  if (entry.removed) return;
  entry.removed = true;
  entry.scar?.reveal();
  entry.scar = null;
  entry.blades?.destroy();
  entry.el.remove();
  if (eventCards.get(key) === entry) eventCards.delete(key);
}
$('event').onclick = () => {
  if (s.event?.mode === 'pages' && nowMs() - eventAt > TAP_GUARD) { readNext(s, C); render(nowMs()); }
};

function fadeText(el, text) {
  el.classList.remove('in');
  el.textContent = text;
  void el.offsetWidth;
  presentation.defer(() => el.classList.add('in'));
}

// The intro: Roy's opening, before the clock starts.
let introKey = null, introAt = 0;
function renderIntro(iv, now) {
  $('event').hidden = true;
  const cover = $('intro');
  cover.hidden = false;
  setText($('skip'), iv.skip);
  if (iv.key !== introKey) {
    introKey = iv.key;
    introAt = now;
    const text = $('intro-text');
    text.className = 'cover-text';
    if (iv.bold) text.classList.add('bold');
    if (iv.italic) text.classList.add('italic');
    if (iv.title) text.classList.add('title');
    fadeText(text, iv.text);
    setText($('intro-hint'), UI.dismiss);
    const buttons = [];
    const add = (label, choice) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'button';
      b.textContent = label;
      b.onclick = e => { e.stopPropagation(); introNext(s, C, choice); render(nowMs()); };
      buttons.push(b);
    };
    if (iv.question) { add(iv.yes, 'yes'); add(iv.no, 'no'); }
    else if (iv.begin) add(iv.begin);
    $('intro-answers').replaceChildren(...buttons);
  }
  showContinue($('intro-hint'), !iv.question && !iv.begin, now - introAt);
}
$('intro').onclick = () => {
  const node = s.phase === 'intro' && C.intro.find(n => n.id === s.intro);
  if (!node || node.yes || nowMs() - introAt < TAP_GUARD) return;
  const nextId = node.next ?? C.intro[C.intro.indexOf(node) + 1]?.id;
  if (!nextId || nextId === '@begin') return;
  introNext(s, C);
  render(nowMs());
};
$('skip').onclick = e => { e.stopPropagation(); skipIntro(s, C); render(nowMs()); };

// ------------------------------------------------------------------ pause

function togglePause() {
  if (s.phase !== 'life') return;
  paused = !paused;
  save();
  render(nowMs());
}
$('pause').onclick = togglePause;
function toggleAccelerate(on = !accelerating) {
  if (on && s.phase !== 'life') return;
  if (accelerating === on) return;
  accelerating = on;
  render(nowMs());
}
// Held, not clicked (Roy, Oct 21, 412): on while the pointer, or Space or
// Enter on the word, is down; off the moment it's let go, wherever, or the
// page is left.
const accelerate = $('accelerate');
accelerate.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  try { accelerate.setPointerCapture(e.pointerId); } catch { /* let go is still heard here */ }
  toggleAccelerate(true);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) accelerate.addEventListener(type, () => toggleAccelerate(false));
accelerate.addEventListener('keydown', e => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  e.preventDefault();
  toggleAccelerate(true);
});
accelerate.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') toggleAccelerate(false); });
accelerate.addEventListener('blur', () => toggleAccelerate(false));
accelerate.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => toggleAccelerate(false));
document.addEventListener('visibilitychange', () => { if (document.hidden) toggleAccelerate(false); });

// The menu, at the lower right of the pause bar. The clock stops while it's
// open. "restart" starts a new game from the intro.
function renderMenu() {
  setText($('menu'), T.interface.menu);
  setText($('restart'), T.interface.restart);
  $('menu-panel').hidden = !menuOpen;
  $('menu').setAttribute('aria-expanded', String(menuOpen));
}
function toggleMenu(open = !menuOpen) {
  menuOpen = open;
  render(nowMs());
}
$('menu').onclick = e => { e.stopPropagation(); toggleMenu(); };
$('restart').onclick = () => {
  restarting = true;
  // A comparison or full preview must stay isolated even when restarted.
  if (params.has('preview')) { location.reload(); return; }
  try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing saved */ }
  location.href = location.pathname;
};
document.addEventListener('click', e => {
  if (menuOpen && !$('menu-panel').contains(e.target)) toggleMenu(false);
});

document.addEventListener('keydown', e => {
  if (e.repeat || e.target.matches('input, select')) return;
  if (e.key === 'Escape' || e.key === 'p') {
    if (menuOpen) toggleMenu(false);
    else togglePause();
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    if (e.target.matches('button')) return;
    e.preventDefault();
    if (s.phase === 'intro') $('intro').click();
    else if (s.event?.mode === 'pages') $('event').click();
    return;
  }
  if (/^[1-4]$/.test(e.key) && running()) {
    const entry = [...choiceEls.values()].find(entry => entry.slot === Number(e.key) - 1 && !entry.leaving);
    entry?.el.querySelector('button').click();
  } else if (/^[1-4]$/.test(e.key) && s.event?.mode === 'answers') {
    const entry = [...eventCards.values()].find(entry => entry.slot === Number(e.key) - 1 && !entry.leaving);
    entry?.el.querySelector('button').click();
  }
});

// For development and checks in the browser console.
window.alignment = {
  get state() { return s; }, C,
  view: () => view(s, C),
  get pace() { return pace; },
  get tick() { return tickNow; },
  get accelerating() { return accelerating; },
  accelerate(on) { toggleAccelerate(on); return accelerating; },
  get busyPassage() { return busyQuiet ? busyPace.snapshot() : null; },
  get presentation() { return presentation.snapshot(); },
  get scars() { return [...painScars].map(scar => scar.snapshot()); },
  // What the wheels show; the true numbers are `state.meters`.
  get shown() { return numbers.snapshot(); },
  get trickles() { return trickles.drops; },
  advance(minutes) { let n = 0; while (n < minutes && tick(s, C)) n++; render(nowMs()); return n; },
  take(id) { const taken = take(s, C, id); render(nowMs()); return taken; },
  inspect(id) { const said = inspect(s, C, id); render(nowMs()); return said; },
  read() { const read = readNext(s, C); render(nowMs()); return read; },
  answer(id) { const answered = answer(s, C, id); render(nowMs()); return answered; },
  // Draws one frame as if `seconds` had passed (the wheels and fades move; the clock doesn't).
  frame(seconds) { lead += seconds * 1000; last = nowMs(); presentation.frame(last, seconds, paint); },
  // Plays `seconds` of real time through the screen's own clock, 60 frames a
  // second, whether or not the page is visible. Stops early once `until()`
  // is true. Returns the seconds played.
  play(seconds, until) {
    let played = 0;
    stepping = performance.now();
    // The time before this call isn't played.
    last = nowMs();
    try {
      while (played < seconds - 1e-9 && !until?.()) { lead += 1000 / 60; played += 1 / 60; onFrame(nowMs()); }
    } finally {
      // Carry on from where the stepped clock stands, without the real time that passed meanwhile.
      lead -= performance.now() - stepping;
      stepping = null;
    }
    return played;
  },
};

if (studyStart) {
  addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== parent) return;
    if (e.data?.type === 'pace-study-play' && !studyDone) { paused = false; last = nowMs(); }
    if (e.data?.type === 'pace-study-pause') paused = true;
    render(nowMs());
  });
  // What this game is really running, so the pace study can show it
  // (pace-ramp.html compares it with what it asked for).
  const running = { reading: P.tick.reading, grow: P.tick.grow, hold: P.tick.hold ?? 1,
    ladder: P.tick.ladder ?? null, settle: P.tick.settle ?? 0, decisions: P.tick.decisions, most: P.tick.most ?? null };
  parent.postMessage({ type: 'pace-study-ready', running }, location.origin);
}
// The scar comparison embeds this ordinary game in an explicitly unsaved
// preview. Its transport drives the existing inputs and clock only.
function sendScarStudyStatus() {
  if (!scarStudy) return;
  parent.postMessage({ type: 'scar-study-status', minute: s.minute + carry,
    elapsed: studyElapsed, paused, rate: devSpeed, rapture: s.meters.rapture,
    event: !!s.event, activity: s.now.id,
    drainMinutes: T.flow[T.flow.default], scars: [...painScars].map(scar => scar.snapshot()),
  }, location.origin);
}
if (scarStudy) {
  addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== parent) return;
    const message = e.data;
    if (!message || !['scar-study-play', 'scar-study-pause', 'scar-study-rate',
      'scar-study-take', 'scar-study-read', 'scar-study-step'].includes(message.type)) return;
    if (message.type === 'scar-study-play') paused = false;
    if (message.type === 'scar-study-pause') paused = true;
    if (message.type === 'scar-study-rate' && Number.isFinite(message.rate)) devSpeed = Math.max(.125, Math.min(64, message.rate));
    if (message.type === 'scar-study-take') {
      const entry = [...choiceEls.values()].find(entry => entry.id === message.id && !entry.leaving);
      entry?.el.querySelector('button').click();
    }
    if (message.type === 'scar-study-read') readNext(s, C);
    if (message.type === 'scar-study-step') {
      paused = false;
      window.alignment.play(Math.max(0, Math.min(1, Number(message.seconds) || 1 / 15)));
      paused = true;
    }
    last = nowMs(); render(last); sendScarStudyStatus();
  });
  parent.postMessage({ type: 'scar-study-ready' }, location.origin);
  sendScarStudyStatus();
}
if (trickleStudy) {
  addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== parent) return;
    const message = e.data;
    if (message?.type === 'trickle-study-tuning') trickles.retune(message.tuning ?? {});
    if (message?.type === 'trickle-study-event') trickles.event({ up: Number(message.up) || 0, down: Number(message.down) || 0 });
    if (message?.type === 'trickle-study-disquiet') trickleDisquiet = Number.isFinite(message.value) ? message.value : null;
  });
  parent.postMessage({ type: 'trickle-study-ready' }, location.origin);
}
requestAnimationFrame(loop);
