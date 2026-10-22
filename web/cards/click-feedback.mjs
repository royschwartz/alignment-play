// Roy, October 14 (359): Soft tint, exactly as in the click study, with
// “Quick start, gentle finish”. Presentation only; no story-time wait.
export const CLICK_FEEDBACK = Object.freeze({ response: 130, hold: 40, fade: 400, tint: 6 });
export const CLICK_EASING = 'cubic-bezier(0.333333333333, 1, 0.666666666667, 1)';
export const clickEaseOut = t => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;
