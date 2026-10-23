// Carves walkable connectors at authentic entity positions, always connecting
// to the region reachable from the mouse start (not to arbitrary islands).
//   node tools/carve-entities.mjs
import fs from "fs";
import path from "path";

const ROOT = path.resolve(".");
const RES = path.join(ROOT, "com.ea.spymouse_row", "files", "res");
const MASKS = path.join(ROOT, "assets", "masks");

function parseEntities(mapNum) {
  const file = path.join(RES, "map" + mapNum, "map" + mapNum + ".xml");
  if (!fs.existsSync(file)) return null;
  const xml = fs.readFileSync(file, "utf8");
  const out = [];
  const re = /<Vertex\s+([^>]*)\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = m[1];
    const g = (k) => {
      const r = a.match(new RegExp(k + '\\s*=\\s*(-?\\d+)'));
      return r ? +r[1] : 0;
    };
    if (g("Flags") !== 10) continue;
    const prop = g("Property");
    const kind =
      prop === 1 ? "start" :
      prop >= 6 && prop <= 10 ? "cheese" :
      prop >= 240 && prop <= 243 ? "exit" :
      prop >= 50 && prop <= 59 ? "cat" : null;
    if (!kind) continue;
    out.push({ x: 2 * g("x") + 32, y: 2 * g("y") + 64, kind });
  }
  return out;
}

function makeGrid(mask) {
  const { cols, rows } = mask;
  const g = new Uint8Array(cols * rows);
  for (let i = 0; i < g.length; i++) g[i] = mask.data[i] === "1" ? 1 : 0;
  return g;
}

function saveGrid(mask, g) {
  mask.data = Array.from(g, (v) => (v ? "1" : "0")).join("");
}

function flood(g, cols, rows, sx, sy) {
  const seen = new Uint8Array(cols * rows);
  if (!g[sy * cols + sx]) return seen;
  const q = new Int32Array(cols * rows);
  let head = 0, tail = 0;
  const s = sy * cols + sx;
  seen[s] = 1;
  q[tail++] = s;
  const dirs = [1, -1, cols, -cols];
  while (head < tail) {
    const cur = q[head++];
    const cx = cur % cols;
    const cy = (cur / cols) | 0;
    for (let i = 0; i < 4; i++) {
      const nb = cur + dirs[i];
      if (nb < 0 || nb >= cols * rows) continue;
      const nx = nb % cols;
      const ny = (nb / cols) | 0;
      if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
      if (seen[nb] || !g[nb]) continue;
      seen[nb] = 1;
      q[tail++] = nb;
    }
  }
  return seen;
}

function nearestOpen(g, cols, rows, ex, ey, maxR) {
  let best = null;
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = ex + dx, ny = ey + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (!g[ny * cols + nx]) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { nx, ny, d };
      }
    if (best) break;
  }
  return best;
}

function nearestIn(g, cols, rows, ex, ey, region, maxR) {
  let best = null;
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = ex + dx, ny = ey + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (!region[ny * cols + nx]) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { nx, ny, d };
      }
    if (best) break;
  }
  return best;
}

function carveLine(g, cols, rows, x0, y0, x1, y1) {
  // 4-connected L path so grid BFS can traverse it.
  const xs = Math.sign(x1 - x0);
  for (let x = x0; x !== x1; x += xs || 1) {
    if (x >= 0 && y0 >= 0 && x < cols && y0 < rows) g[y0 * cols + x] = 1;
    if (!xs) break;
  }
  const ys = Math.sign(y1 - y0);
  for (let y = y0; y !== y1; y += ys || 1) {
    if (x1 >= 0 && y >= 0 && x1 < cols && y < rows) g[y * cols + x1] = 1;
    if (!ys) break;
  }
  if (x1 >= 0 && y1 >= 0 && x1 < cols && y1 < rows) g[y1 * cols + x1] = 1;
}

let touched = 0;
let carved = 0;

for (const maskFile of fs.readdirSync(MASKS)) {
  const mm = maskFile.match(/^map(\d+)\.json$/);
  if (!mm) continue;
  const ents = parseEntities(mm[1]);
  if (!ents) continue;
  const maskPath = path.join(MASKS, maskFile);
  const mask = JSON.parse(fs.readFileSync(maskPath, "utf8"));
  const { cols, rows, cell } = mask;
  const g = makeGrid(mask);
  let changed = false;

  const start = ents.find((e) => e.kind === "start");
  if (!start) continue;
  const toCell = (e) => ({
    ex: Math.max(0, Math.min(cols - 1, Math.floor(e.x / cell))),
    ey: Math.max(0, Math.min(rows - 1, Math.floor(e.y / cell))),
  });

  // 1. Ensure start is open, connecting to the nearest open cell if needed.
  let s = toCell(start);
  if (!g[s.ey * cols + s.ex]) {
    let target = nearestOpen(g, cols, rows, s.ex, s.ey, 16);
    if (!target) {
      // Totally empty mask: open a small area around start.
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = s.ex + dx, ny = s.ey + dy;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) g[ny * cols + nx] = 1;
        }
      changed = true;
    } else {
      carveLine(g, cols, rows, s.ex, s.ey, target.nx, target.ny);
      carved++;
      changed = true;
    }
  }
  let region = flood(g, cols, rows, s.ex, s.ey);

  // 2. Connect cheese/exit to the start region.
  const critical = ents.filter((e) => e.kind === "cheese" || e.kind === "exit");
  for (const e of critical) {
    const c = toCell(e);
    if (region[c.ey * cols + c.ex]) continue;
    const target = nearestIn(g, cols, rows, c.ex, c.ey, region, 18);
    if (!target) continue;
    carveLine(g, cols, rows, c.ex, c.ey, target.nx, target.ny);
    carved++;
    changed = true;
    region = flood(g, cols, rows, s.ex, s.ey);
  }

  // 3. Nudge misplaced cats onto nearby floor (small radius only).
  for (const e of ents) {
    if (e.kind !== "cat") continue;
    const c = toCell(e);
    if (g[c.ey * cols + c.ex]) continue;
    const target = nearestOpen(g, cols, rows, c.ex, c.ey, 2);
    if (!target) continue;
    carveLine(g, cols, rows, c.ex, c.ey, target.nx, target.ny);
    carved++;
    changed = true;
  }

  if (changed) {
    saveGrid(mask, g);
    fs.writeFileSync(maskPath, JSON.stringify(mask));
    touched++;
  }
}

console.log(`carved ${carved} connectors across ${touched} maps`);
