// Import the native MBN line-A wall contours into per-map collision files.
// MBN stores linesB as the route graph; linesA are the authored wall/boundary
// contours (the same polylines the XML editor exposes as <Line>). The web port
// previously used only colour-derived masks, so this keeps the shipped
// geometry available to the runtime collision checks.
//
// A contour is only solid where nothing walks through it. `linesB` is the
// authored route network the native game walks bodies along (cat patrols and
// scripted walks), so a route that CROSSES a contour proves the contour is open
// at that spot. Two consequences, both measured over the 121 shipped maps:
//
//   * whole prop classes are not walls at all - a route crosses nearly all of
//     their lines (prop 114: 16/16, 140: 18/19, 143: 1/1). Those lines are
//     gameplay/presentation markers; keeping them blocked the 1-Boss corridor
//     dead in the middle (map736 x=1550) on a line the art never draws.
//   * individual wall contours keep their solid spans minus a doorway at each
//     route crossing (prop 0: 91/9673 lines, 110: 192/1737).
//
// The class rule is derived from the data at build time (crossed >= half), not
// hardcoded from memory, and the counts are printed so a data change is visible.
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

// World-px doorway cut out around each route crossing: the mouse body is 11.2
// world px wide, so 30 leaves a couple of px of slack on each side.
const ROUTE_GAP = 30;
// Below this length a trimmed span is dropped instead of kept as a stub.
const MIN_SPAN = 2;

// Opt-in repair for the Boss-approach maps (`--doorway-gaps --only=...`):
//
// The legacy rule dropped a WHOLE authored wall contour whenever any
// interactive opening sat within 26 px of it. For the wide entrance maps that
// erased real walls (map531 lost its 2048 px bottom boundary). The repaired
// rule keeps the contour and subtracts a doorway at the opening instead, plus
// a small clearance gap wherever a native linesB route waypoint touches the
// contour (those corners are where the player used to snag).
const args = process.argv.slice(2);
const ONLY_ARG = args.find((a) => a.startsWith('--only='));
const ONLY = ONLY_ARG ? new Set(ONLY_ARG.slice('--only='.length).split(',').filter(Boolean)) : null;
const DOORWAY_GAPS = args.includes('--doorway-gaps');
// A route waypoint lying on a wall corner is a legitimate turn, not a wall to
// walk into; leave enough room for the 11.2 px body. 26 px catches short wall
// stubs that sit just past a turn (map568's 11 px diagonal at x=2379,y=280 sat
// 5 px from a vertical route leg but 20 px from its endpoint).
const CORNER_GAP = 18;
const CORNER_NEAR = 26;
// Doorway left at an interactive opening (mouse hole / pipe / exit / gate).
// Slightly wider than ROUTE_GAP because the opening sprite is wider than a
// walking route line and the hero has to be able to stand in the mouth.
const DOORWAY_GAP = 34;
// A native route can also GRAZE a wall in the middle of a leg (map568's
// vertical linesB leg at x=2374 passes 5 px from a diagonal prop-141 contour,
// while both of its waypoints are 20 px away at the top). A hero body would
// clip that wall, so leave a short gap wherever a route comes this close.
const GRAZE_NEAR = 8; // hero radius 5.6 + 2.4 px slack
const GRAZE_GAP = 18;

function segmentParam(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1);
  return Math.max(0, Math.min(1, t));
}

/** A cut centred on parameter t with a world-px half width. */
function cutAround(t, halfPx, len) {
  return [t - halfPx / len, t + halfPx / len];
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Strict crossing only: touching endpoints or collinear runs (a route that
// walks alongside a wall) must not punch a hole in it.
function segmentsCross(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Parameter along (a->b) where it crosses (c->d), assuming they cross. */
function crossParam(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay;
  const sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx || 1e-9;
  return ((cx - ax) * sy - (cy - ay) * sx) / den;
}

function collectMaps() {
  const maps = [];
  const push = (key, file) => {
    try {
      const info = parseMbn(file);
      if (!info.eof || info.hashOk === false) throw new Error('hash/eof mismatch');
      maps.push({ key, file, info });
    } catch (error) {
      console.warn(`skip ${key}: ${error.message}`);
    }
  };
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'levels', 'index.json'), 'utf8'));
  const seen = new Set();
  for (const entry of index) {
    const id = entry.id;
    const main = path.join(RES, id, `${id}.mbn`);
    if (!fs.existsSync(main)) throw new Error(`Missing runtime map ${main}`);
    push(id, main);
    seen.add(id);
    for (const name of fs.readdirSync(path.join(RES, id)).filter((n) => new RegExp(`^${id}_[0-9]+\\.mbn$`).test(n))) {
      const key = name.replace('.mbn', '');
      push(key, path.join(RES, id, name));
      seen.add(key);
    }
  }
  // Keep collision for shipped maps that are not in the selectable 121 list
  // (boss sub-areas), so audits can still use them.
  for (const dir of fs.readdirSync(RES).filter((n) => /^map\d+$/.test(n))) {
    for (const name of fs.readdirSync(path.join(RES, dir)).filter((n) => n.endsWith('.mbn'))) {
      const key = name.replace('.mbn', '');
      if (seen.has(key)) continue;
      push(key, path.join(RES, dir, name));
      seen.add(key);
    }
  }
  return maps;
}

// ---- pass 1: which line props are walls at all? --------------------------
const classStats = new Map(); // prop -> {lines, crossed}
const mapLines = []; // {key, file, segments, routes}
const maps = collectMaps();

for (const { key, file, info } of maps) {
  const routes = [];
  for (const line of info.linesB || []) {
    const a = info.vertices[line.vA], b = info.vertices[line.vB];
    if (!a || !b) continue;
    const pa = worldPoint(a), pb = worldPoint(b);
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 0.5) continue;
    routes.push([pa, pb]);
  }
  const contours = [];
  for (const line of info.linesA) {
    const a = info.vertices[line.vA], b = info.vertices[line.vB];
    if (!a || !b) continue;
    const pa = worldPoint(a), pb = worldPoint(b);
    if (![pa.x, pa.y, pb.x, pb.y].every(Number.isFinite)) {
      throw new Error(`${file}: non-finite line ${line.vA}-${line.vB}`);
    }
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (len < 0.01) continue;
    const crossings = [];
    for (const [rc, rd] of routes) {
      if (!segmentsCross(pa, pb, rc, rd)) continue;
      const t = crossParam(pa.x, pa.y, pb.x, pb.y, rc.x, rc.y, rd.x, rd.y);
      if (t > 0 && t < 1) crossings.push(t);
    }
    const stat = classStats.get(line.c) || { lines: 0, crossed: 0 };
    stat.lines++;
    if (crossings.length) stat.crossed++;
    classStats.set(line.c, stat);
    contours.push({ prop: line.c, pa, pb, len, crossings });
  }
  mapLines.push({ key, file, info, contours, routes });
}

// A class is non-solid when routes walk through more than half of its lines.
// One-line classes need two crossings to count (a single sloppy route must not
// erase a wall class).
const nonSolid = new Set(NON_COLLISION_LINE_PROPS);
for (const [prop, stat] of classStats) {
  if (nonSolid.has(prop)) continue;
  if (stat.crossed === stat.lines && stat.lines >= 1 && stat.crossed >= 2) nonSolid.add(prop);
  else if (stat.lines >= 3 && stat.crossed / stat.lines >= 0.5) nonSolid.add(prop);
}
const classRows = [...classStats.entries()]
  .sort((a, b) => b[1].lines - a[1].lines)
  .map(([prop, s]) => `  prop ${prop}: ${s.lines} lines, ${s.crossed} crossed by a route${nonSolid.has(prop) ? '  -> non-solid' : ''}`);
console.log('Line classes (MBN linesA):');
console.log(classRows.join('\n'));

// ---- pass 2: write trimmed collision ------------------------------------
// `--only` narrows the FILES WE WRITE, not the maps we learn the line classes
// from: the non-solid class rule is a global statistic over all 203 maps and
// must stay identical between a full build and a targeted repair.
let written = 0;
let kept = 0;
let droppedContours = 0;
let repairedDoorways = 0;
for (const { key, file, info, contours, routes } of mapLines) {
  if (ONLY && !ONLY.has(key)) continue;
  const openings = info.vertices
    .filter((v) => v.flags === 10 && OPENING_PROPS.has(v.prop))
    .map(worldPoint);
  // Unique linesB waypoints. A waypoint sitting on an authored corner is a
  // legal turn, not a wall to walk into; the legacy importer kept the wall
  // across it and the player snagged on the corner (the "stuck foot" report).
  const waypoints = [];
  if (DOORWAY_GAPS) {
    const seen = new Set();
    for (const [a, b] of routes) for (const p of [a, b]) {
      const k = `${Math.round(p.x)},${Math.round(p.y)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      waypoints.push(p);
    }
  }
  const segments = [];
  for (const { prop, pa, pb, len, crossings } of contours) {
    if (nonSolid.has(prop)) continue;
    // Legacy behaviour: one opening near a contour erased the WHOLE contour.
    // On a 6-screen entrance that deleted real boundary walls (map531 lost its
    // 2048 px bottom edge). Keep it for the full-library build so the other
    // 195 maps are byte-identical to the shipped data.
    if (!DOORWAY_GAPS && openings.some((o) => pointSegmentDistance(o.x, o.y, pa.x, pa.y, pb.x, pb.y) < 26)) {
      droppedContours++;
      continue;
    }
    const cuts = crossings.map((t) => cutAround(t, ROUTE_GAP / 2, len));
    if (DOORWAY_GAPS) {
      for (const o of openings) {
        if (pointSegmentDistance(o.x, o.y, pa.x, pa.y, pb.x, pb.y) >= 26) continue;
        cuts.push(cutAround(segmentParam(o.x, o.y, pa.x, pa.y, pb.x, pb.y), DOORWAY_GAP / 2, len));
        repairedDoorways++;
      }
      for (const p of waypoints) {
        if (pointSegmentDistance(p.x, p.y, pa.x, pa.y, pb.x, pb.y) > CORNER_NEAR) continue;
        cuts.push(cutAround(segmentParam(p.x, p.y, pa.x, pa.y, pb.x, pb.y), CORNER_GAP / 2, len));
      }
      // Route legs grazing the contour. Bounding-box reject first: on the 8
      // wide maps this is ~700 contours x ~100 routes, so the naive product
      // would be far too slow.
      const pad = GRAZE_NEAR + 2;
      const loX = Math.min(pa.x, pb.x) - pad, hiX = Math.max(pa.x, pb.x) + pad;
      const loY = Math.min(pa.y, pb.y) - pad, hiY = Math.max(pa.y, pb.y) + pad;
      let lastBucket = -Infinity;
      for (const [rc, rd] of routes) {
        if (Math.max(rc.x, rd.x) < loX || Math.min(rc.x, rd.x) > hiX) continue;
        if (Math.max(rc.y, rd.y) < loY || Math.min(rc.y, rd.y) > hiY) continue;
        const routeLen = Math.hypot(rd.x - rc.x, rd.y - rc.y);
        const steps = Math.max(1, Math.ceil(routeLen / 6));
        for (let i = 0; i <= steps; i++) {
          const q = i / steps;
          const px = rc.x + (rd.x - rc.x) * q, py = rc.y + (rd.y - rc.y) * q;
          if (pointSegmentDistance(px, py, pa.x, pa.y, pb.x, pb.y) > GRAZE_NEAR) continue;
          const t = segmentParam(px, py, pa.x, pa.y, pb.x, pb.y);
          const bucket = Math.round((t * len) / 6);
          if (bucket === lastBucket) continue;
          lastBucket = bucket;
          cuts.push(cutAround(t, GRAZE_GAP / 2, len));
        }
      }
    }
    cuts.sort((a, b) => a[0] - b[0]);
    const spans = [];
    let from = 0;
    for (const [lo, hi] of cuts) {
      if (lo > from) spans.push([from, Math.min(lo, 1)]);
      from = Math.max(from, hi);
    }
    if (from < 1) spans.push([from, 1]);
    for (const [t0, t1] of spans) {
      if (t0 >= t1) continue;
      const sx = pa.x + (pb.x - pa.x) * t0, sy = pa.y + (pb.y - pa.y) * t0;
      const ex = pa.x + (pb.x - pa.x) * t1, ey = pa.y + (pb.y - pa.y) * t1;
      if (Math.hypot(ex - sx, ey - sy) < MIN_SPAN) continue;
      segments.push([sx, sy, ex, ey]);
    }
  }
  const payload = {
    source: DOORWAY_GAPS ? 'runtime-mbn-linesA-doorway-gaps' : 'runtime-mbn-linesA',
    file: path.relative(ROOT, file).replaceAll('\\', '/'),
    count: segments.length,
    segments,
  };
  fs.writeFileSync(path.join(OUT, `${key}.json`), JSON.stringify(payload));
  written++;
  kept += segments.length;
}

console.log(`Collision: ${written} maps, ${kept} solid wall spans (${nonSolid.size} non-solid line props)` +
  (DOORWAY_GAPS ? `, ${repairedDoorways} doorway cuts kept instead of dropping contours` : `, ${droppedContours} contours dropped (legacy)`));
