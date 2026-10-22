// The simulation (spec/opus-5.5-version.md). One rule shapes it: by yourself
// you sleep, wake, work your shifts and are otherwise idle; everything else
// you start by hand, until doing it has made it a habit. Then it happens by
// itself and its card stops coming.
//
// The five principles hold: story minutes are the only clock (tick advances
// one); every draw is seeded and named; nothing here reads the screen;
// content is data; every change is written to the ledger once.
import { draw, pick, fromBag, keyed } from './random.mjs';
import { inHours } from './calendar.mjs';
import { flowStep, taperFlow, preserveNeglectTapers } from './flow.mjs';
import { test, act, canChoose, isOpen, nextCommitment, trueMood } from './rules.mjs';

export const SAVE_VERSION = 6;
export const VISIBLE = ['disquiet', 'rapture', 'hunger', 'money', 'choice'];
// How much of what's written a change to rapture is (Roy, Oct 21, 413: "scale
// down rapture significantly"; `raptureScale` in tuning).
export const scaleOf = C => C.tuning.raptureScale ?? 1;
const LONG_AGO = -1000000;
// Keep one saved counter per appearance, including the rare slow entrances.
// Changing an ordinary card's visual duration must not shorten older saves.
const formationLimit = C => Math.max(C.tuning.cards.formation?.maxMinutes ?? 20, C.tuning.cards.formation?.slow?.maxMinutes ?? 0);

// ------------------------------------------------------------------ state

export function createGame(C, seed) {
  const t = C.tuning, { _note, ...meters } = t.meters;
  const s = {
    version: SAVE_VERSION, seed: String(seed),
    phase: 'intro', intro: C.intro[0]?.id ?? null,
    minute: 0,
    meters: { ...meters, disquiet: C.start.disquiet, money: C.start.money },
    stocks: { ...C.start.stocks },
    revealed: {}, facts: {}, counts: {}, today: { day: 0, counts: {} },
    place: 'home', now: null, runs: 0,
    habits: {}, formed: {},
    commitments: [], tallies: {},
    cards: [], cooldowns: {}, neglectedNeeds: {}, lowered: 0, deal: null,
    event: null, done: {}, mood: null,
    stream: [], streamTotal: 0, lastTold: LONG_AGO, seen: {}, voiced: 0, voicedAt: LONG_AGO,
    ledger: [], pending: {}, flows: [], settled: { entries: 0, totals: {} },
    draws: {}, bags: {}, bagLast: {},
    inputs: [], inputsTotal: 0, journal: [], journalTotal: 0,
  };
  s.initial = { ...s.meters, ...Object.fromEntries(Object.entries(s.stocks).map(([k, v]) => [`stock.${k}`, v])) };
  for (const day of t.work.firstShiftDays) addCommitment(s, shiftOn(C, day));
  return s;
}

// Keep the unfinished Opus build's v3 saves. Previously queued changes keep
// their remaining duration. An ongoing meal begins its newly lingering effect
// at the saved minute, without retroactive changes or replaying its purchase.
export function upgrade(save, C) {
  if (!save || save.now === undefined) return null;
  // An intertitle that's no longer in the content is simply over.
  if (C && save.event && !C.events[save.event.id]) save.event = null;
  // Saved on the line that leads to answers: it comes with them now (Oct 18).
  if (C && save.event?.mode === 'pages' && Array.isArray(save.event.used)) withAnswers(save, C);
  if (C) { letGoOfRetired(save, C); catchUpEvents(save, C); }
  // A wait counted down before October 21 (414) starts counting up afresh.
  if (save.deal && save.deal.waited == null) save.deal = { waited: 0 };
  if (save.version === SAVE_VERSION) { preserveNeglectedNeeds(save); preserveNeglectTapers(save); return save; }
  if (![3, 4, 5].includes(save.version) || !C) return null;
  const a = C.activities[save.now?.id];
  if (save.version === 3 && a && !save.now.over) for (const [key, delta] of Object.entries(a.linger)) {
    const cause = `felt:${a.id}`;
    if (!save.flows.some(f => f.cause === cause && f.key === key)) {
      did(save, key, grant(save, C, key, delta, cause, a.flow));
    }
  }
  // The earlier continuous cost is already accounted for. Start the new
  // stain clock here; never back-charge a need from an older save.
  if (save.version < 5) for (const card of save.cards) if (C.choices[card.id]?.purpose === 'need') card.needMinutes = 0;
  // Earlier cards already had a birth minute. Mature cards stay readable;
  // from this save onward, only eligible, unlocked minutes form their text.
  const formLimit = formationLimit(C);
  for (const card of save.cards) if (card.formMinutes == null) {
    card.formMinutes = Math.min(formLimit, Math.max(0, save.minute - card.since));
  }
  save.version = SAVE_VERSION;
  preserveNeglectedNeeds(save);
  preserveNeglectTapers(save);
  return save;
};

// What an event that's already over sets and reveals is in the save, even
// when the content gave it those later (Roy, Oct 18, 395: the hunger passage
// removed, the second night's dream opens the trip to the hole instead).
// Nothing is replayed; each counts from the minute the event came.
function catchUpEvents(save, C) {
  save.facts ??= {}; save.revealed ??= {};
  for (const e of C.eventList) {
    const at = e.once ? save.done?.[e.id] : null;
    if (at == null) continue;
    for (const f of e.sets || []) save.facts[f] ??= at;
    for (const k of Object.keys(e.reveal || {})) save.revealed[k] ??= at;
  }
}

// What the content no longer has (Roy, Oct 15, 370: most activities retired)
// is let go where the save left it. A card that isn't one any more is gone, as
// is a habit of an activity that isn't. An activity that isn't is over, cut
// short: what it did while it lasted stops, and what comes next is decided
// as after any activity. Nothing is replayed or charged again.
function letGoOfRetired(save, C) {
  save.cards = (save.cards || []).filter(card => C.choices[card.id]);
  for (const id of Object.keys(save.neglectedNeeds || {})) if (!C.choices[id]) delete save.neglectedNeeds[id];
  for (const id of Object.keys(save.formed || {})) if (!C.activities[id]) delete save.formed[id];
  const n = save.now;
  if (n.then && !C.activities[n.then]) n.then = null;
  if (!C.activities[n.id]) {
    save.flows = (save.flows || []).filter(f => f.run !== n.run);
    save.now = { ...n, id: 'idle', then: null, over: true };
  }
}

// Early v6 saves kept expired needs among the offered cards. Preserve their
// completed appearance separately, without replaying its log or penalty.
// This optional record is compatible with the existing save version.
function preserveNeglectedNeeds(s) {
  s.neglectedNeeds ??= {};
  for (const card of s.cards) if (card.neglectedAt != null) {
    s.neglectedNeeds[card.id] ??= { since: card.since, neglectedAt: card.neglectedAt };
  }
  s.cards = s.cards.filter(card => card.neglectedAt == null);
}

const clamp = (key, v) => (VISIBLE.includes(key) ? Math.max(0, v) : Math.min(100, Math.max(0, v)));

// An instant change, recorded once with its cause.
export function change(s, key, delta, cause) {
  if (!delta) return 0;
  const stock = key.startsWith('stock.'), bag = stock ? s.stocks : s.meters, name = stock ? key.slice(6) : key;
  const before = bag[name] ?? 0, after = stock ? Math.max(0, before + delta) : clamp(name, before + delta), actual = after - before;
  if (!actual) return 0;
  bag[name] = after;
  s.ledger.push([s.minute, key, actual, cause]);
  return actual;
}

// A continuous change. It adds up under its cause and is written to the
// ledger once, when the current activity closes.
function accrue(s, key, delta, cause) {
  if (!delta) return 0;
  const before = s.meters[key] ?? 0, after = clamp(key, before + delta), actual = after - before;
  if (!actual) return 0;
  s.meters[key] = after;
  const bag = s.pending[cause] || (s.pending[cause] = {});
  bag[key] = (bag[key] || 0) + actual;
  return actual;
}

function flush(s) {
  for (const [cause, bag] of Object.entries(s.pending)) {
    for (const [key, delta] of Object.entries(bag)) if (delta) s.ledger.push([s.minute, key, delta, cause]);
  }
  s.pending = {};
  // Older than a day: kept as one total per key, so a save stays small.
  let n = 0;
  while (n < s.ledger.length && s.ledger[n][0] < s.minute - 1440) n++;
  for (let i = 0; i < n; i++) s.settled.totals[s.ledger[i][1]] = (s.settled.totals[s.ledger[i][1]] || 0) + s.ledger[i][2];
  s.settled.entries += n;
  s.ledger.splice(0, n);
}

// Roy, Oct 11: "we have to move to model where these attributes drain or
// increase slowly", then "no money goes a lot at once- disquiet and rapture
// can acuumulate or drain quickly OR very slowly". So what happens to
// disquiet, rapture, hunger or choice never lands at once: it's granted here
// and arrives a little each story minute, written to the ledger under its
// own cause as it comes. `over` says how fast: "linger", "quick" or "slow" (tuning's
// flow), or a number of story minutes. Money, stocks and what you carry
// inside change at once.
// `into`: whatever of it actually arrives is added, turned around, to another
// attribute (rapture given up becomes Choice). `run`: it belongs to that run
// of an activity and stops if the activity is cut short.
// A change to rapture is `raptureScale` of what's written (Roy, Oct 21, 413:
// "events like cook a meal should only give you +1"); what it's turned into
// isn't, so pain still gives the Choice it did. `level`: the change brings
// rapture to a level written at its new size (a reset), so it isn't scaled.
function grant(s, C, key, delta, cause, over, { into, run, curve, level } = {}) {
  if (!delta) return 0;
  let exchange = 1;
  if (key === 'rapture' && !level) { delta *= scaleOf(C); exchange = 1 / scaleOf(C); }
  // Something lowered rapture: the count is kept (Roy, Oct 13, 316), but nothing
  // on the screen shows it since he removed the flash on October 13 (331). What
  // drains by itself every minute isn't granted, and doesn't.
  if (key === 'rapture' && delta < 0) s.lowered = (s.lowered || 0) + 1;
  const minutes = typeof over === 'number' ? over : C.tuning.flow[over ?? C.tuning.flow.default];
  if (key === 'money' || !VISIBLE.includes(key) || !(minutes >= 1)) return change(s, key, delta, cause);
  const f = { key, left: delta, per: delta / minutes, cause, ...(into ? { into } : {}), ...(into && exchange !== 1 ? { exchange } : {}), ...(run ? { run } : {}) };
  if (curve === 'ease-out') taperFlow(f);
  s.flows.push(f);
  return delta;
}

// One story minute of everything still arriving.
function flow(s) {
  if (!s.flows.length) return;
  for (const f of s.flows) {
    const next = flowStep(f);
    const arrived = accrue(s, f.key, next.part, f.cause);
    if (f.into) accrue(s, f.into, -arrived * (f.exchange ?? 1), f.cause);
    f.left = next.left;
    if (f.taper) f.taper.left = next.minutes;
    // Many small parts leave a speck of rounding; the last one clears it, so
    // $50 spent is $50 exactly.
    if (!f.left) accrue(s, f.key, Math.round(s.meters[f.key] * 1e6) / 1e6 - s.meters[f.key], f.cause);
  }
  s.flows = s.flows.filter(f => f.left);
}

// The player's inputs, the last few hundred kept, with a count of them all,
// so a long life's save stays small (the opening's pastimes, Oct 18, are
// taken often).
function input(s, entry) {
  s.inputsTotal = (s.inputsTotal ?? s.inputs.length) + 1;
  s.inputs.push(entry);
  if (s.inputs.length > 300) s.inputs.splice(0, 100);
}

function note(s, kind, id, extra) {
  s.journal.push(extra === undefined ? [s.minute, kind, id] : [s.minute, kind, id, extra]);
  s.journalTotal += 1;
  if (s.journal.length > 300) s.journal.splice(0, 100);
}
const setFact = (s, fact) => { if (s.facts[fact] == null) s.facts[fact] = s.minute; };
const reveal = (s, attribute) => { if (s.revealed[attribute] == null) s.revealed[attribute] = s.minute; };

// What the current activity itself did to the five attributes. It's never
// told in words (Roy, Oct 11: "there won't be displayed stat modifications
// anymore"); the numbers at the top turn. It decides only which numbers the
// activity lets you see for the first time. (It counts what was granted,
// which goes on arriving after the activity is over.)
function did(s, key, actual) {
  if (actual && VISIBLE.includes(key)) s.now.did[key] = (s.now.did[key] || 0) + actual;
}

// A line on the right of the middle section: a description, kept by ID and
// never as text.
function say(s, C, entry) {
  s.streamTotal += 1;
  s.stream.push({ n: s.streamTotal, m: s.minute, ...entry });
  const keep = C.tuning.tell.keep;
  if (s.stream.length > keep) s.stream.splice(0, s.stream.length - keep);
}

// Pain costs rapture, and the rapture given up becomes Choice (Roy, Oct 5).
function payPain(s, C, cause) {
  const pain = C.tuning.cards.painRapture;
  grant(s, C, 'rapture', -pain, cause, undefined, { into: 'choice' });
  reveal(s, 'rapture');
  // A tenth of it, since October 21 (413); the Choice is as it was.
  return { rapture: -pain * scaleOf(C), choice: pain };
}

// "after you press a pain card you should see in the log 'pain'" (Roy, Oct
// 13, 316). His word, said the moment it's pressed. It's a mark in the
// descriptions, not something to read: the clock doesn't slow for it (view).
// "sometimes it will be accompanied by a description": an activity whose
// description is said with its pain (`tell.withPain`; Roy, Oct 13: "pain: you
// force yourself to wash every last dish") tells it here, in the same line,
// and has nothing left to tell later. `a`: the activity the card started.
function painTold(s, C, a) {
  const ref = C.tuning.cards.painDescription;
  if (!(ref && C.text(ref).trim())) return;
  const n = s.now, t = C.tuning.tell;
  if (a?.tell?.withPain && n.tells.length) {
    const x = n.tells[0];
    n.tells = [];
    const e = !x.sure && s.minute - s.lastTold < t.minGapMinutes ? null : x.ref ? a.pool.find(p => p.ref === x.ref) : choose(s, C, a);
    if (e) return describe(s, C, a, e, ref);
  }
  say(s, C, { run: n.run, ref });
}

// ------------------------------------------------------------ commitments

export function shiftOn(C, day) {
  return { do: C.tuning.work.activity, start: C.cal.minuteAt(day, C.start.shiftStartHour), end: C.cal.minuteAt(day, C.start.shiftEndHour) };
}
function addCommitment(s, c) {
  if (s.commitments.some(x => x.start === c.start)) return;
  s.commitments.push(c);
  s.commitments.sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------------ intro

export function introNext(s, C, choice) {
  if (s.phase !== 'intro') return false;
  const at = C.intro.findIndex(n => n.id === s.intro), node = C.intro[at];
  if (!node) return begin(s, C);
  let target;
  if (node.yes) {
    if (choice !== 'yes' && choice !== 'no') return false;
    target = node[choice];
  } else target = node.next ?? C.intro[at + 1]?.id;
  input(s, [0, 'intro', choice ?? 'next']);
  if (!target || target === '@begin') return begin(s, C);
  s.intro = target;
  return true;
}

export function skipIntro(s, C) {
  if (s.phase !== 'intro') return false;
  input(s, [0, 'intro', 'skip']);
  return begin(s, C);
}

// Life begins idle at home, with the line `tuning.openingLine` names on the
// right. Since Roy, Oct 21 (410), it names none.
function begin(s, C) {
  s.phase = 'life';
  s.intro = null;
  start(s, C, 'idle', 'self');
  const line = C.tuning.openingLine;
  if (line && C.text(line).trim()) {
    say(s, C, { run: s.now.run, ref: line });
    s.seen[line] = 0;
  }
  updateCards(s, C);
  return true;
}

// ------------------------------------------------------------- activities

// Whether an activity could start this minute.
export function canStart(s, C, a, { ignoreMoney = false } = {}) {
  if (!inHours(C.cal.minuteOfDay(s.minute), a.hours)) return false;
  if (a.place && !isOpen(C, a.place, s.minute)) return false;
  if (!test(s, C, a.requires)) return false;
  for (const [k, n] of Object.entries(a.uses)) {
    if (k === 'money') { if (!ignoreMoney && s.meters.money < n) return false; }
    else if ((s.stocks[k] ?? 0) < n) return false;
  }
  const c = nextCommitment(s);
  return !(c && s.minute + Math.max(...a.minutes.map(Number)) > c.start);
}

// `until`: when it ends, if not after one of its usual lengths. `whole`: how
// long it would have been from its beginning, when it's taken up partway (a
// shift after a reset).
function start(s, C, id, by, { until, then, whole } = {}) {
  const a = C.activities[id], cause = `do:${id}`;
  s.runs += 1;
  s.now = { id, by, run: s.runs, started: s.minute, ends: s.minute, did: {}, tells: [], then: then ?? null, over: false };
  for (const [k, n] of Object.entries(a.uses)) did(s, k, change(s, k === 'money' ? 'money' : `stock.${k}`, -n, cause));
  if (a.place) s.place = a.place;
  s.now.ends = until ?? s.minute + Number(pick(s, `minutes:${id}`, a.minutes));
  // A random outcome with no words, picked now (Roy, Oct 18, 388).
  const o = pickOutcome(s, C, a);
  if (o) {
    s.now.outcome = o.id;
    if (o.minutes && until == null) s.now.ends = s.minute + Number(pick(s, `outcome-minutes:${id}`, o.minutes));
  }
  plan(s, C, a);
  // What it does while it lasts arrives evenly over its own length.
  // Taken up partway, it does only the part that's left.
  const length = s.now.ends - s.now.started, share = whole ? Math.min(1, length / whole) : 1;
  for (const [k, v] of Object.entries(a.during)) did(s, k, grant(s, C, k, v * share, `doing:${id}`, length, { run: s.now.run }));
  // Felt from the start, and left running after this activity has ended.
  // `lingerFrom: "done"`: felt from the description at its end instead (the
  // meal is made; the first time, straight after its intertitle).
  if (a.lingerFrom === 'done' && s.now.tells.length) s.now.owed = true;
  else feel(s, C, a);
  note(s, 'start', id, by);
  fireEvents(s, C, 'activityStart', id);
}

// Which outcome this time: the first time's if it has one, otherwise by
// weight. A seeded draw of its own, so no other stream is reshuffled.
function pickOutcome(s, C, a) {
  if (!a.outcomes.length) return null;
  if (!(s.counts[a.id] > 0)) { const first = a.outcomes.find(o => o.first); if (first) return first; }
  const total = a.outcomes.reduce((n, o) => n + o.weight, 0);
  let x = draw(s, `outcome:${a.id}`) * total;
  for (const o of a.outcomes) { x -= o.weight; if (x < 0) return o; }
  return a.outcomes[a.outcomes.length - 1];
}
const outcomeOf = (s, a) => (s.now.outcome ? a.outcomes.find(o => o.id === s.now.outcome) || null : null);

// What an activity leaves you feeling begins: once for each time it's done.
// With it comes what its hourly rate was holding back meanwhile (`live`).
function feel(s, C, a) {
  const felt = { ...a.linger };
  if (s.now.held) felt.rapture = (felt.rapture || 0) + s.now.held;
  delete s.now.owed;
  delete s.now.held;
  for (const [k, v] of Object.entries(felt)) did(s, k, grant(s, C, k, v, `felt:${a.id}`, a.flow));
  const o = outcomeOf(s, a);
  if (o) for (const [k, v] of Object.entries(o.linger)) did(s, k, grant(s, C, k, v, `felt:${a.id}:${o.id}`, o.flow ?? a.flow));
}

// It was finished: what it does happens now, and only now.
function finish(s, C) {
  const n = s.now, a = act(s, C), cause = `did:${a.id}`;
  // Its description never came: it's felt now, never lost.
  if (n.owed) feel(s, C, a);
  for (const [k, v] of Object.entries(a.end)) did(s, k, grant(s, C, k, v, cause, a.flow));
  const o = outcomeOf(s, a);
  if (o) {
    for (const [k, v] of Object.entries(o.end)) did(s, k, grant(s, C, k, v, `${cause}:${o.id}`, o.flow ?? a.flow));
    for (const f of o.sets) setFact(s, f);
  }
  for (const [k, upTo] of Object.entries(a.restock)) change(s, `stock.${k}`, Math.max(0, upTo - (s.stocks[k] ?? 0)), cause);
  for (const f of a.sets) setFact(s, f);
  if (a.tally) s.tallies[a.tally] = (s.tallies[a.tally] || 0) + 1;
  s.counts[a.id] = (s.counts[a.id] || 0) + 1;
  s.today.counts[a.id] = (s.today.counts[a.id] || 0) + 1;
  // Automation is earned: only what you chose and finished counts.
  if (a.habit && n.by === 'you') {
    s.habits[a.id] = (s.habits[a.id] || 0) + 1;
    if (s.formed[a.id] == null && s.habits[a.id] >= C.tuning.habits.after) { s.formed[a.id] = s.minute; note(s, 'habit', a.id); }
  }
  close(s, C, 'end');
  s.commitments = s.commitments.filter(c => c.end > s.minute);
  fireEvents(s, C, 'activityEnd', a.id);
}

// Finished or cut short, an activity closes once: its continuous changes go
// to the ledger, and the numbers it changed (of those the manuscript says it
// reveals) show from now on.
function close(s, C, how) {
  const n = s.now, a = act(s, C);
  if (n.over) return;
  // Cut short, what it was doing while it lasted stops with it.
  s.flows = s.flows.filter(f => f.run !== n.run);
  flush(s);
  for (const k of a.reveal) if (Math.round(n.did[k] || 0)) reveal(s, k);
  n.over = true;
  if (!a.idle) note(s, how, a.id);
}

// What comes after an activity: what it leads to, then what you'd do by
// yourself, then nothing.
function next(s, C) {
  const prev = s.now, a = act(s, C);
  const due = dueCommitment(s);
  if (due) return start(s, C, due.do, 'self', { until: due.end, whole: due.end - due.start });
  if (prev.then) return start(s, C, prev.then, 'self', prev.then === 'sleep' ? { until: wakeMinute(s, C) } : {});
  if (a.asleep) return start(s, C, 'wake', 'self');
  for (const step of a.then) {
    if (test(s, C, step.when) && canStart(s, C, C.activities[step.do])) return start(s, C, step.do, prev.by);
  }
  const auto = autopilot(s, C);
  if (auto) return startAuto(s, C, auto);
  start(s, C, 'idle', 'self');
}

function startAuto(s, C, auto) {
  start(s, C, auto.id, auto.by ?? 'self', auto);
  // A habit costs what its card did (Roy, Oct 9: "you give up rapture to do so").
  if (auto.by === 'habit' && C.choiceList.some(d => d.does.activity === auto.id && d.pain)) {
    const paid = payPain(s, C, `habit:${auto.id}`);
    did(s, 'rapture', paid.rapture); did(s, 'choice', paid.choice);
  }
}

// What you do by yourself while idle: go to bed, or something you've made a
// habit of. Never anything else.
function autopilot(s, C) {
  if (bedtime(s, C)) {
    const first = !(s.counts.sleep > 0) && C.tuning.sleep.firstNightFails;
    if (first || draw(s, 'sleep') >= C.start.sleepChance) return { id: 'try-sleep', then: 'sleep' };
    return { id: 'sleep', until: wakeMinute(s, C) };
  }
  for (const a of C.activityList) {
    if (!a.habit || s.formed[a.id] == null) continue;
    if (test(s, C, a.habit.when) && canStart(s, C, a)) return { id: a.id, by: 'habit' };
  }
  return null;
}

function bedtime(s, C) {
  const t = C.tuning.sleep, mod = C.cal.minuteOfDay(s.minute), tired = s.meters.tiredness;
  const c = nextCommitment(s);
  if (c && c.start - s.minute < t.wakeBeforeShift + 60) return false;
  if (tired >= t.exhausted) return true;
  const night = [C.start.sleepHour, C.start.wakeHour + 22];
  if (inHours(mod, [t.lateHour, night[1]])) return true;
  return inHours(mod, night) && tired >= t.tiredEnough;
}

// The manuscript's waking hour, or early enough for the next shift.
function wakeMinute(s, C) {
  const t = C.tuning.sleep;
  let wake = C.cal.minuteAt(C.cal.dayIndex(s.minute), C.start.wakeHour);
  if (wake <= s.minute) wake += 1440;
  if (wake - s.minute < 240) wake = s.minute + 240;
  const c = nextCommitment(s);
  if (c && c.start - t.wakeBeforeShift < wake) wake = Math.max(s.minute + 30, c.start - t.wakeBeforeShift);
  return wake;
}

const dueCommitment = s => s.commitments.find(c => c.start <= s.minute && s.minute < c.end) || null;

function startReset(s, C) {
  const t = C.tuning.reset;
  close(s, C, 'cut');
  s.counts.resets = (s.counts.resets || 0) + 1;
  note(s, 'reset', String(s.counts.resets));
  start(s, C, 'reset', 'self');
  // What a reset does arrives while it lasts, so rapture is back by its end.
  const minutes = s.now.ends - s.now.started;
  grant(s, C, 'rapture', t.threshold - s.meters.rapture, 'reset', minutes, { level: true });
  grant(s, C, 'disquiet', -Math.min(t.disquietDrop, s.meters.disquiet), 'reset', minutes);
  grant(s, C, 'choice', -Math.min(t.choiceLoss, s.meters.choice), 'reset', minutes);
}

// ----------------------------------------------------------- descriptions

// Decided as an activity starts: how many descriptions it may have and when.
// Which one is chosen when its moment comes, unless it decides the length.
function plan(s, C, a) {
  const cfg = a.tell, n = s.now, t = C.tuning.tell;
  if (!cfg && !a.first) return;
  // Said with the pain as its card is pressed (`withPain`): a habit, which
  // presses nothing, says nothing.
  if (cfg?.withPain && n.by !== 'you') return;
  const firstTime = !(s.counts[a.id] > 0), tells = [];
  if (cfg?.outcome) {
    const e = choose(s, C, a);
    if (e) { if (e.minutes) n.ends = n.started + e.minutes; tells.push({ ref: e.ref, sure: true }); }
  } else if (a.first && s.seen[a.first] == null) {
    tells.push({ ref: a.first, sure: true });
  } else if (cfg?.order) {
    // Each one that fits, in the order it's written; `one`: only the first.
    for (const e of a.pool) if (fits(s, C, e) && !(cfg.one && tells.length)) tells.push({ ref: e.ref, sure: true });
  } else if (a.pool.length) {
    for (let i = 0; i < (cfg.max ?? 1); i++) {
      const sure = !!cfg.always || (firstTime && i === 0);
      if (sure || draw(s, `tell:${a.id}`) < (cfg.chance ?? 1) * t.density) tells.push({ sure });
    }
  }
  if (!tells.length) return;
  const length = n.ends - n.started, every = cfg?.every ?? Math.max(5, Math.round(length / (tells.length + 1)));
  // `after`: the first comes that many minutes after the start (0: at once).
  // `lead`: the last one comes that many minutes before the end, the others
  // before it. Neither draws anything. Otherwise the first comes partway through.
  // One that says the task is done comes at its end, in story time (Roy,
  // Oct 13, 313 and 315): `closing` story minutes before it's over.
  // One chosen from the pool when its moment comes closes the task when
  // every one it could be says so.
  const closes = x => (x.ref ? a.pool.some(e => e.ref === x.ref && e.done) : a.pool.length > 0 && a.pool.every(e => e.done));
  let at = cfg?.after != null ? n.started + cfg.after
    : cfg?.lead != null ? n.ends - cfg.lead - every * (tells.length - 1)
    : tells.every(closes) ? n.ends - t.closing
    : n.started + Math.max(1, Math.round(length * (t.firstAt[0] + draw(s, 'tell:at') * (t.firstAt[1] - t.firstAt[0]))));
  for (const x of tells) {
    x.at = Math.max(n.started + 1, closes(x) ? n.ends - t.closing : Math.min(at, n.ends - 1));
    at += every;
  }
  n.tells = tells.sort((x, y) => x.at - y.at);
}

const fits = (s, C, e) => test(s, C, e.when) && !(e.once && s.seen[e.ref] != null);

function choose(s, C, a) {
  const ref = fromBag(s, `tell:${a.id}`, a.pool.map(e => e.ref), r => fits(s, C, a.pool.find(e => e.ref === r)));
  return ref ? a.pool.find(e => e.ref === ref) : null;
}

function tellDue(s, C) {
  const n = s.now, a = act(s, C), t = C.tuning.tell;
  // An event that comes before this activity's description (`beforeTold`)
  // opens in the minute before it, so the description follows it at once.
  if (n.tells.length && n.tells[0].at <= s.minute + 1 && fireEvents(s, C, 'beforeTold', a.id)) return;
  while (n.tells.length && n.tells[0].at <= s.minute) {
    const x = n.tells.shift();
    if (!x.sure && s.minute - s.lastTold < t.minGapMinutes) continue;
    const e = x.ref ? a.pool.find(p => p.ref === x.ref) || { ref: x.ref } : choose(s, C, a);
    if (e) describe(s, C, a, e);
  }
}

// The dweller's hunger in its own voice (Roy, Oct 18, 396: "the new hunger
// descriptions you get", "in italics in the log"). Its lines come one at a
// time in his order, each once while the hunger lasts, waiting for their
// hunger and for the line before; feeding the hole (hunger below the first)
// starts them over. Only after the second dream, awake, with nothing covering
// the screen, a description's gap after the line before, and never in the
// same minute as another description. They change nothing, and leave the
// activity's own descriptions as they were.
function hungerVoice(s, C) {
  const v = C.tuning.hungerVoice, lines = v?.lines;
  if (!lines?.length) return;
  if (s.meters.hunger < lines[0].hunger) { s.voiced = 0; return; }
  const a = act(s, C), l = lines[s.voiced ?? 0];
  if (!l || s.event || a.still || a.asleep || (v.after && s.facts[v.after] == null)) return;
  if (s.meters.hunger < l.hunger) return;
  // A line that isn't for now when its turn comes is passed over ("you know
  // what you have to do", only before the first trip back to the hole).
  if (l.when && !test(s, C, l.when)) { s.voiced = (s.voiced ?? 0) + 1; return; }
  if (s.lastTold === s.minute || s.minute - (s.voicedAt ?? LONG_AGO) < C.tuning.tell.minGapMinutes) return;
  say(s, C, { run: s.now.run, ref: l.ref, ...(l.lead ? { lead: l.lead } : {}), italic: true });
  s.voiced = (s.voiced ?? 0) + 1;
  s.voicedAt = s.minute;
}

// A description. It may change only the five attributes (the loader makes
// sure), and what it changes is never put in words beside it.
// `pain`: the pain mark it's said with, in one line ("pain: ...").
function describe(s, C, a, e, pain) {
  if (s.now.owed && e.done) feel(s, C, a);
  for (const [k, v] of Object.entries(e.effects || {})) {
    if (grant(s, C, k, v, `told:${e.ref}`, e.flow) && a.reveal.includes(k)) reveal(s, k);
  }
  for (const f of e.sets || []) setFact(s, f);
  for (const k of e.reveals || []) reveal(s, k);
  const entry = pain ? { run: s.now.run, ref: pain, with: e.ref } : { run: s.now.run, ref: e.ref };
  if (a.tell?.vars) entry.vars = Object.fromEntries(Object.entries(a.tell.vars).map(([k, key]) => [k, key.startsWith('stock.') ? s.stocks[key.slice(6)] ?? 0 : s.meters[key] ?? 0]));
  say(s, C, entry);
  s.seen[e.ref] = s.minute;
  s.lastTold = s.minute;
}

// ------------------------------------------------------------------ cards

// Money a card would need that you don't have. The card still shows.
export function lockOf(s, C, def) {
  const cost = def.does.activity ? C.activities[def.does.activity].uses.money || 0 : 0;
  return cost > s.meters.money ? { kind: 'money' } : null;
}

const cardKey = id => `card:${id}`;

// Whether a card would be offered, leaving aside what's going on negating it.
function offered(s, C, def) {
  if (def.once && s.counts[cardKey(def.id)]) return false;
  if (def.notToday && s.today.counts[cardKey(def.id)]) return false;
  if ((s.cooldowns[def.id] ?? LONG_AGO) > s.minute) return false;
  if (!test(s, C, def.when)) return false;
  // The mood you're really in holds some cards back (Roy, Oct 18, 392); never a need.
  if (def.purpose !== 'need' && def.marks?.length) {
    const m = trueMood(s, C);
    if (m && m.holds.some(k => def.marks.includes(k))) return false;
  }
  if (def.does.activity) {
    const a = C.activities[def.does.activity];
    if (s.now.id === a.id && !s.now.over) return false;
    // Once it's a habit it happens by itself, and the card stops coming.
    if (a.habit && s.formed[a.id] != null) return false;
    return canStart(s, C, a, { ignoreMoney: true });
  }
  // A thought card waits until Roy has written what it says. So does one that only says its description.
  if (def.does.says) return !!C.text(def.does.says).trim();
  if (def.does.thought) return !!C.text(def.does.thought).trim();
  return C.thoughts.length > 0;
}

// The state as what's going on will leave it: its own results, the ones that
// land at once when it's finished (what you carry inside, stocks, money,
// facts). Nothing is changed; this is only asked about.
function after(s, a) {
  const meters = { ...s.meters }, stocks = { ...s.stocks }, facts = { ...s.facts };
  for (const [k, v] of Object.entries(a.end)) {
    if (k.startsWith('stock.')) stocks[k.slice(6)] = Math.max(0, (stocks[k.slice(6)] ?? 0) + v);
    else if (k === 'money' || !VISIBLE.includes(k)) meters[k] = clamp(k, (meters[k] ?? 0) + v);
  }
  for (const [k, upTo] of Object.entries(a.restock)) stocks[k] = Math.max(stocks[k] ?? 0, upTo);
  for (const f of a.sets) facts[f] ??= s.minute;
  return { ...s, meters, stocks, facts };
}

// Negation (Roy, Oct 12, 278): "when one event negates another event ... the
// negated event disappears right away - when the action is started". What's
// going on negates a card when content says it does (`negates`), or when its
// own results will take the card away. Either way the card goes as the
// action starts, never held through it and removed at its end.
export function negated(s, C, def) {
  const a = act(s, C);
  if (s.now.over || a.idle) return false;
  if (a.negates.includes(def.id)) return true;
  if (!a.results) return false;
  return offered(s, C, def) && !offered(after(s, a), C, def);
}

export const eligible = (s, C, def) => offered(s, C, def) && !negated(s, C, def);

// A card's last chance (Roy, Oct 6: "a choice starts fading eg when you want
// to go to the library but it is getting late"): the first story minute
// within `within` at which it would no longer be offered if only the clock
// moved: its own hours, its activity's hours and place, and the time it
// needs before the next shift. Null if it lasts past that. Only asked about;
// nothing is changed. The screen draws the card fainter as it nears.
export function lastChance(s, C, def, within) {
  const at = minute => eligible({ ...s, minute }, C, def);
  for (let checked = s.minute, end = s.minute + within; checked < end;) {
    const next = Math.min(checked + 5, end);
    if (!at(next)) {
      for (let m = checked + 1; m < next; m++) if (!at(m)) return m;
      return next;
    }
    checked = next;
  }
  return null;
}

// The cards showing: the first four that fit, in rank order, one need at
// most. New choices form while you're free (in leisure too). Once you've
// taken a card they come slowly (`cards.deal`, Roy, Oct 18, 400: "new options
// shouldn't immediately come once a choice is made", "they should come less
// frequently, so you have to choose carefully"): one at a time, after a
// wait in minutes you could choose in that's shorter the fewer cards there
// are (414: "when there are no choices on the screen ... there should be
// seldom only one choice to make", "w 2/3 choices the choices come slower");
// a card marked `atOnce` comes when it can, as a need does (411). Before the first choice
// (`s.deal` null) the opening's are all there at once, at most
// `cards.opening` of them (Roy, Oct 21, 410: no fourth). A busy
// activity holds surviving choices, but cannot keep an expired one around,
// nor one it negates.
function updateCards(s, C) {
  if (s.phase !== 'life') return;
  readMood(s, C);
  preserveNeglectedNeeds(s);
  // A neglected appearance is suppressed only while its normal eligibility
  // persists. It takes no visible slot and imposes no invented cooldown.
  for (const id of Object.keys(s.neglectedNeeds)) {
    if (!C.choices[id] || !eligible(s, C, C.choices[id])) delete s.neglectedNeeds[id];
  }
  if (act(s, C).away) return;
  if (!canChoose(s, C)) {
    s.cards = s.cards.filter(card => !s.neglectedNeeds[card.id] && eligible(s, C, C.choices[card.id]));
    return;
  }
  const deal = s.deal;
  const most = deal ? C.tuning.cards.max : Math.min(C.tuning.cards.max, C.tuning.cards.opening ?? Infinity);
  // The cards there'd be: those showing, and those that come when they do.
  // `dealing`: one more may come, the first in order that's waiting.
  const pick = dealing => {
    const open = [];
    let need = false, errands = 0, dealt = false;
    for (const def of dealOrder(s, C)) {
      if (open.length >= most) break;
      if (s.neglectedNeeds[def.id]) continue;
      if (def.purpose === 'need' && need) continue;
      if (def.purpose === 'errand' && errands >= (C.tuning.cards.errands ?? Infinity)) continue;
      if (!eligible(s, C, def)) continue;
      const showing = s.cards.find(c => c.id === def.id);
      // A card that isn't showing yet comes only when the deal allows, one at
      // a time; it never takes the place of one that's waiting. A need comes
      // when it does (Roy, Oct 18, 400), and so does one marked `atOnce` (411).
      const paced = !showing && def.purpose !== 'need' && !def.atOnce && deal;
      if (paced && (!dealing || dealt)) continue;
      if (paced) dealt = true;
      if (def.purpose === 'need') need = true;
      if (def.purpose === 'errand') errands += 1;
      open.push(showing || {
        id: def.id, since: s.minute, formMinutes: 0, ...(def.purpose === 'need' ? { needMinutes: 0 } : {}),
      });
    }
    return { open, dealt };
  };
  // How long the deal waits depends on how many cards there are (Roy, Oct 21,
  // 414): with none or one the next comes soon, with two or three slowly.
  let { open, dealt } = pick(false);
  if (deal && deal.waited >= dealWait(C, open.length)) ({ open, dealt } = pick(true));
  if (dealt) deal.waited = 0;
  for (const card of open) if (C.choices[card.id].purpose === 'need') reveal(s, C.choices[card.id].attached);
  s.cards = open;
}

// Free story minutes the deal waits, since your last choice or the last card
// it brought, before it brings another, when `showing` cards are there
// (`cards.deal.after`; Roy, Oct 21, 414). With as many as can show, none comes.
export const dealWait = (C, showing) => C.tuning.cards.deal.after[showing] ?? Infinity;

// The cards in the order they're offered: their rank, except that impulses
// (things you might feel like doing) come in a different order each day, a
// seeded shuffle that's the same however often it's asked. With the
// opening's many pastimes (Roy, Oct 18, 388-390) the same four would
// otherwise always take the places. Nothing is drawn from a stream.
export function dealOrder(s, C) {
  const impulses = C.choiceList.filter(d => d.purpose === 'impulse');
  if (impulses.length < 2) return C.choiceList;
  const day = C.cal.dayIndex(s.minute), from = Math.min(...impulses.map(d => d.rank));
  const order = d => (d.purpose === 'impulse' ? from + keyed(s, `deal:${day}:${d.id}`) * 0.999 : d.rank);
  return [...C.choiceList].sort((a, b) => order(a) - order(b));
}

// What you make of your mood (Roy, Oct 18, 393): "as you develop your self
// reflection skill your ability to ascertain mood increases", "at the start
// you get a lot of mood: uncertain". When the true mood changes, a seeded
// draw decides whether you recognize it, likelier the more you've reflected;
// the reading holds until it changes again. A mood of the body is always
// recognized, and so is one being introduced. Nothing is drawn from a stream.
function readMood(s, C) {
  const m = trueMood(s, C), key = m?.key ?? '';
  if (s.mood && s.mood.true === key) return;
  const r = C.tuning.moodReading;
  const introducing = !!m && C.events[s.event?.id]?.moodWord === m.label;
  const chance = Math.min(r.most, r.base + r.perReflection * (s.meters.reflection || 0));
  const known = !m || m.plain || introducing || keyed(s, `recognize:${s.minute}:${key}`) < chance;
  s.mood = { true: key, shown: known ? key : r.unsure.replace(/^label:/, ''), since: s.minute };
}

// Letter formation follows the same available story minutes as a need's
// growth. It changes presentation only: never eligibility, cost or the RNG.
function formCards(s, C) {
  if (!canChoose(s, C)) return;
  const limit = formationLimit(C);
  for (const card of s.cards) {
    const def = C.choices[card.id];
    if (lockOf(s, C, def) || !eligible(s, C, def)) continue;
    card.formMinutes = Math.min(limit, (card.formMinutes ?? 0) + 1);
  }
}

// The stain and its consequence share this story-minute clock. Full coverage
// expires this appearance immediately. Keep its neglectedAt marker outside
// the offered cards so it cannot be taken or offered afresh every tick.
// One completed stain grants one consequence.
function neglect(s, C) {
  if (!canChoose(s, C)) return;
  const rule = C.tuning.cards.neglect;
  for (const card of s.cards) {
    const def = C.choices[card.id];
    if (def.purpose !== 'need' || card.neglectedAt != null || lockOf(s, C, def) || !eligible(s, C, def)) continue;
    card.needMinutes = Math.min(rule.minutes, (card.needMinutes ?? 0) + 1);
    if (card.needMinutes < rule.minutes) continue;
    card.neglectedAt = s.minute;
    (s.neglectedNeeds ??= {})[card.id] = { since: card.since, neglectedAt: card.neglectedAt };
    note(s, 'neglect', def.id);
    if (C.text(rule.description).trim()) say(s, C, { run: s.now.run, ref: rule.description });
    grant(s, C, 'rapture', -rule.rapture, `neglect:${def.id}`, rule.drainMinutes, { curve: rule.curve });
    reveal(s, 'rapture');
  }
  s.cards = s.cards.filter(card => card.neglectedAt == null);
}

// Clicking an attribute's word says its line in the descriptions (Roy, Oct
// 21, 416: "when you click on disquiet / disquiet slowly drains rapture - is
// shown in log, and so on"; `attributeLines` in tuning). Seen at a glance:
// the clock doesn't slow for it (`glance`, provisional). Not again while it's
// the newest line, and not while an event covers the screen.
export function inspect(s, C, attribute) {
  const ref = C.tuning.attributeLines?.[attribute];
  if (s.phase !== 'life' || s.event || !ref || !C.text(ref).trim()) return false;
  if (s.stream.at(-1)?.ref === ref) return false;
  input(s, [s.minute, 'inspect', attribute]);
  say(s, C, { run: s.now.run, ref, glance: true });
  return true;
}

// Thoughts leave interruptible activities running; other activities cut them short.
export function take(s, C, id) {
  if (s.phase !== 'life' || s.event || !canChoose(s, C)) return false;
  const card = s.cards.find(c => c.id === id), def = C.choices[id];
  if (!card || card.neglectedAt != null || s.neglectedNeeds?.[id] || !eligible(s, C, def) || lockOf(s, C, def)) return false;
  input(s, [s.minute, 'take', id]);
  s.cards = s.cards.filter(c => c !== card);
  s.deal = { waited: 0 };
  s.cooldowns[id] = s.minute + (def.cooldown ?? C.tuning.cards.returns);
  s.counts[cardKey(id)] = (s.counts[cardKey(id)] || 0) + 1;
  s.today.counts[cardKey(id)] = (s.today.counts[cardKey(id)] || 0) + 1;
  note(s, 'take', id);
  if (def.does.activity) {
    close(s, C, 'cut');
    start(s, C, def.does.activity, 'you');
    if (def.pain) { const paid = payPain(s, C, `card:${id}`); did(s, 'rapture', paid.rapture); did(s, 'choice', paid.choice); painTold(s, C, C.activities[def.does.activity]); }
    return true;
  }
  // A thought starts nothing: its description goes on the right. So does a
  // card that only `says` something (watching the sunset).
  if (def.pain) { payPain(s, C, `card:${id}`); painTold(s, C); }
  for (const [k, v] of Object.entries(def.does.effects || {})) grant(s, C, k, v, `card:${id}`, def.does.flow);
  for (const f of def.does.sets || []) setFact(s, f);
  const ref = def.does.says ?? def.does.thought ?? fromBag(s, 'thoughts', C.thoughts);
  say(s, C, { run: s.now.run, ref });
  s.seen[ref] = s.minute;
  updateCards(s, C);
  return true;
}

// ----------------------------------------------------------------- events

function eventKey(s, C, e) {
  if (e.trigger?.weekly) return `${e.id}@w${C.cal.weekIndex(s.minute)}`;
  if (e.daily) return `${e.id}@d${C.cal.dayIndex(s.minute)}`;
  if (e.once) return e.id;
  return `${e.id}@${s.minute}`;
}
const available = (s, C, e) => s.done[eventKey(s, C, e)] == null;

// Events checked every story minute: calendar times, weekly events, story
// conditions and time spent in an activity.
function dueEvent(s, C) {
  for (const e of C.eventList) {
    const tr = e.trigger || {};
    if (tr.activityStart || tr.activityEnd || tr.beforeTold || !available(s, C, e)) continue;
    // `at`: not before that day and hour (its `when` says what else it needs).
    if (tr.at && s.minute < C.cal.minuteAt(tr.at.day, tr.at.hour)) continue;
    if (tr.weekly && (C.cal.weekday(s.minute) !== tr.weekly.weekday || C.cal.minuteOfDay(s.minute) < tr.weekly.hour * 60)) continue;
    // A weekly event with something to answer waits until you're free.
    if (tr.weekly && !e.silent && !act(s, C).idle) continue;
    if (tr.activityElapsed && (s.now.id !== tr.activityElapsed.activity || s.minute - s.now.started < tr.activityElapsed.minutes)) continue;
    // An important mood is introduced the first time it's true (Roy, Oct 18, 391).
    if (tr.mood && trueMood(s, C)?.key !== tr.mood) continue;
    if (tr.when && !test(s, C, tr.when)) continue;
    if (!byChance(s, C, e)) continue;
    return e;
  }
  return null;
}

// `chance`: an event that may or may not come (Roy, Oct 15: "RANDOM DREAM").
// It's decided once for each time it could come, each run of the activity its
// trigger watches or otherwise each day, and the answer is the same however
// often it's asked. It draws on no stream, so nothing else is reshuffled.
function byChance(s, C, e) {
  if (e.chance == null) return true;
  const tr = e.trigger || {};
  const watches = tr.activityElapsed || tr.activityStart || tr.activityEnd || tr.beforeTold;
  const unit = watches ? `run${s.now.run}` : `day${C.cal.dayIndex(s.minute)}`;
  return keyed(s, `chance:${e.id}:${unit}`) < e.chance;
}

function fireEvents(s, C, kind, activity) {
  if (s.event) return false;
  for (const e of C.eventList) {
    if (e.trigger?.[kind] !== activity || !available(s, C, e)) continue;
    if (e.trigger.when && !test(s, C, e.trigger.when)) continue;
    if (!byChance(s, C, e)) continue;
    if (startEvent(s, C, e)) return true;
  }
  return false;
}

// An event is recorded once when it begins. Its effects start flowing from
// that minute for two story hours by default. Reading freezes story time;
// advancing pages or reloading never restarts the effect.
function startEvent(s, C, e) {
  const key = eventKey(s, C, e), cause = `event:${e.id}`;
  s.done[key] = s.minute;
  note(s, 'event', e.id);
  for (const [k, v] of Object.entries(e.effects || {})) grant(s, C, k, v, cause, e.flow);
  for (const f of e.sets || []) setFact(s, f);
  if (e.pay) pay(s, e.pay, cause);
  // Introduced, the mood is named truly, whatever you'd have made of it.
  if (e.moodWord) s.mood = { true: e.trigger.mood, shown: e.trigger.mood, since: s.minute };
  if (e.silent) {
    // Nothing is read, so what it would have revealed on its first page shows now.
    for (const attribute of Object.keys(e.reveal || {})) reveal(s, attribute);
    return false;
  }
  const vars = {};
  if (Array.isArray(e.answers) && e.answers.some(a => a.count === 'offering')) vars.offering = offering(s, C);
  s.event = { id: e.id, key, pages: [...e.pages], page: 0, mode: 'pages', then: 'answers', base: true, prompt: null, used: [], at: [], vars, after: null };
  revealForPage(s, C);
  if (!s.event.pages.length) toAnswersOrEnd(s, C);
  else withAnswers(s, C);
  return true;
}

function revealForPage(s, C) {
  const ev = s.event, e = C.events[ev.id];
  if (!ev.base || ev.mode !== 'pages') return;
  for (const [attribute, page] of Object.entries(e.reveal || {})) if (ev.page >= page) reveal(s, attribute);
}

export function readNext(s, C) {
  const ev = s.event;
  if (!ev || ev.mode !== 'pages') return false;
  input(s, [s.minute, 'read']);
  if (ev.base) ev.prompt = ev.pages[ev.page];
  ev.page += 1;
  if (ev.page < ev.pages.length) { revealForPage(s, C); withAnswers(s, C); return true; }
  if (ev.then === 'answers') toAnswersOrEnd(s, C);
  else finishEvent(s, C);
  return true;
}

// Branching (Roy, Oct 13, 327: "there are branching paths"): an answer can
// lead to answers of its own. `at` is the path of answers taken to reach the
// ones on offer now; a save from before it has none, and is at the first.
export const answersAt = (e, at = []) => at.reduce((list, id) => list.find(a => a.id === id)?.answers || [], Array.isArray(e.answers) ? e.answers : []);
export const openAnswers = (s, C) => answersAt(C.events[s.event.id], s.event.at).filter(a => !(a.once && s.event.used.includes(a.id)));

function toAnswersOrEnd(s, C) {
  const ev = s.event;
  if (openAnswers(s, C).length) { ev.mode = 'answers'; ev.pages = []; ev.page = 0; ev.base = false; }
  else finishEvent(s, C);
}

// The line that leads to answers is said with them, never first as an
// intertitle of its own (Roy, Oct 18: "it should go directly from the
// intertitle to this", "that intertitle shows and then the next is just the
// description with choices"). It stays above them as their prompt.
function withAnswers(s, C) {
  const ev = s.event;
  if (ev?.mode !== 'pages' || ev.then !== 'answers' || ev.page !== ev.pages.length - 1 || !openAnswers(s, C).length) return;
  ev.prompt = ev.pages[ev.page];
  toAnswersOrEnd(s, C);
}

export const meets = (s, answer) => !answer.closed && (!answer.requires || Object.entries(answer.requires).every(([k, n]) => (s.meters[k] ?? 0) >= n));

export function answer(s, C, id) {
  const ev = s.event;
  if (!ev || ev.mode !== 'answers') return false;
  const e = C.events[ev.id], a = openAnswers(s, C).find(x => x.id === id);
  if (!a) return false;
  if (!meets(s, a)) {
    // A locked answer can still say why ("need more choice").
    if (!a.locked) return false;
    input(s, [s.minute, 'answer', id]);
    if (a.locked.reveal) reveal(s, a.locked.reveal);
    ev.pages = [...(a.locked.pages || [])]; ev.page = 0; ev.then = 'answers';
    ev.mode = ev.pages.length ? 'pages' : 'answers';
    withAnswers(s, C);
    return true;
  }
  input(s, [s.minute, 'answer', id]);
  ev.used.push(id);
  const cause = `event:${e.id}:${a.id}`;
  if (a.pain) { payPain(s, C, cause); painTold(s, C); }
  for (const [k, v] of Object.entries(a.effects || {})) grant(s, C, k, v, cause, a.flow);
  for (const f of a.sets || []) setFact(s, f);
  if (a.feed) feed(s, C, ev, cause);
  if (a.workDays != null) signUp(s, C, a.workDays);
  if (a.after) ev.after = a.after;
  note(s, 'answer', e.id, a.id);
  const later = a.feed && (s.counts.feedings || 0) > 1 && a.laterPages;
  ev.pages = [...(later ? a.laterPages : a.pages || [])];
  ev.page = 0;
  // A branch: its own answers come after what it says, under its last line.
  // Any other answer ends the event, unless it returns to the ones it was among.
  if (Array.isArray(a.answers)) {
    ev.at = [...(ev.at || []), a.id];
    ev.then = 'answers';
    if (ev.pages.length) ev.prompt = ev.pages[ev.pages.length - 1];
  } else ev.then = a.then === 'answers' ? 'answers' : 'end';
  ev.mode = 'pages';
  if (!ev.pages.length) {
    if (ev.then === 'answers') toAnswersOrEnd(s, C);
    else finishEvent(s, C);
  } else withAnswers(s, C);
  return true;
}

function finishEvent(s, C) {
  const ev = s.event;
  s.event = null;
  if (ev.after && C.text(ev.after).trim()) { say(s, C, { run: s.now.run, ref: ev.after }); s.seen[ev.after] = s.minute; s.lastTold = s.minute; }
  note(s, 'event-end', ev.id);
}

const offering = (s, C) => Math.max(0, Math.min(C.start.offeringMax, Math.ceil(s.meters.hunger / C.start.offeringPerHunger), s.stocks.portions));

function feed(s, C, ev, cause) {
  change(s, 'stock.portions', -(ev.vars.offering || 0), cause);
  // The hunger subsides slowly; it can be a great deal of it.
  grant(s, C, 'hunger', Math.min(0, C.start.holeReliefTo - s.meters.hunger), cause, C.tuning.hole.relief);
  grant(s, C, 'rapture', C.tuning.hole.feedRapture, cause);
  s.counts.feedings = (s.counts.feedings || 0) + 1;
}

// The weekly sign-up: the store picks which of next week's days you work.
function signUp(s, C, days) {
  const today = C.cal.dayIndex(s.minute), weekday = C.cal.weekday(s.minute);
  const open = C.tuning.work.workdays.map(wd => today + (((wd - weekday + 7) % 7) || 7));
  for (let i = 0; i < days && open.length; i++) addCommitment(s, shiftOn(C, open.splice(Math.floor(draw(s, 'work') * open.length), 1)[0]));
}

// Pay for what's been tallied since the last pay (shifts worked).
function pay(s, p, cause) {
  change(s, 'money', (s.tallies[p.tally] || 0) * p.each, cause);
  delete s.tallies[p.tally];
}

// ------------------------------------------------------------------- tick

// One story minute. Returns false when the clock is stopped (the intro, or
// an event waiting to be read).
export function tick(s, C) {
  if (s.phase !== 'life' || s.event) return false;
  s.minute += 1;
  const day = C.cal.dayIndex(s.minute);
  if (day !== s.today.day) s.today = { day, counts: {} };

  flow(s);
  if (s.now.over) next(s, C);          // an event opened as the last one ended
  // Every minute moves what moves by itself, so rapture is never standing still.
  live(s, C);
  tellDue(s, C);
  hungerVoice(s, C);

  if (!s.event) step(s, C);
  if (!s.event) { const e = dueEvent(s, C); if (e) startEvent(s, C, e); }
  updateCards(s, C);
  return true;
}

// What moves by itself each minute, whatever you're doing, and what the
// activity does while it lasts.
function live(s, C) {
  const a = act(s, C), t = C.tuning, R = scaleOf(C);
  if (a.still) return;
  // Rapture moves `raptureScale` of what's written, here as in `grant`.
  const per = (k, perHour) => (perHour / 60) * (k === 'rapture' ? R : 1);
  for (const [k, perHour] of Object.entries(t.drift[a.asleep ? 'asleep' : 'awake'])) if (!k.startsWith('_')) accrue(s, k, per(k, perHour), 'drift');
  for (const [k, perHour] of Object.entries(a.drift)) accrue(s, k, per(k, perHour), `doing:${a.id}`);
  const o = !s.now.over && outcomeOf(s, a);
  if (o) for (const [k, perHour] of Object.entries(o.drift)) accrue(s, k, per(k, perHour), `doing:${a.id}:${o.id}`);
  // Hunger rises by itself, and is never the activity's doing (Roy, Oct 9).
  accrue(s, 'hunger', t.hungerRisePerHour / 60, 'drift');
  // While what it leaves you feeling is still owed (`lingerFrom`), so is
  // what it lifts by the hour: nothing of a meal is felt before it's made.
  // It's held as written; `grant` scales it when it's felt.
  if (s.now.owed) s.now.held = (s.now.held || 0) + a.rate / 60;
  else did(s, 'rapture', accrue(s, 'rapture', per('rapture', a.rate), `doing:${a.id}`));
  accrue(s, 'rapture', -per('rapture', s.meters.disquiet * t.drain.disquietPerHour + s.meters.hunger * t.drain.hungerPerHour), 'drain');
  formCards(s, C);
  neglect(s, C);
  // The deal counts the minutes you could choose in, as a need's stain does:
  // not while what you chose holds the cards, nor while you're away.
  if (s.deal && canChoose(s, C)) s.deal.waited += 1;
}

// Where rapture is going in the coming minute, per story hour, by the way it
// goes (Roy, Oct 19: trickles go up above the number when you gain, down
// below it when you lose, and from right to left for disquiet's pull). The
// same parts `flow` and `live` move, read without changing anything: gains
// and losses are added up apart, never netted. Every value is 0 or more.
export function raptureCurrents(s, C) {
  const out = { gain: 0, loss: 0, disquiet: 0, hunger: 0 };
  const add = perHour => { if (perHour > 0) out.gain += perHour; else if (perHour < 0) out.loss -= perHour; };
  if (s.phase !== 'life') return out;
  for (const f of s.flows) if (f.key === 'rapture') add(flowStep(f).part * 60);
  const a = act(s, C), t = C.tuning, R = scaleOf(C);
  if (a.still) return out;
  // What's written moves rapture `raptureScale` of itself (Oct 21, 413); flows already do.
  add(R * (t.drift[a.asleep ? 'asleep' : 'awake'].rapture ?? 0));
  add(R * (a.drift.rapture ?? 0));
  const o = !s.now.over && outcomeOf(s, a);
  if (o) add(R * (o.drift.rapture ?? 0));
  if (!s.now.owed) add(R * a.rate);
  out.disquiet = R * s.meters.disquiet * t.drain.disquietPerHour;
  out.hunger = R * s.meters.hunger * t.drain.hungerPerHour;
  return out;
}

function step(s, C) {
  const a = act(s, C), n = s.now;
  if (s.meters.rapture <= C.tuning.reset.floor && !a.still) return startReset(s, C);
  const due = dueCommitment(s);
  if (due && n.id !== due.do && !a.still) {
    close(s, C, 'cut');
    return start(s, C, due.do, 'self', { until: due.end, whole: due.end - due.start });
  }
  if (s.minute >= n.ends) {
    if (!a.idle) { finish(s, C); if (!s.event) next(s, C); return; }
    // Idle just goes on; its slow changes are written down now and then.
    flush(s);
    n.ends = s.minute + Number(pick(s, 'minutes:idle', a.minutes));
  }
  if (a.idle) {
    const auto = autopilot(s, C);
    if (auto) { close(s, C, 'cut'); startAuto(s, C, auto); }
  }
}
