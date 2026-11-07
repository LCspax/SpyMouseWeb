// Repair the authored prop-11 / prop-60 data of the eight Boss-approach maps.
//
// The generic importer (tools/import-entities.mjs) snaps every entity through
// World.closestOpen() over the COLOUR MASK ALONE. It cannot see the native MBN
// linesA wall segments, and before the mask repair it could drag an authored
// cwmouse more than 100 px into another room (map575 id 989: 6098,304 ->
// 6040,392). It also paired each cwmouse independently, so several mice shared
// one trap and the leftover traps were dead runtime objects.
//
// This pass re-derives ONLY the cwmice / trap data of the eight entrance maps
// from the original XML, using the repaired mask AND the repaired collision
// segments, and writes a true 1:1 pairing. Everything else in the level JSON
// (cheese, cats, routes, exits, mechanisms) is left untouched.
//
//   node tools/fix-boss-entrances.mjs
//   node tools/fix-boss-entrances.mjs --only=map816,map575
import fs from 'node:fs';
import path from 'node:path';
import { World } from '../src/world.js';
import { BOSS_LINKS } from '../src/boss-links.js';
import { assignTraps, trapCost } from './pair-cwmice.mjs';

const ROOT = process.cwd();
const RES = path.join(ROOT, 'com.ea.spymouse_row', 'files', 'res');
const LEVELS = path.join(ROOT, 'assets', 'levels');
const MASKS = path.join(ROOT, 'assets', 'masks');
const COLLISION = path.join(ROOT, 'assets', 'collision');
const HERO_R = 0.35 * 16;

const args = process.argv.slice(2);
const ONLY_ARG = args.find((a) => a.startsWith('--only='));
const ONLY = ONLY_ARG
  ? new Set(ONLY_ARG.slice('--only='.length).split(',').filter(Boolean))
  : null;
const ENTRANCES = BOSS_LINKS.map((link) => link.entrance).filter((id) => !ONLY || ONLY.has(id));

const num = (a, k) => {
  const m = a.match(new RegExp(k + '\\s*=\\s*"?(-?\\d+)"?', 'i'));
  return m ? +m[1] : 0;
};

function readXml(id) {
  const xml = fs.readFileSync(path.join(RES, id, `${id}.xml`), 'utf8');
  const mice = [], traps = [];
  for (const m of xml.matchAll(/<Vertex\s+([^>]*)\/>/g)) {
    const a = m[1];
    if (num(a, 'Flags') !== 10) continue;
    const prop = num(a, 'Property');
    if (prop !== 11 && prop !== 60) continue;
    const v = {
      id: num(a, 'id'),
      prop,
      tag: num(a, 'Tag'),
      flags: num(a, 'Flags'),
      x: 2 * num(a, 'x') + 32,
      y: 2 * num(a, 'y') + 64,
    };
    (prop === 11 ? mice : traps).push(v);
  }
  return { mice, traps };
}

/** Keep the authored point whenever it is actually walkable with a full body. */
function safeSpawn(world, p) {
  if (!world.circleHitsWall(p.x, p.y, HERO_R)) return { x: p.x, y: p.y };
  const nudged = world.clearPoint(p.x, p.y, HERO_R);
  if (!world.circleHitsWall(nudged.x, nudged.y, HERO_R)) return { x: nudged.x, y: nudged.y };
  return world.closestOpen(p.x, p.y, HERO_R);
}

let totalMice = 0;
let totalTraps = 0;
for (const id of ENTRANCES) {
  const levelPath = path.join(LEVELS, `${id}.json`);
  const def = JSON.parse(fs.readFileSync(levelPath, 'utf8'));
  const mask = JSON.parse(fs.readFileSync(path.join(MASKS, `${id}.json`), 'utf8'));
  const collision = JSON.parse(fs.readFileSync(path.join(COLLISION, `${id}.json`), 'utf8'));
  const world = World.fromMask(mask);
  world.setCollisionSegments(collision.segments);
  const { mice, traps } = readXml(id);

  const cwmice = mice.map((v) => {
    const p = safeSpawn(world, v);
    return {
      x: p.x,
      y: p.y,
      source: 'xml',
      id: v.id,
      prop: 11,
      tag: v.tag,
      ox: v.x,
      oy: v.y,
    };
  });
  const assignment = assignTraps(cwmice, traps, trapCost);
  let maxDrift = 0;
  for (let i = 0; i < cwmice.length; i++) {
    const h = assignment[i] == null ? null : traps[assignment[i]];
    const trap = h ? { x: h.x, y: h.y, id: h.id } : null;
    cwmice[i].trap = trap;
    cwmice[i].hole = trap; // deprecated alias read by src/cwmouse.js
    maxDrift = Math.max(maxDrift, Math.hypot(cwmice[i].x - cwmice[i].ox, cwmice[i].y - cwmice[i].oy));
  }

  // The native world coords carry a 32 px letterbox offset, so the LAST white
  // cat waypoint usually sits past the shipped background (map556: x=6242 on a
  // 6144 px image). src/content.js snaps it back with closestOpen(), which used
  // to jump 150 px and kink the final camera leg. Clamp those out-of-bounds
  // waypoints to the playable edge first so the snap stays local.
  const white = (def.cats || []).find((c) => c.type === 3 || c.prop === 53);
  let clampedWaypoints = 0;
  if (white?.route) {
    const maxX = world.w - world.cell * 0.5;
    const maxY = world.h - world.cell * 0.5;
    const min = world.cell * 0.5;
    for (const p of white.route) {
      const x = Math.max(min, Math.min(maxX, p.x));
      const y = Math.max(min, Math.min(maxY, p.y));
      if (x !== p.x || y !== p.y) clampedWaypoints++;
      p.x = x;
      p.y = y;
    }
  }

  def.cwmice = cwmice;
  def.cwmouseHoles = traps.map((v) => ({ id: v.id, x: v.x, y: v.y, prop: 60, tag: v.tag, flags: 10 }));
  def.diagnostics.bossEntranceRepair = {
    source: 'xml-prop11-prop60',
    mice: cwmice.length,
    traps: traps.length,
    paired: assignment.filter((x) => x != null).length,
    maxSpawnDrift: +maxDrift.toFixed(1),
    clampedCatWaypoints: clampedWaypoints,
  };
  fs.writeFileSync(levelPath, JSON.stringify(def, null, 2));
  totalMice += cwmice.length;
  totalTraps += traps.length;
  console.log(`${id}: ${cwmice.length} cwmice / ${traps.length} traps, 1:1 paired=${def.diagnostics.bossEntranceRepair.paired}, max drift ${maxDrift.toFixed(1)}px`);
}
console.log(`fix-boss-entrances: ${totalMice} cwmice + ${totalTraps} traps repaired across ${ENTRANCES.length} maps`);
