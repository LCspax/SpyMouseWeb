// Read-only evidence report for Level.resolveRoute (H2 out-of-world waypoint
// resolution). The level JSON keeps the native coordinates; the runtime route
// may differ, so the fidelity audit's exact match proves source assignment,
// not execution geometry. This tool lists every resolved point with its
// original and landed position plus displacement statistics.
import fs from "node:fs";
import path from "node:path";
import { Level } from "../src/level.js";

const dir = "assets/levels";
const perCat = [];
const stats = {
  levels: 0,
  cats: 0,
  catsAffected: 0,
  resolvedPoints: 0,
  displacementPx: { min: null, median: null, max: null },
};
const displacements = [];

for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".json") || f === "index.json") continue;
  const def = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (!def.mask) continue;
  def.mask = JSON.parse(fs.readFileSync(def.mask, "utf8"));
  const lvl = new Level(def);
  stats.levels++;
  lvl.cats.forEach((cat, ci) => {
    stats.cats++;
    const resolved = cat.routeResolvedOob || [];
    if (!resolved.length) return;
    stats.catsAffected++;
    stats.resolvedPoints += resolved.length;
    const src = def.cats[ci].route || [];
    for (const r of resolved) {
      const d = Math.hypot(r.to.x - r.from.x, r.to.y - r.from.y);
      displacements.push(d);
      perCat.push({
        map: def.id,
        num: def.num,
        tag: def.cats[ci].tag,
        prop: def.cats[ci].prop,
        routeMode: cat.routeMode,
        routeSource: def.cats[ci].routeSource || null,
        index: r.index,
        native: { x: r.from.x, y: r.from.y },
        executed: { x: r.to.x, y: r.to.y },
        displacementPx: +d.toFixed(2),
        sourcePointMatches: src[r.index] ? src[r.index].x === r.from.x && src[r.index].y === r.from.y : null,
        executionPointMatches: cat.route[r.index]
          ? cat.route[r.index].x === r.to.x && cat.route[r.index].y === r.to.y
          : null,
      });
    }
  });
}
displacements.sort((a, b) => a - b);
if (displacements.length) {
  stats.displacementPx.min = +displacements[0].toFixed(2);
  stats.displacementPx.max = +displacements[displacements.length - 1].toFixed(2);
  stats.displacementPx.median = +displacements[Math.floor(displacements.length / 2)].toFixed(2);
}
const byMap = {};
for (const c of perCat) byMap[c.map] = (byMap[c.map] || 0) + 1;
const out = {
  note: "Native coordinates are preserved in assets/levels/*.json; the runtime route is adjusted only for out-of-world points so the cat can reach them in the shipped art extent. This is a web accommodation, not native behavior.",
  stats: { ...stats, byMap },
  resolutions: perCat,
};
console.log(JSON.stringify(out, null, 2));
