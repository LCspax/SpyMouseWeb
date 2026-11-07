// Repair the colour-derived walk masks of the eight Boss-approach maps against
// the ORIGINAL geometry.
//
// The shipped mask is a colour classification of the background art. On the
// long entrance maps it marks large parts of the authored walkable floor as
// wall (dark rugs, shadows, furniture, the plain grey extension of map816).
// The native MBN `linesB` graph is the authoritative walking network: cats,
// scripted actors and the mouse all move along it in the original game. Where
// the colour mask disagrees, the player snags ("stuck foot"), and `snapAll()`
// in src/content.js drags entities and their routes to far-away open cells.
//
// This pass only OPENS cells (wall -> floor); it never closes anything. It
// carves a hero-width corridor along every native linesB leg, plus a small
// pocket at each authored prop-11 cwmouse / prop-60 trap, so:
//   * World.gridCircleHitsWall(x, y, HERO_R) is false on the native routes,
//   * cwmice keep their authored coordinates instead of being snapped 100+ px,
//   * the white cat's native route survives `snapAll` un-distorted, which is
//     what the scroll camera follows.
//
// Only the eight entrance maps are touched. A one-cell border is preserved so
// carving can never open a way out of the level.
//
//   node tools/carve-approach-masks.mjs
//   node tools/carve-approach-masks.mjs --only=map816,map575
import fs from 'node:fs';
import path from 'node:path';
import { parseMbn } from './decode-mbn.mjs';
import { BOSS_LINKS } from '../src/boss-links.js';

const ROOT = process.cwd();
const RES = path.join(ROOT, 'com.ea.spymouse_row', 'files', 'res');
const MASKS = path.join(ROOT, 'assets', 'masks');
const HERO_R = 0.35 * 16; // CFG.mouse.radiusCells * world.cell = 5.6
const CLEARANCE = HERO_R + 4; // 9.6 world px: hero body + 4 px of slack

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

function nativePoints(id, props) {
  const file = path.join(RES, id, `${id}.xml`);
  const xml = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of xml.matchAll(/<Vertex\s+([^>]*)\/>/g)) {
    if (num(m[1], 'Flags') !== 10 || !props.has(num(m[1], 'Property'))) continue;
    out.push({ x: 2 * num(m[1], 'x') + 32, y: 2 * num(m[1], 'y') + 64 });
  }
  return out;
}

function mbnWorld(v) {
  return { x: v.x * 2 + 32, y: (320 - v.y) * 2 + 64 };
}

/** Open every wall cell whose rectangle comes within `r` of (cx, cy). */
function carveDisk(chars, cols, rows, cell, cx, cy, r) {
  // Native world coords carry a 32 px letterbox offset, so the last authored
  // route leg often reaches INTO the final column of the shipped background.
  // Open that column too; x >= cols*cell is still out of bounds for the hero,
  // so this cannot open a way out of the level.
  const minTx = Math.max(1, Math.floor((cx - r) / cell));
  const maxTx = Math.min(cols - 1, Math.floor((cx + r) / cell));
  const minTy = Math.max(1, Math.floor((cy - r) / cell));
  const maxTy = Math.min(rows - 1, Math.floor((cy + r) / cell));
  let opened = 0;
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const rx = tx * cell, ry = ty * cell;
      const px = Math.max(rx, Math.min(cx, rx + cell));
      const py = Math.max(ry, Math.min(cy, ry + cell));
      if ((cx - px) ** 2 + (cy - py) ** 2 > r * r) continue;
      const i = ty * cols + tx;
      if (chars[i] === '1') continue;
      chars[i] = '1';
      opened++;
    }
  }
  return opened;
}

let totalCells = 0;
let totalLegs = 0;
for (const id of ENTRANCES) {
  const maskPath = path.join(MASKS, `${id}.json`);
  const mask = JSON.parse(fs.readFileSync(maskPath, 'utf8'));
  const { cols, rows, cell } = mask;
  const chars = [...mask.data];
  const mbn = parseMbn(path.join(RES, id, `${id}.mbn`));
  let opened = 0;
  let legs = 0;

  for (const line of mbn.linesB || []) {
    const a = mbn.vertices[line.vA], b = mbn.vertices[line.vB];
    if (!a || !b) continue;
    const pa = mbnWorld(a), pb = mbnWorld(b);
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (d < 0.5) continue;
    // Sampling must be denser than the hero radius or a wall cell could be
    // missed between two disks.
    const steps = Math.max(1, Math.ceil(d / Math.max(2, cell * 0.35)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      opened += carveDisk(chars, cols, rows, cell,
        pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t, CLEARANCE);
    }
    legs++;
  }

  // Authored prop 11 (cwmouse) and prop 60 (trap / vanish point).
  const spawns = nativePoints(id, new Set([11, 60]));
  for (const p of spawns) opened += carveDisk(chars, cols, rows, cell, p.x, p.y, CLEARANCE + 2);

  if (!opened) {
    console.log(`${id}: already clear (${legs} native legs, ${spawns.length} spawns)`);
    continue;
  }
  mask.data = chars.join('');
  fs.writeFileSync(maskPath, JSON.stringify(mask));
  totalCells += opened;
  totalLegs += legs;
  console.log(`${id}: opened ${opened} wall cells along ${legs} native legs + ${spawns.length} spawns`);
}
console.log(`carve-approach: ${totalCells} cells opened across ${ENTRANCES.length} entrance maps (${totalLegs} legs with changes)`);
