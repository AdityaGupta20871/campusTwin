/** Pure 2D geometry helpers on the x/z plane (metres). */

export const rectOf = (r) => ({
  minX: r.x - r.w / 2,
  maxX: r.x + r.w / 2,
  minZ: r.z - r.d / 2,
  maxZ: r.z + r.d / 2,
});

export const areaOf = (r) => r.w * r.d;

export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function overlapArea(a, b) {
  const ra = rectOf(a);
  const rb = rectOf(b);
  const w = Math.min(ra.maxX, rb.maxX) - Math.max(ra.minX, rb.minX);
  const d = Math.min(ra.maxZ, rb.maxZ) - Math.max(ra.minZ, rb.minZ);
  return w > 0 && d > 0 ? w * d : 0;
}

export function containsRect(outer, inner, tolerance = 1e-6) {
  const o = rectOf(outer);
  const i = rectOf(inner);
  return (
    i.minX >= o.minX - tolerance &&
    i.maxX <= o.maxX + tolerance &&
    i.minZ >= o.minZ - tolerance &&
    i.maxZ <= o.maxZ + tolerance
  );
}

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

/** Removes consecutive duplicate points so paths never contain zero-length segments. */
export function dedupePoints(points, epsilon = 1e-6) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || distance(last, p) > epsilon) out.push(p);
  }
  return out;
}

export const round = (value, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};
