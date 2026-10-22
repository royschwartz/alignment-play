// Stable row-major slots. Departing cards may finish in vacant places, but
// never create a fifth visible card or share a place with an incoming card.
export const CARD_SLOTS = 4;
export function allocateCardSlots(existing, incoming) {
  const live = new Set(incoming.slice(0, CARD_SLOTS));
  const slots = Array(CARD_SLOTS).fill(null);
  const valid = e => Number.isInteger(e.slot) && e.slot >= 0 && e.slot < CARD_SLOTS;
  for (const entry of existing) {
    if (valid(entry) && live.has(entry.key) && !entry.leaving && slots[entry.slot] === null) slots[entry.slot] = entry.key;
  }
  for (const entry of existing) {
    if (valid(entry) && !live.has(entry.key) && slots[entry.slot] === null) slots[entry.slot] = entry.key;
  }
  for (const key of live) {
    if (slots.includes(key)) continue;
    let at = slots.indexOf(null);
    if (at < 0) at = slots.findIndex(key => !live.has(key));
    if (at >= 0) slots[at] = key;
  }
  return new Map(slots.flatMap((key, slot) => key === null ? [] : [[key, slot]]));
}
export function placeCard(el, slot) {
  el.dataset.slot = String(slot);
  el.style.setProperty('--column', String(slot % 2));
  el.style.setProperty('--row', String(Math.floor(slot / 2)));
}
