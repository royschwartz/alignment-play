// Roy, Oct 13: the entire screen, including CSS fades, draws at 15 FPS.
// This clock only samples presentation. The simulation keeps its own beat.
export const GAME_FPS = 15;

export function createFrameClock(fps = GAME_FPS) {
  const interval = 1000 / fps;
  let origin = null, slot = -1, elapsed = 0;
  return {
    sample(now, dt = 0) {
      elapsed += Math.max(0, dt);
      origin ??= now;
      const next = Math.floor((now - origin + 1e-6) / interval);
      if (next <= slot) return null;
      slot = next;
      const frame = { now, dt: elapsed };
      elapsed = 0;
      return frame;
    },
    reset(now) { origin = now; slot = -1; elapsed = 0; },
  };
}

// Pausing a Web Animation does not change its CSS animation-play-state.
// Read that declared state separately so activity covers and pause still
// freeze the animations they froze before we took over the browser clock.
function cssPaused(animation, style) {
  if (!animation.animationName || !animation.effect?.target) return false;
  const css = style(animation.effect.target, animation.effect.pseudoElement);
  const names = css.animationName.split(',').map(s => s.trim());
  const states = css.animationPlayState.split(',').map(s => s.trim());
  const index = names.indexOf(animation.animationName);
  return index >= 0 && states[index % states.length] === 'paused';
}

export function createPresentation(root, {
  fps = GAME_FPS,
  now = () => performance.now(),
  style = (el, pseudo) => getComputedStyle(el, pseudo),
  observe = callback => new MutationObserver(callback),
} = {}) {
  const clock = createFrameClock(fps), animations = new Map();
  let queued = [], frames = 0, lastFrame = null;

  function capture(at = now()) {
    // Includes transitions and ::before/::after walls, not just DOM faces.
    const live = new Set(root.getAnimations({ subtree: true }));
    for (const animation of animations.keys()) if (!live.has(animation)) animations.delete(animation);
    for (const animation of live) {
      let state = animations.get(animation);
      if (!state) {
        state = { time: 0, last: at, done: animation.playState === 'finished' };
        animations.set(animation, state);
      }
      if (state.done) continue;
      // Set currentTime as well as pause(): that commits a pending pause
      // immediately, before the compositor can sneak in a smooth frame.
      if (animation.playState !== 'paused' || animation.pending) {
        animation.pause();
        animation.currentTime = state.time;
      }
    }
  }

  function advance(at) {
    for (const [animation, state] of animations) {
      if (state.done) continue;
      const dt = Math.max(0, at - state.last);
      state.last = at;
      if (cssPaused(animation, style)) continue;
      state.time += dt;
      const end = animation.effect.getComputedTiming().endTime;
      if (Number.isFinite(end) && state.time + 1e-6 >= end) {
        // Preserve animationend/transitionend and finished promises, used
        // by selection and entrance cleanup. No elapsed time is stretched.
        animation.finish();
        state.done = true;
      } else animation.currentTime = state.time;
    }
  }

  // Inputs can start a CSS transition between animation frames. Capture it
  // in the mutation microtask, before it gets painted at the display's Hz.
  const observer = observe(() => capture());
  observer.observe(root, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'data-phase'] });
  capture();

  return {
    frame(at, dt, draw) {
      capture(at);
      const frame = clock.sample(at, dt);
      if (!frame) return false;
      advance(at);
      const actions = queued;
      queued = [];
      for (const action of actions) action();
      draw(at, frame.dt);
      capture(at);
      lastFrame = at;
      frames++;
      return true;
    },
    // DOM changes deferred here share the next visual frame, including
    // removals after fade completion and the next intertitle's fade-in.
    defer(action) { queued.push(action); },
    reset(at = now()) {
      clock.reset(at);
      for (const state of animations.values()) state.last = at;
    },
    snapshot() { return { fps, frames, lastFrame, animations: animations.size }; },
    destroy() {
      observer.disconnect();
      for (const [animation, state] of animations) if (!state.done) animation.play();
      animations.clear(); queued = [];
    },
  };
}
