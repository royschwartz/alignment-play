// Roy's selected dreamlike card edge, October 12, 2026. The original study
// derived this visual from a generated sound. Preserve its deterministic
// texture without playback or a dependency on the studies. It is made once
// on first use, shared by all cards, and sampled for successive visual shapes.

export const WAVE_DEFAULTS = Object.freeze({
  kind: 'rough', bars: 32, amp: 6, unit: 1, step: 640, rough: 0.15,
  jagged: 0.5, transition: 0.16,
  gap: 0, lines: false, sides: 'all', seed: 1, inset: 12,
  wave: 11, travel: 1,
});

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function randomFrom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Preserve the chosen study's seed-17 texture exactly. These numbers are
// visual data only: no playback, browser audio objects, or encoded media.
function createVisualTexture() {
  const sampleRate = 44100, duration = 16, seed = 17;
  const length = Math.max(1, Math.round(sampleRate * duration));
  const samples = new Float32Array(length);
  const dry = new Float32Array(length);
  const random = randomFrom(seed);
  const between = (a, b) => a + (b - a) * random();
  const follow = seconds => 1 - Math.exp(-1 / (seconds * sampleRate));
  const pitchFollow = follow(0.09), breathFollow = follow(0.055);
  const lowFollow = 1 - Math.exp(-TAU * 870 / sampleRate);
  const noiseFollow = 1 - Math.exp(-TAU * 620 / sampleRate);
  const dcLeak = Math.exp(-TAU * 14 / sampleRate);
  let nextBreath = 0, nextFlicker = 0, breathTarget = 0.4, breath = 0;
  let pitchTarget = 80, pitch = 80, tremble = 5.5, tremblePhase = 0, flutterPhase = 0, grainPhase = 0;
  let phase = 0, cloudPhase = 1.8, nearPhase = 4.2, ringPhase = 0;
  let noise = 0, low = 0, previous = 0, high = 0;
  let flickerStart = -1, flickerEnd = -1, flickerPhase = 0, flickerHz = 590;
  let nextGap = sampleRate * between(1.4, 2.9), gapStart = -1, gapEnd = -1;
  let peak = 0;

  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;
    if (i >= nextBreath) {
      // Holds of unequal length, with occasional quiet breaths rather than
      // a repeating beat or a constant wall of sound.
      breathTarget = i === 0 ? 0.62 : random() < 0.2 ? between(0.025, 0.13) : between(0.3, 0.88);
      pitchTarget = between(64, 94);
      tremble = between(3.7, 8.8);
      nextBreath = i + Math.round(sampleRate * between(0.31, 1.37));
    }
    if (i >= nextGap) {
      gapStart = i;
      gapEnd = i + Math.round(sampleRate * between(0.09, 0.24));
      nextGap = gapEnd + Math.round(sampleRate * between(1.1, 3.3));
    }
    if (i >= nextFlicker) {
      flickerStart = i;
      flickerEnd = i + Math.round(sampleRate * between(0.035, 0.085));
      flickerHz = between(390, 810);
      nextFlicker = flickerEnd + Math.round(sampleRate * between(0.16, 0.77));
    }
    pitch += (pitchTarget - pitch) * pitchFollow;
    breath += (breathTarget - breath) * breathFollow;
    const drift = 1 + 0.014 * Math.sin(TAU * 0.19 * time)
      + 0.008 * Math.sin(TAU * 0.317 * time + 0.9);
    const hz = pitch * drift;
    phase = (phase + TAU * hz / sampleRate) % TAU;
    cloudPhase = (cloudPhase + TAU * (hz * 2.381 + 1.9 * Math.sin(time * 0.7)) / sampleRate) % TAU;
    nearPhase = (nearPhase + TAU * (hz * 2.381 + 6.7 + 2.6 * Math.sin(time * 1.13)) / sampleRate) % TAU;
    ringPhase = (ringPhase + TAU * (31.7 + 3.2 * Math.sin(time * 0.29)) / sampleRate) % TAU;
    tremblePhase = (tremblePhase + TAU * tremble / sampleRate) % TAU;
    flutterPhase = (flutterPhase + (TAU * tremble * 0.613 + 0.37) / sampleRate) % TAU;
    grainPhase = (grainPhase + TAU * tremble * 1.37 / sampleRate) % TAU;
    const flutter = 0.76 + 0.14 * Math.sin(tremblePhase)
      + 0.1 * Math.sin(flutterPhase);
    const body = 0.52 * Math.sin(phase + 0.24 * Math.sin(ringPhase))
      + 0.16 * Math.sin(phase * 2 + 0.4 * Math.sin(cloudPhase));
    const cloud = 0.22 * Math.sin(cloudPhase) + 0.18 * Math.sin(nearPhase);
    const electric = 0.11 * Math.sin(cloudPhase) * Math.sin(ringPhase);
    noise += ((random() * 2 - 1) - noise) * noiseFollow;
    let flicker = 0;
    if (i < flickerEnd) {
      const age = (i - flickerStart) / (flickerEnd - flickerStart);
      flickerPhase = (flickerPhase + TAU * flickerHz / sampleRate) % TAU;
      flicker = Math.sin(Math.PI * age) ** 2
        * (0.08 * Math.sin(flickerPhase + 0.3 * Math.sin(ringPhase)) + 0.035 * noise);
    }
    let gap = 1;
    if (i >= gapStart && i < gapEnd) {
      const age = (i - gapStart) / (gapEnd - gapStart);
      gap = 1 - 0.92 * Math.sin(Math.PI * age) ** 2;
    }
    const grain = noise * 0.045 * (0.5 + 0.5 * Math.sin(grainPhase)) ** 4;
    const raw = ((body + cloud + electric + grain) * breath * flutter + flicker * breath) * gap;
    low += (Math.tanh(raw * 1.18) - low) * lowFollow;
    // Remove subsonic/DC content before the echoes, preserving the low body.
    high = low - previous + dcLeak * high;
    previous = low;
    dry[i] = high;
  }

  const delays = [0.283, 0.619, 0.947].map(seconds => Math.round(seconds * sampleRate));
  const echoGain = [0.22, -0.14, 0.095];
  const echoState = [0, 0, 0];
  const echoFollow = [540, 370, 250].map(hz => 1 - Math.exp(-TAU * hz / sampleRate));
  const edgeSeconds = Math.min(0.085, length / sampleRate / 2);
  for (let i = 0; i < length; i++) {
    let value = dry[i];
    for (let tap = 0; tap < delays.length; tap++) {
      const past = i >= delays[tap] ? dry[i - delays[tap]] : 0;
      echoState[tap] += (past - echoState[tap]) * echoFollow[tap];
      value += echoState[tap] * echoGain[tap];
    }
    // Both loop ends meet at zero, with zero envelope slope.
    const edge = Math.min(1, i / sampleRate / edgeSeconds, (length - 1 - i) / sampleRate / edgeSeconds);
    value *= 0.5 - 0.5 * Math.cos(Math.PI * edge);
    samples[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  const gain = peak ? 0.78 / peak : 0;
  for (let i = 0; i < length; i++) samples[i] *= gain;
  samples[0] = samples[length - 1] = 0;
  return { samples, sampleRate, duration: length / sampleRate };
}

// Short waveform bins, not frequency bins. A fixed lower normalization bound
// preserves quieter passages; the floor and curve expose valleys/zero bars
// without filling the edge with a nearly flat row of RMS values.
function signalLevels(samples, count = 32) {
  const size = Math.max(1, Math.floor(count));
  if (!Number.isFinite(size)) throw new RangeError('count must be finite.');
  if (!samples.length) return Array(size).fill(0);
  const bins = Array.from({ length: size }, (_, bar) => {
    const from = Math.floor(bar * samples.length / size);
    const to = Math.max(from + 1, Math.floor((bar + 1) * samples.length / size));
    let energy = 0, peak = 0, taken = 0;
    for (let i = from; i < to && i < samples.length; i++) {
      const value = Number.isFinite(samples[i]) ? samples[i] : 0;
      energy += value * value;
      peak = Math.max(peak, Math.abs(value));
      taken++;
    }
    return taken ? 0.85 * Math.sqrt(energy / taken) + 0.15 * peak : 0;
  });
  const ceiling = Math.max(0.38, ...bins);
  return bins.map(value => clamp((value / ceiling - 0.13) / 0.82, 0, 1) ** 1.2);
}

// Deterministic uneven timing, preserved from the study. It belongs to the
// visual clock, not the simulation's seeded story randomness.
function chance(a, b = 0, seed = 0) {
  let n = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul((seed | 0) + 1, 0x27d4eb2f);
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

let texture;
const windowValues = new Float32Array(512);
const wrap = (time, duration) => ((time % duration) + duration) % duration;

// Target heights are whole notches. Local cuts keep the shallow outline
// jagged, independently of how smoothly it moves between successive targets.
// Most of each cut stays with its bar, so morphing does not average the edge
// into a broad, smooth wave. jagged:0 reproduces the original study texture.
export function waveLevels(timeSeconds, settings = {}) {
  const s = { ...WAVE_DEFAULTS, ...settings };
  if (!Number.isFinite(timeSeconds)) throw new RangeError('Visual time must be finite.');
  if (!Number.isInteger(s.bars) || s.bars < 1 || s.bars > 512) throw new RangeError('bars must be an integer from 1 to 512.');
  if (!Number.isFinite(s.amp) || s.amp < 0 || !Number.isFinite(s.unit) || s.unit <= 0) throw new RangeError('amp must be nonnegative and unit must be positive.');
  if (!Number.isFinite(s.jagged) || s.jagged < 0 || s.jagged > 1) throw new RangeError('jagged must be from 0 to 1.');
  texture ||= createVisualTexture();
  const { samples, sampleRate, duration } = texture;
  const end = Math.floor(wrap(timeSeconds, duration) * sampleRate);
  for (let i = 0; i < windowValues.length; i++) {
    windowValues[i] = samples[(end - windowValues.length + i + samples.length) % samples.length];
  }
  const most = Math.floor(s.amp / s.unit);
  const phase = Math.floor(wrap(timeSeconds, duration) * 4);
  return signalLevels(windowValues, s.bars).map((level, bar) => {
    const cut = 0.75 * (chance(bar, 79, s.seed) * 2 - 1)
      + 0.25 * (chance(bar, 101 + phase, s.seed) * 2 - 1);
    return Math.round(clamp(level + cut * s.jagged, 0, 1) * most);
  });
}

// Milliseconds, matching the control shown in the approved study.
export function holdDuration(step, settings = {}) {
  const s = { ...WAVE_DEFAULTS, ...settings };
  if (!Number.isFinite(s.step) || s.step <= 0 || !Number.isFinite(s.rough) || s.rough < 0 || s.rough > 1) {
    throw new RangeError('step must be positive and rough must be from 0 to 1.');
  }
  return s.step * (1 + s.rough * (chance(step, 41, s.seed) * 2 - 0.7)
    + (chance(step, 42, s.seed) < 0.16 ? s.rough : 0));
}

// Every edge has its own signal phase and local cuts. The bottom keeps the
// selected study's phase, while the others avoid mirrored/repeated teeth.
function edgeLevels(time, settings) {
  return {
    bottom: waveLevels(time, settings),
    top: waveLevels(time + 3.71, { ...settings, seed: settings.seed + 11 }),
    right: waveLevels(time + 7.13, { ...settings, seed: settings.seed + 23 }),
    left: waveLevels(time + 11.37, { ...settings, seed: settings.seed + 37 }),
  };
}

// Each card holds its jagged shape, then changes in a short, quantized burst.
// Some intervals snap directly; the others take two to four unevenly timed
// steps. A lock freezes even an intermediate glitch frame, and release
// resumes its exact remaining interval with no catch-up. dt and offset are
// seconds; hold and heldFor are interval milliseconds for the study.
export function createWaveClock({ settings = {}, offset = 0 } = {}) {
  let s = { ...WAVE_DEFAULTS, ...settings };
  const validateTransition = value => {
    if (!Number.isFinite(value) || value <= 0 || value > 1) throw new RangeError('transition must be greater than 0 and at most 1.');
  };
  validateTransition(s.transition);
  let heldTime = offset, step = 0, heldFor = 0;
  let hold = holdDuration(step, s), from = edgeLevels(heldTime, s);
  let target = edgeLevels(heldTime + hold / 1000, s);
  const snapshot = () => {
    const burst = Math.min(1, s.transition * (0.6 + 0.8 * chance(step, 81, s.seed)));
    const phase = clamp((heldFor / hold - (1 - burst)) / burst, 0, 1);
    const frames = chance(step, 82, s.seed) < 0.25 ? 1 : 2 + Math.floor(chance(step, 83, s.seed) * 3);
    const blend = Math.floor(phase * frames) / frames;
    const current = Object.fromEntries(Object.entries(from).map(([side, levels]) => [side,
      levels.map((level, i) => Math.round(level + (target[side][i] - level) * blend))]));
    return {
      time: heldTime + heldFor / 1000, heldTime, step, hold, heldFor,
      levels: [...current.bottom], edgeLevels: current,
      from: [...from.bottom], target: [...target.bottom], transition: blend,
      burstDuration: burst * hold, glitchFrames: frames,
    };
  };
  return {
    snapshot,
    configure(settings = {}) {
      const next = { ...s, ...settings };
      validateTransition(next.transition);
      const progress = heldFor / hold;
      s = next;
      hold = holdDuration(step, s);
      heldFor = progress * hold;
      // Only an explicit tuning change resamples a transition. A routine
      // frame with dt=0 never changes either endpoint or its progress.
      from = edgeLevels(heldTime, s);
      target = edgeLevels(heldTime + hold / 1000, s);
      return snapshot();
    },
    update(dt, { frozen = false, still = false } = {}) {
      if (frozen || still || !Number.isFinite(dt) || dt <= 0) return snapshot();
      let remaining = dt * 1000;
      while (remaining > 0) {
        const until = Math.max(0, hold - heldFor);
        if (remaining < until) {
          heldFor += remaining;
          break;
        }
        remaining -= until;
        heldTime += hold / 1000;
        heldFor = 0;
        step++;
        from = target;
        hold = holdDuration(step, s);
        target = edgeLevels(heldTime + hold / 1000, s);
      }
      return snapshot();
    },
  };
}
