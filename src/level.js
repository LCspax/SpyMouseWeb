import { World } from "./world.js";
import { Cat } from "./entities.js";
import {Mechanisms} from './mechanisms.js';
import {Boss} from './boss.js';
import {pipeGroups} from './pipe-portals.js';
import { pickupPosition, mouthPosition, propDirection, exitInteractionPoint } from "./props.js";

// Level definitions come in two flavours:
//
//  * mask levels (imported from the APK): `mask` + `bg` + explicit entity
//    coordinates in background-pixel space.
//  * ascii levels (handy for tests): `rows` with markers
//    '#'=wall  '.'/' '=floor  'M'=mouse  'C'=cheese  'E'=exit  'K'=cat
export class Level {
  constructor(def) {
    this.id = def.id || def.map || "level";
    this.num = def.num || "";
    this.floor=def.floor||0;
    this.name = def.name || "Level";
    this.theme = def.theme || "";
    this.bg = def.bg || null;
    this.hint = def.hint || null;
    this.mode = def.mode || "normal";
    this.trailLength = def.trailLength ?? 1;
    this.times = def.times || null;
    this.goals = Array.isArray(def.goals) ? def.goals : null;
    this.secret = !!def.secret;

    if (def.mask) {
      this.world = World.fromMask(def.mask);
      this.useBg = true;
    } else {
      this.world = World.fromRows(def.rows, def.cell || 16);
      this.useBg = false;
    }
    // Cat navigation world: painted hazards (lava) are walls in the colour
    // mask but the native cat graph walk ignores them (parallel-J2). Only cat
    // movement/vision uses this world; the mouse keeps the base mask.
    // `hazardCells` is the mouse-side hazard layer used by src/hazards.js
    // (native burn subsystem). `waterCells`/`electricCells` are optional:
    // the shipped data pack cannot prove those layers, so they stay empty
    // unless a level definition provides them explicitly.
    this.catWorld = this.world;
    this.hazardCells = new Set();
    this.waterCells = new Set();
    this.electricCells = new Set();
    if (def.hazardMask) {
      const cells = new Set((def.hazardMask.cells || []).map((c) => c.ty * this.world.cols + c.tx));
      this.hazardCells = cells;
      const data = String(def.mask.data).split("");
      for (const i of cells) if (data[i] === "0") data[i] = "1";
      this.catWorld = World.fromMask({ ...def.mask, data: data.join("") });
    }
    if (def.waterMask) for (const c of def.waterMask.cells || []) this.waterCells.add(c.ty * this.world.cols + c.tx);
    if (def.electricMask) for (const c of def.electricMask.cells || []) this.electricCells.add(c.ty * this.world.cols + c.tx);
    this.music = def.music || null;
    this.ambience = def.ambience || null;
    if (def.collisionSegments?.length) {
      this.world.setCollisionSegments(def.collisionSegments);
      if (this.catWorld !== this.world) this.catWorld.setCollisionSegments(def.collisionSegments);
    }

    this.mouseStart = { x: 0, y: 0 };
    this.cheeses = [];
    this.exit = null;
    this.catSeeds = [];
    this.pipes = [];
    // Native pipe pieces 200-207 for rendering (parallel-N2); the traversal
    // links live in `transports`.
    this.pipePieces = Array.isArray(def.pipePieces) ? def.pipePieces.map((p) => ({ ...p })) : [];
    this.nativePipes=def.mechanisms?.source==='runtime-mbn'||this.pipePieces.length>0;
    this.pipeGroups=pipeGroups(this.pipePieces);
    this.transports = [];
    this.hideables = [];

    if (def.mouseStart) {
      this.mouseStart = { ...def.mouseStart };
    }
    if (def.cheeses) {
      for (const c of def.cheeses)
        this.cheeses.push({ ...c, ...pickupPosition(c, this.world), taken: false, prop: c.prop ?? null, glowT: 375 });
    }
    // Prop-260 crumbs (parallel-L1/N2). `null` means not imported: the
    // all_crumbs goal must stay unknown, never vacuously pass.
    this.crumbs = Array.isArray(def.crumbs)
      ? def.crumbs.map((c) => ({ ...c, ...pickupPosition(c, this.world), taken: false }))
      : null;
    if (def.exit) this.exit = { ...def.exit, ...exitInteractionPoint(def.exit, this.world) };
    // ObjControllerBoss bodies/parts (parallel-M1). Positions are the authored
    // world coordinates; no defeat trigger is invented here.
    this.bosses = [];
    if (Array.isArray(def.bosses)) {
      for (const b of def.bosses)
        this.bosses.push(new Boss({
          ...b,
          map: this.id.replace(/^map/, ""),
          cell: this.world.cell,
          parts: b.parts || [],
        }));
    }
    // Prop-11 cwmouse (parallel-L2): not cheese, no score; the runtime fields
    // mirror the native carried/hop/vanish states. `trap` is the paired
    // mousetrap (prop 60) the decoy runs into; `hole` is kept as a deprecated
    // alias for older readers (cwmouse.js still reads it). The truthful name
    // is trap: prop 60 is a mousetrap, not a mouse hole (findings §2.9).
    this.cwmice = [];
    if (Array.isArray(def.cwmice)) {
      for (const m of def.cwmice) {
        const trap = (m.trap || m.hole) ? { x: (m.trap || m.hole).x, y: (m.trap || m.hole).y, id: (m.trap || m.hole).id ?? null } : null;
        this.cwmice.push({
          id: m.id ?? null,
          tag: m.tag ?? 0,
          prop: 11,
          x: m.x,
          y: m.y,
          trap,
          hole: trap,
          picked: false,
          fleeing: false,
          gone: false,
          t: 0,
          ax: 0,
          ay: 0,
          bx: 0,
          by: 0,
          dur: 1,
          yOff: 0,
        });
      }
    }
    if (def.cats) {
      for (const c of def.cats) {
        this.catSeeds.push({
          x: c.x,
          y: c.y,
          angle: c.angle != null ? c.angle : 0,
          route: c.route || null,
          routeMode: c.routeMode || "pingpong",
          routeSource: c.routeSource || null,
          type: c.type || 0,
          prop: c.prop,
        });
      }
    }

    if (def.rows) {
      const cell = this.world.cell;
      for (let y = 0; y < def.rows.length; y++) {
        const row = def.rows[y];
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          const px = (x + 0.5) * cell;
          const py = (y + 0.5) * cell;
          if (ch === "M") this.mouseStart = { x: px, y: py };
          else if (ch === "C") this.cheeses.push({ x: px, y: py, taken: false });
          else if (ch === "E") this.exit = { x: px, y: py };
          else if (ch === "K") this.catSeeds.push({ x: px, y: py, angle: 0, route: null });
        }
      }
    }

    // H2: native routes can contain waypoints beyond the shipped art extent
    // (wide maps are cut short by roughly 16 design units), which cannot be
    // reached in the port. Resolve each out-of-world waypoint to the nearest
    // open cell in the same walkable component as the previous waypoint. The
    // level JSON keeps the native coordinates (fidelity audit unchanged).
    const compLabels = () => {
      if (this._compLabels) return this._compLabels;
      const w = this.world;
      const n = w.cols * w.rows;
      const lab = new Int32Array(n).fill(-1);
      for (let i = 0; i < n; i++) {
        const tx = i % w.cols;
        const ty = (i / w.cols) | 0;
        if (lab[i] !== -1 || w.isWall(tx, ty)) continue;
        lab[i] = i;
        const stack = [i];
        while (stack.length) {
          const c = stack.pop();
          const cx = c % w.cols;
          const cy = (c / w.cols) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w.cols || ny >= w.rows) continue;
            const ni = ny * w.cols + nx;
            if (lab[ni] !== -1 || w.isWall(nx, ny)) continue;
            lab[ni] = i;
            stack.push(ni);
          }
        }
      }
      this._compLabels = lab;
      return lab;
    };
    const resolveRoute = (route) => {
      if (!route || !route.length) return { route, resolved: [] };
      const w = this.world;
      const cell = w.cell;
      const lab = compLabels();
      const out = [];
      const resolved = [];
      let prev = null;
      for (const p of route) {
        const tx = Math.floor(p.x / cell);
        const ty = Math.floor(p.y / cell);
        const oob = tx < 0 || ty < 0 || tx >= w.cols || ty >= w.rows;
        if (!oob || !prev) {
          out.push({ x: p.x, y: p.y, wait: p.wait || 0 });
          if (!oob) prev = { tx, ty };
          continue;
        }
        const want = lab[prev.ty * w.cols + prev.tx];
        const cx = Math.min(Math.max(tx, 0), w.cols - 1);
        const cy = Math.min(Math.max(ty, 0), w.rows - 1);
        let best = null;
        let bestD = Infinity;
        for (let r = 0; r < 64 && best === null; r++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= w.cols || ny >= w.rows) continue;
              if (lab[ny * w.cols + nx] !== want) continue;
              const d = dx * dx + dy * dy;
              if (d < bestD) {
                bestD = d;
                best = { tx: nx, ty: ny };
              }
            }
          }
        }
        if (!best) {
          const no = w.nearestOpen(p.x, p.y);
          best = { tx: no.tx, ty: no.ty };
        }
        resolved.push({ index: out.length, from: { x: p.x, y: p.y }, to: { x: (best.tx + 0.5) * cell, y: (best.ty + 0.5) * cell } });
        out.push({ x: (best.tx + 0.5) * cell, y: (best.ty + 0.5) * cell, wait: p.wait || 0 });
      }
      return { route: out, resolved };
    };

    this.cats = [];
    for (const seed of this.catSeeds) {
      const base =
        seed.route && seed.route.length
          ? seed.route.map((p) => ({ x: p.x, y: p.y, wait: p.wait || 0 }))
          : [{ x: seed.x, y: seed.y, wait: 0 }];
      const { route, resolved } = resolveRoute(base);
      const cat = new Cat(seed.x, seed.y, route, seed.angle, this.world, seed.type, seed.routeMode);
      cat.routeSource = seed.routeSource;
      cat.routeResolvedOob = resolved;
      this.cats.push(cat);
    }

    if (Array.isArray(def.pipes)) {
      for (const p of def.pipes) {
        if (!p || !p.a || !p.b) continue;
        this.pipes.push({
          a: { x: p.a.x, y: p.a.y },
          b: { x: p.b.x, y: p.b.y },
          aExit: this.world.closestOpen(p.a.x, p.a.y),
          bExit: this.world.closestOpen(p.b.x, p.b.y),
        });
      }
    }
    if (Array.isArray(def.transports)) {
      for (const t of def.transports) {
        if (!t || !t.a || !t.b) continue;
        this.transports.push({
          kind: t.kind || "pipe",
          tag: t.tag ?? 0,
          a: { x: t.a.x, y: t.a.y },
          b: { x: t.b.x, y: t.b.y },
          aProp: t.aProp ?? null,
          bProp: t.bProp ?? null,
          aDir: t.aDir ?? null,
          bDir: t.bDir ?? null,
          pairing: t.pairing || "same-tag-ring",
          pairingEvidence: t.pairingEvidence || "unverified",
          verified: t.verified === true,
          aExit: this.transportMouth(t.a, t.aProp, t.aDir),
          bExit: this.transportMouth(t.b, t.bProp, t.bDir),
        });
      }
    }
    if (Array.isArray(def.hideables)) {
      for (const h of def.hideables) {
        this.hideables.push({ ...h });
      }
    }

    this.totalCheese = this.cheeses.length;
    this.mechanisms=new Mechanisms(this,def.mechanisms||{});
    if(def.mechanisms?.source==='runtime-mbn')this.transports=this.transports.filter(t=>!['pipe','pipeportal'].includes(t.kind));
    for(const t of def.mechanisms?.tunnels||[]){
      if(this.transports.some(p=>p.kind==='pipe'&&Math.abs(p.tag)===Math.abs(t.tag)&&Math.hypot(p.a.x-t.a.x,p.a.y-t.a.y)<16&&Math.hypot(p.b.x-t.b.x,p.b.y-t.b.y)<16))continue;
      this.transports.push({...t,aExit:this.transportMouth(t.a,t.aProp),bExit:this.transportMouth(t.b,t.bProp)});
    }
  }

  transportMouth(point, prop, dir) {
    if (!propDirection(prop) && !dir) return this.world.closestOpen(point.x, point.y, this.world.cell * 0.35);
    const mouth = mouthPosition({ ...point, prop, dir }, this.world.cell * 2);
    return this.world.closestOpen(mouth.x, mouth.y, this.world.cell * 0.35);
  }

  get catRange() {
    return this.cats.length ? this.cats[0].range : 0;
  }
}


