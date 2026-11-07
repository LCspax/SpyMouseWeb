// One-to-one pairing of prop-11 cwmice with prop-60 vanish points.
//
// Reverse engineering (analysis/parallel/L2/notes.md §5) shows prop 60 has no
// controller: it is a generic vanish point that consumes whichever prop 11 the
// player is currently carrying. The original XML therefore authors NO explicit
// link - it simply places one prop 60 per prop 11, with adjacent ids. The web
// port gives each cwmouse its own `trap`, so a per-mouse "nearest hole" rule is
// wrong: three mice in map565 all picked hole 191 and holes 192/193 became dead
// objects. This module computes a global minimum-cost assignment instead.
//
// Cost = distance (the hop from A to B is what the player sees) with an
// authoring-adjacent id gap as the tie-breaker. Kuhn-Munkres (Hungarian) so the
// result is a true 1:1 matching, not a greedy approximation.
export function assignTraps(mice, holes, cost) {
  const n = mice.length, m = holes.length;
  if (!n || !m) return [];
  const N = Math.max(n, m);
  // Pad to a square matrix. Dummy rows/columns cost 0; real cells stay finite.
  const a = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) =>
      i < n && j < m ? cost(mice[i], holes[j]) : 0));
  const u = new Float64Array(N + 1);
  const v = new Float64Array(N + 1);
  const p = new Int32Array(N + 1);
  const way = new Int32Array(N + 1);
  for (let i = 1; i <= N; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(N + 1).fill(Infinity);
    const used = new Uint8Array(N + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= N; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= N; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array(n).fill(null);
  for (let j = 1; j <= N; j++) {
    if (p[j] > 0 && p[j] <= n && j <= m) out[p[j] - 1] = j - 1;
  }
  return out;
}

/** Distance in world px, with a tiny authoring-id tie-breaker. */
export function trapCost(mouse, hole) {
  const d = Math.hypot(hole.x - mouse.x, hole.y - mouse.y);
  const idGap = Number.isFinite(mouse.id) && Number.isFinite(hole.id)
    ? Math.abs(hole.id - mouse.id) : 0;
  return d + idGap * 0.001;
}
