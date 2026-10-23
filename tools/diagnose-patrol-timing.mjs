// Diagnostic only: compare current navigation with resetting the cooldown when
// the path was explicitly invalidated. The override exists only on test objects.
import fs from 'node:fs';
import { Level } from '../src/level.js';

const input = process.argv[2] || 'assets/levels/map704.json';
const def = JSON.parse(fs.readFileSync(input, 'utf8'));
def.mask = JSON.parse(fs.readFileSync(def.mask, 'utf8'));
function run(resetInvalidPath) {
  const level = new Level(def), dt = 1 / 60;
  return level.cats.map((cat, index) => {
    if (resetInvalidPath) {
      const original = cat.navigate;
      cat.navigate = function (...args) {
        if (!this.navPath) this.repathTimer = 0;
        return original.apply(this, args);
      };
    }
    const initialAngleDeg = cat.angle * 180 / Math.PI;
    const marks = [];
    let oldIndex = cat.routeIndex, oldDir = cat.routeDir;
    let idleWaitingFrames = 0, wallFrames = 0;
    for (let frame = 0; frame < 120 * 60; frame++) {
      const x = cat.x, y = cat.y;
      cat.update(dt, level.world, { x: -9999, y: -9999 });
      if (Math.hypot(cat.x - x, cat.y - y) < 1e-8 && !cat.navPath && cat.repathTimer > 0 && cat.endpointTimer <= 0) idleWaitingFrames++;
      if (level.world.circleHitsWall(cat.x, cat.y, cat.radius)) wallFrames++;
      if (cat.routeMode === 'loop' ? cat.routeIndex < oldIndex : cat.routeDir !== oldDir) marks.push(frame * dt);
      oldIndex = cat.routeIndex; oldDir = cat.routeDir;
    }
    const stride = cat.routeMode === 'loop' ? 1 : 2;
    const periods = marks.slice(stride).map((t, i) => +(t - marks[i]).toFixed(3));
    return { index, mode: cat.routeMode, initialAngleDeg: +initialAngleDeg.toFixed(2), periodsSec: periods,
      unintendedWaitSec: +(idleWaitingFrames * dt).toFixed(3), wallFrames };
  });
}
console.log(JSON.stringify({ level: def.id, baseline: run(false), resetInvalidPath: run(true),
  limits: 'An in-memory diagnostic, not a production fix or native parity evidence. Shortened periods also reflect the existing waypoint arrival threshold.' }, null, 2));
