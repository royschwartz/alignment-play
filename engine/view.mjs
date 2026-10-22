// What the screen shows, derived from state. The screen never changes state
// (spec principle 3); it only reads this.
import { VISIBLE, lockOf, meets, eligible, lastChance, openAnswers } from './sim.mjs';
import { act, canChoose, trueMood } from './rules.mjs';

const fill = (text, vars) => (vars && vars.x != null ? text.replace(/\bx\b/, String(vars.x)) : text);

// A line of the descriptions as it reads. A mark said with a description is
// one line, in Roy's form: "pain: you force yourself to wash every last dish".
// A line led by another is said after it, in one line: the dweller's "i'm
// hungry," and what follows (Roy, Oct 18, 396).
export const lineText = (C, e) => (e.with ? `${C.text(e.ref)}: ${fill(C.text(e.with), e.vars)}`
  : e.lead ? `${C.text(e.lead)} ${fill(C.text(e.ref), e.vars)}` : fill(C.text(e.ref), e.vars));

// An attribute as the status bar shows it: rapture rounds up, the rest round.
export const shownValue = (key, value) => (key === 'rapture' ? Math.ceil(value - 1e-9) : Math.round(value));

export function view(s, C) {
  if (s.phase === 'intro') return { phase: 'intro', intro: introView(s, C) };
  const a = act(s, C), t = C.tuning, free = canChoose(s, C);
  // The screen may finish fading an existing expired face, but must never
  // recreate it or count it among the choices that can be taken. Read old
  // inline markers too, so an un-upgraded snapshot cannot expose an old need.
  const neglected = new Map(Object.entries(s.neglectedNeeds ?? {}));
  for (const card of s.cards) if (card.neglectedAt != null) neglected.set(card.id, card);
  const neglectedCards = [...neglected].map(([id, card]) => ({ key: `${id}@${card.since}`, id }));
  const cards = a.away ? [] : s.cards.filter(card => !neglected.has(card.id) && eligible(s, C, C.choices[card.id])).map(card => {
    const def = C.choices[card.id];
    return {
      key: `${card.id}@${card.since}`, id: card.id, purpose: def.purpose, label: C.text(def.label),
      since: card.since, formMinutes: card.formMinutes ?? 0, formation: def.formation === 'slow' ? 'slow' : 'immediate',
      thought: !!(def.does.thought || def.does.thoughts), pain: def.pain || 0, attached: def.attached || '',
      marker: C.text(def.purpose === 'need' ? '' : def.does.thought || def.does.thoughts ? 'label:card-thought' : def.pain ? 'label:card-pain' : ''),
      needProgress: def.purpose === 'need' ? Math.min(1, (card.needMinutes ?? 0) / t.cards.neglect.minutes) : 0,
      // Money is noted on the card once you know about money (Roy, Oct 6).
      money: s.revealed.money != null && def.does.activity ? C.activities[def.does.activity].uses.money || 0 : 0,
      lock: lockOf(s, C, def),
      recede: recedeOf(s, C, card, def),
    };
  });
  const lines = s.stream
    .map(e => ({ key: `line${e.n}`, text: lineText(C, e), italic: !!e.italic }))
    .filter(l => l.text.trim());
  // A mark ("pain") is seen at a glance: the clock doesn't slow for it. Said
  // with a description ("pain: ..."), it's read like one. Nor does it for a
  // line you asked for by clicking an attribute (`glance`, Oct 21, 416).
  const newest = s.stream.findLast(e => !e.glance && (e.ref !== t.cards.painDescription || e.with) && lineText(C, e).trim());
  return {
    phase: 'life',
    minute: s.minute,
    date: C.cal.dateLabel(s.minute),
    // The left of the middle section: where you are, what you're doing, and
    // the mood in parentheses (Roy, Oct 11).
    // Only home is named (Roy, Oct 15, 381); elsewhere the line is blank.
    place: a.still || !C.places[s.place]?.shown ? '' : C.text(`place:${s.place}`),
    activity: C.text(a.label),
    mood: mood(s, C),
    attributes: VISIBLE.map(k => ({
      // `raw` is the number as it really is, between whole numbers: the
      // wheels at the top follow it, so they're always slowly turning.
      id: k, label: C.statLabel(k), revealed: s.revealed[k] != null, value: shownValue(k, s.meters[k]), raw: s.meters[k],
      // The open need attached to it: its stain surrounds this number too.
      ink: cards.filter(c => c.attached === k).map(c => ({ key: c.key, level: 1 })),
    })),
    // The right of the middle section, oldest first: descriptions only.
    // What they change is never written out; the numbers above turn.
    stream: lines,
    cards,
    neglectedCards,
    // Cards show but can't be taken while you're busy; that's implied, never said.
    held: !free,
    locks: [...new Set(cards.filter(c => c.lock).map(c => t.interface.lockReasons[c.lock.kind]))],
    event: eventView(s, C),
    // How many times something has lowered rapture. The count is kept, but nothing
    // on the screen shows it since Roy removed the flash on October 13 (331).
    flash: s.lowered ?? 0,
    // For the pace of the clock only (web/pace.mjs).
    clock: {
      run: s.now.run, idle: free, resting: !!a.idle, remaining: Math.max(0, s.now.ends - s.minute),
      choosable: free ? cards.filter(c => !c.lock).length : 0,
      // Which cards those are, so a new one can be told from one that was there.
      choices: free ? cards.filter(c => !c.lock).map(c => c.key) : [],
      // The newest description and the story minute it was given: it's read
      // for story minutes from then (Roy, Oct 13, 315).
      told: s.streamTotal, lastText: newest ? lineText(C, newest) : '', toldAt: newest?.m ?? null,
    },
  };
}

// Over its last story minutes a card grows fainter, so how faint it is says
// how long it will last (Roy, Oct 14: "them receding gives uses a natural
// indication of how long they will last"). From and until are story minutes.
function recedeOf(s, C, card, def) {
  const r = C.tuning.cards.recede;
  const until = r ? lastChance(s, C, def, r.minutes) : null;
  return until == null ? null : { from: Math.max(card.since, until - r.minutes), until };
}

// Mood words are Roy's ("happy", "content", "troubled", "agitated",
// "uncertain") or plain ones he asked for. What shows is what you make of
// your mood (Roy, Oct 18, 393), which the simulation decides: the true one
// when you recognize it, otherwise "uncertain".
function mood(s, C) {
  if (act(s, C).still) return '';
  const key = s.mood ? s.mood.shown : trueMood(s, C)?.key;
  return key ? C.text(`label:${key}`) : '';
}

function eventView(s, C) {
  const ev = s.event;
  if (!ev) return null;
  // An important mood's introduction ends with its word in bold beneath the
  // last page (Roy, Oct 18, 391, and his screenshot).
  const word = C.events[ev.id]?.moodWord;
  if (ev.mode === 'pages') return {
    key: `${ev.key}:${ev.page}:${ev.pages[ev.page]}`, mode: 'pages', text: C.text(ev.pages[ev.page]),
    italic: !!C.events[ev.id]?.italic?.includes(ev.pages[ev.page]),
    mood: word && ev.page === ev.pages.length - 1 ? C.text(word) : '',
  };
  const reasons = C.tuning.interface.lockReasons;
  const answers = openAnswers(s, C).map(a => {
    const locked = !meets(s, a);
    const missing = Object.entries(a.requires || {}).find(([key, n]) => (s.meters[key] ?? 0) < n)?.[0];
    return {
      id: a.id, label: fill(C.text(a.label), { x: ev.vars.offering }), locked, tappable: !locked || !!a.locked,
      reason: locked && reasons[missing] ? reasons[missing] : '', pain: a.pain || 0,
      marker: a.pain ? C.text('label:card-pain') : '',
    };
  });
  return { key: `${ev.key}:answers:${ev.used.join(',')}`, mode: 'answers', text: ev.prompt ? C.text(ev.prompt) : '',
    italic: !!C.events[ev.id]?.italic?.includes(ev.prompt), answers };
}

function introView(s, C) {
  const at = C.intro.findIndex(n => n.id === s.intro), node = C.intro[at];
  const nextId = node.next ?? C.intro[at + 1]?.id;
  return {
    key: node.id,
    text: node.kind === 'feeding' ? '' : node.text,
    bold: !!node.bold, italic: !!node.italic, title: node.kind === 'title',
    question: !!node.yes,
    yes: C.doc.ui.yes, no: C.doc.ui.no,
    begin: !node.yes && (!nextId || nextId === '@begin') ? C.doc.ui.begin : '',
    skip: C.doc.ui.skip,
  };
}
