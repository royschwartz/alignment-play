// A shaped card is still cut on the ordinary card's fixed grid. Subdividing
// at both the outline and the grid keeps even a partial bar in its own square.
const EPS = 1e-8;
const sorted = values => values.sort((a, b) => a - b).filter((n, i, all) => !i || n - all[i - 1] > EPS);
const key = point => point.join(',');

function contoursOf(edges, xs, ys) {
  const pending = new Set(edges), starts = new Map();
  for (const edge of edges) {
    const start = key(edge.start);
    if (!starts.has(start)) starts.set(start, []);
    starts.get(start).push(edge);
  }
  const contours = [];
  while (pending.size) {
    const first = pending.values().next().value, points = [];
    let edge = first;
    do {
      pending.delete(edge);
      points.push([xs[edge.start[0]], ys[edge.start[1]]]);
      if (key(edge.end) === key(first.start)) break;
      // At a point where disconnected pieces touch, turn right to keep each
      // contour separate rather than drawing a bridge between them.
      const next = (starts.get(key(edge.end)) || []).filter(candidate => pending.has(candidate));
      const rank = candidate => [1, 0, 3, 2].indexOf((candidate.direction - edge.direction + 4) % 4);
      next.sort((a, b) => rank(a) - rank(b));
      edge = next[0];
    } while (edge && edge !== first);
    const simple = points.filter((point, i) => {
      const before = points[(i + points.length - 1) % points.length], after = points[(i + 1) % points.length];
      return Math.abs((point[0] - before[0]) * (after[1] - point[1]) - (point[1] - before[1]) * (after[0] - point[0])) > EPS;
    });
    if (simple.length >= 3) contours.push(simple);
  }
  return contours;
}

export function outlinePath(contours, shift = 0) {
  return contours.map(points => `M${points.map(([x, y]) => `${x + shift} ${y + shift}`).join('L')}Z`).join('');
}

export function partitionHoldOutline(width, height, outline, { tile = 24 } = {}) {
  const columns = Math.max(1, Math.round((width - 1) / tile));
  const rows = Math.max(1, Math.round((height - 1) / tile));
  const cw = (width - 1) / columns, ch = (height - 1) / rows;
  const xs = sorted([...outline.map(p => p[0]), ...Array.from({ length: columns + 1 }, (_, i) => .5 + i * cw)]);
  const ys = sorted([...outline.map(p => p[1]), ...Array.from({ length: rows + 1 }, (_, i) => .5 + i * ch)]);
  const cells = Array.from({ length: rows * columns }, (_, id) => {
    const row = Math.floor(id / columns), col = id % columns;
    return { id, row, col, parity: (row + col) % 2, bounds: [.5 + col * cw, .5 + row * ch, .5 + (col + 1) * cw, .5 + (row + 1) * ch], edges: [] };
  });
  const owners = Array.from({ length: ys.length - 1 }, () => Array(xs.length - 1).fill(null));
  for (let x = 0; x < xs.length - 1; x++) {
    const midX = (xs[x] + xs[x + 1]) / 2;
    const crossings = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      if ((a[0] > midX) !== (b[0] > midX)) crossings.push(a[1] + (b[1] - a[1]) * (midX - a[0]) / (b[0] - a[0]));
    }
    crossings.sort((a, b) => a - b);
    for (let y = 0; y < ys.length - 1; y++) {
      const midY = (ys[y] + ys[y + 1]) / 2;
      const inside = crossings.some((top, i) => i % 2 === 0 && midY > top && midY < crossings[i + 1]);
      if (!inside) continue;
      const col = Math.min(columns - 1, Math.floor((midX - .5) / cw));
      const row = Math.min(rows - 1, Math.floor((midY - .5) / ch));
      owners[y][x] = cells[row * columns + col];
    }
  }
  const owner = (x, y) => owners[y]?.[x] ?? null;
  const walls = new Map();
  for (let y = 0; y < owners.length; y++) for (let x = 0; x < owners[y].length; x++) {
    const cell = owner(x, y);
    if (!cell) continue;
    const candidates = [
      { start: [x, y], end: [x + 1, y], direction: 0, neighbor: owner(x, y - 1) },
      { start: [x + 1, y], end: [x + 1, y + 1], direction: 1, neighbor: owner(x + 1, y) },
      { start: [x + 1, y + 1], end: [x, y + 1], direction: 2, neighbor: owner(x, y + 1) },
      { start: [x, y + 1], end: [x, y], direction: 3, neighbor: owner(x - 1, y) },
    ];
    for (const edge of candidates) {
      if (edge.neighbor === cell) continue;
      cell.edges.push(edge);
      // Only the sides facing down/right can be seen in the card's view.
      if (edge.direction !== 1 && edge.direction !== 2) continue;
      if (edge.neighbor && cell.parity === 1) continue;
      const axis = edge.direction === 1 ? 'right' : 'bottom';
      const coordinate = axis === 'right' ? xs[edge.start[0]] : ys[edge.start[1]];
      const wallKey = `${cell.id}:${axis}:${coordinate}:${edge.neighbor?.id ?? 'outer'}`;
      if (!walls.has(wallKey)) walls.set(wallKey, { cell: cell.id, parity: cell.parity, axis, coordinate, neighbor: edge.neighbor?.id ?? null, segments: [] });
      walls.get(wallKey).segments.push([edge.start, edge.end].map(([ix, iy]) => [xs[ix], ys[iy]]));
    }
  }
  for (const cell of cells) {
    cell.contours = contoursOf(cell.edges, xs, ys);
    delete cell.edges;
  }
  return { width, height, columns, rows, cells, walls: [...walls.values()] };
}

export function projectHoldOutline(shape, level, { depth = 3, edgeSample = .25 } = {}) {
  const drop = depth * Math.max(0, Math.min(1, level));
  const faces = [0, 1].map(parity => {
    const shift = parity ? drop : 0;
    const contours = shape.cells.filter(cell => cell.parity === parity).flatMap(cell => cell.contours);
    return { contours, path: outlinePath(contours, shift), matrix: [1, 0, 0, 1, shift, shift] };
  });
  const walls = shape.walls.map(wall => {
    const near = wall.parity ? drop : 0;
    const far = wall.neighbor === null ? depth : drop;
    const contours = far > near ? wall.segments.map(([a, b]) => [
      [a[0] + near, a[1] + near], [b[0] + near, b[1] + near],
      [b[0] + far, b[1] + far], [a[0] + far, a[1] + far],
    ]) : [];
    const scale = (far - near) / edgeSample, sample = wall.coordinate - edgeSample / 2;
    const matrix = wall.axis === 'right'
      ? [scale, scale, 0, 1, wall.coordinate + near - sample * scale, near - sample * scale]
      : [1, 0, scale, scale, near - sample * scale, wall.coordinate + near - sample * scale];
    return { ...wall, near, far, contours, path: outlinePath(contours), matrix };
  });
  return { faces, walls };
}
