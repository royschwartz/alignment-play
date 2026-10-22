// A tapered grant keeps its amount and finish minute. Its remaining amount
// follows (time remaining)^2, so its rate falls continuously to zero.
// `per` remains the original average for compatibility with ordinary flows.
export const flowMinutes = f => f.taper?.left ?? Math.max(0, f.left / f.per);

export function taperFlow(f) {
  if (!f.taper) {
    const minutes = flowMinutes(f);
    if (Number.isFinite(minutes) && minutes > 0) f.taper = { minutes, left: minutes };
  }
  return f;
}

export function flowStep(f) {
  if (f.taper) {
    const minutes = Math.max(0, f.taper.left - 1);
    const left = minutes > 1e-9 ? f.left * (minutes / f.taper.left) ** 2 : 0;
    return { part: f.left - left, left, minutes };
  }
  const last = Math.abs(f.left) <= Math.abs(f.per) + 1e-12;
  return { part: last ? f.left : f.per, left: last ? 0 : f.left - f.per };
}

// Optional save extension: retime only the unspent part of a legacy neglect
// grant. No ledger entries, repeated descriptions, new loss or longer drain.
export function preserveNeglectTapers(s) {
  for (const f of s.flows) {
    if (f.key === 'rapture' && f.per < 0 && f.left < 0 && f.cause.startsWith('neglect:')) taperFlow(f);
  }
}
