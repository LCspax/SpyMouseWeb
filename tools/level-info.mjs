// Print snapped entity positions for a level (useful for previews/debugging).
//   node tools/level-info.mjs assets/levels/map10.json
import fs from "fs";
import { World } from "../src/world.js";

const file = process.argv[2] || "assets/levels/map10.json";
const def = JSON.parse(fs.readFileSync(file, "utf8"));
const mask = JSON.parse(fs.readFileSync(def.mask, "utf8"));
const w = World.fromMask(mask);
const snap = (p) => w.closestOpen(p.x, p.y);

const out = {
  id: def.id,
  size: { w: w.w, h: w.h, cell: w.cell },
  mouseStart: snap(def.mouseStart),
  exit: def.exit ? snap(def.exit) : null,
  cheeses: (def.cheeses || []).map(snap),
  cats: (def.cats || []).map((c) => ({
    ...snap(c),
    angle: c.angle,
    route: c.route ? c.route.map(snap) : [],
  })),
};
console.log(JSON.stringify(out, null, 2));
