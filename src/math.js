export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}
export function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function rotateToward(cur, target, maxStep) {
  const d = angleDiff(target, cur);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

// Shortest distance from point P to segment AB, plus the closest point.
export function pointSegDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / len2;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t, cy = ay + aby * t;
  return { dist: dist(px, py, cx, cy), t, x: cx, y: cy };
}

// Returns list of intersection params {t, u, x, y} between segment p->p2 and q->q2.
export function segmentIntersect(px, py, px2, py2, qx, qy, qx2, qy2) {
  const rx = px2 - px, ry = py2 - py;
  const sx = qx2 - qx, sy = qy2 - qy;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((qx - px) * sy - (qy - py) * sx) / denom;
  const u = ((qx - px) * ry - (qy - py) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: px + rx * t, y: py + ry * t };
}
