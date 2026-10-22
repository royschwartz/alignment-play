// How faint a card is as its last chance nears (Roy, Oct 6: "a choice starts
// fading eg when you want to go to the library but it is getting late";
// Oct 14: "them receding gives uses a natural indication of how long they
// will last"). It reads story minutes only, so it slows, speeds up and
// freezes with the clock. `recede` is the view's { from, until }, or null.
//
// The shape is Roy's sketch (Oct 14, "make this a curve so the last 8% go by
// pretty fast but it's smooth all the way through"): a quarter of a rounded
// square, level at first and steepening, |x|^n + |y|^n = 1 with n
// `roundness`. Drawn to its very end it would fall straight down, all at once
// at a fast clock, so at `finish` it goes on at the slope it has there, in a
// straight line, to nothing at the last chance. The round part is widened so
// that line lands exactly there; the two meet without a kink.
export function recedeCurve(x, { roundness: n, finish }) {
  if (x <= 0) return 1;
  if (x >= 1) return 0;
  const joint = 1 - finish ** n;             // where the line takes over
  if (x >= joint) return finish * (1 - x) / (1 - joint);
  const width = joint ** ((n - 1) / n);
  return (1 - (x / width) ** n) ** (1 / n);
}

export function recedeOpacity(recede, minute, shape) {
  if (!recede) return 1;
  return recedeCurve((minute - recede.from) / Math.max(1, recede.until - recede.from), shape);
}

// Set on the card; each of its faces multiplies its own opacity by it
// (style.css). Opacity on the 3D card itself would flatten its walls. A card
// at full strength carries nothing, so it's drawn exactly as before.
export function showRecede(el, opacity) {
  const value = opacity.toFixed(3);
  if (el.dataset.recede === value) return;
  el.dataset.recede = value;
  el.classList.toggle('receding', opacity < 1);
  if (opacity < 1) el.style.setProperty('--recede', value);
  else el.style.removeProperty('--recede');
}
