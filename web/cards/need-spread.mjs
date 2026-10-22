// The renderer reads progress from the engine; it never decides when a need
// is neglected. The splotch is the need's only marker, beside its action text.
import { simulateStain } from './wicking-stain.mjs';

export function spreadField({ seed, width = 145, height = 73, source = [.08, .35] }) {
  const model = simulateStain({ seed, size: 96, source, aspect: width / height });
  const times = new Float32Array(width * height);
  let last = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const mx = Math.round(x / Math.max(1, width - 1) * (model.size - 1));
    const my = Math.round(y / Math.max(1, height - 1) * (model.size - 1));
    const t = model.times[my * model.size + mx];
    times[y * width + x] = t;
    last = Math.max(last, t);
  }
  return { width, height, times, start: last * .025, last };
}

export function spreadPixels(field, progress) {
  const amount = Math.max(0, Math.min(1, progress));
  const limit = field.start + (field.last - field.start) * amount;
  const data = new Uint8ClampedArray(field.width * field.height * 4);
  for (let i = 0; i < field.times.length; i++) {
    const value = field.times[i] <= limit ? 0 : 255;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return data;
}

export function createNeedSpread(button) {
  const canvas = document.createElement('canvas');
  canvas.className = 'need-spread';
  canvas.setAttribute('aria-hidden', 'true');
  button.prepend(canvas);
  let field, fieldKey, previous = -1, revision = 0;
  return {
    show(blots, _dt, { seed = 'alignment' } = {}) {
      const progress = Math.max(0, Math.min(1, blots[0]?.level ?? 0));
      const labelElement = button.querySelector('.label');
      const width = button.clientWidth, height = button.clientHeight;
      if (!width || !height || !labelElement) return;
      const key = `${seed}:${width}:${height}`;
      if (key !== fieldKey) {
        // The stain is printed on the card: measure in its own plane, before
        // the shared perspective projects the face onto the screen.
        const source = [Math.max(.025, labelElement.offsetLeft / width - .045), (labelElement.offsetTop + labelElement.offsetHeight / 2) / height];
        field = spreadField({ seed, width, height, source });
        canvas.width = width; canvas.height = height;
        fieldKey = key; previous = -1;
      }
      if (previous === progress) return;
      canvas.getContext('2d').putImageData(new ImageData(spreadPixels(field, progress), width, height), 0, 0);
      canvas.dataset.revision = String(++revision);
      previous = progress;
    },
  };
}
