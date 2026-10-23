// Imports authentic entity placement from the original map XML files:
//   property 1        -> mouse start
//   properties 240-243 -> exit (home mouse hole)
//   properties 6-10   -> cheese; 260 -> small crumbs; 11 -> cwmouse
//   properties 50-59  -> cats
// Coordinates are converted from the 480x320 design space to background pixels:
//   px = 2*x + 32, py = 2*y + 64   (letterboxed 960x640 render in a 1024x768 image)
//
//   node tools/import-entities.mjs
import fs from "fs";
import path from "path";
import { World } from "../src/world.js";
import { propDirection } from "../src/props.js";

const ROOT = path.resolve(".");
const RES = path.join(ROOT, "com.ea.spymouse_row", "files", "res");
const OUT = path.join(ROOT, "assets", "levels");

const levels = JSON.parse(fs.readFileSync(path.join(OUT, "..", "levels.json"), "utf8"));

// Raw map property -> web cat archetype.  The original factory selects sprites
// by these ids; 285 is the jungle cat, 58/59 are boss cats.  Boss-controller
// parts (282/283/300+) belong to ObjControllerBoss and are not imported as cats yet.
// Types: 0 brown, 1 orange, 2 black, 3 boss, 4 blind, 5 ghost, 6 ninja,
// 7 lava, 8 boss6, 9 boss4, 10 jungle, 11 reserved for boss controllers.
const CAT_PROP_TYPES = new Map([
  [50, 0], [51, 1], [52, 2], [53, 3], [54, 4], [55, 5], [56, 6], [57, 7],
  [58, 8], [59, 9], [285, 10],
]);

// ObjControllerBoss registry props (parallel-M1/K2): 300-306 plus the 6-Boss
// body 341 (authored but outside that registry). Part props are collected
// separately so they never fall into another bucket.
const BOSS_PROPS = new Set([300, 301, 302, 303, 304, 305, 306, 341]);
const BOSS_PART_PROPS = new Set([282, 283, 349, 350, 353, 357, 358, 366, 367]);
// Native pipe sprites: 200-203 pipe_d/r/u/l, 204-207 pipe_flipflap_d/r/u/l.

function collectBossEntities(verts) {
  const list = (verts || []).filter((v) => v && (v.flags == null || v.flags === 10));
  const bossVerts = list.filter((v) => BOSS_PROPS.has(v.prop));
  const partVerts = list.filter((v) => BOSS_PART_PROPS.has(v.prop));
  const soleBoss = bossVerts.length === 1 ? bossVerts[0] : null;
  const toEntity = (v) => ({
    id: v.id,
    prop: v.prop,
    tag: v.tag,
    x: v.x,
    y: v.y,
    source: "xml",
  });
  const bosses = bossVerts.map((v) => ({
    ...toEntity(v),
    levelPhase: 0,
    parts: soleBoss === v ? partVerts.map((p) => toEntity(p)) : [],
  }));
  const bossParts = partVerts.map((v) => toEntity(v));
  return { bosses, bossParts };
}

function parseAttrs(text) {
  const out = {};
  if (!text) return out;
  for (const m of text.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

// Ambience schemes (Lead request, round 2): map*/amb_schemes.xml maps a floor
// id to a scheme, sound/sound/amb/<scheme>/amb.xml lists the loop file and the
// random ambience groups. The audio engine may or may not use these yet, but
// the level data carries the native structure.
const ambCache = new Map();
function readAmbXml(scheme) {
  if (ambCache.has(scheme)) return ambCache.get(scheme);
  const file = path.join(RES, "sound", "sound", "amb", scheme, "amb.xml");
  let out = { scheme, loop: null, groups: [] };
  if (fs.existsSync(file)) {
    const xml = fs.readFileSync(file, "utf8");
    const loop = (xml.match(/<loop\b[^>]*file="([^"]+)"/) || [])[1] || null;
    const groups = [];
    for (const m of xml.matchAll(/<ambience\b([^>]*)>([\s\S]*?)<\/ambience>/g)) {
      const a = parseAttrs(m[1]);
      const sounds = [...m[2].matchAll(/<sound\b[^>]*file="([^"]+)"/g)].map((s) => s[1]);
      groups.push({
        minDelay: +(a.min_delay ?? a.minDelay ?? 0),
        maxDelay: +(a.max_delay ?? a.maxDelay ?? 0),
        sounds,
      });
    }
    out = { scheme, loop, groups };
  }
  ambCache.set(scheme, out);
  return out;
}
function ambienceFor(mapId, floor = 0) {
  const file = path.join(RES, `map${mapId}`, "amb_schemes.xml");
  if (!fs.existsSync(file)) return null;
  const xml = fs.readFileSync(file, "utf8");
  let scheme = null;
  for (const m of xml.matchAll(/<floor\b([^>]*)\/?>/g)) {
    const a = parseAttrs(m[1]);
    if (String(a.id) === String(floor)) scheme = a.scheme || null;
  }
  return scheme ? readAmbXml(scheme) : null;
}

function parseLevelMeta() {
  const file = path.join(RES, "level_data.xml");
  if (!fs.existsSync(file)) return new Map();
  const xml = fs.readFileSync(file, "utf8");
  const byMap = new Map();
  const re = /<level\b([^>]*)>([\s\S]*?)<\/level>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    const body = m[2];
    const type = parseAttrs((body.match(/<type\b([^>]*)\/>/) || [])[1]);
    const times = parseAttrs((body.match(/<times\b([^>]*)\/>/) || [])[1]);
    const goals = parseAttrs((body.match(/<goals\b([^>]*)\/>/) || [])[1]);
    const unlocked = parseAttrs((body.match(/<unlocked\b([^>]*)\/>/) || [])[1]);
    // Per-level music: <music play="sound/music/CM_Apartments.sps"/>.
    const musicPath = (body.match(/<music\b[^>]*play="([^"]+)"/) || [])[1] || null;
    const music = musicPath ? musicPath.replace(/^sound\/music\//i, "").replace(/\.sps$/i, "") : null;
    for (const obj of [times, unlocked]) {
      for (const k of Object.keys(obj)) {
        if (/^-?\d+(\.\d+)?$/.test(obj[k])) obj[k] = +obj[k];
      }
    }
    // Goal slots are comma separated; a parenthesised slot is a PAIR of types
    // ANDed together, e.g. type="(teacup, chilli)" value="(0, 0)" (native
    // evaluation 0xc5ea8 ANDs the pair).
    const splitTop = (s) => {
      const out = [];
      let depth = 0;
      let cur = "";
      for (const ch of String(s || "")) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          if (cur.trim()) out.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    const num = (x) => (/^-?\d+(\.\d+)?$/.test(x) ? +x : x);
    const goalTypes = splitTop(goals.type);
    const goalValues = splitTop(goals.value);
    const goalList = goalTypes.map((t, i) => {
      const v = goalValues[i];
      if (t.startsWith("(")) {
        const ts = t.replace(/[()]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
        const vs = String(v || "").replace(/[()]/g, "").split(",").map((s) => s.trim());
        return { type: ts, value: vs.map(num) };
      }
      return { type: t, value: num(v) };
    });
    byMap.set(attrs.map || attrs.uid, {
      uid: attrs.uid != null ? +attrs.uid : undefined,
      num: attrs.num,
      name: attrs.name,
      mode: type.mode,
      theme: type.theme,
      trailLength: type.trailLength != null ? +type.trailLength : undefined,
      times: times.start != null ? times : null,
      goals: goalList.length ? goalList : null,
      unlocked: Object.keys(unlocked).length ? unlocked : null,
      music,
      musicPath,
    });
  }
  return byMap;
}

const levelMeta = parseLevelMeta();

const seen = new Set();
const ordered = [];
for (const lv of levels) {
  if (!lv.map || seen.has(lv.map)) continue;
  seen.add(lv.map);
  ordered.push(lv);
}

function parseMapXml(mapNum) {
  const file = path.join(RES, "map" + mapNum, "map" + mapNum + ".xml");
  if (!fs.existsSync(file)) return null;
  const xml = fs.readFileSync(file, "utf8");
  const g = (a, k) => {
    const r = a.match(new RegExp(k + '\\s*=\\s*(-?\\d+)'));
    return r ? +r[1] : 0;
  };
  const verts = [];
  const byId = new Map();
  for (const m of xml.matchAll(/<Vertex\s+([^>]*)\/>/g)) {
    const a = m[1];
    const id = g(a, "id");
    const v = {
      id,
      x: 2 * g(a, "x") + 32,
      y: 2 * g(a, "y") + 64,
      prop: g(a, "Property"),
      tag: g(a, "Tag"),
      flags: g(a, "Flags"),
    };
    byId.set(id, v);
    if (v.flags === 10) verts.push(v);
  }
  const lines = [];
  for (const m of xml.matchAll(/<Line\s+([^>]*)\/>/g)) {
    const a = m[1];
    const va = g(a, "VertexA");
    const vb = g(a, "VertexB");
    if (!byId.has(va) || !byId.has(vb)) continue;
    lines.push({ a: va, b: vb, prop: g(a, "Property"), tag: g(a, "Tag") });
  }
  return { verts, lines, byId };
}

// --- authentic route reconstruction -------------------------------------

function signedArea(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function centroid(points) {
  let x = 0, y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function distToPolygon(p, points) {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    best = Math.min(best, distToSegment(p, points[i], points[(i + 1) % points.length]));
  }
  return best;
}

// Closed polygonal cycles of Property-0 lines. The outer map boundary is a
// larger graph with junctions, so only genuine obstacle islands come out here.
function closedLoops(lines, byId) {
  const adj = new Map();
  for (const l of lines) {
    if (l.prop !== 0) continue;
    if (l.a === l.b) continue;
    if (!adj.has(l.a)) adj.set(l.a, []);
    if (!adj.has(l.b)) adj.set(l.b, []);
    adj.get(l.a).push(l.b);
    adj.get(l.b).push(l.a);
  }
  const seen = new Set();
  const loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      for (const nb of adj.get(cur) || []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    if (!comp.every((v) => (adj.get(v) || []).length === 2)) continue;
    const seq = [start];
    let prev = null, cur = start, ok = true;
    for (let guard = 0; guard < comp.length + 2; guard++) {
      const nbs = adj.get(cur) || [];
      const nxt = nbs[0] !== prev ? nbs[0] : nbs[1];
      if (nxt === undefined) { ok = false; break; }
      if (nxt === start) break;
      seq.push(nxt);
      prev = cur;
      cur = nxt;
    }
    if (!ok || seq.length !== comp.length) continue;
    const points = seq.map((id) => ({ x: byId.get(id).x, y: byId.get(id).y }));
    loops.push({ points, area: Math.abs(signedArea(points)) });
  }
  return loops;
}

function offsetPolygon(points, margin) {
  const n = points.length;
  const center = centroid(points);
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    let nx = b.y - a.y, ny = -(b.x - a.x);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    if (nx * (midX - center.x) + ny * (midY - center.y) < 0) { nx = -nx; ny = -ny; }
    normals.push({ x: nx, y: ny });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n], p = points[i], next = points[(i + 1) % n];
    const np = normals[(i - 1 + n) % n], nn = normals[i];
    const d1 = { x: p.x - prev.x, y: p.y - prev.y };
    const d2 = { x: next.x - p.x, y: next.y - p.y };
    const o1 = { x: prev.x + np.x * margin, y: prev.y + np.y * margin };
    const o2 = { x: p.x + nn.x * margin, y: p.y + nn.y * margin };
    const den = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(den) < 1e-6) {
      out.push({ x: p.x + nn.x * margin, y: p.y + nn.y * margin });
      continue;
    }
    const diff = { x: o2.x - o1.x, y: o2.y - o1.y };
    const t = (diff.x * d2.y - diff.y * d2.x) / den;
    out.push({ x: o1.x + d1.x * t, y: o1.y + d1.y * t });
  }
  return out;
}

// Make sure consecutive waypoints are visible to each other; otherwise splice
// in a BFS path so the drawn route hugs walls instead of cutting corners.
function connectRoute(world, route) {
  if (route.length < 2) return route;
  const out = [];
  for (let i = 0; i < route.length; i++) {
    const a = route[i];
    const b = route[(i + 1) % route.length];
    out.push(a);
    if (!world.lineClear(a.x, a.y, b.x, b.y)) {
      const seg = world.bfsToWorld(a.x, a.y, b.x, b.y) || [];
      let last = a;
      for (const p of seg) {
        if (Math.hypot(p.x - last.x, p.y - last.y) > world.cell * 0.5) {
          out.push(p);
          last = p;
        }
      }
    }
  }
  return out;
}

function sampleLoop(world, points, spacing) {
  const route = [];
  let last = null;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.round(len / spacing));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const p = world.closestOpen(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > spacing * 0.4) {
        route.push(p);
        last = p;
      }
    }
  }
  return route;
}

function loadNativeRoutes(mapNum) {
  const file = path.join(OUT, "routes-native", `map${mapNum}.json`);
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data.routes) || !data.routes.length) return null;
  return data;
}

function bfsDistances(world, sx, sy) {
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

// BFS over the walkable grid plus zero-cost teleport links (mouse holes,
// pipes, pipe pieces). Used only for entity reachability so multi-room levels
// keep entities that the original connects through those objects.
function bfsDistancesTeleport(world, sx, sy, teleportMap) {
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
    const links = teleportMap.get(cur);
    if (links) {
      for (const nb of links) {
        if (dist[nb] !== -1 || world.isWall(nb % world.cols, (nb / world.cols) | 0)) continue;
        dist[nb] = dist[cur];
        cells.push({ tx: nb % world.cols, ty: (nb / world.cols) | 0, d: dist[nb] });
        q[tail++] = nb;
      }
    }
  }
  return cells;
}

let written = 0;
const index = [];

for (const lv of ordered) {
  const maskPath = path.join(ROOT, "assets", "masks", "map" + lv.map + ".json");
  if (!fs.existsSync(maskPath)) continue;
  const mask = JSON.parse(fs.readFileSync(maskPath, "utf8"));
  const world = World.fromMask(mask);
  const c = world.cell;
  const snap = (p) => world.closestOpen(p.x, p.y);
  const px = (cell) => ({ x: (cell.tx + 0.5) * c, y: (cell.ty + 0.5) * c });

  const parsed = parseMapXml(lv.map);
  const verts = parsed ? parsed.verts : null;
  const rawLines = parsed ? parsed.lines : [];
  const byId = parsed ? parsed.byId : new Map();
  let start = null, exit = null;
  const cheese = [];
  const crumbs = [];
  const cats = [];
  const cwmice = [];
  const cwHoles = [];
  const holeVerts = [];
  const pipePieceVerts = [];

  if (verts) {
    for (const v of verts) {
      // Boss bodies/parts are collected separately (parallel-M1); keep them out
      // of every other bucket.
      if (BOSS_PROPS.has(v.prop) || BOSS_PART_PROPS.has(v.prop)) continue;
      if (v.prop === 1 && !start) start = { ...snap(v), id: v.id, prop: v.prop, tag: v.tag, ox: v.x, oy: v.y };
      else if (v.prop >= 240 && v.prop <= 247 && !exit)
        exit = { ...snap(v), id: v.id, prop: v.prop, tag: v.tag, ox: v.x, oy: v.y };
      else if (v.prop >= 6 && v.prop <= 10)
        cheese.push({ ...snap(v), source: "xml", id: v.id, prop: v.prop, tag: v.tag, ox: v.x, oy: v.y });
      // Prop 11 is the cwmouse (parallel-L2), not cheese; prop 60 is its
      // paired hole point that triggers the vanish hop.
      else if (v.prop === 11)
        cwmice.push({ ...snap(v), source: "xml", id: v.id, prop: 11, tag: v.tag, ox: v.x, oy: v.y });
      else if (v.prop === 60) cwHoles.push({ ...v, x: v.x, y: v.y });
      // Prop 260 = crumbs (native all_crumbs goal; parallel-L1/N2).
      else if (v.prop === 260)
        crumbs.push({ ...snap(v), source: "xml", id: v.id, prop: 260, tag: v.tag, ox: v.x, oy: v.y });
      else if (v.prop >= 20 && v.prop <= 23) holeVerts.push(v);
      else if (v.prop >= 200 && v.prop <= 207) pipePieceVerts.push(v);
      else if (CAT_PROP_TYPES.has(v.prop))
        cats.push({ ...snap(v), angle: 0, type: CAT_PROP_TYPES.get(v.prop), prop: v.prop, tag: v.tag, source: "xml", id: v.id, ox: v.x, oy: v.y });
    }
  }
  const { bosses, bossParts } = collectBossEntities(verts);

  // Native pipes are props 200-203 (pipe_d/r/u/l) + 204-207 (flipflaps); the
  // old prop-518 "pipe" pairing was wrong (parallel-N2: 518 vertices sit on
  // televisions in map743 and have no handler). Keep the authored pipe pieces
  // for rendering; the flipflap portal rule below still builds the transports.
  const pipePieces = pipePieceVerts.map((v) => ({
    id: v.id,
    prop: v.prop,
    tag: v.tag,
    x: v.x,
    y: v.y,
    dir: propDirection(v.prop),
  }));
  const pipes = [];

  // Traversal links proven from the engine (parallel-D2):
  //   P20-23  = mouse holes (u/l/d/r)
  //   P200-203 = pipe pieces (d/r/u/l), P204-207 = pipe flipflaps (d/r/u/l)
  // Same-Tag vertices form one object group; a group of n>=2 is linked as a
  // ring so every endpoint can reach the others. The exact runtime pairing is
  // UNVERIFIED; this is a conservative connectivity model, marked per entry.
  const DIRS = Object.fromEntries([20,21,22,23,200,201,202,203,204,205,206,207].map(prop => [prop, propDirection(prop)]));
  const transports = [];
  const addTransportGroup = (list, kind) => {
    const groups = new Map();
    for (const v of list) {
      const key = v.tag || 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const n = group.length;
      const pairs = n === 2 ? [[0, 1]] : group.map((_, i) => [i, (i + 1) % n]);
      for (const [i, j] of pairs) {
        transports.push({
          kind,
          tag: group[i].tag || 0,
          a: { x: group[i].x, y: group[i].y },
          b: { x: group[j].x, y: group[j].y },
          aProp: group[i].prop,
          bProp: group[j].prop,
          aDir: DIRS[group[i].prop] || null,
          bDir: DIRS[group[j].prop] || null,
          pairing: "same-tag-ring",
          // The engine sprite type only proves the object kind (hole/pipe),
          // not the teleport target pairing. Keep this explicitly unverified.
          pairingEvidence: "unverified",
        });
      }
    }
  };
  // Prop-518 "pipes" removed (parallel-N2: not native pipes); only the
  // 200-207 flipflap portal rule below builds transports.
  // Parallel-F2 (PROVEN): mouse holes are hide spots, not one-tap teleports;
  // a Tag group of pipe pieces is a portal only when it contains a flipflap
  // (P204-207). Parallel-G1 refined this with disassembly evidence: while
  // hidden in hole A (player+0x204 == A.Tag), a tap on a same-Tag hole B
  // within 45 design units pops the player out at B's mouth (0x9e990
  // placement called from the 0xdbbd4 same-Tag scan). The scan reference
  // (touch point vs hidden player) is still unverified, so treat the
  // two-tap travel as evidence-backed but not runtime-confirmed.
  const hideables = holeVerts.map((v) => ({
    id: v.id,
    prop: v.prop,
    tag: v.tag,
    x: v.x,
    y: v.y,
    dir: DIRS[v.prop] || null,
  }));
  const holeGroups = new Map();
  for (const v of holeVerts) {
    const key = v.tag || 0;
    if (!holeGroups.has(key)) holeGroups.set(key, []);
    holeGroups.get(key).push(v);
  }
  const flipflapGroups = new Map();
  for (const v of pipePieceVerts) {
    const key = v.tag || 0;
    if (!flipflapGroups.has(key)) flipflapGroups.set(key, []);
    flipflapGroups.get(key).push(v);
  }
  for (const group of flipflapGroups.values()) {
    const flaps = group.filter((v) => v.prop >= 204 && v.prop <= 207);
    if (!flaps.length) continue;
    const entries = group.filter((v) => v.prop >= 200 && v.prop <= 203);
    for (const e of entries) {
      for (const f of flaps) {
        transports.push({
          kind: "pipeportal",
          tag: e.tag || 0,
          a: { x: e.x, y: e.y },
          b: { x: f.x, y: f.y },
          aProp: e.prop,
          bProp: f.prop,
          aDir: DIRS[e.prop] || null,
          bDir: DIRS[f.prop] || null,
          pairing: "flipflap-portal",
          pairingEvidence: "flipflap-portal-rule",
          verified: true,
        });
      }
    }
  }

  const diagnostics = {
    original: { cheese: cheese.length, cats: cats.length, exit: exit ? 1 : 0, pipes: pipes.length, transports: 0, transportsSameComponent: 0, hideables: 0 },
    imported: { cheese: 0, cats: 0, exit: 0, pipes: pipes.length, transports: 0, transportsSameComponent: 0, hideables: 0 },
    droppedUnreachable: { cheese: 0, cats: 0, exit: 0, details: [] },
    unreachable: { cheese: 0, cats: 0, exit: 0, cwmice: 0, details: [] },
    duplicateCheese: 0,
    synthesized: { cheese: 0, exit: 0, mouseStart: false },
    mouseStart: { original: null, imported: null },
  };

  if (start && start.ox != null) {
    diagnostics.mouseStart.original = {
      id: start.id,
      designX: (start.ox - 32) / 2,
      designY: (start.oy - 64) / 2,
      worldX: start.ox,
      worldY: start.oy,
    };
  }

  const startFromXml = !!start;
  if (!start) {
    const openCells = [];
    for (let ty = 0; ty < world.rows; ty++)
      for (let tx = 0; tx < world.cols; tx++) if (!world.isWall(tx, ty)) openCells.push({ tx, ty });
    if (!openCells.length) continue;
    const mid = openCells[Math.floor(openCells.length / 2)];
    start = px(mid);
    diagnostics.synthesized.mouseStart = true;
  }
  diagnostics.mouseStart.imported = { x: start.x, y: start.y, source: startFromXml ? "xml" : "synthesized" };

  const startCell = world.nearestOpen(start.x, start.y);
  // Component labels, used to keep only cross-component candidate links: a
  // same-component pair cannot help connectivity and can trap the nearest-
  // endpoint selection. Both sets are reported in diagnostics.
  const n = world.cols * world.rows;
  const compLabel = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const tx = i % world.cols;
    const ty = (i / world.cols) | 0;
    if (compLabel[i] !== -1 || world.isWall(tx, ty)) continue;
    compLabel[i] = i;
    const stack = [i];
    while (stack.length) {
      const c = stack.pop();
      const cx = c % world.cols;
      const cy = (c / world.cols) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= world.cols || ny >= world.rows) continue;
        const ni = ny * world.cols + nx;
        if (compLabel[ni] !== -1 || world.isWall(nx, ny)) continue;
        compLabel[ni] = i;
        stack.push(ni);
      }
    }
  }
  const compAt = (p) => {
    const t = world.nearestOpen(p.x, p.y);
    if (t.tx < 0 || t.ty < 0 || t.tx >= world.cols || t.ty >= world.rows) return -1;
    return compLabel[t.ty * world.cols + t.tx];
  };
  const sameComponentLinks = [];
  const crossComponentLinks = [];
  for (const t of transports) {
    const ca = compAt(t.a);
    const cb = compAt(t.b);
    if (ca < 0 || cb < 0) continue;
    if (ca === cb) sameComponentLinks.push(t);
    else crossComponentLinks.push(t);
  }
  diagnostics.original.transports = transports.length;
  diagnostics.original.transportsSameComponent = sameComponentLinks.length;
  diagnostics.original.hideables = hideables.length;
  diagnostics.imported.transports = crossComponentLinks.length;
  diagnostics.imported.transportsSameComponent = sameComponentLinks.length;
  diagnostics.imported.hideables = hideables.length;
  const teleportMap = new Map();
  const addTeleportPair = (a, b) => {
    const ta = world.nearestOpen(a.x, a.y);
    const tb = world.nearestOpen(b.x, b.y);
    const ia = ta.ty * world.cols + ta.tx;
    const ib = tb.ty * world.cols + tb.tx;
    if (ia === ib) return false;
    if (!teleportMap.has(ia)) teleportMap.set(ia, []);
    if (!teleportMap.has(ib)) teleportMap.set(ib, []);
    teleportMap.get(ia).push(ib);
    teleportMap.get(ib).push(ia);
    return compAt(a) !== compAt(b);
  };
  for (const t of crossComponentLinks) addTeleportPair(t.a, t.b);
  // Two-tap hole travel (G1): every member of a Tag group is reachable from
  // any other member, so hole groups also count for entity reachability.
  let holeLinksCross = 0;
  let holeLinksSame = 0;
  for (const group of holeGroups.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (addTeleportPair(group[i], group[j])) holeLinksCross++;
        else holeLinksSame++;
      }
    }
  }
  diagnostics.original.holeLinks = holeLinksCross;
  diagnostics.imported.holeLinks = holeLinksCross;
  diagnostics.original.holeLinksSameComponent = holeLinksSame;
  diagnostics.imported.holeLinksSameComponent = holeLinksSame;
  const reach = bfsDistancesTeleport(world, startCell.tx, startCell.ty, teleportMap);
  reach.sort((a, b) => b.d - a.d);
  const reachSet = new Set(reach.map((cell) => cell.ty * world.cols + cell.tx));
  const reachable = (p) => {
    const t = world.nearestOpen(p.x, p.y);
    if (t.tx < 0 || t.ty < 0 || t.tx >= world.cols || t.ty >= world.rows) return false;
    return reachSet.has(t.ty * world.cols + t.tx);
  };

  const describeDropped = (kind, e) => ({
    kind,
    id: e.id,
    prop: e.prop,
    tag: e.tag,
    // Raw values are world pixels: world = 2*design + (32, 64).
    designX: (e.ox - 32) / 2,
    designY: (e.oy - 64) / 2,
    worldX: e.ox,
    worldY: e.oy,
  });
  // Keep authored entities even when the colour mask disconnects their room.
  // The mask is an art approximation and previously deleted map769's two lava
  // cats and the native exit. Mark them for audits instead of silently dropping
  // gameplay data; the native collision graph is the authority.
  for (let i = cheese.length - 1; i >= 0; i--) {
    if (!reachable(cheese[i])) {
      diagnostics.droppedUnreachable.cheese++;
      diagnostics.droppedUnreachable.details.push(describeDropped("cheese", cheese[i]));
      cheese.splice(i, 1);
    }
  }
  for (const c of cats) {
    if (!reachable(c)) {
      c.unreachable = true;
      diagnostics.unreachable.cats++;
      diagnostics.unreachable.details.push(describeDropped("cat", c));
    }
  }
  if (exit && !reachable(exit)) {
    diagnostics.droppedUnreachable.exit = 1;
    diagnostics.droppedUnreachable.details.push(describeDropped("exit", exit));
    exit = null;
  }

  // Pair each cwmouse with its prop-60 companion (smallest id gap, then
  // nearest distance; all authored pairs are 1:1).
  for (const m of cwmice) {
    let best = null;
    for (const h of cwHoles) {
      const idGap = Math.abs(h.id - m.id);
      const d = Math.hypot(h.x - m.x, h.y - m.y);
      if (!best || idGap < best.idGap || (idGap === best.idGap && d < best.d)) best = { h, idGap, d };
    }
    m.hole = best ? { x: best.h.x, y: best.h.y, id: best.h.id } : null;
  }
  for (let i = cwmice.length - 1; i >= 0; i--) {
    if (!reachable(cwmice[i])) {
      diagnostics.droppedUnreachable.cwmice = (diagnostics.droppedUnreachable.cwmice || 0) + 1;
      diagnostics.droppedUnreachable.details.push(describeDropped("cwmouse", cwmice[i]));
      cwmice.splice(i, 1);
    }
  }

  // Grid snapping can put distinct authored pickups into the same cell.
  // Only remove duplicate authored objects, never nearby different ones.
  for (let i = cheese.length - 1; i >= 0; i--)
    for (let j = i - 1; j >= 0; j--)
      if (cheese[i].id != null && cheese[i].id === cheese[j].id) {
        diagnostics.duplicateCheese++;
        cheese.splice(i, 1);
        break;
      }

  const farthest = reach[0] || { tx: startCell.tx, ty: startCell.ty, d: 0 };

  if (!exit) {
    diagnostics.synthesized.exit = 1;
    exit = { ...px(farthest), source: "synthesized" };
  } else {
    exit.source = "xml";
  }

  if (!cheese.length) {
    // Native levels may have no authored cheese (completion is the home hole;
    // cheese is score). Do not fabricate pickups; keep the flag for reports.
    diagnostics.synthesized.cheese = 0;
    diagnostics.noAuthoredCheese = true;
  }

  // Cat patrol routes. Preference order:
  //   1. native route overrides extracted from the emulator (assets/levels/routes-native)
  //   2. an offset loop around the nearest obstacle polygon (matches the
  //      dotted patrol lines drawn by the original game far better than BFS)
  //   3. legacy BFS fallback for open rooms with no obstacle islands.
  const nativeData = loadNativeRoutes(lv.map);
  const nativeRoutes = nativeData ? nativeData.routes : null;
  const nativeSource = nativeData ? nativeData.source || "native" : null;
  const loops = closedLoops(rawLines, byId);
  const routeMargin = c * 3;

  for (const cat of cats) {
    let assigned = null;

    if (nativeRoutes) {
      // The .mbn graph walk tags each route with the marker Tag. Only an exact
      // Tag match is native evidence; a nearby route with a different Tag
      // belongs to another object (cutscene actor, boss part, mover), so it is
      // never stolen. No match means the native path count stays 0 (idle).
      const exact = nativeRoutes.find((r) => r.tag != null && Math.abs(r.tag) === Math.abs(cat.tag));
      if (exact && exact.points && exact.points.length >= 1) {
        const stationary = exact.stationary === true || exact.points.length < 2;
        assigned = {
          route: exact.points.map((p) => ({ x: p.x, y: p.y, wait: p.wait || 0 })),
          mode: stationary ? "stationary" : exact.mode || "pingpong",
          source: nativeSource || "native",
          stationary,
        };
      }
    }

    if (!assigned && nativeRoutes) {
      // Native 0x7042c finds no marker for this Tag -> count 0 -> the actor
      // idles at its spawn (proven in parallel-G2 for props 58/59 and by the
      // generator's early-out for any Tag without a start marker).
      const bossActor = cat.prop === 58 || cat.prop === 59;
      assigned = {
        route: [{ x: cat.x, y: cat.y }],
        mode: "stationary",
        source: bossActor ? "native-boss-stationary" : "native-no-marker",
        stationary: true,
      };
    }

    if (!assigned && (cat.prop === 58 || cat.prop === 59)) {
      // G2 (proven): props 58/59 are the boss cutscene actors ('fluffy' /
      // 'henchman'). 0x7042c matches the spawn Tag literally and no shipped
      // map has a route-start marker with their tags (Tag 0 matches nothing),
      // so the native path count stays 0 and the actor idles at its spawn.
      // Never synthesize movement for them.
      assigned = {
        route: [{ x: cat.x, y: cat.y }],
        mode: "stationary",
        source: "native-boss-stationary",
        stationary: true,
      };
    }

    if (!assigned) {
      const candidates = loops
        .filter((loop) => loop.area >= c * c * 6)
        .map((loop) => ({ loop, d: distToPolygon(cat, loop.points) }))
        .sort((a, b) => a.d - b.d);
      for (const { loop, d } of candidates) {
        if (d > c * 10) break;
        const off = offsetPolygon(loop.points, routeMargin);
        const offWall = off.filter((p) => world.isWallAt(p.x, p.y)).length;
        if (offWall > off.length * 0.4) continue;
        const route = connectRoute(world, sampleLoop(world, off, c * 0.75));
        if (route.length >= 6) {
          assigned = { route, mode: "loop", source: "heuristic-offset" };
          break;
        }
      }
    }

    if (assigned) {
      cat.route = assigned.route;
      cat.routeMode = assigned.mode;
      cat.routeSource = assigned.source;
      if (cat.route.length >= 2) {
        cat.angle = Math.atan2(cat.route[1].y - cat.y, cat.route[1].x - cat.x);
      }
      continue;
    }

    const from = world.nearestOpen(cat.x, cat.y);
    const cells = bfsDistances(world, from.tx, from.ty).filter((cell) => cell.d > 0);
    cells.sort((a, b) => b.d - a.d);
    let far = null;
    for (const cell of cells) {
      const p = px(cell);
      if (Math.hypot(p.x - cat.x, p.y - cat.y) < c * 3) continue;
      if (cheese.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < c * 1.5)) continue;
      if (Math.hypot(p.x - start.x, p.y - start.y) < c * 1.5) continue;
      far = p;
      break;
    }
    const route = [{ x: cat.x, y: cat.y }];
    if (far) {
      const seg = world.bfsToWorld(cat.x, cat.y, far.x, far.y) || [];
      let last = route[0];
      for (const p of seg) {
        if (!p) continue;
        if (Math.hypot(p.x - last.x, p.y - last.y) >= c * 2) {
          route.push({ x: p.x, y: p.y });
          last = p;
        }
      }
      if (Math.hypot(last.x - far.x, last.y - far.y) > c * 0.75) route.push(far);
      cat.angle = Math.atan2(route[1].y - cat.y, route[1].x - cat.x);
    }
    cat.route = route;
    cat.routeMode = "pingpong";
    cat.routeSource = "bfs";
  }

  diagnostics.imported = {
    cheese: cheese.length,
    cats: cats.length,
    exit: exit ? 1 : 0,
    pipes: pipes.length,
    transports: crossComponentLinks.length,
    transportsSameComponent: sameComponentLinks.length,
    hideables: hideables.length,
    holeLinks: holeLinksCross,
    holeLinksSameComponent: holeLinksSame,
  };

  const meta = levelMeta.get(String(lv.map));
  const hazardPath = path.join(ROOT, "assets", "masks", "hazards", `map${lv.map}.json`);
  const hazardMask = fs.existsSync(hazardPath) ? JSON.parse(fs.readFileSync(hazardPath, "utf8")) : null;
  const def = {
    id: "map" + lv.map,
    num: meta?.num || lv.num,
    name: meta?.name || lv.name,
    theme: meta?.theme || lv.theme,
    mode: meta?.mode || "normal",
    trailLength: meta?.trailLength ?? 1,
    times: meta?.times || null,
    goals: meta?.goals || null,
    secret: meta?.unlocked?.secret === "true",
    music: meta?.music || null,
    musicPath: meta?.musicPath || null,
    ambience: ambienceFor(lv.map, 0),
    bg: `assets/maps/map${lv.map}.jpg`,
    mask: `assets/masks/map${lv.map}.json`,
    source: "xml",
    mouseStart: start,
    exit,
    cheeses: cheese,
    crumbs,
    cats,
    bosses,
    bossParts,
    pipes,
    pipePieces,
    transports: crossComponentLinks,
    hideables,
    cwmice,
    cwmouseHoles: cwHoles,
    hazardMask,
    diagnostics,
  };

  fs.writeFileSync(path.join(OUT, `map${lv.map}.json`), JSON.stringify(def, null, 2));
  index.push({ id: def.id, num: def.num, name: def.name, theme: def.theme, file: `assets/levels/map${lv.map}.json` });
  written++;
}

fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2));
console.log(`imported ${written} levels with authentic entity placement`);
