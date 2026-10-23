import fs from "fs";
import { Level } from "../src/level.js";

const file = process.argv[2] || "assets/levels/map10.json";
const def = JSON.parse(fs.readFileSync(file, "utf8"));
def.mask = JSON.parse(fs.readFileSync(def.mask, "utf8"));
const lvl = new Level(def);
const w = lvl.world;
const c = lvl.cats[0];
console.log("cat", c.x.toFixed(1), c.y.toFixed(1), "exit", lvl.exit.x, lvl.exit.y, "cell", w.cell);
console.log("start tile", w.nearestOpen(c.x, c.y), "exit tile", w.nearestOpen(lvl.exit.x, lvl.exit.y));
const p = w.bfsToWorld(c.x, c.y, lvl.exit.x, lvl.exit.y);
console.log("path len", p ? p.length : p);
if (p) console.log("first pts", p.slice(0, 3).map((q) => `(${q.x},${q.y})`).join(" "));

const x0 = c.x, y0 = c.y;
c.route = [{ x: c.x, y: c.y }, { x: lvl.exit.x, y: lvl.exit.y }];
c.routeIndex = 1;
c.state = "patrol";
c.navPath = null;
c.repathTimer = 0;
const dt = 1 / 60;
for (let i = 0; i < 180; i++) {
  c.update(dt, w, { x: 9999, y: 9999 });
  if (i % 30 === 0)
    console.log(
      `t=${(i * dt).toFixed(2)} pos=(${c.x.toFixed(1)},${c.y.toFixed(1)}) state=${c.state} cursor=${c.cursor} navlen=${c.navPath ? c.navPath.length : null}`
    );
}
console.log("moved", Math.hypot(c.x - x0, c.y - y0).toFixed(1));
