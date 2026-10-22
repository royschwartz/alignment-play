// Builds the game's content from Roy's writing plus this version's entries in
// game-opus/content/. Text is always looked up by ID; nothing here writes
// prose. Roy's words come from three places, read as they are now: the live
// manuscript, and his labels and THINK lines in writing/ (where his editor
// saves them).
import { makeCalendar } from './calendar.mjs';
import { CONDITION_KEYS } from './rules.mjs';

export const FILES = ['tuning', 'places', 'activities', 'choices', 'events', 'labels'];
// Descriptions may change only the five attributes (Roy, Oct 6).
export const ATTRIBUTES = ['disquiet', 'rapture', 'hunger', 'money', 'choice'];
export const PURPOSES = ['need', 'errand', 'step', 'impulse'];
export const NEED_ATTRIBUTES = ['disquiet', 'rapture'];
// The categories you can explore (Roy, Oct 13, 317-318): the self and the
// hole, technology and science, specific people, the world, magic and
// spirituality, hard work. A mark on an answer or a card; nothing reads it yet.
export const CATEGORIES = ['self', 'science', 'people', 'world', 'magic', 'work'];
const ANNOTATIONS = ['[remove this]'];
const KIND_RULES = { idle: false, interruptible: false, away: false, asleep: false, inBed: false, still: false };

// Roy, Oct 9: "hunger should not be added near activities at all". Hunger
// rises by itself. Anything here that would add it is reported and loses
// that part.
function addsNoHunger(effects, where, problems) {
  if (!(effects?.hunger > 0)) return effects || {};
  problems.push(`${where}: adds hunger; hunger is never added by an activity or a description`);
  const { hunger, ...rest } = effects;
  return rest;
}

// A description that only restates its activity ("you try to sleep" under
// *trying to sleep*) is skipped (Roy, Oct 7). Copied from game/engine/content.mjs.
const FILLER = new Set(['you', 'your', 'a', 'an', 'the', 'to', 'for', 'while', 'awhile', 'some', 'again', 'just', 'it', 'up']);
const stem = w => w.replace(/(ing|ed|es|s)$/, '').replace(/e$/, '');
const words = text => String(text).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w && !FILLER.has(w)).map(stem);
export function restates(text, names) {
  const own = new Set(names.flatMap(words)), said = words(text);
  return said.length > 0 && said.every(w => own.has(w));
}

const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith('_')));

// Every answer of an event, at any depth, in the order you meet them: an
// answer can lead to answers of its own (Roy, Oct 13, 327). `after` is the
// answer that leads to it, if any, and `depth` how many lead to it.
export function* allAnswers(e) {
  yield* walk(e.answers, null, 0);
  function* walk(list, after, depth) {
    for (const answer of Array.isArray(list) ? list : []) {
      yield { answer, after, depth };
      yield* walk(answer.answers, answer, depth + 1);
    }
  }
}

// doc: the manuscript's document. roy: { labels, thoughts } from writing/.
// data: this version's files, by name (FILES).
export function buildContent(doc, roy, data) {
  const problems = [];
  const tuning = data.tuning;
  const actions = new Map(doc.actions.map(a => [a.id, a]));
  const labels = { ...roy.labels.labels, ...data.labels?.labels };
  const thoughtById = new Map(roy.thoughts.thoughts.map(t => [t.id, t]));
  const intro = new Map(doc.intro.map(n => [n.id, n]));
  const places = Object.fromEntries(Object.entries(clean(data.places.places)).map(([id, p]) => [id, { id, ...p }]));

  // "@storyRules.hungryAt" reads the manuscript, "@action.cook.effects.rapture"
  // one of its actions, "@tuning.x" this version's tuning.
  const lookup = path => {
    const [root, ...rest] = path.slice(1).split('.');
    let value = root === 'tuning' ? tuning : root === 'action' ? actions.get(rest.shift()) : doc[root];
    for (const key of rest) value = value?.[key];
    if (value === undefined) problems.push(`missing value ${path}`);
    return value;
  };
  const resolve = value => {
    if (typeof value === 'string' && value.startsWith('@')) return lookup(value);
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, resolve(v)]));
    return value;
  };

  const raw = ref => {
    if (!ref) return '';
    const at = ref.indexOf(':'), kind = ref.slice(0, at), key = ref.slice(at + 1);
    switch (kind) {
      case 'log': return doc.logs[key];
      case 'message': return doc.messages[key];
      case 'action': return actions.get(key)?.label;
      case 'label': return labels[key];
      case 'thought': return thoughtById.get(key)?.text;
      case 'intro': return intro.get(key)?.text;
      case 'ui': return doc.ui[key];
      case 'stat': return doc.statLabels?.[key];
      case 'place': return places[key]?.name;
      case 'interface': return tuning.interface?.[key];
      case 'text': return key;
      default: return undefined;
    }
  };
  const exists = ref => raw(ref) !== undefined;
  const annotated = ref => ANNOTATIONS.some(mark => (raw(ref) || '').includes(mark));
  const text = ref => (annotated(ref) ? '' : raw(ref) ?? '');

  const sr = doc.storyRules, flow = sr.openingFlow || {};
  const start = {
    disquiet: doc.startingValues.disquiet, money: doc.startingValues.money,
    // No joints (Roy, Oct 15, 375: "replace joints with beer"), so the
    // manuscript's startingJoints isn't a stock any more.
    stocks: { portions: sr.startingPortions, frozen: sr.startingFrozenPortions, leftovers: 0, ...clean(tuning.stocks || {}) },
    shiftStartHour: flow.shiftStartHour, shiftEndHour: flow.shiftEndHour,
    sleepHour: sr.sleepHour, wakeHour: sr.wakeHour, sleepChance: sr.sleepChance,
    hungryAt: sr.hungryAt, holeReliefTo: sr.holeReliefTo, offeringMax: sr.offeringMax, offeringPerHunger: sr.offeringPerHunger,
  };

  // A thought that belongs to a thought card is that card's, so it isn't
  // also one of the stray thoughts thinking brings. With no card that thinks
  // (Roy, Oct 15, 373: "think card will be removed") there are none to bring.
  const carded = new Set(data.choices.choices.map(c => c.does?.thought).filter(Boolean));
  const thinks = data.choices.choices.some(c => c.does?.thoughts);
  const thoughts = !thinks ? [] : [...thoughtById.values()].map(t => `thought:${t.id}`).filter(ref => !carded.has(ref) && text(ref).trim());

  // ----------------------------------------------------------- activities
  const kinds = clean(data.activities.kinds), activities = {};
  for (const def of data.activities.activities) {
    const action = def.action ? actions.get(def.action) : null;
    if (def.action && !action) problems.push(`activity ${def.id}: no manuscript action ${def.action}`);
    const kind = def.kind ?? 'task';
    if (!kinds[kind]) problems.push(`activity ${def.id}: unknown kind ${kind}`);
    const a = {
      rate: 0, drift: {}, uses: {}, during: {}, linger: {}, lingerFrom: null, end: {}, restock: {}, requires: null, sets: [], negates: [], then: [], hours: [0, 24], habit: null, tally: null, tell: null,
      ...KIND_RULES, ...clean(kinds[kind]), ...resolve(def), kind,
    };
    a.label = def.label ?? '';
    a.minutes = resolve(def.minutes) ?? action?.durations ?? (action?.minutes ? [action.minutes] : [30]);
    // Which attributes its change shows for the first time (the manuscript's).
    a.reveal = (action?.reveal || []).filter(k => ATTRIBUTES.includes(k));
    a.end = addsNoHunger(a.end, `activity ${a.id}`, problems);
    a.linger = addsNoHunger(a.linger, `activity ${a.id}`, problems);
    for (const k of Object.keys(a.linger)) if (!ATTRIBUTES.includes(k)) problems.push(`activity ${a.id}: only attributes can linger, not ${k}`);
    a.during = addsNoHunger(a.during, `activity ${a.id}`, problems);
    for (const k of Object.keys(a.during)) if (!ATTRIBUTES.includes(k)) problems.push(`activity ${a.id}: only the five attributes can change "during" it, not ${k}`);
    if (a.flow != null && typeof a.flow !== 'number' && typeof tuning.flow[a.flow] !== 'number') problems.push(`activity ${a.id}: unknown flow "${a.flow}"`);
    a.drift = addsNoHunger(a.drift, `activity ${a.id}`, problems);
    if (a.place != null && !places[a.place]) problems.push(`activity ${a.id}: unknown place ${a.place}`);
    // Whether finishing it changes anything a card could depend on (negation).
    a.results = Object.keys(a.end).length + Object.keys(a.restock).length + a.sets.length > 0;
    a.pool = buildPool(a, action);
    a.outcomes = buildOutcomes(a);
    // What it leaves you feeling begins as it starts, or with the description at its end.
    if (a.lingerFrom != null && !(a.lingerFrom === 'done' && a.pool.some(e => e.done))) problems.push(`activity ${a.id}: lingerFrom is "done", and needs a description marked done`);
    a.first = a.tell?.from === 'outcomes' && action?.firstLog ? `log:${action.firstLog}` : null;
    if (a.first && !text(a.first).trim()) a.first = null;
    activities[a.id] = a;
  }

  // Random outcomes with no words (Roy, Oct 18, 388: "events may have random
  // outcomes (you can see that with tv, sometimes it helps sometimes it
  // hurts)", "there should be no descriptions here"). One is picked as the
  // activity starts; it can change how long it takes (`minutes`), what's felt
  // (`linger`, with its own `flow`), what moves inside while it lasts
  // (`drift`), what happens at its end (`end`) and the facts it sets (`sets`).
  // `weight` is how likely it is; `first` is the one the first time.
  function buildOutcomes(a) {
    const list = (a.outcomes || []).map(o => ({ weight: 1, linger: {}, drift: {}, end: {}, sets: [], ...o }));
    for (const o of list) {
      const where = `activity ${a.id}: outcome ${o.id}`;
      if (!o.id) problems.push(`activity ${a.id}: an outcome has no id`);
      o.linger = addsNoHunger(o.linger, where, problems);
      o.drift = addsNoHunger(o.drift, where, problems);
      o.end = addsNoHunger(o.end, where, problems);
      for (const k of Object.keys(o.linger)) if (!ATTRIBUTES.includes(k)) problems.push(`${where}: only attributes can linger, not ${k}`);
      if (!(o.weight > 0)) problems.push(`${where}: its weight is more than nothing`);
      if (o.minutes != null && !(Array.isArray(o.minutes) && o.minutes.every(m => m > 0))) problems.push(`${where}: minutes is a list of lengths`);
      if (o.flow != null && typeof o.flow !== 'number' && typeof tuning.flow[o.flow] !== 'number') problems.push(`${where}: unknown flow "${o.flow}"`);
    }
    if (list.length && a.tell?.outcome) problems.push(`activity ${a.id}: its outcomes are told from the manuscript, so it can't have wordless ones too`);
    if (list.filter(o => o.first).length > 1) problems.push(`activity ${a.id}: only one outcome can be the first time's`);
    return list;
  }

  function buildPool(a, action) {
    const d = a.tell;
    if (!d) return [];
    const entries = [];
    if (d.from === 'outcomes') {
      for (const o of action?.outcomes || []) {
        if (o.enabled === false || !o.log) continue;
        entries.push({ ref: `log:${o.log}`, effects: { ...(o.effects || {}) }, minutes: o.minutes || null, sets: o.message ? [o.message] : [] });
      }
    }
    if (d.from === 'log' && action?.log) entries.push({ ref: `log:${action.log}` });
    for (const r of d.refs || []) entries.push(typeof r === 'string' ? { ref: r } : { ...r });
    const kept = [];
    for (const e of entries) {
      Object.assign(e, d.tags?.[e.ref] || {});
      if (!exists(e.ref)) { problems.push(`activity ${a.id}: missing text ${e.ref}`); continue; }
      if (annotated(e.ref)) { problems.push(`activity ${a.id}: skipped ${e.ref}, marked "${raw(e.ref)}"`); continue; }
      // Empty or deleted text stays empty: nothing to tell, and never regenerated.
      if (!text(e.ref).trim()) continue;
      // Roy's generic lines (Oct 12, 276) are his to restate with: "you eat leftovers".
      if (!e.generic && restates(text(e.ref), [text(a.label), action?.label || ''])) { problems.push(`activity ${a.id}: skipped ${e.ref}, it restates the activity`); continue; }
      e.effects = Object.fromEntries(Object.entries(addsNoHunger(e.effects, `activity ${a.id}: ${e.ref}`, problems)).filter(([k, v]) => {
        if (ATTRIBUTES.includes(k)) return v;
        problems.push(`activity ${a.id}: ${e.ref} changes ${k}; descriptions may change only the five attributes`);
        return false;
      }));
      for (const k of e.reveals || []) if (!ATTRIBUTES.includes(k)) problems.push(`activity ${a.id}: ${e.ref} reveals ${k}, which isn't one of the five attributes`);
      kept.push(e);
    }
    return kept;
  }

  // --------------------------------------------------------------- events
  const events = {};
  for (const def of data.events.events) {
    const e = resolve(def);
    e.pages = e.pages || [];
    // Pages Roy wrote in italics (Oct 18, 395: the second dream's "i am hungry").
    e.italic = e.italic || [];
    // The weekly sign-up has no writing yet: its answers are the numbers of days.
    if (e.answers === 'workDays') e.answers = [0, 1, 2, 3, 4, 5].map(n => ({ id: String(n), label: `text:${n}`, workDays: n }));
    events[e.id] = e;
  }

  // ---------------------------------------------------------------- moods
  // The moods, in rank order: the first whose `when` fits is the true mood
  // (rules.mjs). `holds`: marks of the cards that don't come while you're in
  // it (Roy, Oct 18, 392: "when you're agitated you may get choices like
  // violent activities , and not relaxed contemplative one"). `plain`: a
  // mood of the body, always recognized (393). `introduce`: an important
  // mood's pages, read once, the first time it's true; the last page shows
  // its word in bold beneath (391). Its event is made here.
  const moods = (tuning.moods || []).filter(m => m.label).map((m, rank) => ({
    holds: [], plain: false, introduce: [], ...resolve(m), key: m.label.replace(/^label:/, ''), rank,
  }));
  for (const m of moods) if (m.introduce.length) {
    const id = `mood-${m.key}`;
    if (events[id]) problems.push(`mood ${m.key}: an event is already called ${id}`);
    events[id] = { id, once: true, trigger: { mood: m.key }, pages: m.introduce, moodWord: m.label };
  }

  // ---------------------------------------------------------------- cards
  const choices = {};
  data.choices.choices.forEach((def, rank) => {
    const d = choices[def.id] = { pain: 0, when: null, ...resolve(def), rank };
    if (d.purpose === 'need' && !NEED_ATTRIBUTES.includes(d.attached)) {
      problems.push(`card ${d.id}: a need is attached to disquiet or rapture, not ${d.attached ?? 'nothing'}`);
      d.attached = 'rapture';
    }
    if (d.does?.effects) d.does = { ...d.does, effects: addsNoHunger(d.does.effects, `card ${d.id}`, problems) };
  });

  const C = {
    doc, tuning, start, problems, text, raw, exists,
    cal: makeCalendar(tuning.start),
    intro: doc.intro, places, thoughts,
    activities, activityList: Object.values(activities),
    events, eventList: Object.values(events), moods,
    choices, choiceList: Object.values(choices),
    statLabel: key => doc.statLabels?.[key] || key,
  };
  validate(C, problems);
  return C;
}

// Report anything that can't work.
function validate(C, problems) {
  const neglect = C.tuning.cards.neglect;
  if (!(neglect.minutes > 0 && neglect.drainMinutes > 0 && neglect.rapture >= 0)) problems.push('need neglect: invalid timing or rapture loss');
  const deal = C.tuning.cards.deal;
  if (!deal?.after || ![...Array(C.tuning.cards.max).keys()].every(n => deal.after[n] >= 0)) problems.push(`cards.deal: after needs a number of story minutes for 0 to ${C.tuning.cards.max - 1} cards showing`);
  if (!C.exists(neglect.description)) problems.push(`need neglect: missing text ${neglect.description}`);
  const facts = new Set();
  for (const e of C.eventList) {
    (e.sets || []).forEach(f => facts.add(f));
    for (const { answer } of allAnswers(e)) (answer.sets || []).forEach(f => facts.add(f));
  }
  for (const a of C.activityList) {
    a.sets.forEach(f => facts.add(f));
    for (const p of a.pool) (p.sets || []).forEach(f => facts.add(f));
  }
  for (const d of C.choiceList) (d.does?.sets || []).forEach(f => facts.add(f));

  const check = (where, cond) => {
    if (!cond || typeof cond !== 'object') return;
    for (const [k, v] of Object.entries(cond)) {
      if (!CONDITION_KEYS.includes(k)) problems.push(`${where}: unknown condition "${k}"`);
      else if (k === 'any') v.forEach(c => check(where, c));
      else if (k === 'facts') { for (const f of v) if (!facts.has(f)) problems.push(`${where} needs "${f}", which nothing sets`); }
      else if (k === 'doing' || k === 'notDoing') { for (const id of v) if (!C.activities[id]) problems.push(`${where}: no activity ${id}`); }
      else if ((k === 'open' || k === 'personAt' || k === 'place') && !C.places[v]) problems.push(`${where}: no place ${v}`);
      else if (k === 'house' && !['dirty', 'clean'].includes(v)) problems.push(`${where}: the house is "dirty" or "clean"`);
      else if (k === 'stat') { for (const m of Object.keys(v)) if (C.tuning.meters[m] == null && !ATTRIBUTES.includes(m)) problems.push(`${where}: no "${m}" to measure`); }
    }
  };

  const marks = (where, categories) => {
    if (categories === undefined) return;
    if (!Array.isArray(categories) || !categories.length) problems.push(`${where}: categories is a list of at least one`);
    else for (const c of categories) if (!CATEGORIES.includes(c)) problems.push(`${where}: no category ${c}`);
  };

  for (const a of C.activityList) {
    // Idle is implied: its line is blank (Roy, Oct 12).
    if (!a.still && !a.idle && !C.text(a.label)) problems.push(`activity ${a.id} has no label`);
    check(`activity ${a.id}`, a.requires);
    check(`activity ${a.id} habit`, a.habit?.when);
    for (const e of a.pool) check(`activity ${a.id} ${e.ref}`, e.when);
    for (const step of a.then) {
      if (!C.activities[step.do]) problems.push(`activity ${a.id}: no activity ${step.do} to follow it`);
      check(`activity ${a.id} then`, step.when);
    }
    for (const k of Object.keys(a.uses)) if (k !== 'money' && C.start.stocks[k] == null) problems.push(`activity ${a.id}: uses ${k}, which isn't a stock`);
    for (const id of a.negates) {
      if (!C.choices[id]) problems.push(`activity ${a.id}: negates ${id}, which isn't a card`);
      else if (C.choices[id].does?.activity === a.id) problems.push(`activity ${a.id}: negates its own card`);
    }
    if (a.negates.length && a.idle) problems.push(`activity ${a.id}: being idle negates nothing`);
  }
  if (!C.activities.idle?.idle) problems.push('there must be an idle activity called "idle"');
  for (const id of ['sleep', 'try-sleep', 'wake', 'reset', C.tuning.work.activity]) if (!C.activities[id]) problems.push(`no activity ${id}`);

  for (const e of C.eventList) {
    check(`event ${e.id}`, e.trigger?.when);
    for (const ref of e.pages) if (!C.exists(ref)) problems.push(`event ${e.id}: missing page ${ref}`);
    // A save names an answer by its id alone, so no two in an event share one.
    const ids = new Set();
    for (const { answer: ans } of allAnswers(e)) {
      if (ids.has(ans.id)) problems.push(`event ${e.id}: two answers are called ${ans.id}`);
      ids.add(ans.id);
      if (!C.text(ans.label)) problems.push(`event ${e.id}: answer ${ans.id} has no label`);
      for (const ref of [...(ans.pages || []), ...(ans.laterPages || []), ...(ans.locked?.pages || []), ...(ans.after ? [ans.after] : [])]) {
        if (!C.exists(ref)) problems.push(`event ${e.id}: missing text ${ref}`);
      }
      if ((ans.pain || 0) > 1) problems.push(`event ${e.id}: answer ${ans.id} has pain ${ans.pain}; pain has no levels`);
      if (ans.answers !== undefined) {
        if (!Array.isArray(ans.answers) || !ans.answers.length) problems.push(`event ${e.id}: answer ${ans.id} leads to no answers`);
        if (ans.then === 'answers') problems.push(`event ${e.id}: answer ${ans.id} leads to its own answers, so it can't also return to the ones it was among`);
        if (ans.closed) problems.push(`event ${e.id}: answer ${ans.id} is closed, so nothing can come after it`);
      }
      marks(`event ${e.id}: answer ${ans.id}`, ans.categories);
    }
    for (const k of ['activityStart', 'activityEnd', 'beforeTold']) if (e.trigger?.[k] && !C.activities[e.trigger[k]]) problems.push(`event ${e.id}: no activity ${e.trigger[k]}`);
    if (!e.silent && !e.pages.length && !e.answers) problems.push(`event ${e.id} has nothing to show`);
    const shown = new Set([...e.pages, ...[...allAnswers(e)].flatMap(({ answer: ans }) => [...(ans.pages || []), ...(ans.laterPages || []), ...(ans.locked?.pages || [])])]);
    for (const ref of e.italic || []) if (!shown.has(ref)) problems.push(`event ${e.id}: ${ref} is in italics but isn't one of its pages`);
    if (e.chance != null && !(e.chance > 0 && e.chance <= 1)) problems.push(`event ${e.id}: a chance is more than nothing and at most 1`);
  }

  // The dweller's hunger in its own voice (Roy, Oct 18, 396): its lines are
  // his, in order of the hunger they wait for.
  const voice = C.tuning.hungerVoice;
  if (voice) {
    if (voice.after && !facts.has(voice.after)) problems.push(`the hunger voice waits for "${voice.after}", which nothing sets`);
    let last = -Infinity;
    (voice.lines || []).forEach((l, i) => {
      for (const ref of [l.ref, l.lead].filter(Boolean)) if (!C.exists(ref)) problems.push(`hunger voice line ${i + 1}: missing text ${ref}`);
      if (!(l.hunger >= last)) problems.push(`hunger voice line ${i + 1}: it waits for less hunger than the line before it`);
      last = l.hunger;
      check(`hunger voice line ${i + 1}`, l.when);
    });
  }

  // A description said with the pain needs a pain card to press.
  for (const a of Object.values(C.activities)) {
    if (a.tell?.withPain && !C.choiceList.some(d => d.does?.activity === a.id && d.pain)) problems.push(`activity ${a.id}: its description is said with the pain, and no pain card starts it`);
  }

  for (const d of C.choiceList) {
    if (!PURPOSES.includes(d.purpose)) problems.push(`card ${d.id}: unknown purpose ${d.purpose}`);
    if (!C.text(d.label)) problems.push(`card ${d.id} has no label`);
    if (d.pain > 1) problems.push(`card ${d.id}: pain ${d.pain}; pain has no levels`);
    // Roy, Oct 7: "pain cards cannot be need cards".
    if (d.purpose === 'need' && d.pain) problems.push(`card ${d.id}: a need can't be a pain card`);
    if (d.purpose !== 'need' && d.attached != null) problems.push(`card ${d.id}: only a need is attached to an attribute`);
    check(`card ${d.id}`, d.when);
    marks(`card ${d.id}`, d.categories);
    if (d.does?.activity) { if (!C.activities[d.does.activity]) problems.push(`card ${d.id}: no activity ${d.does.activity}`); }
    else if (d.does?.thought) {
      if (!C.exists(d.does.thought)) problems.push(`card ${d.id}: no text ${d.does.thought}`);
      else if (!C.text(d.does.thought).trim()) problems.push(`card ${d.id}: waits for Roy's writing (${d.does.thought} is empty), so it doesn't form yet`);
      for (const k of Object.keys(d.does.effects || {})) if (!ATTRIBUTES.includes(k)) problems.push(`card ${d.id}: a thought may change only the five attributes, not ${k}`);
    } else if (d.does?.says) {
      // It only says its description, at once (watching the sunset).
      if (!C.exists(d.does.says)) problems.push(`card ${d.id}: no text ${d.does.says}`);
      else if (!C.text(d.does.says).trim()) problems.push(`card ${d.id}: waits for Roy's writing (${d.does.says} is empty), so it doesn't form yet`);
    } else if (!d.does?.thoughts) problems.push(`card ${d.id} does nothing`);
  }

  const known = C.tuning.marks || [];
  for (const m of C.moods) {
    if (!C.text(m.label)) problems.push(`mood ${m.label} has no word`);
    check(`mood ${m.label}`, m.when);
    // The true mood is worked out from what's inside, never from itself.
    if (JSON.stringify(m.when || {}).includes('"mood"')) problems.push(`mood ${m.key}: a mood can't depend on the mood`);
    for (const k of m.holds) if (!known.includes(k)) problems.push(`mood ${m.key}: holds back "${k}", which isn't one of the marks`);
    for (const ref of m.introduce) if (!C.exists(ref) || !C.text(ref).trim()) problems.push(`mood ${m.key}: its introduction has no text at ${ref}`);
  }
  const reading = C.tuning.moodReading;
  if (!reading || !C.text(reading.unsure)) problems.push('moods: the word for a mood you can\'t name is missing');
  for (const d of C.choiceList) {
    for (const k of d.marks || []) if (!known.includes(k)) problems.push(`card ${d.id}: marked "${k}", which isn't one of the marks`);
    if (d.purpose === 'need' && (d.marks || []).length) problems.push(`card ${d.id}: a need is never held back, so it has no marks`);
    for (const key of d.when?.mood || []) if (!C.moods.some(m => m.key === key)) problems.push(`card ${d.id}: asks for the mood "${key}", which isn't one`);
  }
  for (const [id, p] of Object.entries(C.places)) if (typeof p.name !== 'string') problems.push(`place ${id} has no name (use "" for none)`);
}
