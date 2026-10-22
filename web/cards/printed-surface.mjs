// The cards as real objects with their lettering printed on them, and the
// one view they're seen through. Roy, Oct 12: "i want the letters to be
// printed on the cards in 3d and manipulated when the cards change" and "I
// want the 3d view to barely add perspective. the perspective you have on
// the cards is enough right?"
//
// The model: x across, y down, z up out of the card. The resting face is at
// z = 0 and the card is `depth` thick. A card is a list of flat facets (the
// tops of its squares, the walls between squares of different heights, the
// sides of a pain line). The printed face, the sheet, is flat artwork in face
// coordinates; a facet says which patch of the sheet is printed on it.
//
// The view: the one the cards have always been drawn in. Nothing recedes to
// a vanishing point; height only slides a point on screen, one pixel left and
// one up for each pixel it rises. So a face that lies flat is seen exactly
// square-on, and print moves or shears only where its surface does.
//
// Nothing here touches the page until createPrintedCard, so the checks run
// the geometry by itself (test/printed-surface.test.mjs).

// screen x = x - z, screen y = y - z.
export const VIEW = [[1, 0, -1], [0, 1, -1]];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rad = degrees => degrees * Math.PI / 180;

// The same view with more or less of the edge showing (1 is the cards' own),
// and optionally the card really turned in space (degrees). A turn is for
// comparison in the study; the game's view has none.
export function viewOf({ edge = 1, yaw = 0, pitch = 0 } = {}) {
  const base = [[1, 0, -edge], [0, 1, -edge]];
  if (!yaw && !pitch) return base;
  const cy = Math.cos(rad(yaw)), sy = Math.sin(rad(yaw)), cp = Math.cos(rad(pitch)), sp = Math.sin(rad(pitch));
  // Turn about the upright axis, then tip about the level one.
  const turn = [[cy, 0, sy], [sp * sy, cp, -sp * cy], [-cp * sy, sp, cp * cy]];
  return base.map(row => [0, 1, 2].map(i => row[0] * turn[0][i] + row[1] * turn[1][i] + row[2] * turn[2][i]));
}

// Where a point of the model lands on screen. `pivot` is the point a turned
// view turns about; it stays where it is.
export function screen(view, p, pivot = [0, 0, 0]) {
  const q = sub(p, pivot);
  return [pivot[0] + dot(view[0], q), pivot[1] + dot(view[1], q)];
}

// Where a point of something standing on the card lands. Its foot is where
// the view puts the surface it stands on (`floor`); its height above that is
// drawn along `up`. Roy, Oct 12 (284): "blades should come up perpendicular
// to the card surface". Straight up the screen, [0, -1], is how something
// standing on a surface seen flat-on reads as standing. With `up` left out
// it's the view's own slide, the same as `screen`.
export function stand(view, up, p, floor, pivot) {
  const foot = screen(view, [p[0], p[1], floor], pivot), lift = up || [view[0][2], view[1][2]];
  return [foot[0] + (p[2] - floor) * lift[0], foot[1] + (p[2] - floor) * lift[1]];
}

// Roy, Oct 12 (285): "it's almost a top down view, just slightly tilted".
// The card's edges say which way the view is tilted: toward the lower right,
// since that's where its sides show. How far it's tilted from top-down they
// don't say; `degrees` does. Something standing on the card then shows
// tan(tilt) of its height, drawn up and to the left: the `up` for `stand`.
// (At 54.7 degrees it's the view's own slide: a card only as thick as the 3
// pixels of edge it shows. A slight tilt means a thicker card.)
export function tiltUp(degrees) {
  const each = Math.tan(rad(degrees)) / Math.SQRT2;
  return [-each, -each];
}

// The direction the viewer is in. A surface is seen when it faces this way.
export function toward(view) {
  const k = cross(view[0], view[1]), length = Math.hypot(...k);
  return k.map(n => n / length);
}

export const normal = pts => cross(sub(pts[1], pts[0]), sub(pts.at(-1), pts[0]));

// The 2D matrix (a, b, c, d, e, f) that prints the sheet onto a facet as the
// view sees it: sheet point `print.at` lies on the facet's first corner, and
// the sheet vectors `along` and `down` run along its first and last edges.
export function printMatrix(view, facet, pivot) {
  const { at, along, down } = facet.print, o = screen(view, facet.pts[0], pivot);
  const u = screen(view, facet.pts[1], pivot), v = screen(view, facet.pts.at(-1), pivot);
  const p = [[u[0] - o[0], v[0] - o[0]], [u[1] - o[1], v[1] - o[1]]];
  const det = along[0] * down[1] - down[0] * along[1];
  const inverse = [[down[1] / det, -down[0] / det], [-along[1] / det, along[0] / det]];
  const a = p[0][0] * inverse[0][0] + p[0][1] * inverse[1][0], c = p[0][0] * inverse[0][1] + p[0][1] * inverse[1][1];
  const b = p[1][0] * inverse[0][0] + p[1][1] * inverse[1][0], d = p[1][0] * inverse[0][1] + p[1][1] * inverse[1][1];
  return [a, b, c, d, o[0] - a * at[0] - c * at[1], o[1] - b * at[0] - d * at[1]];
}

export const applyMatrix = ([a, b, c, d, e, f], [x, y]) => [a * x + c * y + e, b * x + d * y + f];

// A saw blade, in card pixels: how far its tips stand out of the card once
// it's all the way up, the teeth (`pitch` apart, `depth` deep, each tip
// `lean` of the way along its tooth, so they rake one way as a saw's do),
// and the thickness of the steel. Provisional numbers.
export const BLADE = { height: 5, pitch: 4, depth: 2.4, lean: 0.25, thick: 0.8 };

// A tooth ground to a point (Roy, Oct 12, 286: "can we make them diamond
// shaped, the teeth (seen top down it would resembled diamond . so there's a
// visible sharpness even top down"): four flat sides rising to one point over
// a diamond-shaped foot, `length` along the line and `width` across it, the
// point `height` above the card. Roy, the same day: "instead of filling solid
// black can i see 1 bit diamonds, black and white, black outlines, white
// fill". So each is paper-white with a black line `line` wide round it;
// `creases` also draws its four edges up to the point, which is what shows
// the point from above. (`shade` fills the sides turned away from the light
// instead, the first trial.)
// The shape is his sketch of October 12 (287: "the diamonds should be like
// this, 3d", drawn from above, from the side and in the round): a low
// four-sided point, its foot 0.7 as wide as it is long and the point a sixth
// of the length high, with every edge drawn, the four up to the point
// included. He then set the sizes himself in the study (288: "I like these
// settings for now"): small slim teeth, a hairline, the edges drawn and the
// far sides black. TILT is his too: how far the view is from top-down.
export const DIAMOND = { height: 0.5, length: 5.5, width: 1.9, line: 0.25, creases: true, shade: true };
export const TILT = 9;

// Where a pain card's lines run, each as a whole line across the face
// ({ x, y, length, angle }): the two diagonals, corner to corner. Teeth are
// left out where the words are, so each line stops short of them on either
// side. (289 added one straight across the middle and one straight down it;
// Roy, Oct 12, 290: "remove those added lines".)
export function painLines({ width = 145, height = 73, inset = 1.9 } = {}) {
  const across = width - inset * 2, down = height - inset * 2, slope = Math.atan2(down, across) * 180 / Math.PI;
  return [
    { x: inset, y: inset, length: Math.hypot(across, down), angle: slope },
    { x: inset, y: height - inset, length: Math.hypot(across, down), angle: -slope },
  ];
}

// A blade's top edge at `t` along it: its height above the surface when the
// tips are `tall` out of it. Negative where the steel hasn't come through yet.
export function bladeEdge(blade, tall, t) {
  const u = ((t / blade.pitch) % 1 + 1) % 1;
  const gullet = u < blade.lean ? 1 - u / blade.lean : (u - blade.lean) / (1 - blade.lean);
  return tall - blade.depth * gullet;
}

// Where blades can stand so that, all the way up and seen through `view`,
// each stays on its card and off its lettering: the given lines, cut back to
// the stretches where the whole blade, foot to tip, is inside the face and
// clear of the `lettering` boxes ({ left, top, right, bottom }, face
// coordinates). Roy, Oct 12 (280): "spikes don't rise where the letters are".
export function bladeLines(segments, { width = 145, height = 73, lettering = [], blade = BLADE, view = VIEW, up = null, margin = 1.5, slide = 3, step = 0.25 } = {}) {
  const lean = z => stand(view, up, [0, 0, z], 0);    // how far a point that high is drawn from its foot
  // Round the words there's also the `slide` of a lowered square: what stands
  // on one moves that far against the words on the next.
  const clear = (x, y) => x >= margin && y >= margin && x <= width - margin && y <= height - margin
    && !lettering.some(box => x > box.left - margin - slide && x < box.right + margin + slide && y > box.top - margin - slide && y < box.bottom + margin + slide);
  const out = [];
  for (const segment of segments) {
    const d = [Math.cos(rad(segment.angle)), Math.sin(rad(segment.angle))];
    const ok = t => [0, 0.5, 1].every(part => {
      const [sx, sy] = lean(blade.height * part);
      return clear(segment.x + d[0] * t + sx, segment.y + d[1] * t + sy);
    });
    let from = null;
    for (let t = 0; t <= segment.length + step; t += step) {
      const good = t <= segment.length && ok(t);
      if (good && from === null) from = t;
      if (!good && from !== null) {
        if (t - step - from >= blade.pitch) out.push({ x: segment.x + d[0] * from, y: segment.y + d[1] * from, length: t - step - from, angle: segment.angle });
        from = null;
      }
    }
  }
  return out;
}

// A card as facets.
//   lower: 0..1, how far alternate squares have lowered (the activity hold).
//   press: 0..1, how far the whole face is pressed in.
//   ridges: pain lines as segments on the face ({ x, y, length, angle }),
//           `rise` 0..1 of the way out of the surface, tip first.
//   pain: what a pain line is. 'diamond' (286): a row of teeth ground to
//           points, each a diamond from above. 'blade' (283: "materially it
//           should look like saw blade"): a thin blade standing on edge
//           along the line, teeth up. 'ridge': the three-sided ridge of 281.
//           All come up through the card, the tips first.
//   lettering: the boxes of the card's words ({ left, top, right, bottom }).
//           A tooth that would touch one, or leave the face, isn't there
//           (Roy, 280: "spikes don't rise where the letters are").
// Each facet: { id, kind, cell: [col, row], pts (3D corners), fill, ink,
// print (or null), edges (which of its sides are drawn as lines) }. A facet
// with `parts` is several flat pieces painted as one shape in one colour.
export function cardModel({
  width = 145, height = 73, depth = 3, tile = 24, lower = 0, press = 0,
  ridges = [], rise = 1, ridge = { base: 1.8, height: 3 }, edgeBand = 0.25, inverted = false,
  pain = 'diamond', blade = BLADE, tooth = DIAMOND, lettering = [],
} = {}) {
  const columns = Math.max(1, Math.round((width - 1) / tile)), rows = Math.max(1, Math.round((height - 1) / tile));
  const w = (width - 1) / columns, h = (height - 1) / rows, base = -depth;
  const inside = (col, row) => col >= 0 && row >= 0 && col < columns && row < rows;
  // A square's height. Outside the card there's only the surface it lies on.
  const z = (col, row) => (inside(col, row) ? Math.max(base, -((col + row) % 2 ? depth * lower : 0) - depth * press) : base);
  const differs = (a, b) => Math.abs(a - b) > 1e-9;
  const paper = inverted ? '#000' : '#fff', type = inverted ? '#fff' : '#000';
  const facets = [];

  // The paper under the squares, in one piece at the lowest of them, so the
  // squares that lie in one plane show no seam where they meet.
  const lowest = Math.min(z(0, 0), z(columns > 1 ? 1 : 0, 0));
  facets.push({
    id: 'under', kind: 'under', cell: [-1, -1], fill: paper, ink: type, print: null, edges: [false, false, false, false],
    pts: [[0.5, 0.5, lowest], [width - 0.5, 0.5, lowest], [width - 0.5, height - 0.5, lowest], [0.5, height - 0.5, lowest]],
  });

  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const x = 0.5 + col * w, y = 0.5 + row * h, r = x + w, b = y + h, top = z(col, row), cell = [col, row];
    const beside = { up: z(col, row - 1), right: z(col + 1, row), down: z(col, row + 1), left: z(col - 1, row) };
    facets.push({
      id: `top:${col}:${row}`, kind: 'top', cell, fill: paper, ink: type,
      pts: [[x, y, top], [r, y, top], [r, b, top], [x, b, top]],
      print: { at: [x, y], along: [w, 0], down: [0, h] },
      // A line only where the height changes, or the card ends.
      edges: [!inside(col, row - 1) || differs(top, beside.up), !inside(col + 1, row) || differs(top, beside.right),
        !inside(col, row + 1) || differs(top, beside.down), !inside(col - 1, row) || differs(top, beside.left)],
    });
    // Walls drop from this square to whatever is lower beside it. The ink at
    // the cut edge runs down a wall between two squares (Roy, 254-257); the
    // card's own outer sides are plain.
    const wall = (name, far, pts, print) => {
      if (!(far < top - 1e-9)) return;
      facets.push({ id: `${name}:${col}:${row}`, kind: 'wall', cell, fill: '#000', ink: '#fff', pts, print, edges: [true, true, true, true] });
    };
    wall('right', beside.right, [[r, y, top], [r, y, beside.right], [r, b, beside.right], [r, b, top]],
      inside(col + 1, row) ? { at: [r - edgeBand / 2, y], along: [edgeBand, 0], down: [0, h] } : null);
    wall('down', beside.down, [[x, b, top], [r, b, top], [r, b, beside.down], [x, b, beside.down]],
      inside(col, row + 1) ? { at: [x, b - edgeBand / 2], along: [w, 0], down: [0, edgeBand] } : null);
    wall('left', beside.left, [[x, y, top], [x, b, top], [x, b, beside.left], [x, y, beside.left]], null);
    wall('up', beside.up, [[x, y, top], [x, y, beside.up], [r, y, beside.up], [r, y, top]], null);
  }

  // Pain lines: a three-sided ridge along each segment, standing on whatever
  // square it crosses, so it lowers with the squares. Coming out of the
  // surface, the part that shows is the same shape, smaller: the tip first.
  const up = ridge.height * rise, half = ridge.base / 2 * rise, tall = blade.height * rise;
  if (rise > 1e-9) ridges.forEach((segment, index) => {
    const d = [Math.cos(rad(segment.angle)), Math.sin(rad(segment.angle))], n = [-d[1], d[0]];
    if (pain === 'diamond') {
      // As many whole teeth as fit, centred on the line. A tooth coming up
      // through the card shows as much of itself as is above the surface: the
      // same shape, smaller, so its point comes first and its foot grows.
      const count = Math.floor(segment.length / tooth.length + 1e-9), begin = (segment.length - count * tooth.length) / 2, groups = new Map();
      // Room: a pixel inside the face's line, and round the words that plus
      // the slide of a lowered square, so a tooth never lands on a letter.
      const room = 1, gap = room + depth;
      const onFace = ([x, y]) => x >= 0.5 + room && y >= 0.5 + room && x <= width - 0.5 - room && y <= height - 0.5 - room;
      const onWords = ([x, y]) => lettering.some(box => x > box.left - gap && x < box.right + gap && y > box.top - gap && y < box.bottom + gap);
      for (let k = 0; k < count; k++) {
        const t = begin + (k + 0.5) * tooth.length, cx = segment.x + d[0] * t, cy = segment.y + d[1] * t;
        // Judged at its full size, so the same teeth are there all through the rise.
        const whole = [[cx + d[0] * tooth.length / 2, cy + d[1] * tooth.length / 2], [cx + n[0] * tooth.width / 2, cy + n[1] * tooth.width / 2],
          [cx - d[0] * tooth.length / 2, cy - d[1] * tooth.length / 2], [cx - n[0] * tooth.width / 2, cy - n[1] * tooth.width / 2]];
        const round = whole.flatMap((p, j) => [0, 0.25, 0.5, 0.75].map(f => [p[0] + (whole[(j + 1) % 4][0] - p[0]) * f, p[1] + (whole[(j + 1) % 4][1] - p[1]) * f]));
        if (!round.every(onFace) || [...round, [cx, cy]].some(onWords)) continue;
        const col = Math.min(columns - 1, Math.max(0, Math.floor((cx - 0.5) / w))), row = Math.min(rows - 1, Math.max(0, Math.floor((cy - 0.5) / h)));
        const floor = z(col, row), a = tooth.length / 2 * rise, b = tooth.width / 2 * rise, point = [cx, cy, floor + tooth.height * rise];
        const foot = [[cx + d[0] * a, cy + d[1] * a, floor], [cx + n[0] * b, cy + n[1] * b, floor], [cx - d[0] * a, cy - d[1] * a, floor], [cx - n[0] * b, cy - n[1] * b, floor]];
        // A tooth stands on its own square. Where it runs over the next
        // square at the same height, that square paints its share of it; at
        // a step down or up it's cut off, as the square is.
        const light = [], dark = [];
        if (!tooth.creases && !tooth.shade) light.push(foot);          // drawn as its foot alone: a plain diamond
        else foot.forEach((p, j) => {
          const side = [p, foot[(j + 1) % 4], point];
          let out = normal(side);
          if (out[2] < 0) out = out.map(v => -v);
          // Shaded: a side turned the way the card's own black sides are turned is dark.
          (tooth.shade && out[0] + out[1] > 0 ? dark : light).push(side);
        });
        const span = (values, size, most) => [Math.max(0, Math.floor((Math.min(...values) - 0.5) / size)), Math.min(most - 1, Math.floor((Math.max(...values) - 0.5) / size))];
        const [c0, c1] = span(foot.map(q => q[0]), w, columns), [r0, r1] = span(foot.map(q => q[1]), h, rows);
        for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
          if (differs(z(c, r), floor)) continue;
          const key = `${c}:${r}`;
          if (!groups.has(key)) groups.set(key, { col: c, row: r, floor, light: [], dark: [] });
          groups.get(key).light.push(...light);
          groups.get(key).dark.push(...dark);
        }
      }
      for (const [key, g] of groups) {
        const x = 0.5 + g.col * w, y = 0.5 + g.row * h;
        const shared = {
          kind: 'ridge', cell: [g.col, g.row], floor: g.floor, print: null, ink: paper, edges: [], outline: type, line: tooth.line,
          // Only what's over this square, as high as a tooth reaches.
          clip: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], reach: tooth.height * rise,
        };
        // White sides with a black line round each; shaded ones over them, nearer the eye.
        if (g.light.length) facets.push({ ...shared, id: `teeth:${index}:${key}:light`, parts: g.light, pts: g.light[0], fill: paper });
        if (g.dark.length) facets.push({ ...shared, id: `teeth:${index}:${key}:dark`, parts: g.dark, pts: g.dark[0], fill: type });
      }
      return;
    }
    const cuts = [0, segment.length];
    for (let col = 1; col < columns; col++) if (Math.abs(d[0]) > 1e-9) cuts.push((0.5 + col * w - segment.x) / d[0]);
    for (let row = 1; row < rows; row++) if (Math.abs(d[1]) > 1e-9) cuts.push((0.5 + row * h - segment.y) / d[1]);
    const stops = [...new Set(cuts.filter(t => t >= 0 && t <= segment.length))].sort((a, b) => a - b);
    const pieces = [];
    for (let i = 0; i + 1 < stops.length; i++) {
      const from = stops[i], to = stops[i + 1], mid = (from + to) / 2;
      if (to - from < 1e-6) continue;
      const col = Math.min(columns - 1, Math.max(0, Math.floor((segment.x + d[0] * mid - 0.5) / w)));
      const row = Math.min(rows - 1, Math.max(0, Math.floor((segment.y + d[1] * mid - 0.5) / h)));
      const floor = z(col, row), last = pieces.at(-1);
      // Squares at one height carry the line in one piece (painted with the
      // last of them, so none of their tops covers it).
      if (last && !differs(last.floor, floor)) {
        last.to = to;
        if (col + row > last.col + last.row) { last.col = col; last.row = row; }
      } else pieces.push({ from, to, col, row, floor });
    }
    pieces.forEach(({ from, to, col, row, floor }, i) => {
      const at = (t, side, lift) => [segment.x + d[0] * t + n[0] * side, segment.y + d[1] * t + n[1] * side, floor + lift];
      if (pain === 'blade') {
        // The blade comes straight up through the card: what shows is
        // whatever of its toothed edge is above the surface, tips first. Its
        // two sides, the top of its teeth and its ends are all one steel.
        const stops = new Set([from, to]);
        for (let k = Math.floor(from / blade.pitch) - 1; k * blade.pitch <= to; k++) {
          for (const t of [k * blade.pitch, (k + blade.lean) * blade.pitch]) if (t > from && t < to) stops.add(t);
        }
        const along = [...stops].sort((a, b) => a - b), side = blade.thick / 2, parts = [];
        for (let j = 0; j + 1 < along.length; j++) {
          let [t0, t1] = [along[j], along[j + 1]], g0 = bladeEdge(blade, tall, t0 + 1e-9), g1 = bladeEdge(blade, tall, t1 - 1e-9);
          if (g0 <= 1e-9 && g1 <= 1e-9) continue;
          if (g0 < 0) { t0 += (t1 - t0) * (0 - g0) / (g1 - g0); g0 = 0; }
          if (g1 < 0) { t1 = t0 + (t1 - t0) * g0 / (g0 - g1); g1 = 0; }
          parts.push([at(t0, side, 0), at(t1, side, 0), at(t1, side, g1), at(t0, side, g0)]);
          parts.push([at(t0, -side, 0), at(t1, -side, 0), at(t1, -side, g1), at(t0, -side, g0)]);
          parts.push([at(t0, -side, g0), at(t1, -side, g1), at(t1, side, g1), at(t0, side, g0)]);
        }
        for (const t of [from, to]) {
          const g = bladeEdge(blade, tall, t === from ? t + 1e-9 : t - 1e-9);
          if (g > 1e-9) parts.push([at(t, -side, 0), at(t, side, 0), at(t, side, g), at(t, -side, g)]);
        }
        if (parts.length) facets.push({ id: `blade:${index}:${i}`, kind: 'ridge', cell: [col, row], floor, parts, pts: parts[0], print: null, fill: type, ink: paper, edges: [] });
        return;
      }
      const piece = (name, pts, facing) => facets.push({
        id: `ridge:${index}:${i}:${name}`, kind: 'ridge', cell: [col, row], pts, print: null,
        // The side turned the way the card's own black sides are turned is black.
        fill: facing[0] + facing[1] > 0 ? type : paper, ink: paper,
        edges: pts.map(() => !(facing[0] + facing[1] > 0)),
      });
      piece('a', [at(from, half, 0), at(from, 0, up), at(to, 0, up), at(to, half, 0)], n);
      piece('b', [at(from, -half, 0), at(to, -half, 0), at(to, 0, up), at(from, 0, up)], [-n[0], -n[1]]);
      // An end shows only where the line stops or steps to another height.
      if (!pieces[i - 1] || differs(pieces[i - 1].floor, floor)) piece('start', [at(from, half, 0), at(from, -half, 0), at(from, 0, up)], [-d[0], -d[1]]);
      if (!pieces[i + 1] || differs(pieces[i + 1].floor, floor)) piece('end', [at(to, -half, 0), at(to, half, 0), at(to, 0, up)], d);
    });
  });
  return facets;
}

// The facets the view can see, back to front. Squares are painted along the
// diagonal away from the viewer's corner; on each, its top, then what stands
// on it, then its walls. (Any view whose `toward` leans right, down and out
// of the card, as the cards' own does.)
const RANK = { under: 0, top: 0, ridge: 1, wall: 2 };
export function paintOrder(view, facets) {
  const k = toward(view);
  return facets
    .filter(f => f.parts || dot(normal(f.pts), k) > 1e-9)
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.cell[0] + a.f.cell[1]) - (b.f.cell[0] + b.f.cell[1]) || RANK[a.f.kind] - RANK[b.f.kind] || a.i - b.i)
    .map(({ f }) => f);
}

// ------------------------------------------------------------------ page

const SVG = 'http://www.w3.org/2000/svg';
const round = n => Math.round(n * 1000) / 1000;

// Lines are drawn with a square pen one pixel across, the way the cards'
// edges always were. A line is the pen swept from one end to the other; a
// solid side is the pen swept all over it. Corners come out whole and
// nothing pokes past them, whatever the angle.
const PEN = 0.5;
const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function hull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = list => {
    const out = [];
    for (const q of list) { while (out.length >= 2 && turn(out.at(-2), out.at(-1), q) <= 1e-9) out.pop(); out.push(q); }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
export const swept = (points, pen = PEN) => hull(points.flatMap(([x, y]) => [[x - pen, y - pen], [x + pen, y - pen], [x + pen, y + pen], [x - pen, y + pen]]));
const closed = points => `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`;
// The drawn sides of a facet, as shapes to fill.
export const lines = (pts, edges) => pts.map((p, i) => (edges[i] ? closed(swept([p, pts[(i + 1) % pts.length]])) : '')).join('');

// Paints a card from its model. `el` is the card's place, `sheet()` returns a
// new copy of the printed face (the button's contents, laid out as the game
// lays them out). Call `paint(state, view)` whenever the card changes.
export function createPrintedCard(el, sheet, { width = 145, height = 73 } = {}) {
  const root = document.createElement('span');
  root.className = 'printed-card';
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none';
  el.append(root);
  const made = new Map();
  const pivot = [width / 2, height / 2, 0];

  function element(facet) {
    let entry = made.get(facet.id);
    if (entry) return entry;
    const face = document.createElement('span');
    face.style.cssText = 'position:absolute;left:-60px;top:-60px;width:400px;height:300px';
    let copy = null;
    if (facet.print) {
      copy = sheet();
      // Inside the padding, so the copy's own corner is the card's corner.
      copy.style.left = '60px'; copy.style.top = '60px';
      copy.style.transformOrigin = '0 0';
      face.append(copy);
    }
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('width', '1'); svg.setAttribute('height', '1');
    svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('fill', '#000');
    svg.append(path);
    entry = { face, copy, svg, path };
    made.set(facet.id, entry);
    return entry;
  }

  return {
    // `up`: the screen direction things standing on the card rise in (see `stand`).
    paint(state, view = VIEW, { up = null } = {}) {
      const seen = new Set();
      for (const facet of paintOrder(view, cardModel({ width, height, ...state }))) {
        const { face, copy, svg, path } = element(facet), pts = facet.pts.map(p => screen(view, p, pivot));
        seen.add(facet.id);
        if (facet.parts) {
          // Several flat pieces, one colour: one shape. Each piece is wound
          // the same way round, so where two overlap they add up, not cancel.
          path.setAttribute('fill', facet.fill);
          // A fine line round each piece, where the model asks for one.
          // One bit: black or white and nothing between, so no smoothing.
          path.setAttribute('stroke', facet.outline || 'none');
          path.setAttribute('stroke-width', String(facet.line ?? 0.3));
          path.setAttribute('stroke-linejoin', 'miter');
          path.setAttribute('shape-rendering', facet.outline ? 'crispEdges' : 'auto');
          path.setAttribute('d', facet.parts.map(part => {
            const flat = part.map(p => stand(view, up, p, facet.floor, pivot));
            const area = flat.reduce((sum, p, i) => sum + p[0] * flat[(i + 1) % flat.length][1] - flat[(i + 1) % flat.length][0] * p[1], 0);
            return closed(area < 0 ? flat.reverse() : flat);
          }).join(''));
          svg.style.clipPath = facet.clip ? `polygon(${hull(facet.clip.flatMap(([x, y]) => [0, facet.reach].map(lift => stand(view, up, [x, y, facet.floor + lift], facet.floor, pivot)))).map(([x, y]) => `${round(x)}px ${round(y)}px`).join(',')})` : '';
          face.remove();
          root.append(svg);
          continue;
        }
        path.setAttribute('fill', '#000');
        path.setAttribute('stroke', 'none');
        path.setAttribute('shape-rendering', 'auto');
        // A black side with every edge drawn is one solid shape. The clip is
        // in the face span's own coordinates, 60px in on each side.
        const solid = facet.fill === '#000' && facet.edges.every(Boolean), shape = solid ? swept(pts) : pts;
        face.style.clipPath = `polygon(${shape.map(([x, y]) => `${round(x + 60)}px ${round(y + 60)}px`).join(',')})`;
        face.style.background = facet.fill;
        if (copy) {
          copy.style.color = facet.ink;
          copy.style.transform = `matrix(${printMatrix(view, facet, pivot).map(round).join(',')})`;
        }
        path.setAttribute('d', solid ? '' : lines(pts, facet.edges));
        root.append(face, svg);
      }
      for (const [id, entry] of made) if (!seen.has(id)) { entry.face.remove(); entry.svg.remove(); made.delete(id); }
    },
    destroy() { root.remove(); made.clear(); },
  };
}
