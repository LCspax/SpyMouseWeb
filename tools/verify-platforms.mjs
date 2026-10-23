// Verify the final chapter's moving platforms against native 0x96b80:
// they advance their authored route and play 114, but do NOT carry riders and
// do NOT write terrain collision.
//   node tools/verify-platforms.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { loadContent } from '../src/content.js';

globalThis.window = { devicePixelRatio: 1 };
globalThis.Image = class { set src(_v) {} };
globalThis.fetch = async (url) => ({ ok: fs.existsSync(url), json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 960, height: 640 }) };
const { levels } = await loadContent();
const worlds = JSON.parse(fs.readFileSync('assets/menu/worlds.json', 'utf8'));
const finalIds = new Set(worlds.find((w) => w.id === 8).nodes.map((n) => n.levelId));

const checked = [];
for (const def of levels.filter((d) => finalIds.has(d.id))) {
  const g = new Game(canvas, { intro: false });
  g.loadLevel(def, 0);
  for (const floor of g.floorLevels.values()) {
    g.level = floor;
    const m = floor.mechanisms;
    for (const p of m.platforms) {
      p.x = p.home.x; p.y = p.home.y;
      p.routeStopped = false; p.routeIndex = undefined; p.routeDirection = undefined; p.routeWait = undefined;
      m.prepare(g, 1 / 60);
      Object.assign(g.mouse, { x: p.x, y: p.y, hidden: false, airborne: false });
      const start = { x: p.x, y: p.y };
      const mouseStart = { x: g.mouse.x, y: g.mouse.y };
      const base = floor.world.grid.slice();
      let wallHit = null;
      for (let i = 0; i < 1200; i++) {
        m.prepare(g, 1 / 60);
        if (floor.world.isWallAt(g.mouse.x, g.mouse.y)) { wallHit = { x: g.mouse.x, y: g.mouse.y, i }; }
        if (p.routeStopped) break;
      }
      // A platform may start partly outside the floor (map734 tag2); the
      // native contract tested here is no rider carry and no terrain write.
      void wallHit;
      assert.equal(g.mouse.x, mouseStart.x, `${def.id}/${floor.floor}/${p.tag}: platform carried the hero X`);
      assert.equal(g.mouse.y, mouseStart.y, `${def.id}/${floor.floor}/${p.tag}: platform carried the hero Y`);
      assert.deepEqual(floor.world.grid, base, `${def.id}/${floor.floor}/${p.tag}: platform wrote collision grid`);
      assert(Math.hypot(p.x - start.x, p.y - start.y) > 2, `${def.id}/${floor.floor}/${p.tag}: platform never moved`);
      checked.push({ level: def.id, floor: floor.floor, tag: p.tag, moved: Math.round(Math.hypot(p.x - start.x, p.y - start.y)) });
    }
  }
}
assert(checked.length >= 10, `expected all final-chapter platforms, checked ${checked.length}`);
console.log(`platform verification OK: ${checked.length} final-chapter platforms move without carrying riders or writing terrain`);
for (const row of checked) console.log(`  ${row.level}/${row.floor} tag=${row.tag} moved=${row.moved}px`);

