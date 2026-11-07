// Audit the eight Boss-approach (mode="infinite") entrance maps against the
// original game files. Three independent checks:
//
//   1. CAMERA   the white cat (prop 53 / cat type 3) is the authored scroll
//               driver: its route must span the map, and its horizontal motion
//               is the only thing that may push the camera forward.
//   2. COLLISION the shipped wall spans are compared with MBN linesA (which
//               line classes were dropped, where doorways were cut), and every
//               native linesB walking route is sampled with the hero's body
//               radius to find "stuck foot" spots (circleHitsWall on a route).
//   3. SPAWNS   prop-11 cwmice / prop-60 traps in the level JSON are compared
//               with the raw XML vertices: position drift caused by grid
//               snapping, points inside walls, and 1:1 pairing.
//
// Usage: node tools/audit-boss-approach.mjs [--json] [--strict]
//   --json    machine-readable report
//   --strict  exit 1 when a blocking problem is found (for regression runs)
import fs from 'node:fs';
import path from 'node:path';
import { World } from '../src/world.js';
import { parseMbn } from './decode-mbn.mjs';
import { BOSS_LINKS } from '../src/boss-links.js';

const ROOT = process.cwd();
const RES = path.join(ROOT, 'com.ea.spymouse_row', 'files', 'res');
const ENTRANCES = BOSS_LINKS.map((link) => link.entrance);
const HERO_R = 0.35 * 16; // CFG.mouse.radiusCells * world.cell

const g = (a, k) => {
  const r = a.match(new RegExp(k + '\\s*=\\s*"?(-?\\d+)"?', 'i'));
  return r ? +r[1] : 0;
};

function readXmlVerts(id) {
  const file = path.join(RES, id, `${id}.xml`);
  const xml = fs.readFileSync(file, 'utf8');
  const verts = [];
  for (const m of xml.matchAll(/<Vertex\s+([^>]*)\/>/g)) {
    const a = m[1];
    const designX = g(a, 'x');
    const designY = g(a, 'y');
    verts.push({
      id: g(a, 'id'),
      prop: g(a, 'Property'),
      tag: g(a, 'Tag'),
      flags: g(a, 'Flags'),
      design: { x: designX, y: designY },
      x: 2 * designX + 32,
      y: 2 * designY + 64,
    });
  }
  return verts;
}

function mbnWorld(v) {
  // MBN stores design-space y flipped (320 - y); XML does not.
  return { x: v.x * 2 + 32, y: (320 - v.y) * 2 + 64 };
}

function nearestSegmentDistance(world, x, y) {
  let best = Infinity;
  let bestSeg = null;
  for (const s of world.segments) {
    if (x < s.minX - 200 || x > s.maxX + 200 || y < s.minY - 200 || y > s.maxY + 200) continue;
    const d = Math.sqrt(world.segmentDistanceSq(x, y, s));
    if (d < best) { best = d; bestSeg = s; }
  }
  return { distance: best, segment: bestSeg };
}

function pointState(world, x, y, radius = HERO_R) {
  const grid = world.gridCircleHitsWall(x, y, radius);
  const near = world.segmentNear(x, y, radius);
  const seg = nearestSegmentDistance(world, x, y);
  return {
    blocked: grid || near,
    grid,
    segment: near,
    segmentDistance: Number.isFinite(seg.distance) ? +seg.distance.toFixed(1) : null,
    nearestSegment: seg.segment ? [seg.segment.ax, seg.segment.ay, seg.segment.bx, seg.segment.by].map(Math.round) : null,
  };
}

/** Sample a lineB route with the hero body and collect continuous blocked runs. */
function routeSnags(world, a, b, step = 3) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(d / step));
  const runs = [];
  let open = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    // Native world coords carry a 32 px letterbox offset, so the last leg of a
    // wide map extends past the shipped background (map736 reaches 4126 on a
    // 4096 px image). Out-of-bounds is not walkable floor in the port. A hero
    // also cannot be centred within one body radius of the world border (the
    // out-of-bounds tile is wall), so those samples are level edges, not snags.
    if (x < HERO_R || y < HERO_R || x > world.w - HERO_R || y > world.h - HERO_R) {
      if (open) { runs.push(open); open = null; }
      continue;
    }
    const st = pointState(world, x, y);
    if (st.blocked) {
      if (!open) open = { from: { x: +x.toFixed(1), y: +y.toFixed(1) }, to: { x, y }, reason: st };
      else open.to = { x: +x.toFixed(1), y: +y.toFixed(1) };
    } else if (open) { runs.push(open); open = null; }
  }
  if (open) runs.push(open);
  return runs;
}

function audit(id) {
  const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'levels', `${id}.json`), 'utf8'));
  const mask = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'masks', `${id}.json`), 'utf8'));
  const collision = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'collision', `${id}.json`), 'utf8'));
  const world = World.fromMask(mask);
  world.setCollisionSegments(collision.segments);
  const mbn = parseMbn(path.join(RES, id, `${id}.mbn`));
  const verts = readXmlVerts(id);
  // src/content.js replaces a synthesized exit with the authored prop-359 gate
  // from mechanisms.json. The audit must measure the gate the RUNTIME uses,
  // not the arbitrary BFS corner stored in the level JSON.
  const mechanisms = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'mechanisms.json'), 'utf8'))[id] || {};
  const runtimeExit = mechanisms.nativeExit || def.exit || null;

  const report = {
    id,
    num: def.num || null,
    world: { w: world.w, h: world.h, cell: world.cell },
    exit: def.exit || null,
    camera: {},
    collision: {},
    spawns: {},
    problems: [],
  };

  // ---- 1. camera driver -------------------------------------------------
  const whiteCats = (def.cats || []).filter((c) => c.type === 3 || c.prop === 53);
  const white = whiteCats[0] || null;
  if (!white) report.problems.push({ kind: 'camera', detail: 'no white cat (prop 53 / type 3) authored' });
  else {
    const route = white.route || [];
    const xs = route.map((p) => p.x);
    let vertical = 0;
    let horizontal = 0;
    for (let i = 1; i < route.length; i++) {
      vertical += Math.abs(route[i].y - route[i - 1].y);
      horizontal += Math.abs(route[i].x - route[i - 1].x);
    }
    // The native linesB graph is the authored walking network. Its rightmost
    // waypoint is the true end of the scroll: on map816 the shipped background
    // is padded with ~2700 px of blank grey art beyond it, and a BFS-synthesized
    // exit sits in that padding. Comparing the cat against that fake gate was a
    // false "camera" failure - the cat covers 100% of the authored routes.
    let authoredMaxX = 0;
    for (const l of mbn.linesB || []) {
      const va = mbn.vertices[l.vA], vb = mbn.vertices[l.vB];
      if (va) authoredMaxX = Math.max(authoredMaxX, mbnWorld(va).x);
      if (vb) authoredMaxX = Math.max(authoredMaxX, mbnWorld(vb).x);
    }
    const lastX = xs.length ? Math.max(...xs) : 0;
    // src/content.js snaps every cat route waypoint through World.closestOpen.
    // A waypoint that snaps more than one cell means the scroll driver is being
    // distorted by the colour mask (the pre-repair map556 last leg jumped 150px).
    const maxRouteSnap = route.length
      ? Math.max(...route.map((p) => {
        const o = world.closestOpen(p.x, p.y);
        return Math.hypot(o.x - p.x, o.y - p.y);
      }))
      : 0;
    report.camera = {
      maxRouteSnap: +maxRouteSnap.toFixed(1),
      catId: white.id ?? null,
      tag: white.tag,
      prop: white.prop,
      type: white.type,
      routeMode: white.routeMode,
      routeSource: white.routeSource,
      waypoints: route.length,
      spawn: { x: white.x, y: white.y },
      first: route[0] || null,
      last: route.at(-1) || null,
      xRange: xs.length ? [Math.min(...xs), Math.max(...xs)] : null,
      horizontalPx: +horizontal.toFixed(1),
      verticalPx: +vertical.toFixed(1),
      authoredMaxX,
      // The importer clamps waypoints that sit in the 32 px letterbox overflow
      // to the last playable cell, so the cat can only reach the authored max x
      // OR the shipped image edge, whichever is smaller.
      playableMaxX: Math.min(authoredMaxX, world.w - world.cell * 0.5),
      routeCoversAuthored: lastX >= Math.min(authoredMaxX, world.w - world.cell * 0.5) - world.cell,
      gateX: runtimeExit?.x ?? null,
      gateSource: mechanisms.nativeExit ? 'native-prop-359' : def.exit?.source || 'none',
      routeReachesGate: !!runtimeExit && lastX >= runtimeExit.x - world.cell * 4,
      paddedExit: !mechanisms.nativeExit && !!def.exit && def.exit.x > authoredMaxX + world.cell * 8,
    };
    // A white cat that does not even walk its own authored route graph is a
    // real camera bug. A cat that stops before a synthesized exit in the padded
    // art is a data note, not a scroll failure: BossApproach.advance() keeps the
    // hero-lead leash as the documented safety net for that last stretch.
    if (!report.camera.routeCoversAuthored) {
      report.problems.push({ kind: 'camera', detail: 'white cat route stops short of the authored linesB network', lastX, authoredMaxX });
    }
    if (horizontal < world.cell * 8) {
      report.problems.push({ kind: 'camera', detail: 'white cat route has almost no horizontal motion', horizontalPx: horizontal });
    }
    if (maxRouteSnap > world.cell) {
      report.problems.push({ kind: 'camera', detail: `white cat route snaps ${maxRouteSnap.toFixed(1)}px away from its authored waypoints`, maxRouteSnap });
    }
    if (report.camera.paddedExit) {
      report.notes = [...(report.notes || []), `no prop-359 gate: synthesized exit x=${def.exit.x} lies ${def.exit.x - authoredMaxX}px past the authored geometry; the hero-lead leash finishes the scroll`];
    }
    if (whiteCats.length > 1) report.problems.push({ kind: 'camera', detail: 'more than one white cat', count: whiteCats.length });
  }

  // ---- 2. collision -----------------------------------------------------
  const lineAProps = {};
  for (const l of mbn.linesA) lineAProps[l.c] = (lineAProps[l.c] || 0) + 1;
  // Re-create the import rule to know which classes are non-solid globally.
  // (The importer derives this across ALL maps; here we only report the local
  // line classes so a per-map anomaly is visible.)
  const routes = [];
  for (const l of mbn.linesB) {
    const a = mbn.vertices[l.vA], b = mbn.vertices[l.vB];
    if (!a || !b) continue;
    routes.push({ a: mbnWorld(a), b: mbnWorld(b), prop: l.c });
  }
  const snags = [];
  for (const r of routes) {
    const runs = routeSnags(world, r.a, r.b);
    for (const run of runs) {
      snags.push({ route: [r.a, r.b].map((p) => [Math.round(p.x), Math.round(p.y)]), ...run });
    }
  }
  // Which raw linesA are missing / trimmed in the shipped collision?
  const shipped = collision.segments.map((s) => s.map(Math.round));
  const exact = new Set(shipped.map((s) => s.join(',')));
  const missing = [];
  for (const l of mbn.linesA) {
    const a = mbnWorld(mbn.vertices[l.vA]);
    const b = mbnWorld(mbn.vertices[l.vB]);
    const key = [a.x, a.y, b.x, b.y].map(Math.round).join(',');
    const rev = [b.x, b.y, a.x, a.y].map(Math.round).join(',');
    if (!exact.has(key) && !exact.has(rev)) {
      missing.push({ prop: l.c, from: [Math.round(a.x), Math.round(a.y)], to: [Math.round(b.x), Math.round(b.y)] });
    }
  }
  const missingByProp = {};
  for (const m of missing) missingByProp[m.prop] = (missingByProp[m.prop] || 0) + 1;
  // "Unmatched" only means the raw line was trimmed (doorways), which is fine.
  // The real consistency failure is a long authored wall with NO shipped span
  // at all - that is the legacy whole-contour drop (map531 lost a 2048 px
  // bottom boundary). Exclude the three presentation line classes that the
  // importer derives as globally non-solid from all 203 maps.
  const NON_SOLID = new Set([114, 140, 142]);
  const lineDistance = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  let rawWallLength = 0;
  let shippedWallLength = 0;
  for (const s of shipped) shippedWallLength += Math.hypot(s[2] - s[0], s[3] - s[1]);
  const droppedLong = [];
  for (const l of mbn.linesA) {
    const a = mbnWorld(mbn.vertices[l.vA]);
    const b = mbnWorld(mbn.vertices[l.vB]);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (NON_SOLID.has(l.c)) continue;
    rawWallLength += len;
    let covered = false;
    for (const s of shipped) {
      if (lineDistance(s[0], s[1], a.x, a.y, b.x, b.y) > 2) continue;
      if (lineDistance(s[2], s[3], a.x, a.y, b.x, b.y) > 2) continue;
      const midX = (s[0] + s[2]) / 2, midY = (s[1] + s[3]) / 2;
      if (midX < Math.min(a.x, b.x) - 3 || midX > Math.max(a.x, b.x) + 3) continue;
      if (midY < Math.min(a.y, b.y) - 3 || midY > Math.max(a.y, b.y) + 3) continue;
      covered = true;
      break;
    }
    if (!covered && len > 100) {
      droppedLong.push({ prop: l.c, len: Math.round(len), from: [Math.round(a.x), Math.round(a.y)], to: [Math.round(b.x), Math.round(b.y)] });
    }
  }
  report.collision = {
    source: collision.source,
    rawLinesA: mbn.linesA.length,
    rawLineAProps: lineAProps,
    rawWallLength: Math.round(rawWallLength),
    shippedWallLength: Math.round(shippedWallLength),
    shippedSpans: collision.segments.length,
    droppedLongLines: droppedLong.length,
    droppedLongSample: droppedLong.slice(0, 8),
    unmatchedRawLines: missing.length,
    unmatchedByProp: missingByProp,
    unmatchedSample: missing.slice(0, 12),
    nativeRoutes: routes.length,
    routeSnagRuns: snags.length,
    routeSnagSample: snags.slice(0, 12),
  };
  if (snags.length) report.problems.push({ kind: 'collision', detail: `${snags.length} blocked runs on native walking routes`, count: snags.length });
  if (droppedLong.length) report.problems.push({ kind: 'collision', detail: `${droppedLong.length} long authored walls have no shipped span`, count: droppedLong.length });

  // ---- 3. spawns --------------------------------------------------------
  const nativeMice = verts.filter((v) => v.prop === 11 && v.flags === 10);
  const nativeTraps = verts.filter((v) => v.prop === 60 && v.flags === 10);
  const jsonMice = def.cwmice || [];
  const jsonTraps = def.cwmouseHoles || [];
  const byId = new Map(jsonMice.map((m) => [m.id, m]));
  const trapIds = jsonMice.map((m) => m.trap?.id ?? m.hole?.id ?? null);
  const shared = [...new Set(trapIds.filter((t) => t != null && trapIds.filter((x) => x === t).length > 1))];
  const unused = jsonTraps.filter((h) => !trapIds.includes(h.id)).map((h) => h.id);

  const mouseRows = nativeMice.map((v) => {
    const imported = byId.get(v.id) || null;
    const drift = imported ? Math.hypot(imported.x - v.x, imported.y - v.y) : null;
    return {
      id: v.id,
      native: [v.x, v.y],
      imported: imported ? [imported.x, imported.y] : null,
      drift: drift == null ? null : +drift.toFixed(1),
      nativePoint: pointState(world, v.x, v.y),
      importedPoint: imported ? pointState(world, imported.x, imported.y) : null,
      trapId: imported?.trap?.id ?? imported?.hole?.id ?? null,
      trap: imported?.trap ?? imported?.hole ?? null,
    };
  });
  const trapRows = nativeTraps.map((v) => ({
    id: v.id,
    native: [v.x, v.y],
    shipped: (jsonTraps.find((h) => h.id === v.id) || null) ? [jsonTraps.find((h) => h.id === v.id).x, jsonTraps.find((h) => h.id === v.id).y] : null,
    point: pointState(world, v.x, v.y),
    usedBy: jsonMice.filter((m) => (m.trap?.id ?? m.hole?.id) === v.id).map((m) => m.id),
  }));
  report.spawns = {
    nativeMice: nativeMice.length,
    nativeTraps: nativeTraps.length,
    importedMice: jsonMice.length,
    importedTraps: jsonTraps.length,
    sharedTraps: shared,
    unusedTraps: unused,
    mice: mouseRows,
    traps: trapRows,
  };
  for (const row of mouseRows) {
    if (row.drift == null) report.problems.push({ kind: 'spawn', detail: `cwmouse ${row.id} missing from level JSON` });
    else if (row.drift > world.cell) report.problems.push({ kind: 'spawn', detail: `cwmouse ${row.id} snapped ${row.drift}px away from native position`, id: row.id, drift: row.drift });
    if (row.importedPoint?.blocked) report.problems.push({ kind: 'spawn', detail: `cwmouse ${row.id} spawn is inside collision`, id: row.id });
  }
  for (const row of trapRows) {
    if (row.point.blocked) report.problems.push({ kind: 'spawn', detail: `trap ${row.id} sits inside collision`, id: row.id });
    if (row.shipped && Math.hypot(row.shipped[0] - row.native[0], row.shipped[1] - row.native[1]) > 0.5) {
      report.problems.push({ kind: 'spawn', detail: `trap ${row.id} shipped position differs from XML`, id: row.id });
    }
  }
  if (shared.length || unused.length) {
    report.problems.push({ kind: 'pairing', detail: 'cwmouse/trap pairing is not 1:1', shared, unused });
  }
  return report;
}

const asJson = process.argv.includes('--json');
const strict = process.argv.includes('--strict');
const quiet = process.argv.includes('--quiet');
const reports = ENTRANCES.map(audit);

if (asJson) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  const info = quiet ? () => {} : (s) => console.log(s);
  for (const r of reports) {
    info(`\n=== ${r.id} ${r.num || ''} (${r.world.w}x${r.world.h}, cell ${r.world.cell}) ===`);
    const c = r.camera;
    info(` camera  : cat=${c.catId ?? '-'} tag=${c.tag ?? '-'} mode=${c.routeMode ?? '-'} pts=${c.waypoints ?? 0} x=[${c.xRange?.join(',')}] authoredMaxX=${c.authoredMaxX} gateX=${c.gateX} (${c.gateSource}) horiz=${c.horizontalPx} vert=${c.verticalPx} snap=${c.maxRouteSnap} coversAuthored=${c.routeCoversAuthored} reachesGate=${c.routeReachesGate}`);
    const k = r.collision;
    info(` collision: linesA=${k.rawLinesA} props=${JSON.stringify(k.rawLineAProps)} rawLen=${k.rawWallLength} shippedLen=${k.shippedWallLength} spans=${k.shippedSpans} droppedLong=${k.droppedLongLines} unmatched=${k.unmatchedRawLines} (${JSON.stringify(k.unmatchedByProp)}) routes=${k.nativeRoutes} snagRuns=${k.routeSnagRuns}`);
    if (k.droppedLongSample.length) for (const d of k.droppedLongSample.slice(0, 4)) info(`   dropped ${d.prop} ${d.len}px ${JSON.stringify(d.from)}->${JSON.stringify(d.to)}`);
    if (k.routeSnagSample.length) for (const s of k.routeSnagSample.slice(0, 4)) info(`   snag ${JSON.stringify(s.from)}->${JSON.stringify(s.to)} grid=${s.reason.grid} seg=${s.reason.segment} segDist=${s.reason.segmentDistance}`);
    const s = r.spawns;
    info(` spawns  : mice ${s.importedMice}/${s.nativeMice} traps ${s.importedTraps}/${s.nativeTraps} shared=${JSON.stringify(s.sharedTraps)} unused=${JSON.stringify(s.unusedTraps)}`);
    for (const m of s.mice) info(`   mouse ${m.id} native=${m.native} imported=${m.imported} drift=${m.drift} blocked=${m.nativePoint.blocked}/${m.importedPoint?.blocked} trap=${m.trapId}`);
    for (const t of s.traps) info(`   trap  ${t.id} native=${t.native} blocked=${t.point.blocked} (grid=${t.point.grid}, seg=${t.point.segment}, d=${t.point.segmentDistance}) usedBy=${JSON.stringify(t.usedBy)}`);
    if (r.notes?.length) for (const n of r.notes) info(`   note: ${n}`);
    if (r.problems.length) {
      if (quiet) console.log(`\n=== ${r.id} ===`);
      for (const p of r.problems) console.log(`   !! ${p.kind}: ${p.detail}`);
    }
  }
  const counts = {};
  for (const r of reports) for (const p of r.problems) counts[p.kind] = (counts[p.kind] || 0) + 1;
  console.log(`\nsummary: ${reports.length} maps, problems ${JSON.stringify(counts)}`);
}

if (strict) {
  const blocking = reports.flatMap((r) => r.problems);
  if (blocking.length) process.exitCode = 1;
}
