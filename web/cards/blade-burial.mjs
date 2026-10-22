// A released blade keeps turning around its axle as that axle tips into
// the ground. Its rigid shape passes through a fixed, unmarked surface.
import { LEAN, projectedProfile } from './blade-geometry.mjs';

const quadratic = (a, b, c, t) => a.map((v, i) => (1-t)**2*v + 2*(1-t)*t*b[i] + t*t*c[i]);
const profile = [[0, -.45]];
for (let i = 1; i <= 24; i++) profile.push(quadratic([0,-.45], [-.63,-.54], [-1,-.13], i/24));
for (let i = 1; i <= 24; i++) profile.push(quadratic([-1,-.13], [-.32,-.20], [0,.5], i/24));

const BORE_TILT = Math.PI * .4;
function rotate([x,y,z], ax, ay, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), dot = ax*x + ay*y;
  return [x*c + ay*z*s + ax*dot*(1-c), y*c - ax*z*s + ay*dot*(1-c), z*c + (ax*y-ay*x)*s];
}
// Continue the mounted rotation about the outward axle, then tip the
// complete frame toward the substrate. Do not add a separate flat spin.
function orient(vector, nx, ny, tilt, spin) {
  return rotate(rotate(vector, nx, ny, -spin), -ny, nx, tilt);
}
const intersection = (a, b) => {
  const t = a[2] / (a[2] - b[2]);
  return [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, 0];
};

export function bladeBurialFrame(fragment, pose) {
  const { nx, ny } = fragment;
  const tilt = BORE_TILT * pose.contact;
  const u = orient(fragment.u, nx, ny, tilt, pose.spin);
  const v = orient(fragment.v, nx, ny, tilt, pose.spin);
  const local = profile.map(([x,y]) => u.map((n,i) => x*n+y*v[i]));
  const landingU = orient(fragment.u, nx, ny, BORE_TILT, pose.contactSpin);
  const landingV = orient(fragment.v, nx, ny, BORE_TILT, pose.contactSpin);
  const landingHeight = -Math.min(...profile.map(([x,y]) => x*landingU[2]+y*landingV[2]));
  // Bound the entire rotation, not just this frame. Recomputing the height
  // from each frame's top/bottom cancels the rotation and looks like a wipe.
  const highestSweep = Math.max(...profile.map(([x,y]) => {
    const p = fragment.u.map((n,i) => x*n+y*fragment.v[i]);
    const axial = p[0]*nx+p[1]*ny;
    const radial = Math.sqrt(Math.max(0, p.reduce((sum,n)=>sum+n*n,0)-axial*axial));
    return -axial*Math.sin(BORE_TILT)+radial*Math.cos(BORE_TILT);
  }));
  const initial = fragment.heightAboveGround;
  const depth = (landingHeight+highestSweep+.5)*pose.burial;
  const height = initial*(1-pose.contact)+landingHeight*pose.contact+pose.lift-depth;
  // Feed down the tilted axle. Every point follows a corkscrew into the
  // same ground plane; the blade neither scales down nor loses opacity.
  const feed = depth / Math.tan(BORE_TILT);
  const anchor = [fragment.x+LEAN*initial+pose.dx+nx*feed,
    fragment.y+LEAN*initial+pose.dy+ny*feed];
  return { u, v, height, anchor, local };
}

export function bladeBurialGeometry(fragment, pose) {
  if (pose.phase === 'gone') return { fill: '', outline: '', visibleFraction: 0 };
  const { u, v, height, anchor, local } = bladeBurialFrame(fragment, pose);
  const world = local.map(([x,y,z]) => [x, y, z+height]);
  const project = ([x,y,z]) => [anchor[0]+x-LEAN*z, anchor[1]+y-LEAN*z];
  const point = p => project(p).map(n => n.toFixed(4)).join(',');
  if (world.every(p => p[2] >= 0)) {
    const d = projectedProfile([u[0]-LEAN*u[2], u[1]-LEAN*u[2], v[0]-LEAN*v[2], v[1]-LEAN*v[2],
      anchor[0]-LEAN*height, anchor[1]-LEAN*height]);
    return { fill: d, outline: d, visibleFraction: 1 };
  }
  const clipped = [], strokes = [];
  for (let i = 0; i < world.length; i++) {
    const a = world[i], b = world[(i+1)%world.length], aboveA = a[2] >= 0, aboveB = b[2] >= 0;
    if (aboveA) clipped.push(a);
    if (aboveA !== aboveB) clipped.push(intersection(a,b));
    if (aboveA || aboveB) {
      const start = aboveA ? a : intersection(a,b), end = aboveB ? b : intersection(a,b);
      strokes.push(`M${point(start)}L${point(end)}`);
    }
  }
  // Fill closes at the ground; stroke only the surviving original outline,
  // so clipping never draws a new seam or a hole in the white substrate.
  return { fill: clipped.length > 2 ? `M${clipped.map(point).join('L')}Z` : '',
    outline: strokes.join(''), visibleFraction: world.filter(p => p[2] >= 0).length / world.length };
}
