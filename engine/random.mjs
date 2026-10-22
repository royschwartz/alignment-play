// Seeded randomness (spec principle 2). Every draw comes from a named stream,
// and each stream keeps its own count, so adding a stream never reshuffles another.

export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function draw(s, stream) {
  const n = s.draws[stream] || 0;
  s.draws[stream] = n + 1;
  return hash32(`${s.seed}:${stream}:${n}`) / 4294967296;
}

// A draw that depends only on its name, never on how many came before: the
// same name always gives the same number. For things that must be the same
// however often they're asked, like an actor's hours on a given day.
export const keyed = (s, key) => hash32(`${s.seed}:${key}`) / 4294967296;

export function pick(s, stream, list) {
  return list[Math.floor(draw(s, stream) * list.length)];
}

// A shuffle-bag: every entry comes up once before any repeats. `ok` filters
// entries that don't fit right now; they stay in the bag for later.
export function fromBag(s, key, ids, ok = () => true) {
  if (!ids.length) return null;
  const live = new Set(ids);
  let bag = (s.bags[key] || []).filter(id => live.has(id));
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!bag.length) bag = shuffle(s, key, ids);
    const at = bag.findIndex(ok);
    if (at >= 0) {
      const [id] = bag.splice(at, 1);
      s.bags[key] = bag;
      s.bagLast[key] = id;
      return id;
    }
    if (bag.length === ids.length) break;
    bag = [];
  }
  s.bags[key] = bag;
  return null;
}

function shuffle(s, key, ids) {
  const bag = [...ids];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(draw(s, `bag:${key}`) * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  // Don't repeat the last entry of the previous round straight away.
  if (bag.length > 1 && bag[0] === s.bagLast[key]) [bag[0], bag[1]] = [bag[1], bag[0]];
  return bag;
}
