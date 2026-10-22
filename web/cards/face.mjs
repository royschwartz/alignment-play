// Roy, Oct 13 (311): pain choice cards grow fixed, rotating wall blades.
// Thought markers and story answers retain their existing presentation.
import { createNeedSpread } from './need-spread.mjs';
import { createPainWave } from './pain-wave.mjs';
import { createPainBlades } from './pain-blades.mjs';

function markedLabel(label, card, classic) {
  if (!classic && card.marker) {
    const marker = document.createElement('span');
    marker.className = 'card-marker';
    marker.textContent = card.marker;
    label.append(marker, document.createTextNode(' '));
  }
  label.append(document.createTextNode(card.label));
}

export function cardFace(button, card, { classic = false } = {}) {
  const label = document.createElement('span');
  label.className = 'label';
  if (card.thought && classic) {
    const word = document.createElement('span');
    word.className = 'thought-word';
    word.textContent = card.thought;
    const topic = document.createElement('span');
    topic.className = 'topic';
    topic.textContent = card.label;
    label.append(word, topic);
  } else markedLabel(label, card.pain && !card.thought && !classic ? { ...card, marker: '' } : card, classic);
  button.append(label);
  if (card.money) {
    const money = document.createElement('span');
    money.className = 'money';
    money.textContent = `-$${card.money}`;
    button.append(money);
  }
  const kinds = [card.pain ? 'pain' : '', card.thought ? 'thought' : ''].filter(Boolean).join(', ');
  if (kinds) button.setAttribute('aria-description', kinds);
}

// The whole card: a fixed footprint and its accessible text button.
export function cardElement(card, { classic = false, waveSettings = null, bladeAge = 0, bladesGrown = bladeAge > 0 } = {}) {
  const el = document.createElement('div');
  el.className = ['choice', card.purpose, card.pain ? 'pain' : '', card.thought ? 'thought' : ''].filter(Boolean).join(' ');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button';
  cardFace(button, card, { classic });
  el.append(button);
  if (classic) { el.classList.add('classic'); return { el, button, symbol: null, ink: null, wave: null, blades: null }; }
  el.classList.add('raised-card');
  const ink = card.purpose === 'need' ? createNeedSpread(button) : null;
  // The old wave remains available only when an earlier study requests it.
  const wave = card.pain && waveSettings ? createPainWave(el, button, { settings: waveSettings }) : null;
  const blades = card.pain && !wave ? createPainBlades(el, button, { pain: card.pain, initialMinutes: bladeAge, grown: bladesGrown }) : null;
  return { el, button, symbol: null, ink, wave, blades };
}

// Story answers use the same text-only pain marker.
//   answer: { label, pain, locked }
export function answerElement(answer, { classic = false } = {}) {
  const el = document.createElement('span');
  el.className = 'answer';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button${answer.locked ? ' locked' : ''}${answer.pain ? ' pain' : ''}`;
  const label = document.createElement('span');
  label.className = 'label';
  markedLabel(label, answer, classic);
  button.append(label);
  if (answer.pain) button.setAttribute('aria-description', 'pain');
  el.append(button);
  if (!classic) el.classList.add('raised-card');
  return { el, button, symbol: null };
}
