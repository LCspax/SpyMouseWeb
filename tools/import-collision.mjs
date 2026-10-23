// Import the native MBN line-A wall contours into per-map collision files.
// MBN stores linesB as the route graph; linesA are the authored wall/boundary
// contours (the same polylines the XML editor exposes as <Line>). The web port
// previously used only colour-derived masks, so this keeps the shipped
// geometry available to the runtime collision checks.
import fs from 'node:fs';
import path from 'node:path';
import {parseMbn} from './decode-mbn.mjs';

const ROOT = process.cwd();
const RES = path.join(ROOT, 'com.ea.spymouse_row', 'files', 'res');
const OUT = path.join(ROOT, 'assets', 'collision');

function worldPoint(v) {
  return { x: v.x * 2 + 32, y: (320 - v.y) * 2 + 64 };
}

// Interactive openings cut through the authored wall contours. The colour mask
// already carves them; the raw MBN wall line stays continuous across the hole,
// so collision must leave a gap at the same places or the mouse can never reach
// the hole/exit mouth.
// Line records carry a property/type in `c`. 0 is the generic wall contour.
// 142 is the authored tutorial/guide path (map10: the dashed spawn->exit line),
// not collision. Treat it and other presentation lines as non-solid; they are
// still available in the original data for rendering.
const NON_COLLISION_LINE_PROPS = new Set([142]);

const OPENING_PROPS = new Set([
  20, 21, 22, 23,
  31, 33, 34, 35, 36, 37, 38, 39, 267, 268, 320,
  200, 201, 202, 203, 204, 205, 206, 207,
  240, 241, 242, 243, 244, 245, 246, 247,
  357, 358, 359,
]);

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function importMap(key, file) {
  const info = parseMbn(file);
  if (!info.eof || info.hashOk === false) throw new Error(`Invalid MBN ${file}`);
  const openings = info.vertices
    .filter((v) => v.flags === 10 && OPENING_PROPS.has(v.prop))
    .map(worldPoint);
  const segments = [];
  for (const line of info.linesA) {
    if (NON_COLLISION_LINE_PROPS.has(line.c)) continue;
    const a = info.vertices[line.vA];
    const b = info.vertices[line.vB];
    if (!a || !b) continue;
    const pa = worldPoint(a);
    const pb = worldPoint(b);
    if (![pa.x, pa.y, pb.x, pb.y].every(Number.isFinite)) {
      throw new Error(`${file}: non-finite line ${line.vA}-${line.vB}`);
    }
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 0.01) continue;
    if (openings.some((o) => pointSegmentDistance(o.x, o.y, pa.x, pa.y, pb.x, pb.y) < 26)) continue;
    segments.push([pa.x, pa.y, pb.x, pb.y]);
  }
  const payload = {
    source: 'runtime-mbn-linesA',
    file: path.relative(ROOT, file).replaceAll('\\', '/'),
    count: segments.length,
    segments,
  };
  fs.writeFileSync(path.join(OUT, `${key}.json`), JSON.stringify(payload));
  return segments.length;
}

fs.mkdirSync(OUT, { recursive: true });
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'levels', 'index.json'), 'utf8'));
const keys = new Set();
let maps = 0;
let segments = 0;

for (const entry of index) {
  const id = entry.id;
  const main = path.join(RES, id, `${id}.mbn`);
  if (!fs.existsSync(main)) throw new Error(`Missing runtime map ${main}`);
  segments += importMap(id, main);
  keys.add(id);
  maps++;
  for (const name of fs.readdirSync(path.join(RES, id)).filter((n) => new RegExp(`^${id}_[0-9]+\\.mbn$`).test(n))) {
    const key = name.replace('.mbn', '');
    segments += importMap(key, path.join(RES, id, name));
    keys.add(key);
    maps++;
  }
}

// Keep collision for shipped maps that are not in the selectable 121 list
// (boss sub-areas), so audits can still use them.
for (const dir of fs.readdirSync(RES).filter((n) => /^map\d+$/.test(n))) {
  for (const name of fs.readdirSync(path.join(RES, dir)).filter((n) => n.endsWith('.mbn'))) {
    const key = name.replace('.mbn', '');
    if (keys.has(key)) continue;
    const file = path.join(RES, dir, name);
    try {
      segments += importMap(key, file);
      keys.add(key);
      maps++;
    } catch (error) {
      console.warn(`skip ${key}: ${error.message}`);
    }
  }
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify([...keys].sort(), null, 1));
console.log(`Collision: ${maps} maps, ${segments} native wall segments`);
