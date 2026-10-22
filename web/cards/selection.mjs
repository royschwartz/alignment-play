// Selection is shared by live choices, story answers and the card study.
// Roy, October 14: a stationary soft tint, then a gentle fade of the whole card.
import { CLICK_FEEDBACK, CLICK_EASING } from './click-feedback.mjs';

export function selectCard({ el }) {
  const button = el.querySelector('button');
  el.style.setProperty('--click-response', `${CLICK_FEEDBACK.response}ms`);
  el.style.setProperty('--click-delay', `${CLICK_FEEDBACK.response + CLICK_FEEDBACK.hold}ms`);
  el.style.setProperty('--click-fade', `${CLICK_FEEDBACK.fade}ms`);
  el.style.setProperty('--click-tint', String(CLICK_FEEDBACK.tint / 100));
  el.style.setProperty('--click-easing', CLICK_EASING);
  const faded = new Promise(resolve => {
    const done = event => {
      if (event.target !== el || event.animationName !== 'card-taken') return;
      el.removeEventListener('animationend', done);
      el.removeEventListener('animationcancel', done);
      resolve();
    };
    el.addEventListener('animationend', done);
    el.addEventListener('animationcancel', done);
  });
  button.disabled = true;
  el.classList.add('soft-tint', 'selected', 'taken');
  return faded;
}
