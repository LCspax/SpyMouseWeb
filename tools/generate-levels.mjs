// Generates a first-pass playable level for every imported map (real
// background + collision mask, auto start/exit/cheese/cat placement).
// Refine individual levels with editor.html.
//   node tools/generate-levels.mjs
import fs from "fs";
import path from "path";
import { World } from "../src/world.js";

const OUT = path.resolve("assets/levels");
const levels = JSON.parse(fs.readFileSync(path.resolve("assets/levels.json"), "utf8"));

// unique maps in level_data order
const seen = new Set();
const ordered = [];
for (const lv of levels) {
  if (seen.has(lv.map)) continue;
  seen.add(lv.map);
  ordered.push(lv);
}

function bfsDist(world, sx, sy) {
  const n = world.cols * world.rows;
  const dist = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  const s = sy * world.cols + sx;
  dist[s] = 0;
  q[tail++] = s;
  const dirs = [1, -1, world.cols, -world.cols];
  const cells = [{ tx: sx, ty: sy, d: 0 }];
  while (head < tail) {
    const cur = q[head++];
    const cx = cur % world.cols;
    const cy = (cur / world.cols) | 0;
    for (let i = 0; i < 4; i++) {
      const nb = cur + dirs[i];
      if (nb < 0 || nb >= n) continue;
      const nx = nb % world.cols;
      const ny = (nb / world.cols) | 0;
      if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
      if (dist[nb] !== -1 || world.isWall(nx, ny)) continue;
      dist[nb] = dist[cur] + 1;
      cells.push({ tx: nx, ty: ny, d: dist[nb] });
      q[tail++] = nb;
    }
  }
  return cells;
}

let written = 0;
const index = [];

for (const lv of ordered) {
  const maskPath = path.resolve("assets/masks/map" + lv.map + ".json");
  if (!fs.existsSync(maskPath)) continue;
  const mask = JSON.parse(fs.readFileSync(maskPath, "utf8"));
  const world = World.fromMask(mask);

  const open = [];
  for (let y = 0; y < world.rows; y++)
    for (let x = 0; x < world.cols; x++) if (!world.isWall(x, y)) open.push({ tx: x, ty: y });
  if (!open.length) continue;

  const cxm = open.reduce((a, c) => a + c.tx, 0) / open.length;
  const cym = open.reduce((a, c) => a + c.ty, 0) / open.length;
  let start = open[0], bestD = 1e9;
  for (const c of open) {
    const d = (c.tx - cxm) ** 2 + (c.ty - cym) ** 2;
    if (d < bestD) { bestD = d; start = c; }
  }

  const cells = bfsDist(world, start.tx, start.ty);
  const reach = cells.filter((c) => c.d > 0);
  reach.sort((a, b) => b.d - a.d);
  const maxD = reach.length ? reach[0].d : 0;
  const pickAt = (frac) => {
    if (!reach.length) return start;
    const target = Math.round(maxD * frac);
    let best = reach[0];
    for (const c of reach) if (Math.abs(c.d - target) < Math.abs(best.d - target)) best = c;
    return best;
  };

  const px = (c) => ({ x: (c.tx + 0.5) * world.cell, y: (c.ty + 0.5) * world.cell });

  const exitCell = reach[0] || start;
  const cheeses = [];
  for (const f of [0.4, 0.65, 0.85]) {
    const c = pickAt(f);
    const p = px(c);
    if (!cheeses.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < world.cell * 3)) cheeses.push(p);
  }
  if (!cheeses.length) cheeses.push(px(start));

  const catCell = pickAt(0.4);
  const catTarget = pickAt(0.8);
  const catRoute = [{ x: (catCell.tx + 0.5) * world.cell, y: (catCell.ty + 0.5) * world.cell }];
  if (Math.hypot(catTarget.tx - catCell.tx, catTarget.ty - catCell.ty) > 2) {
    catRoute.push({ x: (catTarget.tx + 0.5) * world.cell, y: (catTarget.ty + 0.5) * world.cell });
  } else if (reach.length) {
    const far = reach[0];
    catRoute.push({ x: (far.tx + 0.5) * world.cell, y: (far.ty + 0.5) * world.cell });
  }
  const cat = {
    x: catRoute[0].x,
    y: catRoute[0].y,
    angle: catRoute.length > 1 ? Math.atan2(catRoute[1].y - catRoute[0].y, catRoute[1].x - catRoute[0].x) : Math.PI / 2,
    route: catRoute,
  };

  const def = {
    id: "map" + lv.map,
    num: lv.num,
    name: lv.name,
    theme: lv.theme,
    bg: `assets/maps/map${lv.map}.jpg`,
    mask: `assets/masks/map${lv.map}.json`,
    generated: true,
    mouseStart: px(start),
    exit: px(exitCell),
    cheeses,
    cats: [cat],
  };

  fs.writeFileSync(path.join(OUT, `map${lv.map}.json`), JSON.stringify(def, null, 2));
  index.push({ id: def.id, num: def.num, name: def.name, theme: def.theme, file: `assets/levels/map${lv.map}.json` });
  written++;
}

fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2));
console.log(`generated ${written} levels`);
